import { useMemo, useRef, useState, type PointerEvent } from 'react';
import type { HistorySeries, PortfolioTxn } from '../../api/types';
import { avgBuyFx, FX_KEY, istDate, rebase, tradingCalendar, usReturnsInrVsUsd, type PricePoints } from '../../domain/portfolio';
import { signedInr } from '../../lib/format';
import { isUs } from '../../lib/markets';
import { usePriceHistory } from './usePortfolios';

const PERIODS = ['1M', '6M', '1Y', '5Y', '10Y', 'All'] as const;
type FxPeriod = (typeof PERIODS)[number];
type Mode = 'rate' | 'value';

const MONTHS: Record<Exclude<FxPeriod, 'All'>, number> = { '1M': 1, '6M': 6, '1Y': 12, '5Y': 60, '10Y': 120 };

function startOf(period: FxPeriod, last: string, first: string): string {
  if (period === 'All') return first;
  const d = new Date(`${last}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - MONTHS[period]);
  return d.toISOString().slice(0, 10);
}

const pct = (v: number, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}%`;
const rupee = (v: number) => `₹${v.toFixed(2)}`;
const shortDate = (d: string, withYear: boolean) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(withYear ? { year: '2-digit' } : {}), timeZone: 'UTC' });

interface FxLine {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
  dashed?: boolean;
  fill?: boolean;
}

const W = 440;
const H = 200;
const LEFT = 8;
const RIGHT = W - 48;
const TOP = 10;
const BOTTOM = H - 24;

/** Lines on a date axis with the scale on the right; optional marker dots and one dashed reference level. */
function FxChart({
  dates,
  lines,
  format,
  markers = [],
  reference,
  label,
}: {
  dates: string[];
  lines: FxLine[];
  format: (v: number) => string;
  markers?: { index: number; value: number; text: string }[];
  reference?: { value: number; color: string; text: string };
  label: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const n = dates.length - 1;
  const all = lines.flatMap((l) => l.values).filter((v): v is number => v !== null);
  if (reference) all.push(reference.value);
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.01 || 1;
  lo -= pad;
  hi += pad;
  const x = (i: number) => LEFT + ((RIGHT - LEFT) * i) / Math.max(n, 1);
  const y = (v: number) => TOP + (BOTTOM - TOP) * (1 - (v - lo) / (hi - lo));
  const yTicks = Array.from({ length: 5 }, (_, k) => lo + ((hi - lo) * (k + 0.5)) / 5);
  const spanYears = (Date.parse(dates[n]) - Date.parse(dates[0])) / (365 * 864e5);
  const xTicks = Array.from({ length: 5 }, (_, k) => Math.round((n * k) / 4));
  const path = (vals: (number | null)[]) => {
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
      pen = true;
    });
    return d;
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const px = ((e.clientX - box.left) / box.width) * W;
    setHover(Math.max(0, Math.min(n, Math.round(((px - LEFT) / (RIGHT - LEFT)) * n))));
  };
  const hoverMarker = hover === null ? undefined : markers.find((m) => m.index === hover);

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label={label}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={LEFT} x2={RIGHT} y1={y(v)} y2={y(v)} stroke="var(--gridline)" strokeWidth={1} />
            <text x={RIGHT + 6} y={y(v) + 3} fontSize={10} fill="var(--text-muted)">
              {format(v)}
            </text>
          </g>
        ))}
        {xTicks.map((i, k) => (
          <text key={k} x={x(i)} y={H - 7} textAnchor={k === 0 ? 'start' : k === 4 ? 'end' : 'middle'} fontSize={10} fill="var(--text-muted)">
            {shortDate(dates[i], spanYears > 0.9)}
          </text>
        ))}
        <defs>
          <linearGradient id="fx-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--series-blue)" stopOpacity={0.22} />
            <stop offset="1" stopColor="var(--series-blue)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {lines
          .filter((l) => l.fill)
          .map((l) => {
            const first = l.values.findIndex((v) => v !== null);
            const last = l.values.length - 1 - [...l.values].reverse().findIndex((v) => v !== null);
            return first < 0 ? null : <path key={`${l.key}-fill`} d={`${path(l.values)} L${x(last)} ${BOTTOM} L${x(first)} ${BOTTOM} Z`} fill="url(#fx-area)" />;
          })}
        {reference && (
          <g>
            <line x1={LEFT} x2={RIGHT} y1={y(reference.value)} y2={y(reference.value)} stroke={reference.color} strokeWidth={1.2} strokeDasharray="5 4" />
            <rect x={RIGHT + 1} y={y(reference.value) - 8} width={48} height={16} rx={2} fill={reference.color} />
            <text x={RIGHT + 25} y={y(reference.value) + 3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--surface-card)">
              {format(reference.value)}
            </text>
          </g>
        )}
        {lines.map((l) => (
          <path key={l.key} d={path(l.values)} fill="none" stroke={l.color} strokeWidth={l.dashed ? 1.5 : 2} strokeDasharray={l.dashed ? '5 4' : undefined} strokeLinejoin="round" />
        ))}
        {markers.map((m, k) => (
          <circle key={k} cx={x(m.index)} cy={y(m.value)} r={4.5} fill="var(--warning)" stroke="var(--surface-card)" strokeWidth={2}>
            <title>{m.text}</title>
          </circle>
        ))}
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={TOP} y2={BOTTOM} stroke="var(--text-muted)" strokeWidth={0.8} />
            {lines.map((l) => {
              const v = l.values[hover];
              return v === null ? null : <circle key={l.key} cx={x(hover)} cy={y(v)} r={3.5} fill={l.color} stroke="var(--surface-card)" strokeWidth={1.2} />;
            })}
          </g>
        )}
      </svg>
      <div className="flex min-h-6 flex-wrap justify-center gap-x-4 gap-y-1 border-t border-[var(--border)] pt-2 text-xs tabular" aria-live="polite">
        {hover === null ? (
          <span className="text-[var(--text-muted)]">Hover the chart to see any day</span>
        ) : (
          <>
            <span className="text-[var(--text-muted)]">{shortDate(dates[hover], true)}</span>
            {lines.map((l) => {
              const v = l.values[hover];
              return (
                <span key={l.key} className="text-[var(--text-secondary)]">
                  <span style={{ color: l.color }}>●</span> {l.label} {v === null ? '—' : format(v)}
                </span>
              );
            })}
            {hoverMarker && <span className="text-[var(--warning)]">{hoverMarker.text}</span>}
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-md bg-[var(--surface-sunken)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

const Swatch = ({ color, dashed, round }: { color: string; dashed?: boolean; round?: boolean }) =>
  dashed ? (
    <span className="inline-block w-3.5 border-t-2 border-dashed align-middle" style={{ borderColor: color }} />
  ) : (
    <span className={`inline-block h-2.5 w-2.5 ${round ? 'rounded-full' : 'rounded-sm'}`} style={{ background: color }} />
  );

/**
 * INR vs US dollar, under the allocation: the USD/INR rate with your US buys
 * on it and your average rate, or your US stocks' return in rupees beside the
 * same return in dollars — the gap is what the rupee added.
 */
export function FxPanel({
  txns,
  history,
  liveFx,
  currencyGain,
}: {
  txns: PortfolioTxn[];
  /** The page's daily closes (holdings and USD/INR, back to the first trade). */
  history: Record<string, HistorySeries> | undefined;
  liveFx: number | null;
  /** Rupee gain on US holdings from the rate moving since purchase. */
  currencyGain: number;
}) {
  const [mode, setMode] = useState<Mode>('rate');
  const [period, setPeriod] = useState<FxPeriod>('1Y');
  // The rate's whole history, so 10Y and All reach back beyond your first trade.
  const rateHistory = usePriceHistory([FX_KEY], 'max');
  const usTxns = useMemo(() => txns.filter((t) => t.kind === 'STOCK' && isUs(t.symbol)), [txns]);
  const hasUs = usTxns.length > 0;
  const avg = useMemo(() => avgBuyFx(usTxns), [usTxns]);
  const view: Mode = hasUs ? mode : 'rate';

  const rate = useMemo(() => {
    const points: PricePoints | undefined = rateHistory.data?.[FX_KEY]?.points ?? history?.[FX_KEY]?.points;
    if (!points || points.length < 2) return null;
    const all = points.map(([t, c]) => ({ date: istDate(t), value: c }));
    const start = startOf(period, all[all.length - 1].date, all[0].date);
    const s = all.filter((p) => p.date >= start);
    if (s.length < 2) return null;
    const dates = s.map((p) => p.date);
    const markers = usTxns
      .filter((t) => t.side === 'BUY' && t.fx && t.date >= dates[0])
      .map((t) => {
        const i = dates.findIndex((d) => d >= t.date);
        return { index: i < 0 ? dates.length - 1 : i, value: t.fx!, text: `Bought ${t.symbol.replace(/^US:/, '')} at ${rupee(t.fx!)}` };
      });
    return { dates, values: s.map((p) => p.value), markers };
  }, [rateHistory.data, history, period, usTxns]);

  const value = useMemo(() => {
    if (!hasUs || !history) return null;
    const h = Object.fromEntries(Object.entries(history).map(([k, v]) => [k, v.points]));
    const calendar = tradingCalendar(h[FX_KEY], ...usTxns.map((t) => h[t.symbol]));
    const r = usReturnsInrVsUsd(usTxns, h, calendar);
    if (!r || r.inr.length < 2) return null;
    const start = startOf(period, r.inr[r.inr.length - 1].date, r.inr[0].date);
    const inr = rebase(r.inr, start);
    const usdMap = new Map(rebase(r.usd, inr[0]?.date ?? start).map((p) => [p.date, p.value]));
    if (inr.length < 2) return null;
    return {
      dates: inr.map((p) => p.date),
      inr: inr.map((p) => (p.value - 1) * 100),
      usd: inr.map((p) => {
        const v = usdMap.get(p.date);
        return v === undefined ? null : (v - 1) * 100;
      }),
    };
  }, [hasUs, history, usTxns, period]);

  const today = liveFx ?? rate?.values[rate.values.length - 1] ?? null;
  const loading = view === 'rate' ? !rate && (rateHistory.loading || !history) : !value && !history;

  let headline = '';
  let sub = '';
  let change = '';
  let changeColor = 'var(--text-secondary)';
  let note = '';
  if (view === 'rate' && rate) {
    const c = (rate.values[rate.values.length - 1] / rate.values[0] - 1) * 100;
    headline = today ? rupee(today) : '—';
    sub = 'per $1';
    change = `${pct(c)} in ${period === 'All' ? 'all history' : period}`;
    // A weaker rupee lifts US holdings in rupee terms.
    changeColor = !hasUs ? 'var(--text-secondary)' : c >= 0 ? 'var(--good-text)' : 'var(--critical)';
    note = c >= 0 ? 'Rupee weaker vs the dollar — US holdings are worth more in ₹.' : 'Rupee stronger vs the dollar — US holdings are worth less in ₹.';
  } else if (view === 'value' && value) {
    const a = value.inr[value.inr.length - 1];
    const b = value.usd[value.usd.length - 1] ?? 0;
    headline = `${pct(a)} in ₹`;
    sub = `vs ${pct(b)} in $`;
    change = `${a - b >= 0 ? '+' : '−'}${Math.abs(a - b).toFixed(1)} pts from the rupee`;
    changeColor = a - b >= 0 ? 'var(--good-text)' : 'var(--critical)';
    note = 'Your US stocks, measured in rupees and in dollars.';
  }

  const segBtn = (on: boolean) =>
    `min-h-7 px-2.5 text-[11px] font-semibold ${on ? 'bg-[var(--text-primary)] text-[var(--surface-card)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`;

  return (
    <section aria-label="INR vs US dollar" className="border-t border-[var(--border)] px-4 pb-4 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em]">INR vs US dollar</h3>
        <div className="flex flex-wrap gap-2">
          {hasUs && (
            <div className="flex overflow-hidden rounded-md border border-[var(--border-strong)]" role="radiogroup" aria-label="Show">
              {(
                [
                  ['rate', 'Rate'],
                  ['value', 'US returns ₹ vs $'],
                ] as const
              ).map(([m, label]) => (
                <button key={m} type="button" role="radio" aria-checked={view === m} onClick={() => setMode(m)} className={segBtn(view === m)}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="flex overflow-hidden rounded-md border border-[var(--border-strong)]" role="radiogroup" aria-label="Period">
            {PERIODS.map((p) => (
              <button key={p} type="button" role="radio" aria-checked={period === p} onClick={() => setPeriod(p)} className={segBtn(period === p)}>
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center text-sm text-[var(--text-muted)]">Loading USD/INR…</div>
      ) : (view === 'rate' ? !rate : !value) ? (
        <div className="flex h-48 items-center justify-center text-sm text-[var(--text-muted)]">No USD/INR history for this period.</div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-2.5">
            <span className="text-2xl font-semibold tabular">{headline}</span>
            <span className="text-sm text-[var(--text-muted)]">{sub}</span>
            <span className="text-sm font-semibold tabular" style={{ color: changeColor }}>
              {change}
            </span>
          </div>
          <div className="mb-2 text-xs text-[var(--text-muted)]">{note}</div>
          <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]">
            {view === 'rate' ? (
              <>
                <span className="flex items-center gap-1.5">
                  <Swatch color="var(--series-blue)" /> USD/INR
                </span>
                {rate!.markers.length > 0 && (
                  <span className="flex items-center gap-1.5">
                    <Swatch color="var(--warning)" round /> Your US buys
                  </span>
                )}
                {avg !== null && (
                  <span className="flex items-center gap-1.5">
                    <Swatch color="var(--warning)" dashed /> Your avg rate {rupee(avg)}
                  </span>
                )}
              </>
            ) : (
              <>
                <span className="flex items-center gap-1.5">
                  <Swatch color="var(--text-muted)" dashed /> US holdings in $
                </span>
                <span className="flex items-center gap-1.5">
                  <Swatch color="var(--good)" /> Same holdings in ₹
                </span>
              </>
            )}
          </div>
          {view === 'rate' ? (
            <FxChart
              dates={rate!.dates}
              lines={[{ key: 'rate', label: 'USD/INR', color: 'var(--series-blue)', values: rate!.values, fill: true }]}
              format={(v) => `₹${v.toFixed(v >= 100 ? 0 : 1)}`}
              markers={rate!.markers}
              reference={avg !== null ? { value: avg, color: 'var(--warning)', text: 'Your avg rate' } : undefined}
              label={`USD/INR from ${rate!.dates[0]} to ${rate!.dates[rate!.dates.length - 1]}: ${rupee(rate!.values[0])} to ${rupee(rate!.values[rate!.values.length - 1])}`}
            />
          ) : (
            <FxChart
              dates={value!.dates}
              lines={[
                { key: 'usd', label: 'In $', color: 'var(--text-muted)', values: value!.usd, dashed: true },
                { key: 'inr', label: 'In ₹', color: 'var(--good)', values: value!.inr },
              ]}
              format={(v) => pct(v, Math.abs(v) < 10 ? 1 : 0)}
              label={`US holdings return since ${value!.dates[0]}: ${headline} ${sub}`}
            />
          )}
          <div className="mt-3 grid grid-cols-1 gap-2 min-[420px]:grid-cols-3">
            <Stat label="Your avg buy rate" value={avg !== null ? rupee(avg) : '—'} />
            <Stat label="Today" value={today ? rupee(today) : '—'} />
            <Stat
              label="Currency gain on US"
              value={hasUs ? signedInr(currencyGain) : '—'}
              color={!hasUs ? undefined : currencyGain >= 0 ? 'var(--good-text)' : 'var(--critical)'}
            />
          </div>
        </>
      )}
    </section>
  );
}
