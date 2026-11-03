import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Small controls shared by the strategy builder's panels. */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'sm',
}: {
  value: T;
  options: { id: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  label: string;
  size?: 'xs' | 'sm';
}) {
  const pad = size === 'xs' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs';
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg bg-[var(--surface-sunken)] p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          title={o.title}
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-md font-medium transition-colors pointer-coarse:min-h-9 ${pad} ${
            value === o.id
              ? 'bg-[var(--surface-raised)] text-[var(--text-primary)] shadow-[0_1px_2px_#0000001f]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Round toggle chip: preset strategies, σ bands, Greek overlays. */
export function Chip({
  active = false,
  onClick,
  children,
  title,
  disabled,
  className = '',
}: {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full border px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 pointer-coarse:min-h-9 ${
        active
          ? 'border-[var(--series-blue)] bg-[color-mix(in_srgb,var(--series-blue)_14%,transparent)] font-medium text-[var(--series-blue)]'
          : 'border-[var(--border)] text-[var(--text-primary)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-raised)]'
      } ${className}`}
    >
      {children}
    </button>
  );
}

/** A trigger and a floating panel that closes on outside click or Escape. */
export function Popover({
  trigger,
  children,
  align = 'left',
  label,
  disabled,
  triggerClass,
}: {
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  label: string;
  disabled?: boolean;
  triggerClass: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-haspopup="true"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={triggerClass}
      >
        {trigger}
      </button>
      {open && (
        <div
          className={`absolute z-30 mt-1 min-w-[11rem] rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] p-1 shadow-xl ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ onClick, children, danger }: { onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs hover:bg-[var(--surface-sunken)] pointer-coarse:py-2.5 ${
        danger ? 'text-[var(--critical)]' : 'text-[var(--text-primary)]'
      }`}
    >
      {children}
    </button>
  );
}

/** Small "−  value  +" stepper. */
export function Stepper({
  value,
  onDec,
  onInc,
  decDisabled,
  incDisabled,
  label,
  decIcon = '−',
  incIcon = '+',
  width = 'w-9',
}: {
  value: ReactNode;
  onDec: () => void;
  onInc: () => void;
  decDisabled?: boolean;
  incDisabled?: boolean;
  label: string;
  decIcon?: ReactNode;
  incIcon?: ReactNode;
  width?: string;
}) {
  const btn =
    'flex h-7 w-6 items-center justify-center text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 pointer-coarse:h-10 pointer-coarse:w-9';
  return (
    <div className="inline-flex items-center rounded-md bg-[var(--surface-sunken)]" role="group" aria-label={label}>
      <button type="button" className={btn} onClick={onDec} disabled={decDisabled} aria-label={`Decrease ${label}`}>
        {decIcon}
      </button>
      <span className={`${width} text-center text-xs font-semibold tabular`}>{value}</span>
      <button type="button" className={btn} onClick={onInc} disabled={incDisabled} aria-label={`Increase ${label}`}>
        {incIcon}
      </button>
    </div>
  );
}

export const iconBtn =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)] disabled:opacity-40 pointer-coarse:h-11';
