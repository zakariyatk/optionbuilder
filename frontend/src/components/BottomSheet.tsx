import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** Phone bottom sheet that sits above the tab bar; closes on backdrop tap or Escape. */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  className = '',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-40 bg-black/45" style={{ bottom: 'var(--tabbar-h)' }} onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-[var(--border-strong)] bg-[var(--surface-raised)] shadow-2xl ${className}`}
        style={{ paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
      >
        <div className="flex shrink-0 items-center justify-between py-1 pl-5 pr-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">{children}</div>
      </div>
    </div>
  );
}
