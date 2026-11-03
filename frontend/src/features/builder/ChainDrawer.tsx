import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** Option chain as a slide-over panel from the right (full width on phones). */
export function ChainDrawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-40 bg-black/40" style={{ bottom: 'var(--tabbar-h)' }} onClick={onClose}>
      <aside
        role="dialog"
        aria-label="Option chain"
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-y-0 right-0 flex w-full max-w-[580px] flex-col border-l border-[var(--border-strong)] bg-[var(--surface-page)] shadow-2xl"
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingRight: 'env(safe-area-inset-right)' }}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] py-1.5 pl-4 pr-1.5">
          <div className="min-w-0 truncate text-sm font-semibold">{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close option chain"
            className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">{children}</div>
      </aside>
    </div>
  );
}
