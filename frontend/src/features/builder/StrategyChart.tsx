import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react';
import type { ChainRow } from '../../api/types';
import { expectedMove, greekCurve, scaleIv, type GreekKey } from '../../domain/analysis';
import { strikeOi } from '../../domain/chain';
import { formatExpiry, parseExpiry, yearsToExpiry } from '../../domain/dates';
import { calibrateLegs, expiryCurve, pnlAtExpiry, pnlOnDate, type PayoffPoint } from '../../domain/payoff';
import { isLinear, type Leg, type StrategyMetrics } from '../../domain/types';
import { useMarket } from './market';
import { Chip, Segmented } from './parts';
import { PnlHeatmap } from './PnlHeatmap';

const MINUTE = 60_000;
const DAY = 86_400_000;
const LEFT = 58;
const TOP = 30;

function geometry(compact: boolean) {
  const W = compact ? 480 : 1000;
  const H = compact ? 380 : 400;
  return { W, H, RIGHT: W - (compact ? 60 : 76), BOTTOM: H - 82 };
}

const COMPACT_QUERY = '(max-width: 639px)';
const subscribeCompact = (cb: () => void) => {
  const mq = window.matchMedia?.(COMPACT_QUERY);
  mq?.addEventListener('change', cb);
  return () => mq?.removeEventListener('change', cb);
};
const getCompact = () => window.matchMedia?.(COMPACT_QUERY).matches ?? false;

/** "Nice" tick values between min and max — steps of 1, 2, 5 × 10ⁿ. */
function ticks(min: number, max: number, count: number): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const r = raw / mag;
  const step = (r > 5 ? 10 : r > 2 ? 5 : r > 1 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const istDay = (ms: number) => new Date(ms).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

/** Greek overlays; Rho only matters (and is only offered) for US positions. */
const greekList = (cur: string, us: boolean): { id: GreekKey; label: string; name: string; unit: string }[] => [
  { id: 'delta', label: 'Δ', name: 'Delta', unit: us ? 'shares' : 'units' },
  { id: 'gamma', label: 'Γ', name: 'Gamma', unit: 'Δ per pt' },
  { id: 'theta', label: 'Θ', name: 'Theta', unit: `${cur} / day` },
  { id: 'vega', label: 'ν', name: 'Vega', unit: `${cur} / vol pt` },
  ...(us ? [{ id: 'rho' as const, label: 'ρ', name: 'Rho', unit: `${cur} / 1% rate` }] : []),
];

function timeLeft(ms: number): string {
  const d = Math.floor(ms / DAY);
  if (d >= 1) return `${d}d`;
  const h = Math.floor(ms / 3_600_000);
  return h >= 1 ? `${h}h` : `${Math.max(0, Math.floor(ms / MINUTE))}m`;
}

export function StrategyChart({
  legs,
  spot,
  symbol,
  title,
  metrics,
  fallbackIv,
  marks,
  oiRows,
  capital,
}: {
  legs: Leg[];
  spot: number | null;
  symbol: string;
  /** "Iron condor · 27 Nov (24d) · ₹2,340 credit" style caption. */
  title: string;
  metrics: StrategyMetrics;
  fallbackIv: number | null;
  /** Live price per leg, so the "today" curve starts from the market. */
  marks: (number | null)[];
  oiRows: ChainRow[] | null;
  /** What P/L % is quoted against (margin, else max loss). */
  capital: number | null;
}) {
  const mk = useMarket();
  const GREEKS = greekList(mk.currencySymbol, mk.id === 'US');
  const signedInr = mk.signedMoney;
  const axisIndian = mk.axis;
  const priceText = mk.price;
  const compact = useSyncExternalStore(subscribeCompact, getCompact, () => false);
  const { W, H, RIGHT, BOTTOM } = geometry(compact);
  const PLOT_W = RIGHT - LEFT;
  const PLOT_H = BOTTOM - TOP;
  const svgRef = useRef<SVGSVGElement>(null);

  const [view, setView] = useState<'chart' | 'heatmap'>('chart');
  const [unit, setUnit] = useState<'abs' | 'pct'>('abs');
  const [greek, setGreek] = useState<GreekKey | null>(null);
  const [sigma, setSigma] = useState<0 | 1 | 2>(1);
  const [showOi, setShowOi] = useState(false);
  const [targetMs, setTargetMs] = useState<number | null>(null);
  const [ivScale, setIvScale] = useState(1);
  /** Half-width of the price window as a fraction of spot; null fits the strategy. */
  const [range, setRange] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), MINUTE);
    return () => window.clearInterval(t);
  }, []);

  const expiryMs = useMemo(() => {
    const times = legs.map((l) => (l.expiry ? parseExpiry(l.expiry)?.getTime() : undefined)).filter((t): t is number => t !== undefined);
    return times.length ? Math.min(...times) : null;
  }, [legs]);
  const nearestExpiry = useMemo(() => legs.map((l) => l.expiry).filter((e): e is string => !!e).sort()[0] ?? null, [legs]);
  const dateOpen = expiryMs !== null && expiryMs > now;
  const targetTime = expiryMs === null ? now : dateOpen ? clamp(targetMs ?? now, now, expiryMs) : expiryMs;
  const atExpiry = expiryMs !== null && targetTime >= expiryMs;
  const target = useMemo(() => new Date(targetTime), [targetTime]);
  const iv = fallbackIv ? fallbackIv * ivScale : null;
  const model = mk.model;
  const priced = useMemo(() => scaleIv(calibrateLegs(legs, spot, new Date(now), marks, model), ivScale), [legs, spot, now, marks, ivScale, model]);

  const em = useMemo(
    () => (spot && nearestExpiry ? expectedMove(spot, iv, yearsToExpiry(new Date(now), nearestExpiry)) : null),
    [spot, iv, nearestExpiry, now],
  );

  // Fitted window: every strike and spot, padded, wide enough for the σ band.
  const fit = useMemo(() => {
    const points = [spot ?? 0, ...legs.filter((l) => !isLinear(l.type)).map((l) => l.strike)].filter((v) => v > 0);
    const xs = points.length ? points : [100];
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    const pad = Math.max(hi - lo, hi * 0.04, 10) * 0.6;
    let min = Math.max(0, lo - pad);
    let max = hi + pad;
    if (spot && em && sigma) {
      min = Math.min(min, spot - em * sigma * 1.15);
      max = Math.max(max, spot + em * sigma * 1.15);
    }
    return { min: Math.max(0, min), max };
  }, [legs, spot, em, sigma]);
  const centre = spot ?? (fit.min + fit.max) / 2;
  const xMin = range === null ? fit.min : Math.max(0, centre * (1 - range));
  const xMax = range === null ? fit.max : centre * (1 + range);
  const fitRange = spot ? Math.max(spot - fit.min, fit.max - spot) / spot : 0.1;

  const scale = (v: number) => (unit === 'pct' && capital && capital > 0 ? (v / capital) * 100 : v);
  const pctOk = !!capital && capital > 0;

  const { expirySeries, targetSeries, yMin, yMax, greekSeries } = useMemo(() => {
    const exp: PayoffPoint[] = legs.length ? expiryCurve(legs, xMin, xMax, 240) : [];
    const prices = exp.map((p) => p.price);
    const tgt = atExpiry ? null : prices.map((price) => ({ price, pnl: pnlOnDate(priced, price, target, iv, model) }));
    const tgtOk = tgt && tgt.every((p) => p.pnl !== null) ? (tgt as PayoffPoint[]) : null;
    const s = (v: number) => (unit === 'pct' && capital && capital > 0 ? (v / capital) * 100 : v);
    const ys = [...exp.map((p) => s(p.pnl)), ...(tgtOk?.map((p) => s(p.pnl)) ?? [])];
    const lo = ys.length ? Math.min(...ys, 0) : -1;
    const hi = ys.length ? Math.max(...ys, 0) : 1;
    const pad = (hi - lo || 1) * 0.12;
    return {
      expirySeries: exp,
      targetSeries: tgtOk,
      yMin: lo - pad,
      yMax: hi + pad,
      greekSeries: greek ? greekCurve(priced, prices.filter((_, i) => i % 3 === 0), target, iv, greek, model) : null,
    };
  }, [legs, priced, xMin, xMax, target, iv, atExpiry, unit, capital, greek, model]);

  const oi = useMemo(() => (showOi && oiRows?.length ? strikeOi(oiRows, xMin, xMax, 'oi') : null), [showOi, oiRows, xMin, xMax]);

  const px = (price: number) => LEFT + ((price - xMin) / (xMax - xMin || 1)) * PLOT_W;
  const py = (v: number) => TOP + (1 - (v - yMin) / (yMax - yMin || 1)) * PLOT_H;
  const toPrice = (x: number) => xMin + ((x - LEFT) / PLOT_W) * (xMax - xMin);
  const zeroY = py(0);

  // Wheel zooms the price window around spot. Native, non-passive, so the page doesn't scroll.
  const wheel = useRef<(e: WheelEvent) => void>(() => {});
  wheel.current = (e: WheelEvent) => {
    if (!spot) return;
    e.preventDefault();
    const current = range ?? fitRange;
    setRange(clamp(current * Math.exp(clamp(e.deltaY, -200, 200) * 0.002), 0.01, 0.5));
  };
  const hasChart = legs.length > 0 && view === 'chart';
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => wheel.current(e);
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [hasChart]);

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    if (box.width <= 0) return;
    const x = ((e.clientX - box.left) / box.width) * W;
    setHoverX(x >= LEFT && x <= RIGHT ? x : null);
  };

  const path = (pts: { price: number; v: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${px(p.price).toFixed(1)} ${py(p.v).toFixed(1)}`).join(' ');
  const expiryPath = path(expirySeries.map((p) => ({ price: p.price, v: scale(p.pnl) })));
  const targetPath = targetSeries ? path(targetSeries.map((p) => ({ price: p.price, v: scale(p.pnl) }))) : null;
  const area = expirySeries.length
    ? `${expiryPath} L${px(expirySeries[expirySeries.length - 1].price).toFixed(1)} ${zeroY.toFixed(1)} L${px(expirySeries[0].price).toFixed(1)} ${zeroY.toFixed(1)} Z`
    : '';

  // Greek overlay on its own scale, with 0 on the P&L zero line.
  const greekPath = (() => {
    if (!greekSeries?.length) return null;
    const peak = Math.max(...greekSeries.map((g) => Math.abs(g.value)), 1e-12);
    const room = Math.max(zeroY - TOP, BOTTOM - zeroY) * 0.85;
    return greekSeries.map((g, i) => `${i ? 'L' : 'M'}${px(g.price).toFixed(1)} ${(zeroY - (g.value / peak) * room).toFixed(1)}`).join(' ');
  })();

  const fmtY = (v: number) => (unit === 'pct' && pctOk ? `${v.toFixed(Math.abs(v) < 10 ? 1 : 0)}%` : Math.abs(v) >= 1000 ? axisIndian(v) : v.toFixed(0));
  const fmtVal = (v: number) => (unit === 'pct' && pctOk ? `${v >= 0 ? '+' : ''}${scale(v).toFixed(1)}%` : signedInr(v));

  // Strike chips under the plot, in two staggered rows when they crowd.
  const chips = (() => {
    const seen = new Map<string, { x: number; label: string; sell: boolean }>();
    for (const l of legs) {
      if (isLinear(l.type) || l.strike < xMin || l.strike > xMax) continue;
      const key = `${l.type}${l.strike}`;
      if (!seen.has(key)) seen.set(key, { x: px(l.strike), label: `${l.type === 'CE' ? 'C' : 'P'} ${l.strike.toLocaleString('en-IN')}`, sell: l.action === 'SELL' });
    }
    const list = [...seen.values()].sort((a, b) => a.x - b.x);
    const lastEnd = [-Infinity, -Infinity];
    return list.map((c) => {
      const w = c.label.length * 6.4 + 10;
      const row = c.x - w / 2 > lastEnd[0] + 2 ? 0 : 1;
      lastEnd[row] = c.x + w / 2;
      return { ...c, w, row };
    });
  })();
  const chipRows = chips.some((c) => c.row === 1) ? 2 : 1;
  const beY = BOTTOM + 14 + chipRows * 18 + 2;

  if (legs.length === 0) return null;

  const hoverPrice = hoverX === null ? null : toPrice(hoverX);
  const hoverExp = hoverPrice === null ? null : pnlAtExpiry(legs, hoverPrice);
  const hoverTgt = hoverPrice === null || atExpiry ? null : pnlOnDate(priced, hoverPrice, target, iv, model);
  const hoverGreek =
    hoverPrice !== null && greek ? (greekCurve(priced, [hoverPrice], target, iv, greek, model)[0]?.value ?? null) : null;
  const xTicks = ticks(xMin, xMax, compact ? 5 : 9);
  const yTicks = ticks(yMin, yMax, 5);
  const band = spot && em && sigma ? { lo: spot - em * sigma, hi: spot + em * sigma } : null;
  const rangeLabel = spot ? `−${(((spot - xMin) / spot) * 100).toFixed(0)}% / +${(((xMax - spot) / spot) * 100).toFixed(0)}%` : '';
  const half = expiryMs !== null ? now + (expiryMs - now) / 2 : now;
  const quick = [
    { label: 'Today', ms: now },
    { label: '+1w', ms: now + 7 * DAY },
    { label: 'Half-way', ms: half },
    { label: 'Expiry', ms: expiryMs ?? now },
  ].filter((q) => expiryMs === null || q.ms <= expiryMs || q.label === 'Expiry');
  const pinLabel = (v: number, y: number, color: string) => (
    <g>
      <rect x={RIGHT + 4} y={y - 9} width={W - RIGHT - 6} height={18} rx={4} fill={color} />
      <text x={RIGHT + 4 + (W - RIGHT - 6) / 2} y={y + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill="#fff">
        {unit === 'pct' && pctOk ? `${scale(v) >= 0 ? '+' : ''}${scale(v).toFixed(0)}%` : `${v >= 0 ? '+' : '−'}${axisIndian(Math.abs(v))}`}
      </text>
    </g>
  );

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <Segmented
          label="P&L unit"
          size="xs"
          value={unit}
          onChange={setUnit}
          options={[
            { id: 'abs', label: `P/L ${mk.currencySymbol}` },
            { id: 'pct', label: 'P/L %', title: pctOk ? 'Percent of capital at risk (margin)' : 'Needs a margin figure' },
          ]}
        />
        {view === 'chart' && (
          <>
            <div className="flex items-center gap-1" role="group" aria-label="Greek overlay">
              {GREEKS.map((g) => (
                <Chip key={g.id} active={greek === g.id} title={`Overlay position ${g.name}`} onClick={() => setGreek(greek === g.id ? null : g.id)} className="!px-2.5">
                  {g.label}
                </Chip>
              ))}
            </div>
            <div className="flex items-center gap-1" role="group" aria-label="Expected move band">
              {([1, 2] as const).map((k) => (
                <Chip key={k} active={sigma === k} disabled={!em} title={`Shade the ±${k}σ expected move`} onClick={() => setSigma(sigma === k ? 0 : k)}>
                  ±{k}σ
                </Chip>
              ))}
            </div>
            {!!oiRows?.length && (
              <Chip active={showOi} onClick={() => setShowOi(!showOi)} title="Open interest by strike behind the payoff">
                OI
              </Chip>
            )}
          </>
        )}
        <div className="ml-auto">
          <Segmented
            label="View"
            size="xs"
            value={view}
            onChange={setView}
            options={[
              { id: 'chart', label: 'Chart' },
              { id: 'heatmap', label: 'Heatmap' },
            ]}
          />
        </div>
      </div>

      {view === 'heatmap' ? (
        <PnlHeatmap
          legs={priced}
          symbol={symbol}
          spot={spot}
          fallbackIv={iv}
          nowMs={now}
          expiryMs={expiryMs}
          capital={unit === 'pct' && pctOk ? capital : null}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-2 text-xs">
            <span className="truncate text-[var(--text-secondary)]">
              <span className="font-semibold text-[var(--text-primary)]">{mk.display(symbol)}</span> · {title}
            </span>
            <span className="flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
              {!atExpiry && targetSeries && (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-0.5 w-4 bg-[var(--series-blue)]" />
                  {targetTime - now < MINUTE ? 'Today' : istDay(targetTime)}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4" style={{ background: 'linear-gradient(90deg, var(--critical) 50%, var(--good) 50%)' }} />
                Expiry
              </span>
              {greek && (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-0.5 w-4 bg-[var(--series-violet)]" />
                  {GREEKS.find((g) => g.id === greek)?.name}
                </span>
              )}
            </span>
          </div>

          <div className="relative px-1">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              className="w-full touch-pan-y select-none"
              role="img"
              aria-label={`Payoff chart. Max profit ${metrics.maxProfit === null ? 'unlimited' : signedInr(metrics.maxProfit)}, max loss ${metrics.maxLoss === null ? 'unlimited' : signedInr(metrics.maxLoss)}.`}
              onPointerMove={onMove}
              onPointerDown={onMove}
              onPointerLeave={() => setHoverX(null)}
            >
              <defs>
                <clipPath id="sc-plot">
                  <rect x={LEFT} y={TOP} width={PLOT_W} height={PLOT_H} />
                </clipPath>
                <clipPath id="sc-up">
                  <rect x={LEFT} y={TOP} width={PLOT_W} height={clamp(zeroY - TOP, 0, PLOT_H)} />
                </clipPath>
                <clipPath id="sc-down">
                  <rect x={LEFT} y={clamp(zeroY, TOP, BOTTOM)} width={PLOT_W} height={clamp(BOTTOM - zeroY, 0, PLOT_H)} />
                </clipPath>
              </defs>

              {yTicks.map((v) => (
                <line key={v} x1={LEFT} x2={RIGHT} y1={py(v)} y2={py(v)} stroke="var(--gridline)" strokeDasharray={v === 0 ? undefined : '3 4'} />
              ))}

              {band && (
                <g clipPath="url(#sc-plot)">
                  <rect x={px(band.lo)} y={TOP} width={Math.max(px(band.hi) - px(band.lo), 0)} height={PLOT_H} fill="var(--series-blue)" fillOpacity={0.07} />
                  <line x1={px(band.lo)} x2={px(band.lo)} y1={TOP} y2={BOTTOM} stroke="var(--series-blue)" strokeOpacity={0.35} />
                  <line x1={px(band.hi)} x2={px(band.hi)} y1={TOP} y2={BOTTOM} stroke="var(--series-blue)" strokeOpacity={0.35} />
                </g>
              )}
              {band && px(band.hi) <= RIGHT && (
                <text x={px(band.hi) - 4} y={TOP + 12} textAnchor="end" fontSize={10} fill="var(--series-blue)">
                  ±{sigma}σ {mk.id === 'US' ? `$${(em! * sigma).toFixed(2)}` : Math.round(em! * sigma).toLocaleString('en-IN')}
                </text>
              )}

              {oi && oi.peak > 0 && (
                <g clipPath="url(#sc-plot)" pointerEvents="none">
                  {oi.bars.map((b) => {
                    const w = oi.step ? clamp((oi.step / (xMax - xMin)) * PLOT_W * 0.36, 1, 10) : 5;
                    const h = (v: number) => (Math.abs(v) / oi.peak) * PLOT_H * 0.3;
                    return (
                      <g key={b.strike} opacity={0.28}>
                        <rect x={px(b.strike) - w - 0.5} y={BOTTOM - h(b.call)} width={w} height={h(b.call)} fill="var(--critical)" />
                        <rect x={px(b.strike) + 0.5} y={BOTTOM - h(b.put)} width={w} height={h(b.put)} fill="var(--good)" />
                      </g>
                    );
                  })}
                </g>
              )}

              <g clipPath="url(#sc-plot)">
                <path d={area} fill="var(--good-fill)" clipPath="url(#sc-up)" />
                <path d={area} fill="var(--critical-fill)" clipPath="url(#sc-down)" />
                <line x1={LEFT} x2={RIGHT} y1={zeroY} y2={zeroY} stroke="var(--baseline)" strokeWidth={1.2} />
                {metrics.maxProfit !== null && (
                  <line x1={LEFT} x2={RIGHT} y1={py(scale(metrics.maxProfit))} y2={py(scale(metrics.maxProfit))} stroke="var(--good)" strokeDasharray="4 4" strokeOpacity={0.7} />
                )}
                {metrics.maxLoss !== null && (
                  <line x1={LEFT} x2={RIGHT} y1={py(scale(metrics.maxLoss))} y2={py(scale(metrics.maxLoss))} stroke="var(--critical)" strokeDasharray="4 4" strokeOpacity={0.7} />
                )}
                {spot !== null && spot >= xMin && spot <= xMax && (
                  <line x1={px(spot)} x2={px(spot)} y1={TOP} y2={BOTTOM} stroke="var(--text-muted)" strokeWidth={1} />
                )}
                {greekPath && <path d={greekPath} fill="none" stroke="var(--series-violet)" strokeWidth={1.6} strokeDasharray="5 3" />}
                <path d={expiryPath} fill="none" stroke="var(--good)" strokeWidth={2.4} strokeLinejoin="round" clipPath="url(#sc-up)" />
                <path d={expiryPath} fill="none" stroke="var(--critical)" strokeWidth={2.4} strokeLinejoin="round" clipPath="url(#sc-down)" />
                {targetPath && <path d={targetPath} fill="none" stroke="var(--series-blue)" strokeWidth={2} strokeLinejoin="round" />}
                {metrics.breakevens
                  .filter((b) => b >= xMin && b <= xMax)
                  .map((b) => (
                    <circle key={b} cx={px(b)} cy={zeroY} r={3.5} fill="var(--text-primary)" stroke="var(--surface-card)" strokeWidth={1.5} />
                  ))}
              </g>

              {spot !== null && spot >= xMin && spot <= xMax && (
                <g>
                  <rect x={px(spot) - 46} y={6} width={92} height={18} rx={9} fill="var(--surface-raised)" stroke="var(--border-strong)" />
                  <text x={px(spot)} y={19} textAnchor="middle" fontSize={11} fill="var(--text-primary)">
                    <tspan fill="var(--text-muted)">{compact ? '' : `${mk.display(symbol).slice(0, 9)} `}</tspan>
                    <tspan fontWeight={600}>{priceText(spot)}</tspan>
                  </text>
                </g>
              )}

              {yTicks.map((v) => (
                <text key={v} x={LEFT - 8} y={py(v) + 3.5} textAnchor="end" fontSize={10.5} fill="var(--text-muted)">
                  {fmtY(v)}
                </text>
              ))}
              {metrics.maxProfit !== null && pinLabel(metrics.maxProfit, py(scale(metrics.maxProfit)), 'var(--good)')}
              {metrics.maxLoss !== null && pinLabel(metrics.maxLoss, py(scale(metrics.maxLoss)), 'var(--critical)')}

              {chips.map((c) => (
                <g key={c.label}>
                  <line x1={c.x} x2={c.x} y1={BOTTOM} y2={BOTTOM + 6 + c.row * 18} stroke="var(--border-strong)" strokeDasharray="2 2" />
                  <rect x={c.x - c.w / 2} y={BOTTOM + 6 + c.row * 18} width={c.w} height={16} rx={4} fill={c.sell ? 'var(--critical)' : 'var(--series-blue)'} />
                  <text x={c.x} y={BOTTOM + 17.5 + c.row * 18} textAnchor="middle" fontSize={10.5} fontWeight={600} fill="#fff">
                    {c.label}
                  </text>
                </g>
              ))}
              {metrics.breakevens
                .filter((b) => b >= xMin && b <= xMax)
                .map((b) => {
                  const label = `BE ${priceText(b)}`;
                  const w = label.length * 6.2 + 10;
                  return (
                    <g key={`be-${b}`}>
                      <rect x={clamp(px(b) - w / 2, LEFT, RIGHT - w)} y={beY} width={w} height={16} rx={4} fill="var(--surface-raised)" stroke="var(--border-strong)" />
                      <text x={clamp(px(b), LEFT + w / 2, RIGHT - w / 2)} y={beY + 11.5} textAnchor="middle" fontSize={10.5} fill="var(--text-primary)">
                        {label}
                      </text>
                    </g>
                  );
                })}
              {xTicks.map((v) => (
                <text key={v} x={px(v)} y={H - 6} textAnchor="middle" fontSize={10.5} fill="var(--text-muted)">
                  {v.toLocaleString('en-IN')}
                </text>
              ))}

              {hoverPrice !== null && hoverExp !== null && (
                <g pointerEvents="none">
                  <line x1={hoverX!} x2={hoverX!} y1={TOP} y2={BOTTOM} stroke="var(--text-secondary)" strokeDasharray="3 3" />
                  <circle cx={hoverX!} cy={py(scale(hoverExp))} r={4} fill={hoverExp >= 0 ? 'var(--good)' : 'var(--critical)'} stroke="var(--surface-card)" strokeWidth={1.5} />
                  {hoverTgt !== null && <circle cx={hoverX!} cy={py(scale(hoverTgt))} r={4} fill="var(--series-blue)" stroke="var(--surface-card)" strokeWidth={1.5} />}
                </g>
              )}
            </svg>

            {hoverPrice !== null && hoverExp !== null && (
              <div
                className="pointer-events-none absolute top-8 z-10 w-max min-w-[11rem] rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-xs tabular shadow-xl"
                style={{
                  left: `${(hoverX! / W) * 100}%`,
                  transform: hoverX! > W * 0.6 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
                }}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold">{priceText(hoverPrice)}</span>
                  {spot && (
                    <span className="text-[var(--text-muted)]">
                      {hoverPrice >= spot ? '+' : ''}
                      {(((hoverPrice - spot) / spot) * 100).toFixed(2)}%
                    </span>
                  )}
                </div>
                {hoverTgt !== null && (
                  <div className="mt-1 flex justify-between gap-3">
                    <span className="text-[var(--series-blue)]">{targetTime - now < MINUTE ? 'Today' : istDay(targetTime)}</span>
                    <span style={{ color: hoverTgt >= 0 ? 'var(--good-text)' : 'var(--critical)' }}>{fmtVal(hoverTgt)}</span>
                  </div>
                )}
                <div className="mt-0.5 flex justify-between gap-3">
                  <span className="text-[var(--text-secondary)]">At expiry</span>
                  <span style={{ color: hoverExp >= 0 ? 'var(--good-text)' : 'var(--critical)' }}>{fmtVal(hoverExp)}</span>
                </div>
                {hoverGreek !== null && greek && (
                  <div className="mt-0.5 flex justify-between gap-3">
                    <span className="text-[var(--series-violet)]">{GREEKS.find((g) => g.id === greek)?.name}</span>
                    <span>
                      {hoverGreek.toFixed(greek === 'gamma' ? 3 : greek === 'delta' ? 1 : mk.id === 'US' ? 2 : 0)}{' '}
                      {GREEKS.find((g) => g.id === greek)?.unit}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      <div className="grid gap-x-6 gap-y-3 border-t border-[var(--border)] px-3 py-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center gap-3">
            <div className="w-28 shrink-0">
              <div className="text-xs font-semibold">{atExpiry ? 'Expiry' : targetTime - now < MINUTE ? 'Today' : istDay(targetTime)}</div>
              <div className="text-[11px] text-[var(--text-muted)]">
                {expiryMs === null ? 'No expiry on legs' : atExpiry ? (nearestExpiry ? formatExpiry(nearestExpiry) : '') : `${timeLeft(expiryMs - targetTime)} to expiry`}
              </div>
            </div>
            <input
              type="range"
              className="ob-range min-w-0 flex-1"
              min={now}
              max={expiryMs ?? now}
              step={30 * MINUTE}
              value={targetTime}
              disabled={!dateOpen}
              aria-label="Valuation date"
              aria-valuetext={istDay(targetTime)}
              onChange={(e) => setTargetMs(Number(e.target.value))}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {quick.map((q) => (
              <Chip
                key={q.label}
                disabled={!dateOpen}
                active={dateOpen && Math.abs(targetTime - clamp(q.ms, now, expiryMs ?? now)) < 30 * MINUTE}
                onClick={() => setTargetMs(q.label === 'Today' ? null : q.ms)}
              >
                {q.label}
              </Chip>
            ))}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <label className="flex items-center gap-3 text-xs">
            <span className="w-12 shrink-0 font-semibold" title="Scale every leg's implied volatility">
              IV
            </span>
            <input type="range" className="ob-range min-w-0 flex-1" min={0.5} max={2} step={0.05} value={ivScale} onChange={(e) => setIvScale(Number(e.target.value))} />
            <button type="button" className="w-12 shrink-0 text-right tabular hover:underline" onClick={() => setIvScale(1)} title="Reset IV">
              ×{ivScale.toFixed(2)}
            </button>
          </label>
          <div className="flex items-center gap-3 text-xs">
            <span className="w-12 shrink-0 font-semibold">Range</span>
            <input
              type="range"
              className="ob-range min-w-0 flex-1"
              min={0.01}
              max={0.4}
              step={0.005}
              value={range ?? fitRange}
              disabled={!spot}
              aria-label="Price range"
              onChange={(e) => setRange(Number(e.target.value))}
            />
            <span className="shrink-0 tabular text-[var(--text-muted)] max-sm:hidden">{rangeLabel}</span>
            <Chip active={range === null} onClick={() => setRange(null)} title="Fit the strategy">
              Fit
            </Chip>
          </div>
        </div>
      </div>
    </div>
  );
}
