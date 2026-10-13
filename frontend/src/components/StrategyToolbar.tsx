import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TEMPLATES, type StrategyTemplate } from '../domain/templates';
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
  draftCount,
  onTemplate,
  onSaveDraft,
  onViewDrafts,
}: {
  /** Templates need a strike ladder (live chain or spot). */
  canBuild: boolean;
  hasLegs: boolean;
  symbol: string;
  /** Open drafts, shown on the Drafts button. */
  draftCount: number;
  onTemplate: (t: StrategyTemplate) => void;
  /** Resolves true once saved. */
  onSaveDraft: (name: string) => Promise<boolean>;
  onViewDrafts: () => void;
}) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const defaultName = () =>
    `${symbol} ${new Date().toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`;

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

      <Popover label="Save to drafts" disabled={!hasLegs}>
        {(close) => (
          <form
            className="flex flex-col gap-2 p-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (saving) return;
              setSaving(true);
              const ok = await onSaveDraft(name.trim() || defaultName());
              setSaving(false);
              if (ok) {
                setName('');
                close();
              }
            }}
          >
            <div className="text-xs text-[var(--text-muted)]">
              Records the legs at their current premiums so you can track live P&amp;L under Trade → Draft Portfolios.
            </div>
            <div className="flex gap-1">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={defaultName()}
                aria-label="Draft name"
                maxLength={80}
                autoFocus
                className="min-w-0 flex-1 rounded border border-[var(--border)] bg-transparent px-2 py-1 text-xs"
              />
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </form>
        )}
      </Popover>

      <Button onClick={onViewDrafts} title="Trade → Draft Portfolios">
        Drafts{draftCount ? ` (${draftCount})` : ''} →
      </Button>

      <span className="ml-auto hidden text-[11px] text-[var(--text-muted)] md:inline">
        Your working strategy is kept across reloads.
      </span>
    </Card>
  );
}
