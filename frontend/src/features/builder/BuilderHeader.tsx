import { useState, type ReactNode } from 'react';
import { Bookmark, Ellipsis, FolderOpen, Share2, Table2, Trash2 } from 'lucide-react';
import type { SpotQuote } from '../../api/types';
import { Skeleton } from '../../components/ui';
import { useMarket } from './market';
import { MenuItem, Popover, iconBtn } from './parts';

export function BuilderHeader({
  symbol,
  marketSwitch,
  picker,
  canSave,
  spot,
  spotError,
  expectedMove,
  expiryLabel,
  atmIv,
  hasLegs,
  draftCount,
  onOpenChain,
  onSaveDraft,
  onShare,
  onViewDrafts,
  onClear,
}: {
  symbol: string;
  /** The India / US switch. */
  marketSwitch: ReactNode;
  /** The market's underlying picker. */
  picker: ReactNode;
  /** Saving to drafts is NSE-only (drafts track live Upstox prices). */
  canSave: boolean;
  spot: SpotQuote | null;
  spotError: string | null;
  /** One-sigma move to the selected expiry, in points. */
  expectedMove: number | null;
  expiryLabel: string | null;
  atmIv: number | null;
  hasLegs: boolean;
  draftCount: number;
  onOpenChain: () => void;
  /** Resolves true once saved. */
  onSaveDraft: (name: string) => Promise<boolean>;
  onShare: () => void;
  /** Null hides the drafts entry (US). */
  onViewDrafts: (() => void) | null;
  onClear: () => void;
}) {
  const mk = useMarket();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const change = spot ? spot.price - spot.previousClose : null;
  const changePct = spot && spot.previousClose ? ((spot.price - spot.previousClose) / spot.previousClose) * 100 : null;
  const up = (change ?? 0) >= 0;
  const defaultName = () =>
    `${symbol} ${new Date().toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`;
  const emText = expectedMove === null ? '' : mk.id === 'US' ? `$${expectedMove.toFixed(2)}` : Math.round(expectedMove).toLocaleString('en-IN');

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2.5 sm:px-4">
      {marketSwitch}
      {picker}

      <div className="flex items-baseline gap-2 tabular" aria-live="polite">
        {spot ? (
          <>
            <span className="text-lg font-semibold">{mk.id === 'US' ? `$${mk.price(spot.price)}` : spot.price.toLocaleString('en-IN')}</span>
            {change !== null && changePct !== null && (
              <span className="text-sm" style={{ color: up ? 'var(--good-text)' : 'var(--critical)' }}>
                {up ? '▲' : '▼'} {mk.id === 'US' ? '$' : ''}
                {mk.price(Math.abs(change))} ({up ? '+' : '−'}
                {Math.abs(changePct).toFixed(2)}%)
              </span>
            )}
          </>
        ) : spotError ? (
          <span className="text-sm text-[var(--critical)]" title={spotError}>
            Spot price unavailable
          </span>
        ) : (
          <Skeleton className="h-6 w-36" />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {expectedMove !== null && (
          <span
            className="rounded-md border border-[var(--border)] px-2 py-0.5 tabular text-[var(--text-secondary)]"
            title="Expected move: one standard deviation by expiry, from ATM implied volatility"
          >
            EM <span className="font-semibold text-[var(--text-primary)]">±{emText}</span>
            {expiryLabel && ` · ${expiryLabel}`}
          </span>
        )}
        {atmIv !== null && (
          <span className="rounded-md border border-[var(--border)] px-2 py-0.5 tabular text-[var(--text-secondary)]" title="At-the-money implied volatility">
            IV <span className="font-semibold text-[var(--text-primary)]">{atmIv.toFixed(1)}%</span>
          </span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-0.5">
        <button type="button" className={iconBtn} onClick={onOpenChain} title="Pick strikes from the option chain">
          <Table2 size={16} aria-hidden="true" />
          <span className="max-sm:hidden">Chain</span>
        </button>
        {canSave && (
        <Popover
          label="Save to drafts"
          align="right"
          disabled={!hasLegs}
          triggerClass={iconBtn}
          trigger={
            <>
              <Bookmark size={16} aria-hidden="true" />
              <span className="max-sm:hidden">Save</span>
            </>
          }
        >
          {(close) => (
            <form
              className="flex w-[min(20rem,calc(100vw-3rem))] flex-col gap-2 p-2"
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
                  className="min-w-0 flex-1 rounded border border-[var(--border)] bg-transparent px-2 py-1 text-xs pointer-coarse:min-h-11"
                />
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded bg-[var(--accent)] px-3 text-xs font-medium text-[var(--accent-text)] hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          )}
        </Popover>
        )}
        <button type="button" className={iconBtn} onClick={onShare} disabled={!hasLegs} title="Copy a link to this strategy">
          <Share2 size={16} aria-hidden="true" />
          <span className="max-sm:hidden">Share</span>
        </button>
        <Popover label="More" align="right" triggerClass={iconBtn} trigger={<Ellipsis size={16} aria-hidden="true" />}>
          {(close) => (
            <>
              {onViewDrafts && (
                <MenuItem
                  onClick={() => {
                    close();
                    onViewDrafts();
                  }}
                >
                  <FolderOpen size={14} aria-hidden="true" />
                  Draft portfolios{draftCount ? ` (${draftCount})` : ''}
                </MenuItem>
              )}
              {!onViewDrafts && !hasLegs && <div className="px-2.5 py-1.5 text-xs text-[var(--text-muted)]">Nothing to do yet</div>}
              {hasLegs && (
                <MenuItem
                  danger
                  onClick={() => {
                    close();
                    onClear();
                  }}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  Clear all legs
                </MenuItem>
              )}
            </>
          )}
        </Popover>
      </div>
    </div>
  );
}
