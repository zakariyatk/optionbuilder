import { useMemo, useState, type ReactNode } from 'react';
import { api, errorMessage } from '../../api/client';
import type { Draft } from '../../api/types';
import { MetricsPanel } from '../../components/MetricsPanel';
import { PayoffChart } from '../../components/PayoffChart';
import { Button, Card, CardHeader, Notice } from '../../components/ui';
import { formatExpiry } from '../../domain/dates';
import { draftLegToLeg, draftPnl, draftPrices } from '../../domain/drafts';
import { strategyGreeks, strategyMetrics } from '../../domain/payoff';
import { useSpot } from '../../hooks/market';
import { inr, num, signedInr, signedPct } from '../../lib/format';
import { dateTime, useDraftQuotes } from './useDraftQuotes';

const pnlColor = (v: number) => (v > 0 ? 'var(--good-text)' : v < 0 ? 'var(--critical)' : 'var(--text-secondary)');

function Stat({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
      <div className="truncate text-base font-semibold tabular">{children}</div>
      {hint && <div className="text-[11px] text-[var(--text-muted)]">{hint}</div>}
    </div>
  );
}

export function DraftMonitor({
  draft,
  brokerConnected,
  onBack,
  onChanged,
  onDeleted,
  onOpenInBuilder,
}: {
  draft: Draft;
  brokerConnected: boolean;
  onBack: () => void;
  onChanged: (d: Draft) => void;
  onDeleted: () => void;
  onOpenInBuilder: (d: Draft) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const closed = draft.closedAt !== null;

  const drafts = useMemo(() => [draft], [draft]);
  const quotes = useDraftQuotes(drafts, brokerConnected && !closed);
  const spotState = useSpot(draft.symbol);
  const spot = closed ? (draft.exitSpot ?? spotState.data?.price ?? null) : (spotState.data?.price ?? null);

  const prices = draftPrices(draft, quotes.data?.quotes);
  const pnl = draftPnl(draft.legs, prices);
  const legs = useMemo(() => draft.legs.map(draftLegToLeg), [draft.legs]);
  const ivs = draft.legs.map((l) => l.iv).filter((v): v is number => !!v);
  const fallbackIv = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;
  const metrics = useMemo(() => strategyMetrics(legs, spot ?? draft.entrySpot ?? 0, draft.symbol), [legs, spot, draft.entrySpot, draft.symbol]);
  const greeks = useMemo(() => strategyGreeks(legs, spot ?? 0, fallbackIv), [legs, spot, fallbackIv]);
  const missing = draft.legs.filter((l) => !l.instrumentKey).length;
  const spotMove = spot && draft.entrySpot ? ((spot - draft.entrySpot) / draft.entrySpot) * 100 : null;

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const rename = () => {
    const name = window.prompt('Rename draft', draft.name);
    if (name === null || name.trim() === '' || name === draft.name) return;
    void act(async () => onChanged((await api.renameDraft(draft.id, name)).draft));
  };

  const close = () => {
    if (!pnl.complete) {
      setActionError('Every leg needs a live price to close at market. Connect Upstox, or wait for quotes to load.');
      return;
    }
    if (!window.confirm(`Close “${draft.name}” at current prices? Recorded P&L: ${signedInr(pnl.total)}`)) return;
    void act(async () => onChanged((await api.closeDraft(draft.id, prices as number[], spot)).draft));
  };

  const reopen = () => void act(async () => onChanged((await api.reopenDraft(draft.id)).draft));

  const remove = () => {
    if (!window.confirm(`Delete “${draft.name}”? This cannot be undone.`)) return;
    void act(async () => {
      await api.deleteDraft(draft.id);
      onDeleted();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={onBack}>
          ← All drafts
        </Button>
        <h2 className="mr-auto min-w-0 truncate text-lg font-semibold">{draft.name}</h2>
        <Button onClick={() => onOpenInBuilder(draft)}>Open in builder</Button>
        <Button onClick={rename} disabled={busy}>
          Rename
        </Button>
        {closed ? (
          <Button onClick={reopen} disabled={busy}>
            Reopen
          </Button>
        ) : (
          <Button variant="primary" onClick={close} disabled={busy || !brokerConnected}>
            Close at market
          </Button>
        )}
        <Button variant="danger" onClick={remove} disabled={busy}>
          Delete
        </Button>
      </div>

      {actionError && <Notice tone="critical">{actionError}</Notice>}
      {!closed && !brokerConnected && <Notice>Connect Upstox to monitor live prices. Showing entry prices only.</Notice>}
      {!closed && missing > 0 && (
        <Notice>
          {missing} leg{missing > 1 ? 's were' : ' was'} added without a live-chain instrument, so {missing > 1 ? 'they have' : 'it has'} no live quote.
        </Notice>
      )}

      <Card className="grid grid-cols-2 gap-4 px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="col-span-2 sm:col-span-1">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{closed ? 'Final P&L' : 'Live P&L'}</div>
          <div className="text-2xl font-bold tabular" style={{ color: pnlColor(pnl.total) }}>
            {closed || pnl.perLeg.some((v) => v !== null) ? signedInr(pnl.total) : '—'}
          </div>
          {!closed && quotes.updatedAt && (
            <div className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--good)]" />
              {new Date(quotes.updatedAt).toLocaleTimeString('en-IN')}
            </div>
          )}
        </div>
        <Stat label="Status" hint={closed ? `Closed ${dateTime(draft.closedAt!)}` : `Since ${dateTime(draft.createdAt)}`}>
          <span style={{ color: closed ? 'var(--text-muted)' : 'var(--good-text)' }}>{closed ? 'Closed' : 'Open'}</span>
        </Stat>
        <Stat label="Entry credit / debit">
          <span style={{ color: pnl.entryNet >= 0 ? 'var(--good-text)' : 'var(--critical)' }}>
            {pnl.entryNet >= 0 ? 'Cr ' : 'Dr '}
            {inr(Math.abs(pnl.entryNet))}
          </span>
        </Stat>
        <Stat label={`${draft.symbol} at entry`}>{draft.entrySpot ? num(draft.entrySpot) : '—'}</Stat>
        <Stat label={closed ? `${draft.symbol} at exit` : `${draft.symbol} now`} hint={spotMove !== null ? signedPct(spotMove) : undefined}>
          {spot ? num(spot) : '—'}
        </Stat>
        <Stat label="Max profit / loss">
          <span style={{ color: 'var(--good-text)' }}>{metrics.maxProfit === null ? '∞' : inr(metrics.maxProfit)}</span>
          {' / '}
          <span style={{ color: 'var(--critical)' }}>{metrics.maxLoss === null ? '∞' : inr(metrics.maxLoss)}</span>
        </Stat>
      </Card>

      <Card>
        <CardHeader title="Legs" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-sm tabular">
            <thead className="text-left text-xs text-[var(--text-muted)]">
              <tr className="border-b border-[var(--border)]">
                <th className="px-3 py-2 font-medium">Side</th>
                <th className="px-3 py-2 font-medium">Instrument</th>
                <th className="px-3 py-2 font-medium">Expiry</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-right font-medium">Entry</th>
                <th className="px-3 py-2 text-right font-medium">{closed ? 'Exit' : 'LTP'}</th>
                <th className="px-3 py-2 text-right font-medium">Change</th>
                <th className="px-3 py-2 text-right font-medium">P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {draft.legs.map((l, i) => {
                const price = prices[i];
                const legPnl = pnl.perLeg[i];
                const buy = l.action === 'BUY';
                return (
                  <tr key={i} className="border-b border-[var(--gridline)]">
                    <td className="px-3 py-2">
                      <span
                        className="inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold text-white"
                        style={{ background: buy ? 'var(--series-blue)' : 'var(--critical)' }}
                      >
                        {buy ? 'B' : 'S'}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-medium">
                      {l.type === 'CE' || l.type === 'PE' ? `${l.strike.toLocaleString('en-IN')} ${l.type}` : l.type === 'FUT' ? 'Future' : 'Stock'}
                    </td>
                    <td className="px-3 py-2 text-[var(--text-secondary)]">{l.expiry ? formatExpiry(l.expiry) : '—'}</td>
                    <td className="px-3 py-2 text-right">{l.lots * l.lotSize}</td>
                    <td className="px-3 py-2 text-right">{num(l.premium)}</td>
                    <td className="px-3 py-2 text-right font-medium">{price == null ? '—' : num(price)}</td>
                    <td className="px-3 py-2 text-right" style={{ color: price == null ? undefined : pnlColor(price - l.premium) }}>
                      {price == null ? '—' : `${price - l.premium >= 0 ? '+' : ''}${num(price - l.premium)}`}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold" style={{ color: legPnl == null ? undefined : pnlColor(legPnl) }}>
                      {legPnl == null ? '—' : signedInr(legPnl)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <PayoffChart legs={legs} spot={spot} symbol={draft.symbol} metrics={metrics} fallbackIv={fallbackIv} oiRows={null} capital={metrics.marginEstimate} />
      <MetricsPanel metrics={metrics} greeks={greeks} hasLegs brokerMargin={null} marginLoading={false} />
    </div>
  );
}
