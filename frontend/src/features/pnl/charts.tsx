import { useRef, useState, type ReactNode } from 'react';
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
