import { useEffect, useRef, useState, type ReactNode } from 'react';
import { periodStart } from '../../domain/pnl';
import { inr, signedInr } from '../../lib/format';

/** Profit right of zero in the good hue, loss left in the critical hue; the sign is always printed too. */
const barColor = (v: number) => (v >= 0 ? 'var(--good)' : 'var(--critical)');
const textColor = (v: number) => (v > 0 ? 'var(--good-text)' : v < 0 ? 'var(--critical)' : 'var(--text-secondary)');

export interface BarRow {
  key: string;
  label: ReactNode;
  value: number;
  /** Shown in the hover / focus tooltip. */
  detail?: ReactNode;
  /** Spoken for screen readers instead of the visual row. */
  description?: string;
  /** Characters the label needs, when it isn't plain text (sizes the label column). */
  labelChars?: number;
}

/**
 * Horizontal bars from a shared zero line: profit grows right, loss grows left.
 * Each row prints its signed value (so color is never the only cue), and
 * hovering or focusing a row opens a tooltip with the breakdown.
 */
export function DivergingBars({ rows, label }: { rows: BarRow[]; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ i: number; x: number; y: number } | null>(null);

  const maxPos = Math.max(0, ...rows.map((r) => r.value));
  const maxNeg = Math.max(0, ...rows.map((r) => -r.value));
  const span = maxPos + maxNeg || 1;
  // Where zero sits across the bar track, as a fraction.
  const zero = maxNeg / span;
  // Label column fits the longest name (contract symbols run long), up to 45% of the chart.
  const chars = Math.max(6, ...rows.map((r) => r.labelChars ?? (typeof r.label === 'string' ? r.label.length : 10)));
  // Capitals run wider than the "0" a ch is measured on.
  const labelWidth = `min(${Math.ceil(chars * 1.25) + 2}ch, 45%)`;

  const place = (i: number, clientX: number, clientY: number) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setTip({ i, x: clientX - r.left, y: clientY - r.top });
  };

  return (
    <div ref={box} className="relative text-xs" role="list" aria-label={label} onMouseLeave={() => setTip(null)}>
      {rows.map((r, i) => {
        const width = (Math.abs(r.value) / span) * 100;
        const left = r.value >= 0 ? zero * 100 : zero * 100 - width;
        return (
          <div
            key={r.key}
            role="listitem"
            tabIndex={0}
            aria-label={r.description ?? `${typeof r.label === 'string' ? r.label : ''} ${signedInr(r.value)}`}
            className="grid min-h-8 cursor-default items-center gap-3 rounded outline-none hover:bg-[var(--surface-sunken)] focus-visible:bg-[var(--surface-sunken)] focus-visible:ring-2 focus-visible:ring-[var(--series-blue)]"
            style={{ gridTemplateColumns: `${labelWidth} 1fr auto` }}
            onMouseMove={(e) => place(i, e.clientX, e.clientY)}
            onFocus={(e) => {
              const b = e.currentTarget.getBoundingClientRect();
              place(i, b.left + b.width / 2, b.bottom);
            }}
            onBlur={() => setTip(null)}
          >
            <span className="truncate pl-1 text-xs text-[var(--text-secondary)]">{r.label}</span>
            <span className="relative block h-3">
              {/* Zero line: the shared baseline every bar starts from. */}
              <span className="absolute inset-y-[-4px] w-px bg-[var(--border-strong)]" style={{ left: `${zero * 100}%` }} aria-hidden="true" />
              {width > 0 && (
                <span
                  className="absolute inset-y-0"
                  style={{
                    left: `${left}%`,
                    width: `max(${width}%, 2px)`,
                    background: barColor(r.value),
                    // Rounded at the data end only; square where it meets zero.
                    borderRadius: r.value >= 0 ? '0 4px 4px 0' : '4px 0 0 4px',
                  }}
                  aria-hidden="true"
                />
              )}
            </span>
            <span className="tabular min-w-[5.5rem] pr-1 text-right text-xs font-semibold" style={{ color: textColor(r.value) }}>
              {signedInr(r.value)}
            </span>
          </div>
        );
      })}
      {tip && rows[tip.i]?.detail && (
        <div
          className="pointer-events-none absolute z-10 w-max max-w-[16rem] rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-2 text-xs shadow-lg"
          style={{ left: Math.min(tip.x + 12, (box.current?.clientWidth ?? 0) - 180), top: tip.y + 14 }}
          role="tooltip"
        >
          {rows[tip.i].detail}
        </div>
      )}
    </div>
  );
}

/** One line of a tooltip: a name and its signed amount. */
export function TipLine({ name, value }: { name: string; value: number }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-[var(--text-muted)]">{name}</span>
      <span className="tabular font-medium" style={{ color: textColor(value) }}>
        {signedInr(value)}
      </span>
    </div>
  );
}

/** Margin used against everything available in a funds segment. */
export function FundsMeter({ used, available, note }: { used: number; available: number; note?: string }) {
  const total = used + Math.max(available, 0);
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-[var(--text-secondary)]">Margin used</span>
        <span className="tabular font-semibold">{pct.toFixed(0)}%</span>
      </div>
      <div
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={`Margin used ${pct.toFixed(0)}%`}
      >
        <div className="h-full rounded-full bg-[var(--series-blue)]" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between gap-2 text-[11px] text-[var(--text-muted)]">
        <span className="tabular">Used {inr(used)}</span>
        <span className="tabular">Free {inr(available)}</span>
      </div>
      {note && <p className="mt-1 text-[11px] text-[var(--text-muted)]">{note}</p>}
    </div>
  );
}

export interface ColumnRow {
  key: string;
  /** Axis label (a date or a month). */
  label: string;
  value: number;
  detail?: ReactNode;
}

/**
 * P&L per day (or month) as columns from a zero line: profit up, loss down.
 * Hover or focus a column for its breakdown; the largest gain and loss are
 * labelled on the axis so the scale reads without gridlines.
 */
export function ColumnBars({ rows, label, height = 168 }: { rows: ColumnRow[]; label: string; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ i: number; x: number } | null>(null);
  const maxPos = Math.max(0, ...rows.map((r) => r.value));
  const maxNeg = Math.max(0, ...rows.map((r) => -r.value));
  const span = maxPos + maxNeg || 1;
  const zeroY = (maxPos / span) * height;
  const show = (i: number, el: HTMLElement) => {
    const b = box.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (b) setTip({ i, x: r.left - b.left + r.width / 2 });
  };
  const ticks = rows.length > 1 ? [0, Math.floor((rows.length - 1) / 2), rows.length - 1] : [0];

  return (
    <div ref={box} className="relative text-[10px]" onMouseLeave={() => setTip(null)}>
      <div className="flex">
        <div className="tabular flex w-16 shrink-0 flex-col justify-between pr-2 text-right text-[var(--text-muted)]" style={{ height }} aria-hidden="true">
          <span>{maxPos > 0 ? signedInr(maxPos) : ''}</span>
          <span>{maxNeg > 0 ? signedInr(-maxNeg) : ''}</span>
        </div>
        <div className="relative min-w-0 flex-1" style={{ height }} role="list" aria-label={label}>
          <span className="absolute inset-x-0 h-px bg-[var(--border-strong)]" style={{ top: zeroY }} aria-hidden="true" />
          {/* Many bars (weeks over years): a 1px gap and hairline bars still fit. */}
          <div className={`absolute inset-0 flex items-stretch ${rows.length > 150 ? 'gap-px' : 'gap-[2px]'}`}>
            {rows.map((r, i) => {
              const h = (Math.abs(r.value) / span) * height;
              return (
                <div
                  key={r.key}
                  role="listitem"
                  tabIndex={0}
                  aria-label={`${r.label}: ${signedInr(r.value)}`}
                  className="relative min-w-px flex-1 cursor-default rounded-sm outline-none hover:bg-[var(--surface-sunken)] focus-visible:bg-[var(--surface-sunken)] focus-visible:ring-2 focus-visible:ring-[var(--series-blue)]"
                  onMouseEnter={(e) => show(i, e.currentTarget)}
                  onFocus={(e) => show(i, e.currentTarget)}
                  onBlur={() => setTip(null)}
                >
                  {h > 0 && (
                    <span
                      className="absolute inset-x-0 mx-auto max-w-6"
                      style={{
                        top: r.value >= 0 ? zeroY - Math.max(h, 1) : zeroY,
                        height: Math.max(h, 1),
                        background: barColor(r.value),
                        borderRadius: r.value >= 0 ? '3px 3px 0 0' : '0 0 3px 3px',
                      }}
                      aria-hidden="true"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="relative ml-16 mt-1 h-4 text-[var(--text-muted)]" aria-hidden="true">
        {ticks.map((i) => (
          <span
            key={i}
            className="absolute whitespace-nowrap"
            style={{
              left: `${((i + 0.5) / rows.length) * 100}%`,
              transform: i === 0 ? 'translateX(-10%)' : i === rows.length - 1 ? 'translateX(-90%)' : 'translateX(-50%)',
            }}
          >
            {rows[i]?.label}
          </span>
        ))}
      </div>
      {tip && rows[tip.i] && (
        <div
          className="pointer-events-none absolute top-0 z-10 w-max max-w-[16rem] rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-2 text-xs shadow-lg"
          style={{ left: Math.max(64, Math.min(tip.x - 80, (box.current?.clientWidth ?? 0) - 170)) }}
          role="tooltip"
        >
          <div className="mb-0.5 font-semibold">{rows[tip.i].label}</div>
          {rows[tip.i].detail ?? <TipLine name="Realised" value={rows[tip.i].value} />}
        </div>
      )}
    </div>
  );
}

export interface LinePoint {
  key: string;
  label: string;
  value: number;
  detail?: ReactNode;
}

/**
 * A single series over time as a 2px line with a light area to zero, a zero
 * baseline, and a crosshair + tooltip on hover. `tone` colours it: the accent
 * for a running total, the loss hue for drawdown.
 */
export function LineArea({ points, label, tone = 'accent', height = 200 }: { points: LinePoint[]; label: string; tone?: 'accent' | 'loss'; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const n = points.length;
  const hi = Math.max(0, ...points.map((p) => p.value));
  const lo = Math.min(0, ...points.map((p) => p.value));
  const span = hi - lo || 1;
  const W = 1000;
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => ((hi - v) / span) * height;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = n ? `${line} L${x(n - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z` : '';
  const color = tone === 'loss' ? 'var(--critical)' : 'var(--series-blue)';
  const ticks = n > 1 ? [0, Math.floor((n - 1) / 2), n - 1] : [0];
  const pick = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !n) return;
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    setHover(Math.round(f * (n - 1)));
  };
  const h = hover !== null ? points[hover] : null;

  return (
    <div className="text-[10px]">
      <div className="flex">
        <div className="tabular flex w-16 shrink-0 flex-col justify-between pr-2 text-right text-[var(--text-muted)]" style={{ height }} aria-hidden="true">
          <span>{hi > 0 ? signedInr(hi) : ''}</span>
          <span>{lo < 0 ? signedInr(lo) : ''}</span>
        </div>
        <div
          ref={box}
          className="relative min-w-0 flex-1 cursor-crosshair"
          style={{ height }}
          role="img"
          aria-label={`${label}: from ${signedInr(points[0]?.value ?? 0)} to ${signedInr(points[n - 1]?.value ?? 0)}`}
          onMouseMove={(e) => pick(e.clientX)}
          onMouseLeave={() => setHover(null)}
        >
          <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
            <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--border-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            {n > 0 && <path d={area} fill={color} opacity={0.14} />}
            {n > 0 && <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
          </svg>
          {h && hover !== null && (
            <>
              <span className="pointer-events-none absolute inset-y-0 w-px bg-[var(--border-strong)]" style={{ left: `${(x(hover) / W) * 100}%` }} aria-hidden="true" />
              <span
                className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--surface-card)]"
                style={{ left: `${(x(hover) / W) * 100}%`, top: y(h.value), background: color }}
                aria-hidden="true"
              />
              <div
                className="pointer-events-none absolute top-0 z-10 w-max max-w-[16rem] rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-2 text-xs shadow-lg"
                style={{ left: `clamp(0px, calc(${(x(hover) / W) * 100}% + 12px), calc(100% - 180px))` }}
                role="tooltip"
              >
                <div className="mb-0.5 font-semibold">{h.label}</div>
                {h.detail ?? <TipLine name={label} value={h.value} />}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="relative ml-16 mt-1 h-4 text-[var(--text-muted)]" aria-hidden="true">
        {ticks.map((i) => (
          <span
            key={i}
            className="absolute whitespace-nowrap"
            style={{ left: `${(x(i) / W) * 100}%`, transform: i === 0 ? 'none' : i === n - 1 ? 'translateX(-100%)' : 'translateX(-50%)' }}
          >
            {points[i]?.label}
          </span>
        ))}
      </div>
    </div>
  );
}

const HEAT_STEPS = [28, 48, 72, 100];

/** Cell colour: deeper green for bigger profit, deeper red for bigger loss, neutral for no trades. */
function heatColor(v: number | undefined, max: number): string {
  if (v === undefined) return 'var(--surface-sunken)';
  if (v === 0 || max === 0) return 'color-mix(in srgb, var(--text-muted) 22%, var(--surface-sunken))';
  // Square root, so a few huge days don't wash every other day out.
  const step = Math.min(HEAT_STEPS.length - 1, Math.floor(Math.sqrt(Math.abs(v) / max) * HEAT_STEPS.length));
  return `color-mix(in srgb, ${v > 0 ? 'var(--good)' : 'var(--critical)'} ${HEAT_STEPS[step]}%, var(--surface-sunken))`;
}

/**
 * Trading days as a calendar: one column per week (Monday on top, Friday at
 * the bottom), each day coloured by its P&L. Long ranges scroll sideways and
 * open on the latest weeks.
 */
export function CalendarHeatmap({ days, from, to, label }: { days: Record<string, number>; from: string; to: string; label: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ date: string; x: number; y: number } | null>(null);
  const max = Math.max(0, ...Object.values(days).map(Math.abs));

  const weeks: string[][] = [];
  const start = Date.parse(`${periodStart(from, 'week')}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = start; t <= end; t += 7 * 86_400_000) {
    weeks.push([0, 1, 2, 3, 4].map((d) => new Date(t + d * 86_400_000).toISOString().slice(0, 10)));
  }
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [from, to]);

  const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { ...o, timeZone: 'UTC' });
  const CELL = 13;
  const GAP = 3;

  return (
    <div className="relative text-[10px]" onMouseLeave={() => setTip(null)}>
      <div className="flex gap-2">
        <div className="flex shrink-0 flex-col pt-4 text-[var(--text-muted)]" style={{ gap: GAP }} aria-hidden="true">
          {['Mon', '', 'Wed', '', 'Fri'].map((d, i) => (
            <span key={i} className="leading-none" style={{ height: CELL }}>
              {d}
            </span>
          ))}
        </div>
        <div ref={scroller} className="min-w-0 overflow-x-auto pb-1">
          <div className="flex" style={{ gap: GAP }} role="grid" aria-label={label}>
            {weeks.map((w, wi) => {
              const month = w[0].slice(0, 7);
              const newMonth = wi === 0 || weeks[wi - 1][0].slice(0, 7) !== month;
              return (
                <div key={w[0]} className="flex flex-col" style={{ gap: GAP, width: CELL }} role="row">
                  {/* Zero-width, so a month name wider than a cell spills right instead of widening its week. */}
                  <span className="h-3 w-0 overflow-visible whitespace-nowrap leading-none text-[var(--text-muted)]" aria-hidden="true">
                    {newMonth ? fmt(w[0], { month: 'short', ...(month.endsWith('-01') || wi === 0 ? { year: '2-digit' } : {}) }) : ''}
                  </span>
                  {w.map((d) => {
                    const out = d < from || d > to;
                    const v = days[d];
                    return (
                      <span
                        key={d}
                        role="gridcell"
                        tabIndex={out ? -1 : 0}
                        aria-label={`${fmt(d, { day: 'numeric', month: 'short', year: 'numeric' })}: ${v === undefined ? 'no trades' : signedInr(v)}`}
                        className="block rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--series-blue)]"
                        style={{ width: CELL, height: CELL, background: out ? 'transparent' : heatColor(v, max) }}
                        onMouseEnter={(e) => {
                          if (out) return;
                          const r = e.currentTarget.getBoundingClientRect();
                          const b = e.currentTarget.closest('.relative')!.getBoundingClientRect();
                          setTip({ date: d, x: r.left - b.left, y: r.bottom - b.top });
                        }}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[var(--text-muted)]" aria-hidden="true">
        <span>Loss</span>
        {[...HEAT_STEPS].reverse().map((p) => (
          <span key={`l${p}`} className="h-2.5 w-2.5 rounded-[2px]" style={{ background: `color-mix(in srgb, var(--critical) ${p}%, var(--surface-sunken))` }} />
        ))}
        <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: 'var(--surface-sunken)', outline: '1px solid var(--border)' }} />
        {HEAT_STEPS.map((p) => (
          <span key={`g${p}`} className="h-2.5 w-2.5 rounded-[2px]" style={{ background: `color-mix(in srgb, var(--good) ${p}%, var(--surface-sunken))` }} />
        ))}
        <span>Profit</span>
        <span className="ml-3">Empty = no trades</span>
      </div>
      {tip && (
        <div
          className="pointer-events-none absolute z-10 w-max rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: Math.max(0, tip.x - 60), top: tip.y + 6 }}
          role="tooltip"
        >
          <div className="font-semibold">{fmt(tip.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</div>
          {days[tip.date] === undefined ? <div className="text-[var(--text-muted)]">No trades</div> : <TipLine name="Realised" value={days[tip.date]} />}
        </div>
      )}
    </div>
  );
}
