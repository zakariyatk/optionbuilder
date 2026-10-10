import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TEMPLATES, type StrategyTemplate } from '../domain/templates';
import type { SavedStrategy } from '../store/strategy';
import { Button, Card } from './ui';

/** A small popover that closes on outside click or Escape. */
function Popover({ label, children, disabled }: { label: ReactNode; children: (close: () => void) => ReactNode; disabled?: boolean }) {
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
      <Button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true" disabled={disabled}>
        {label} <span aria-hidden="true">▾</span>
      </Button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] p-1 shadow-xl">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

const VIEW_COLOR: Record<StrategyTemplate['view'], string> = {
  Bullish: 'var(--good-text)',
  Bearish: 'var(--critical)',
  Neutral: 'var(--text-secondary)',
  Volatile: 'var(--series-violet)',
  Income: 'var(--warning)',
};

export function StrategyToolbar({
  canBuild,
  hasLegs,
  symbol,
  saved,
  onTemplate,
  onSave,
  onLoad,
  onDelete,
}: {
  /** Templates need a strike ladder (live chain or spot). */
  canBuild: boolean;
  hasLegs: boolean;
  symbol: string;
  saved: SavedStrategy[];
  onTemplate: (t: StrategyTemplate) => void;
  onSave: (name: string) => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState('');

  return (
    <Card className="flex flex-wrap items-center gap-2 px-3 py-2">
      <span className="mr-1 text-xs font-semibold">Strategy</span>

      <Popover label="Templates" disabled={!canBuild}>
        {(close) => (
          <ul className="max-h-80 overflow-auto">
            {TEMPLATES.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className="w-full rounded px-2 py-1.5 text-left hover:bg-[var(--surface-sunken)]"
                  onClick={() => {
                    onTemplate(t);
                    close();
                  }}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium">{t.name}</span>
                    <span className="text-[10px] uppercase tracking-wide" style={{ color: VIEW_COLOR[t.view] }}>
                      {t.view}
                    </span>
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)]">{t.description}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Popover>

      <Popover label={`Saved${saved.length ? ` (${saved.length})` : ''}`}>
        {(close) => (
          <div>
            <form
              className="flex gap-1 border-b border-[var(--border)] p-1 pb-2"
              onSubmit={(e) => {
                e.preventDefault();
                onSave(name || `${symbol} ${new Date().toLocaleDateString('en-IN')}`);
                setName('');
              }}
            >
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={hasLegs ? 'Name this strategy' : 'Add legs to save'}
                disabled={!hasLegs}
                aria-label="Strategy name"
                maxLength={60}
                className="min-w-0 flex-1 rounded border border-[var(--border)] bg-transparent px-2 py-1 text-xs"
              />
              <Button type="submit" variant="primary" disabled={!hasLegs}>
                Save
              </Button>
            </form>
            {saved.length === 0 ? (
              <div className="px-2 py-3 text-center text-[11px] text-[var(--text-muted)]">No saved strategies yet.</div>
            ) : (
              <ul className="max-h-72 overflow-auto pt-1">
                {saved.map((s) => (
                  <li key={s.id} className="flex items-center gap-1 rounded hover:bg-[var(--surface-sunken)]">
                    <button
                      type="button"
                      className="min-w-0 flex-1 px-2 py-1.5 text-left"
                      onClick={() => {
                        onLoad(s.id);
                        close();
                      }}
                    >
                      <div className="truncate text-xs font-medium">{s.name}</div>
                      <div className="text-[10px] text-[var(--text-muted)]">
                        {s.symbol} · {s.legs.length} leg{s.legs.length === 1 ? '' : 's'} ·{' '}
                        {new Date(s.savedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(s.id)}
                      className="mr-1 rounded px-1.5 text-[var(--text-muted)] hover:text-[var(--critical)]"
                      aria-label={`Delete ${s.name}`}
                      title="Delete"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Popover>

      <span className="ml-auto hidden text-[11px] text-[var(--text-muted)] md:inline">
        Your working strategy is kept across reloads.
      </span>
    </Card>
  );
}
