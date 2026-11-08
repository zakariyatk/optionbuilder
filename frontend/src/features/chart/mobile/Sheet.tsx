import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * A phone sheet over the chart: from the bottom (most sheets) or the right
 * (the watchlist). Rendered inside the chart, so it also shows in full
 * screen. Closes on a backdrop tap, Escape, or a downward swipe on its handle.
 */
export function Sheet({
  open,
  onClose,
  title,
  side = 'bottom',
  tall = false,
  actions,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  side?: 'bottom' | 'right';
  /** A bottom sheet that takes most of the screen (lists you search through). */
  tall?: boolean;
  /** Buttons beside the title. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const onHandleDown = (e: React.PointerEvent) => {
    if (side !== 'bottom') return;
    drag.current = { y: e.clientY, dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onHandleMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !panel.current) return;
    d.dy = Math.max(0, e.clientY - d.y);
    panel.current.style.transform = `translateY(${d.dy}px)`;
  };
  const onHandleUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !panel.current) return;
    if (d.dy > 80) onClose();
    else panel.current.style.transform = '';
  };

  const placement =
    side === 'right'
      ? 'inset-y-0 right-0 w-[min(88vw,380px)] border-l ob-sheet-right'
      : `inset-x-0 bottom-0 rounded-t-2xl border-t ob-sheet-up ${tall ? 'h-[88dvh]' : 'max-h-[80dvh]'}`;

  return (
    <div className="fixed inset-0 z-[80] bg-black/50" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`absolute flex flex-col border-[var(--border-strong)] bg-[var(--surface-raised)] shadow-2xl ${placement}`}
        style={{
          paddingBottom: side === 'bottom' ? 'env(safe-area-inset-bottom)' : undefined,
          paddingRight: 'env(safe-area-inset-right)',
          paddingLeft: side === 'bottom' ? 'env(safe-area-inset-left)' : undefined,
        }}
      >
        {side === 'bottom' && (
          <div
            className="flex h-5 shrink-0 cursor-grab touch-none items-center justify-center"
            onPointerDown={onHandleDown}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={onHandleUp}
            aria-hidden="true"
          >
            <span className="h-1 w-10 rounded-full bg-[var(--border-strong)]" />
          </div>
        )}
        <div className="flex shrink-0 items-center gap-1 pl-4 pr-1">
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</h2>
          {actions}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] active:bg-[var(--surface-sunken)]"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  );
}

/** A full-width row in a sheet: icon, label, optional detail on the right. */
export function SheetRow({
  icon,
  label,
  detail,
  active,
  onClick,
  disabled,
}: {
  icon?: ReactNode;
  label: ReactNode;
  detail?: ReactNode;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`flex min-h-12 w-full items-center gap-3 px-4 text-left text-sm active:bg-[var(--surface-sunken)] disabled:opacity-40 ${
        active ? 'text-[var(--series-blue)]' : ''
      }`}
    >
      {icon && <span className={`shrink-0 ${active ? '' : 'text-[var(--text-secondary)]'}`}>{icon}</span>}
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      {detail && <span className="shrink-0 text-xs text-[var(--text-muted)]">{detail}</span>}
    </button>
  );
}
