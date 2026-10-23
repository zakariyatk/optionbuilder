import { useMemo, useRef, useState, type PointerEvent } from 'react';
import type { SeriesPoint } from '../../domain/portfolio';

export interface ChartLine {
  key: string;
  label: string;
  /** Name in the chip at the line's end; defaults to `label`. */
  short?: string;
  color: string;
  points: SeriesPoint[];
  /** The portfolio itself is drawn thicker and on top. */
  primary?: boolean;
}

const W = 800;
const H = 300;
const LEFT = 48;
/** Room on the right for the end-of-line chips: "−10.6%" plus a short name. */
const RIGHT = W - 132;
const CHIP_H = 18;
const CHIP_GAP = 4;
const TOP = 12;
const BOTTOM = H - 26;

function niceStep(span: number, target: number) {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const r = raw / mag;
  return (r > 5 ? 10 : r > 2 ? 5 : r > 1 ? 2 : 1) * mag;
}

const pct = (v: number, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}%`;
const shortDate = (d: string, withYear: boolean) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(withYear ? { year: '2-digit' } : {}), timeZone: 'UTC' });

/**
 * Nudges label positions apart so none are closer than `gap`, keeping them
 * inside [min, max] and as near to their own line's end as the room allows.
 */
function spreadLabels(ys: number[], gap: number, min: number, max: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const out = order.map((o) => Math.min(max, Math.max(min, o.y)));
  for (let k = 1; k < out.length; k++) out[k] = Math.max(out[k], out[k - 1] + gap);
  // Overflowed the bottom: push the stack back up from there.
  if (out.length && out[out.length - 1] > max) {
    out[out.length - 1] = max;
    for (let k = out.length - 2; k >= 0; k--) out[k] = Math.min(out[k], out[k + 1] - gap);
  }
  const placed: number[] = [];
  order.forEach((o, k) => (placed[o.i] = out[k]));
  return placed;
}

/**
 * Percent-return lines on a shared date axis, all starting at 0%. Series are
 * aligned on the union of their dates; a line with no point on a date simply
 * isn't drawn there. Each line ends in a colour chip with its latest return
 * and short name.
 */
export function PerformanceChart({ lines }: { lines: ChartLine[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const { dates, values, lo, hi } = useMemo(() => {
    const dateSet = new Set<string>();
    for (const l of lines) for (const p of l.points) dateSet.add(p.date);
    const dates = [...dateSet].sort();
    const values = lines.map((l) => {
      const m = new Map(l.points.map((p) => [p.date, (p.value - 1) * 100]));
      return dates.map((d) => m.get(d) ?? null);
    });
    const all = values.flat().filter((v): v is number => v !== null);
    let lo = Math.min(0, ...all);
    let hi = Math.max(0, ...all);
    const pad = (hi - lo) * 0.08 || 1;
    lo -= pad;
    hi += pad;
    return { dates, values, lo, hi };
  }, [lines]);

  if (dates.length < 2) {
    return <div className="flex h-56 items-center justify-center text-sm text-[var(--text-muted)]">Not enough price history for this period yet.</div>;
  }

  const n = dates.length - 1;
  const x = (i: number) => LEFT + ((RIGHT - LEFT) * i) / n;
  const y = (v: number) => TOP + (BOTTOM - TOP) * (1 - (v - lo) / (hi - lo));
  const step = niceStep(hi - lo, 5);
  const yTicks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) yTicks.push(Math.round(v * 1000) / 1000);
  const spanYears = (Date.parse(dates[n]) - Date.parse(dates[0])) / (365 * 864e5);
  const xTicks = Array.from({ length: 6 }, (_, k) => Math.round((n * k) / 5));

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

  // The portfolio's own line: where it starts and ends, for its area fill and end marker.
  const primaryIndex = lines.findIndex((l) => l.primary);
  const pv = primaryIndex >= 0 ? values[primaryIndex] : [];
  const primaryFirst = pv.findIndex((v) => v !== null);
  const fromEnd = [...pv].reverse().findIndex((v) => v !== null);
  const primaryLast = fromEnd < 0 ? -1 : pv.length - 1 - fromEnd;
  const areaPath = () =>
    pv
      .slice(primaryFirst, primaryLast + 1)
      .map((v, k) => (v === null ? '' : `${k === 0 ? 'M' : 'L'}${x(primaryFirst + k).toFixed(1)} ${y(v).toFixed(1)}`))
      .join(' ');

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const px = ((e.clientX - box.left) / box.width) * W;
    setHover(Math.max(0, Math.min(n, Math.round(((px - LEFT) / (RIGHT - LEFT)) * n))));
  };

  // Draw benchmarks first so the portfolio sits on top.
  const order = lines.map((l, i) => ({ l, i })).sort((a, b) => Number(!!a.l.primary) - Number(!!b.l.primary));

  // Where each line ends, and where its chip goes once chips are pushed apart.
  const ends = values.map((vals) => {
    const back = [...vals].reverse().findIndex((v) => v !== null);
    if (back < 0) return null;
    const i = vals.length - 1 - back;
    return { i, v: vals[i]! };
  });
  const endLines = lines.map((l, k) => ({ l, end: ends[k] })).filter((e): e is { l: ChartLine; end: { i: number; v: number } } => e.end !== null);
  const chipYs = spreadLabels(
    endLines.map((e) => y(e.end.v)),
    CHIP_H + CHIP_GAP,
    TOP + CHIP_H / 2,
    BOTTOM - CHIP_H / 2,
  );

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label={`Percentage return since ${dates[0]}: ${lines
          .map((l, i) => {
            const last = [...values[i]].reverse().find((v) => v !== null);
            return `${l.label} ${last == null ? 'no data' : pct(last)}`;
          })
          .join(', ')}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={LEFT} x2={RIGHT} y1={y(v)} y2={y(v)} stroke={Math.abs(v) < 1e-9 ? 'var(--baseline)' : 'var(--gridline)'} strokeWidth={Math.abs(v) < 1e-9 ? 1.4 : 1} />
            <text x={LEFT - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--text-muted)">
              {v === 0 ? '0%' : `${v > 0 ? '+' : ''}${Number.isInteger(v) ? v : v.toFixed(1)}%`}
            </text>
          </g>
        ))}
        {xTicks.map((i, k) => (
          <text key={k} x={x(i)} y={H - 8} textAnchor={k === 0 ? 'start' : k === 5 ? 'end' : 'middle'} fontSize={10} fill="var(--text-muted)">
            {shortDate(dates[i], spanYears > 0.9)}
          </text>
        ))}
        <defs>
          <linearGradient id="perf-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--series-blue)" stopOpacity={0.24} />
            <stop offset="1" stopColor="var(--series-blue)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {/* Soft fill under the portfolio's line, down to the axis. */}
        {primaryIndex >= 0 && primaryLast >= 0 && (
          <path
            d={`${areaPath()} L${x(primaryLast).toFixed(1)} ${BOTTOM} L${x(primaryFirst).toFixed(1)} ${BOTTOM} Z`}
            fill="url(#perf-area)"
          />
        )}
        {order.map(({ l, i }) => (
          <path
            key={l.key}
            d={path(values[i])}
            fill="none"
            stroke={l.color}
            strokeWidth={l.primary ? 2.4 : 1.4}
            strokeDasharray={l.primary ? undefined : '5 4'}
            strokeLinejoin="round"
          />
        ))}
        {/* Every line ends in a dot and a colour chip: latest return, then its short name. */}
        <g pointerEvents="none">
          {endLines.map(({ l, end }, k) => {
            const ex = x(end.i);
            const ey = y(end.v);
            const cy = chipYs[k];
            const text = pct(end.v);
            const chipW = text.length * 6.4 + 14;
            const chipX = RIGHT + 10;
            const name = (l.short ?? l.label).slice(0, 12);
            return (
              <g key={l.key}>
                {/* Joins the dot to its chip when the chip had to move, or the line ends early. */}
                {(Math.abs(cy - ey) > 0.5 || ex < RIGHT - 0.5) && (
                  <path d={`M${ex.toFixed(1)} ${ey.toFixed(1)} L${(chipX - 4).toFixed(1)} ${cy.toFixed(1)}`} stroke={l.color} strokeWidth={1} opacity={0.6} fill="none" />
                )}
                <circle cx={ex} cy={ey} r={l.primary ? 4.5 : 3.5} fill={l.primary ? 'var(--surface-card)' : l.color} stroke={l.primary ? l.color : 'var(--surface-card)'} strokeWidth={2} />
                <rect x={chipX} y={cy - CHIP_H / 2} width={chipW} height={CHIP_H} rx={CHIP_H / 2} fill={l.color} />
                <text x={chipX + chipW / 2} y={cy + 3.6} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="var(--surface-card)" className="tabular">
                  {text}
                </text>
                <text
                  x={chipX + chipW + 6}
                  y={cy + 3.6}
                  fontSize={10.5}
                  fontWeight={l.primary ? 700 : 400}
                  fill={l.primary ? 'var(--text-primary)' : 'var(--text-secondary)'}
                >
                  {name}
                </text>
              </g>
            );
          })}
        </g>
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={TOP} y2={BOTTOM} stroke="var(--text-muted)" strokeWidth={0.8} />
            {lines.map((l, i) => {
              const v = values[i][hover];
              return v === null ? null : <circle key={l.key} cx={x(hover)} cy={y(v)} r={3.5} fill={l.color} stroke="var(--surface-card)" strokeWidth={1.2} />;
            })}
          </g>
        )}
      </svg>
      <div className="flex min-h-6 flex-wrap justify-center gap-x-4 gap-y-1 border-t border-[var(--border)] pt-2 text-xs tabular" aria-live="polite">
        {hover === null ? (
          <span className="text-[var(--text-muted)]">Hover the chart to compare on any day</span>
        ) : (
          <>
            <span className="text-[var(--text-muted)]">{shortDate(dates[hover], true)}</span>
            {lines.map((l, i) => {
              const v = values[i][hover];
              return (
                <span key={l.key} className="text-[var(--text-secondary)]">
                  <span style={{ color: l.color }}>●</span> {l.label}{' '}
                  <span style={{ color: v === null ? undefined : v >= 0 ? 'var(--good-text)' : 'var(--critical)' }}>{v === null ? '—' : pct(v, 2)}</span>
                </span>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
