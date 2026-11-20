import { useMemo } from 'react';
import { Plus } from 'lucide-react';
import type { Draft } from '../../api/types';
import { Button, Card, CardHeader, Notice, Skeleton } from '../../components/ui';
import { formatExpiry } from '../../domain/dates';
import { draftPnl, draftPrices } from '../../domain/drafts';
import { inr, signedInr } from '../../lib/format';
import { dateTime, useDraftQuotes } from './useDraftQuotes';

const pnlColor = (v: number) => (v > 0 ? 'var(--good-text)' : v < 0 ? 'var(--critical)' : 'var(--text-secondary)');

export function DraftsPage({
  drafts,
  loading,
  error,
  brokerConnected,
  localSavedCount,
  onImportLocal,
  onOpen,
  onNew,
}: {
  drafts: Draft[] | null;
  loading: boolean;
  error: string | null;
  brokerConnected: boolean;
  /** Strategies saved in this browser by the older "Saved" menu, offered for import. */
  localSavedCount: number;
  onImportLocal: () => void;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const list = useMemo(() => drafts ?? [], [drafts]);
  const quotes = useDraftQuotes(list, brokerConnected);

  const rows = list.map((d) => ({ draft: d, pnl: draftPnl(d.legs, draftPrices(d, quotes.data?.quotes), d.realized ?? 0) }));
  const open = rows.filter((r) => r.draft.closedAt === null);
  const openTotal = open.reduce((s, r) => s + r.pnl.total, 0);
  const closedTotal = rows.filter((r) => r.draft.closedAt !== null).reduce((s, r) => s + r.pnl.total, 0);

  return (
    <div className="flex flex-col gap-4">
      {localSavedCount > 0 && (
        <Notice tone="info" action={<Button onClick={onImportLocal}>Import to drafts</Button>}>
          {localSavedCount} strateg{localSavedCount === 1 ? 'y is' : 'ies are'} saved only in this browser from the old Saved menu.
        </Notice>
      )}
      {!brokerConnected && <Notice>Connect Upstox to see live P&amp;L — until then drafts show their entry prices only.</Notice>}
      {error && <Notice tone="critical">Drafts: {error}</Notice>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Open drafts</div>
          <div className="text-xl font-semibold tabular">{open.length}</div>
        </Card>
        <Card className="px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Open P&amp;L (live)</div>
          <div className="text-xl font-semibold tabular" style={{ color: pnlColor(openTotal) }}>
            {brokerConnected ? signedInr(openTotal) : '—'}
          </div>
        </Card>
        <Card className="px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Closed P&amp;L</div>
          <div className="text-xl font-semibold tabular" style={{ color: pnlColor(closedTotal) }}>
            {signedInr(closedTotal)}
          </div>
        </Card>
        <Card className="flex items-center justify-center px-4 py-3">
          <Button variant="primary" onClick={onNew}>
            <Plus size={16} aria-hidden="true" />
            New strategy
          </Button>
        </Card>
      </div>

      <Card>
        <CardHeader title="Draft portfolios">
          {quotes.updatedAt && (
            <span className="text-[11px] text-[var(--text-muted)]">
              Live · updated {new Date(quotes.updatedAt).toLocaleTimeString('en-IN')}
            </span>
          )}
        </CardHeader>
        {loading && !drafts ? (
          <div className="flex flex-col gap-2 p-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[var(--text-muted)]">
            No drafts yet. Build a strategy, then use <b>Save to drafts</b> to track it here with live prices.
          </div>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead className="text-left text-xs text-[var(--text-muted)]">
                <tr className="border-b border-[var(--border)]">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Symbol</th>
                  <th className="px-3 py-2 font-medium">Legs</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                  <th className="px-3 py-2 text-right font-medium">Entry credit / debit</th>
                  <th className="px-3 py-2 text-right font-medium">P&amp;L</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ draft: d, pnl }) => {
                  const closed = d.closedAt !== null;
                  const expiries = [...new Set(d.legs.map((l) => l.expiry).filter((e): e is string => !!e))];
                  return (
                    <tr
                      key={d.id}
                      className="cursor-pointer border-b border-[var(--gridline)] hover:bg-[var(--surface-sunken)]"
                      onClick={() => onOpen(d.id)}
                    >
                      <td className="px-3 py-2.5">
                        <button type="button" className="text-left font-medium text-[var(--series-blue)] hover:underline" onClick={() => onOpen(d.id)}>
                          {d.name}
                        </button>
                      </td>
                      <td className="px-3 py-2.5">
                        {d.symbol}
                        {expiries.length > 0 && <span className="text-xs text-[var(--text-muted)]"> · {expiries.map((e) => formatExpiry(e)).join(', ')}</span>}
                      </td>
                      <td className="px-3 py-2.5 tabular">{d.legs.length}</td>
                      <td className="px-3 py-2.5 text-xs text-[var(--text-secondary)]">{dateTime(d.createdAt)}</td>
                      <td className="px-3 py-2.5 text-right tabular" style={{ color: pnl.entryNet >= 0 ? 'var(--good-text)' : 'var(--critical)' }}>
                        {pnl.entryNet >= 0 ? 'Cr ' : 'Dr '}
                        {inr(Math.abs(pnl.entryNet))}
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular" style={{ color: pnlColor(pnl.total) }}>
                        {closed || (brokerConnected && pnl.perLeg.some((v) => v !== null)) ? signedInr(pnl.total) : '—'}
                        {!closed && brokerConnected && !pnl.complete && pnl.perLeg.some((v) => v !== null) && (
                          <span className="ml-1 text-[10px] font-normal text-[var(--warning)]" title="Some legs have no live quote">
                            partial
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={closed ? { background: 'var(--surface-sunken)', color: 'var(--text-muted)' } : { background: 'var(--good-fill)', color: 'var(--good-text)' }}
                        >
                          {closed ? 'Closed' : 'Open'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
