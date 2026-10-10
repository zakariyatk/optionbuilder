import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { parseExpiry, toDateInput } from '../domain/dates';
import { expiryCurve, pnlAtExpiry, pnlOnDate, targetDateCurve, type PayoffPoint } from '../domain/payoff';
import { isLinear, type Leg, type StrategyMetrics } from '../domain/types';
import { signedInr } from '../lib/format';
import { Card, LegendSwatch } from './ui';

// SVG coordinate space; the element scales to its container.
const W = 800;
const H = 380;
const LEFT = 56;
const RIGHT = W - 16;
const TOP = 20;
const BOTTOM = H - 28;
const PLOT_W = RIGHT - LEFT;
const PLOT_H = BOTTOM - TOP;
/** Smallest zoom window, as a fraction of the full range. */
const MIN_SPAN = 0.02;

/** "Nice" tick values between min and max — steps of 1, 2, 5 × 10ⁿ. */
function ticks(min: number, max: number, count: number): number[] {
  if (min === max) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const r = raw / mag;
  const step = (r > 5 ? 10 : r > 2 ? 5 : r > 1 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

/** Client X → SVG X, accounting for the element being scaled to fit. */
function svgX(svg: SVGSVGElement, clientX: number): number | null {
  const box = svg.getBoundingClientRect();
  if (box.width <= 0) return null;
  const x = ((clientX - box.left) / box.width) * W;
  return Number.isFinite(x) ? x : null;
}

const axisLabel = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0));

export function PayoffChart({
  legs,
  spot,
  metrics,
  fallbackIv,
}: {
  legs: Leg[];
  spot: number | null;
  metrics: StrategyMetrics;
  fallbackIv: number | null;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [targetDate, setTargetDate] = useState(() => toDateInput(new Date()));
  const [zoom, setZoom] = useState<{ min: number; max: number } | null>(null);
  const drag = useRef<{ startX: number; startMin: number; startMax: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const lastExpiry = useMemo(() => {
    const dates = legs
      .map((l) => (l.expiry ? parseExpiry(l.expiry) : null))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime());
    return dates[0] ? toDateInput(dates[0]) : undefined;
  }, [legs]);

  const target = useMemo(() => {
    const d = new Date(`${targetDate}T10:00:00Z`);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }, [targetDate]);

  // Full x-range: every strike and spot, padded generously on both sides.
  const full = useMemo(() => {
    const points = [spot ?? 0, ...legs.filter((l) => !isLinear(l.type)).map((l) => l.strike)].filter((v) => v > 0);
    const xs = points.length ? points : [100];
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    const pad = Math.max(hi - lo, hi * 0.1, 10);
    return { min: Math.max(0, lo - pad * 0.9), max: hi + pad * 0.9 };
  }, [legs, spot]);

  // A structural change of the strategy invalidates any zoom window.
  const fullKey = `${full.min.toFixed(2)}:${full.max.toFixed(2)}`;
  const lastFullKey = useRef(fullKey);
  useEffect(() => {
    if (lastFullKey.current !== fullKey) {
      lastFullKey.current = fullKey;
      setZoom(null);
    }
  }, [fullKey]);

  const zoomed = zoom !== null && Number.isFinite(zoom.min) && Number.isFinite(zoom.max) && zoom.max > zoom.min;
  const xMin = zoomed ? zoom.min : full.min;
  const xMax = zoomed ? zoom.max : full.max;

  const { expirySeries, targetSeries, yMin, yMax } = useMemo(() => {
    const exp: PayoffPoint[] = legs.length ? expiryCurve(legs, xMin, xMax) : [];
    const tgt = targetDateCurve(legs, exp.map((p) => p.price), target, fallbackIv);
    const ys = [...exp.map((p) => p.pnl), ...(tgt?.map((p) => p.pnl) ?? [])];
    const range = ys.length ? Math.max(...ys) - Math.min(...ys) : 1;
    const pad = range === 0 ? 1 : range * 0.1;
    return {
      expirySeries: exp,
      targetSeries: tgt,
      yMin: ys.length ? Math.min(...ys, 0) - pad : -1,
      yMax: ys.length ? Math.max(...ys, 0) + pad : 1,
    };
  }, [legs, xMin, xMax, target, fallbackIv]);

  const toPrice = useCallback((x: number) => xMin + ((x - LEFT) / PLOT_W) * (xMax - xMin), [xMin, xMax]);
  const px = (price: number) => LEFT + ((price - xMin) / (xMax - xMin || 1)) * PLOT_W;
  const py = (pnl: number) => TOP + (1 - (pnl - yMin) / (yMax - yMin || 1)) * PLOT_H;
  const zeroY = py(0);

  const applyZoom = useCallback(
    (factor: number, anchor: number) => {
      if (!Number.isFinite(anchor)) return;
      const span = xMax - xMin;
      const fullSpan = full.max - full.min;
      if (!(span > 0) || !(fullSpan > 0)) return;
      const next = Math.min(Math.max(span * factor, fullSpan * MIN_SPAN), fullSpan);
      if (Math.abs(next - span) < 1e-9) return;
      let lo = anchor - ((anchor - xMin) / span) * next;
      let hi = lo + next;
      if (lo < full.min) [lo, hi] = [full.min, full.min + next];
      if (hi > full.max) [lo, hi] = [full.max - next, full.max];
      if (Number.isFinite(lo) && Number.isFinite(hi)) setZoom(next >= fullSpan - 1e-9 ? null : { min: lo, max: hi });
    },
    [xMin, xMax, full],
  );

  // Wheel must be a non-passive native listener to be able to preventDefault the page scroll.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      const x = svgX(svg, e.clientX);
      if (x === null) return;
      e.preventDefault();
      applyZoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, toPrice(x));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [applyZoom, toPrice]);

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const x = svgX(svg, e.clientX);
    if (x === null) return;
    const d = drag.current;
    if (d) {
      const span = d.startMax - d.startMin;
      const shift = ((x - d.startX) / PLOT_W) * span;
      let lo = d.startMin - shift;
      let hi = d.startMax - shift;
      if (lo < full.min) [lo, hi] = [full.min, full.min + span];
      if (hi > full.max) [lo, hi] = [full.max - span, full.max];
      if (Number.isFinite(lo) && Number.isFinite(hi)) setZoom({ min: lo, max: hi });
      return;
    }
    setHoverX(Math.min(Math.max(x, LEFT), RIGHT));
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!zoomed) return;
    const svg = svgRef.current;
    const x = svg && svgX(svg, e.clientX);
    if (x == null) return;
    drag.current = { startX: x, startMin: xMin, startMax: xMax };
    setDragging(true);
    try {
      svg!.setPointerCapture(e.pointerId);
    } catch {
      /* not supported — panning still works while the pointer stays inside */
    }
  };

  const endDrag = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    try {
      if (svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  if (legs.length === 0) {
    return (
      <Card className="flex h-[300px] flex-col items-center justify-center gap-1 text-sm text-[var(--text-muted)] sm:h-[380px]">
        <span>Add legs to see the payoff graph</span>
        <span className="text-xs">Pick a strategy template, or click B / S in the option chain.</span>
      </Card>
    );
  }

  const path = (pts: PayoffPoint[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${px(p.price).toFixed(2)} ${py(p.pnl).toFixed(2)}`).join(' ');
  const expiryPath = path(expirySeries);
  const targetPath = targetSeries ? path(targetSeries) : null;
  const area = expirySeries.length
    ? `${expiryPath} L ${px(expirySeries[expirySeries.length - 1].price).toFixed(2)} ${zeroY} L ${px(expirySeries[0].price).toFixed(2)} ${zeroY} Z`
    : '';

  const xTicks = ticks(xMin, xMax, 8);
  const yTicks = ticks(yMin, yMax, 5);
  const hoverPrice = hoverX === null ? null : toPrice(hoverX);
  const hoverExpiry = hoverPrice !== null ? pnlAtExpiry(legs, hoverPrice) : null;
  const hoverTarget = hoverPrice !== null && targetSeries ? pnlOnDate(legs, hoverPrice, target, fallbackIv) : null;
  const zoomPct = xMax - xMin > 0 ? Math.round(((full.max - full.min) / (xMax - xMin)) * 100) : 100;

  const zoomBtn = 'rounded border border-[var(--border)] px-1.5 py-0.5 leading-none text-[var(--text-primary)] hover:border-[var(--border-strong)] disabled:opacity-40';

  return (
    <Card className="p-2">
      <div className="mb-1 flex flex-wrap items-center gap-3 px-1 text-[10px] text-[var(--text-muted)]">
        <LegendSwatch color="var(--text-secondary)" kind="line">
          At expiry
        </LegendSwatch>
        <LegendSwatch color="var(--series-blue)" kind="line">
          On target date
        </LegendSwatch>
        <label className="flex items-center gap-1.5">
          Target date
          <input
            type="date"
            value={targetDate}
            min={toDateInput(new Date())}
            max={lastExpiry}
            onChange={(e) => setTargetDate(e.target.value)}
            className="rounded border border-[var(--border)] bg-transparent px-1 py-0.5 tabular text-[var(--text-primary)]"
          />
        </label>
        <span className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => applyZoom(1 / 1.4, (xMin + xMax) / 2)} className={zoomBtn} aria-label="Zoom in" title="Zoom in">
            +
          </button>
          <button type="button" onClick={() => applyZoom(1.4, (xMin + xMax) / 2)} className={zoomBtn} aria-label="Zoom out" title="Zoom out">
            −
          </button>
          <button type="button" onClick={() => setZoom(null)} disabled={!zoomed} className={zoomBtn} title="Reset zoom">
            Reset
          </button>
          <span className="w-10 text-right tabular" style={{ color: zoom ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
            {zoomPct}%
          </span>
        </span>
      </div>
      <div className="mb-1 hidden px-1 text-[9px] text-[var(--text-muted)] sm:block">Scroll to zoom · drag to pan · double-click to reset</div>
      {!targetPath && (
        <div className="mb-1 px-1 text-[10px] text-[var(--warning)]">
          Target-date line needs implied volatility — add legs from a live option chain to enable it.
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none"
        style={{ cursor: dragging ? 'grabbing' : zoomed ? 'grab' : 'crosshair' }}
        role="img"
        aria-label={`Payoff chart. Max profit ${metrics.maxProfit === null ? 'unlimited' : signedInr(metrics.maxProfit)}, max loss ${metrics.maxLoss === null ? 'unlimited' : signedInr(metrics.maxLoss)}.`}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => setZoom(null)}
        onPointerLeave={() => {
          setHoverX(null);
          drag.current = null;
          setDragging(false);
        }}
      >
        <clipPath id="clip-profit">
          <rect x={0} y={0} width={W} height={Math.max(zeroY, 0)} />
        </clipPath>
        <clipPath id="clip-loss">
          <rect x={0} y={zeroY} width={W} height={Math.max(H - zeroY, 0)} />
        </clipPath>

        {yTicks.map((v) => (
          <line key={v} x1={LEFT} x2={RIGHT} y1={py(v)} y2={py(v)} stroke="var(--gridline)" strokeWidth={1} />
        ))}

        <path d={area} fill="var(--good-fill)" clipPath="url(#clip-profit)" />
        <path d={area} fill="var(--critical-fill)" clipPath="url(#clip-loss)" />
        <line x1={LEFT} x2={RIGHT} y1={zeroY} y2={zeroY} stroke="var(--baseline)" strokeWidth={1.5} />

        {metrics.maxProfit !== null && (
          <line x1={LEFT} x2={RIGHT} y1={py(metrics.maxProfit)} y2={py(metrics.maxProfit)} stroke="var(--good)" strokeDasharray="4 4" />
        )}
        {metrics.maxLoss !== null && (
          <line x1={LEFT} x2={RIGHT} y1={py(metrics.maxLoss)} y2={py(metrics.maxLoss)} stroke="var(--critical)" strokeDasharray="4 4" />
        )}

        {metrics.breakevens
          .filter((b) => b >= xMin && b <= xMax)
          .map((b) => (
            <g key={b}>
              <line x1={px(b)} x2={px(b)} y1={TOP} y2={BOTTOM} stroke="var(--text-muted)" strokeDasharray="2 3" />
              <circle cx={px(b)} cy={zeroY} r={3.5} fill="var(--surface-card)" stroke="var(--text-secondary)" strokeWidth={1.5} />
            </g>
          ))}

        {spot !== null && spot >= xMin && spot <= xMax && (
          <g>
            <line x1={px(spot)} x2={px(spot)} y1={TOP} y2={BOTTOM} stroke="var(--series-violet)" strokeWidth={1.5} strokeDasharray="5 3" />
            <text x={px(spot)} y={14} textAnchor="middle" fontSize={10} fill="var(--series-violet)">
              Spot {spot.toLocaleString('en-IN')}
            </text>
          </g>
        )}

        <path d={expiryPath} fill="none" stroke="var(--text-secondary)" strokeWidth={2} strokeLinejoin="round" />
        {targetPath && <path d={targetPath} fill="none" stroke="var(--series-blue)" strokeWidth={2} strokeLinejoin="round" />}

        {xTicks.map((v) => (
          <text key={v} x={px(v)} y={H - 12} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
            {v.toLocaleString('en-IN')}
          </text>
        ))}
        {yTicks.map((v) => (
          <text key={v} x={LEFT - 8} y={py(v) + 3} textAnchor="end" fontSize={10} fill="var(--text-muted)">
            {axisLabel(v)}
          </text>
        ))}

        {hoverPrice !== null && hoverExpiry !== null && (
          <g pointerEvents="none">
            <line x1={px(hoverPrice)} x2={px(hoverPrice)} y1={TOP} y2={BOTTOM} stroke="var(--text-muted)" />
            <circle cx={px(hoverPrice)} cy={py(hoverExpiry)} r={4} fill={hoverExpiry >= 0 ? 'var(--good)' : 'var(--critical)'} />
            {hoverTarget !== null && (
              <circle cx={px(hoverPrice)} cy={py(hoverTarget)} r={4} fill="var(--series-blue)" stroke="var(--surface-card)" strokeWidth={1.5} />
            )}
          </g>
        )}
      </svg>

      <div className="flex min-h-7 flex-wrap justify-center gap-x-4 gap-y-1 border-t border-[var(--border)] pt-2 text-xs tabular" aria-live="polite">
        {hoverPrice !== null && hoverExpiry !== null ? (
          <>
            <span className="text-[var(--text-muted)]">
              Underlying: <span className="text-[var(--text-primary)]">{hoverPrice.toFixed(1)}</span>
            </span>
            <span className="text-[var(--text-muted)]">
              At expiry:{' '}
              <span style={{ color: hoverExpiry >= 0 ? 'var(--good-text)' : 'var(--critical)' }}>{signedInr(hoverExpiry)}</span>
            </span>
            {hoverTarget !== null && (
              <span className="text-[var(--text-muted)]">
                On target date: <span className="text-[var(--series-blue)]">{signedInr(hoverTarget)}</span>
              </span>
            )}
          </>
        ) : (
          <span className="text-[var(--text-muted)]">Hover the chart to read P&amp;L at any price</span>
        )}
      </div>
    </Card>
  );
}
