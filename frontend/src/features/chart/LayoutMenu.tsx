import { useEffect, useRef, useState } from 'react';
import { cellRects, chartCount, LAYOUTS, layoutById, type ChartLayout } from './layouts';

/** A layout's shape: one rounded box per chart. */
export function LayoutIcon({ layout, size = 20 }: { layout: ChartLayout; size?: number }) {
  const pad = 2;
  const box = 20 - pad * 2;
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      {cellRects(layout).map((r, i) => (
        <rect key={i} x={pad + r.x * box} y={pad + r.y * box} width={r.w * box} height={r.h * box} rx="1.6" />
      ))}
    </svg>
  );
}

const GROUPS = [1, 2, 3, 4].map((n) => ({ n, layouts: LAYOUTS.filter((l) => chartCount(l) === n) }));

/** TradingView's "Layout setup": pick how many charts the page shows and how they're arranged. */
export function LayoutMenu({ layoutId, onChange }: { layoutId: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const current = layoutById(layoutId);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Layout setup: ${current.label}`}
        title="Layout setup"
        className={`flex h-8 w-9 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)] ${
          open ? 'bg-[var(--surface-sunken)] text-[var(--text-primary)]' : ''
        }`}
      >
        <LayoutIcon layout={current} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Layout setup"
          className="absolute left-0 top-full z-30 mt-1 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] py-1 shadow-xl"
        >
          {GROUPS.map(({ n, layouts }, gi) => (
            <div key={n} className={`flex items-center gap-1 px-3 py-1.5 ${gi > 0 ? 'border-t border-[var(--border)]' : ''}`}>
              <span className="w-5 text-xs tabular text-[var(--text-muted)]">{n}</span>
              {layouts.map((l) => {
                const selected = l.id === current.id;
                return (
                  <button
                    key={l.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    aria-label={l.label}
                    title={l.label}
                    onClick={() => {
                      onChange(l.id);
                      setOpen(false);
                    }}
                    className={`flex h-9 w-9 items-center justify-center rounded-md ${
                      selected
                        ? 'bg-[var(--text-primary)] text-[var(--surface-page)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <LayoutIcon layout={l} size={22} />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
