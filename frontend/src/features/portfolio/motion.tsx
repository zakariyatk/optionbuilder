import { useEffect, useRef, useState } from 'react';
import { stagger } from './stagger';

/** True when the OS asks for less motion; every animation here then jumps straight to its end. */
function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * A number that counts up to its value on first show, then glides to each new
 * value as live prices move it.
 */
export function CountUp({ value, format, duration = 1100 }: { value: number; format: (v: number) => string; duration?: number }) {
  const [shown, setShown] = useState(() => (reducedMotion() ? value : 0));
  const from = useRef(shown);
  const first = useRef(true);

  useEffect(() => {
    if (reducedMotion() || !Number.isFinite(value)) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = from.current;
    const ms = first.current ? duration : 600;
    first.current = false;
    if (start === value) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const v = start + (value - start) * ease(k);
      setShown(v);
      from.current = v;
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    /* a background tab gets no animation frames: land on the value anyway */
    const done = window.setTimeout(() => {
      cancelAnimationFrame(raf);
      setShown(value);
      from.current = value;
    }, ms + 250);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(done);
    };
  }, [value, duration]);

  return <>{format(shown)}</>;
}

/** A line chart drawing itself over and over, with a soft area under it. */
function DrawingLine({ className = '' }: { className?: string }) {
  const d = 'M4 52 L22 44 L38 48 L54 30 L70 36 L86 20 L102 26 L118 10 L136 16';
  return (
    <svg viewBox="0 0 140 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="pf-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--series-blue)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--series-blue)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L136 64 L4 64 Z`} fill="url(#pf-area)" className="pf-loader-area" />
      <path d={d} pathLength={100} fill="none" stroke="var(--series-blue)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="pf-loader-line" />
      <circle cx="136" cy="16" r="4" fill="var(--series-blue)" className="pf-loader-dot" />
    </svg>
  );
}

/** Shown while the portfolios themselves load: a drawing chart over a shimmering outline of the page. */
export function PortfolioLoader() {
  return (
    <div className="relative flex flex-col gap-3" aria-busy="true" aria-live="polite">
      <div className="pf-rise flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-card)] px-4 py-3">
        <DrawingLine className="h-10 w-20 shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-semibold">
            Loading your portfolio<span className="pf-dots" aria-hidden="true" />
          </div>
          <div className="text-[11px] text-[var(--text-muted)]">Fetching holdings and prices</div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="pf-rise skeleton h-[74px] rounded-lg" style={stagger(i + 1)} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.55fr)]">
        <div className="pf-rise skeleton h-64 rounded-lg" style={stagger(5)} />
        <div className="pf-rise skeleton h-64 rounded-lg" style={stagger(6)} />
      </div>
      <div className="pf-rise skeleton h-40 rounded-lg" style={stagger(7)} />
    </div>
  );
}

/** Stands in for the performance chart while price history loads. */
export function ChartLoader() {
  return (
    <div className="flex h-64 w-full flex-col items-center justify-center gap-2 rounded bg-[var(--surface-sunken)]" aria-busy="true">
      <DrawingLine className="h-16 w-36" />
      <div className="text-[11px] text-[var(--text-muted)]">
        Loading price history<span className="pf-dots" aria-hidden="true" />
      </div>
    </div>
  );
}

/** A small spinner for buttons that are busy. */
export function Spinner() {
  return <span className="pf-spin" aria-hidden="true" />;
}
