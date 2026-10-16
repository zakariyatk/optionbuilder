import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

/** Small shared primitives. Everything is styled through the CSS variables in styles/index.css. */

export function Card({ children, className = '', ...rest }: { children: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-lg border border-[var(--border)] bg-[var(--surface-card)] ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

type Variant = 'default' | 'primary' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  default: 'border border-[var(--border)] text-[var(--text-primary)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-raised)]',
  primary: 'bg-[var(--accent)] text-[var(--accent-text)] hover:opacity-90',
  danger: 'border border-[var(--border)] text-[var(--critical)] hover:bg-[var(--critical-fill)]',
  ghost: 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-raised)]',
};

export function Button({
  variant = 'default',
  size = 'sm',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'xs' | 'sm' }) {
  // Touch screens get finger-sized targets; mouse users keep the compact desktop toolbar.
  const pad =
    size === 'xs'
      ? 'px-2 py-0.5 text-[11px] pointer-coarse:min-h-9 pointer-coarse:px-2.5 pointer-coarse:text-xs'
      : 'px-2.5 py-1 text-xs pointer-coarse:min-h-11 pointer-coarse:px-3.5 pointer-coarse:text-sm';
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${pad} ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  );
}

/** B / S quick-action chip used in the chain and legs table. */
export function SideChip({ side, onClick, label, title }: { side: 'BUY' | 'SELL'; onClick: () => void; label?: string; title?: string }) {
  const buy = side === 'BUY';
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? (buy ? 'Buy' : 'Sell')}
      aria-label={title ?? (buy ? 'Buy' : 'Sell')}
      className="rounded px-1.5 py-0.5 text-[10px] font-semibold transition-opacity hover:opacity-80 pointer-coarse:min-h-8 pointer-coarse:min-w-8 pointer-coarse:text-xs"
      style={{
        background: buy ? 'var(--good-fill)' : 'var(--critical-fill)',
        color: buy ? 'var(--good-text)' : 'var(--critical)',
      }}
    >
      {label ?? (buy ? 'B' : 'S')}
    </button>
  );
}

export type Tone = 'good' | 'critical' | 'warning' | 'neutral';

const toneColor = (tone?: Tone) =>
  tone === 'good'
    ? 'var(--good-text)'
    : tone === 'critical'
      ? 'var(--critical)'
      : tone === 'warning'
        ? 'var(--warning)'
        : 'var(--text-primary)';

export function Stat({ label, value, hint, tone, size = 'md' }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: Tone; size?: 'md' | 'lg' }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
      <div className={`tabular truncate font-semibold ${size === 'lg' ? 'text-xl' : 'text-base'}`} style={{ color: toneColor(tone) }}>
        {value}
      </div>
      {hint && <div className="text-[10px] text-[var(--text-muted)]">{hint}</div>}
    </div>
  );
}

export function Notice({ tone = 'warning', children, action }: { tone?: 'warning' | 'critical' | 'info'; children: ReactNode; action?: ReactNode }) {
  const color = tone === 'critical' ? 'var(--critical)' : tone === 'info' ? 'var(--text-secondary)' : 'var(--warning)';
  const bg = tone === 'critical' ? 'var(--critical-fill)' : tone === 'info' ? 'var(--surface-sunken)' : 'var(--warning-fill)';
  return (
    <div role={tone === 'critical' ? 'alert' : 'status'} className="flex flex-wrap items-center gap-2 rounded px-3 py-2 text-xs" style={{ color, background: bg }}>
      <span className="flex-1">{children}</span>
      {action}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function Dot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />;
}

export function LegendSwatch({ color, kind = 'box', children }: { color: string; kind?: 'box' | 'line' | 'ring'; children: ReactNode }) {
  const swatch =
    kind === 'line' ? (
      <span className="inline-block h-0.5 w-4" style={{ background: color }} />
    ) : kind === 'ring' ? (
      <span className="inline-block h-3 w-5 rounded-sm" style={{ boxShadow: `inset 0 0 0 2px ${color}` }} />
    ) : (
      <span className="inline-block h-3 w-5 rounded-sm border border-[var(--border)]" style={{ background: color }} />
    );
  return (
    <span className="flex items-center gap-1.5">
      {swatch}
      {children}
    </span>
  );
}

export const inputClass =
  'rounded border border-[var(--border)] bg-transparent px-1.5 py-0.5 text-[var(--text-primary)] tabular hover:border-[var(--border-strong)] pointer-coarse:min-h-10 pointer-coarse:px-2';
export const selectClass =
  'min-w-0 max-w-full rounded-md border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm text-[var(--text-primary)] outline-none hover:border-[var(--border-strong)] disabled:opacity-40 pointer-coarse:min-h-11';
