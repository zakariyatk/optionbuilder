import { useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../../api/client';
import type { ChainSide, Draft, DraftLeg } from '../../api/types';
import { MetricsPanel } from '../../components/MetricsPanel';
import { PayoffChart } from '../../components/PayoffChart';
import { StrikeChain } from '../../components/StrikeChain';
import { Button, Card, CardHeader, Notice, selectClass } from '../../components/ui';
import { atmIv } from '../../domain/chain';
import { formatExpiry } from '../../domain/dates';
import { applyDraftTrade, draftLegToLeg, draftPnl, draftPrices, exitLegTrade } from '../../domain/drafts';
import { strategyGreeks, strategyMetrics } from '../../domain/payoff';
import type { LegAction } from '../../domain/types';
import { useOptionChain, useSpot } from '../../hooks/market';
import { confirmDialog, promptDialog } from '../../lib/dialog';
import { inr, num, signedInr, signedPct } from '../../lib/format';
import { dateTime, useDraftQuotes } from './useDraftQuotes';

const pnlColor = (v: number) => (v > 0 ? 'var(--good-text)' : v < 0 ? 'var(--critical)' : 'var(--text-secondary)');

const instrument = (l: { type: DraftLeg['type']; strike: number }) =>
  l.type === 'CE' || l.type === 'PE' ? `${l.strike.toLocaleString('en-IN')} ${l.type}` : l.type === 'FUT' ? 'Future' : 'Stock';

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
  const [adjusting, setAdjusting] = useState(false);
  const closed = draft.closedAt !== null;
  const realized = draft.realized ?? 0;

  const firstExpiry = useMemo(() => draft.legs.map((l) => l.expiry).filter((e): e is string => !!e).sort()[0], [draft.legs]);
  const [chainExpiry, setChainExpiry] = useState<string | undefined>(firstExpiry);
  // The chain feeds the OI bars behind the payoff and the add / exit panel.
  const chainState = useOptionChain(draft.symbol, chainExpiry, brokerConnected);
  const chain = chainState.data;

  const drafts = useMemo(() => [draft], [draft]);
  const quotes = useDraftQuotes(drafts, brokerConnected && !closed);
  const spotState = useSpot(draft.symbol);
  const spot = closed ? (draft.exitSpot ?? spotState.data?.price ?? null) : (spotState.data?.price ?? chain?.underlyingValue ?? null);

  const prices = draftPrices(draft, quotes.data?.quotes);
  const pnl = draftPnl(draft.legs, prices, realized);
  const legs = useMemo(() => draft.legs.map(draftLegToLeg), [draft.legs]);
  const ivs = draft.legs.map((l) => l.iv).filter((v): v is number => !!v);
  const fallbackIv = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : atmIv(chain?.rows ?? [], spot);
  const metrics = useMemo(() => strategyMetrics(legs, spot ?? draft.entrySpot ?? 0, draft.symbol), [legs, spot, draft.entrySpot, draft.symbol]);
  const greeks = useMemo(() => strategyGreeks(legs, spot ?? 0, fallbackIv), [legs, spot, fallbackIv]);
  const missing = draft.legs.filter((l) => !l.instrumentKey).length;
  const spotMove = spot && draft.entrySpot ? ((spot - draft.entrySpot) / draft.entrySpot) * 100 : null;
  const trades = draft.trades ?? [];

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

  /** Nets a fill into the draft and records it. */
  const fill = (trade: DraftLeg) =>
    act(async () => {
      const next = applyDraftTrade(draft.legs, trade);
      onChanged((await api.adjustDraft(draft.id, next.legs, { ...trade, realized: next.trade.realized }, spot)).draft);
    });

  const addFromChain = (type: 'CE' | 'PE', action: LegAction, strike: number, premium: number, side: ChainSide | null, lots = 1) => {
    if (busy || !chain) return;
    void fill({
      action,
      type,
      strike,
      premium,
      lots,
      lotSize: chain.lotSize,
      instrumentKey: side?.instrumentKey ?? null,
      iv: side?.iv ?? null,
      expiry: chain.expiry,
    });
  };

  const exitLeg = async (i: number) => {
    const leg = draft.legs[i];
    const price = prices[i];
    if (price == null) {
      setActionError('This leg has no live price to exit at yet.');
      return;
    }
    const ok = await confirmDialog({
      title: `Are you sure you want to exit ${instrument(leg)}?`,
      message: `${leg.action === 'BUY' ? 'Sell' : 'Buy back'} ${leg.lots * leg.lotSize} at ${num(price)}.`,
      confirmLabel: 'Yes, Exit',
    });
    if (!ok) return;
    void fill(exitLegTrade(leg, price));
  };

  const rename = async () => {
    const name = await promptDialog({ title: 'Rename draft', defaultValue: draft.name, confirmLabel: 'Save' });
    if (name === null || name.trim() === '' || name === draft.name) return;
    void act(async () => onChanged((await api.renameDraft(draft.id, name)).draft));
  };

  const close = async () => {
    if (!pnl.complete) {
      setActionError('Every leg needs a live price to close at market. Connect Upstox, or wait for quotes to load.');
      return;
    }
    const ok = await confirmDialog({
      title: `Close “${draft.name}” at market?`,
      message: `Every open leg exits at its current price. Recorded P&L: ${signedInr(pnl.total)}.`,
      confirmLabel: 'Yes, Close',
    });
    if (!ok) return;
    void act(async () => onChanged((await api.closeDraft(draft.id, prices as number[], spot)).draft));
  };

  const reopen = () => void act(async () => onChanged((await api.reopenDraft(draft.id)).draft));

  const remove = async () => {
    const ok = await confirmDialog({
      title: 'Are you sure you want to delete?',
      message: `“${draft.name}” and its trade record will be removed. This cannot be undone.`,
      confirmLabel: 'Yes, Delete',
    });
    if (!ok) return;
    void act(async () => {
      await api.deleteDraft(draft.id);
      onDeleted();
    });
  };

  const canTrade = !closed && brokerConnected;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          All drafts
        </Button>
        <h2 className="mr-auto min-w-0 truncate text-lg font-semibold max-sm:basis-[calc(100%-9rem)]">{draft.name}</h2>
        {!closed && (
          <Button variant={adjusting ? 'primary' : 'default'} onClick={() => setAdjusting((a) => !a)} disabled={!brokerConnected} aria-expanded={adjusting}>
            {adjusting ? <Check size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
            {adjusting ? 'Done adjusting' : 'Add / exit legs'}
          </Button>
        )}
        <Button onClick={() => onOpenInBuilder(draft)} disabled={draft.legs.length === 0}>
          Open in builder
        </Button>
        <Button onClick={rename} disabled={busy}>
          <Pencil size={16} aria-hidden="true" />
          Rename
        </Button>
        {closed ? (
          <Button onClick={reopen} disabled={busy || draft.legs.length === 0}>
            Reopen
          </Button>
        ) : (
          <Button onClick={close} disabled={busy || !brokerConnected}>
            Close at market
          </Button>
        )}
        <Button variant="danger" onClick={remove} disabled={busy}>
          <Trash2 size={16} aria-hidden="true" />
          Delete
        </Button>
      </div>

      {actionError && <Notice tone="critical">{actionError}</Notice>}
      {!closed && !brokerConnected && <Notice>Connect Upstox to monitor live prices and adjust legs. Showing entry prices only.</Notice>}
      {!closed && missing > 0 && (
        <Notice>
          {missing} leg{missing > 1 ? 's were' : ' was'} added without a live-chain instrument, so {missing > 1 ? 'they have' : 'it has'} no live quote.
        </Notice>
      )}

      <Card className="grid grid-cols-2 gap-4 px-4 py-3 sm:grid-cols-4 lg:grid-cols-7">
        <div className="col-span-2 sm:col-span-1">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{closed ? 'Final P&L' : 'Live P&L'}</div>
          <div className="text-2xl font-bold tabular" style={{ color: pnlColor(pnl.total) }}>
            {closed || realized !== 0 || pnl.perLeg.some((v) => v !== null) ? signedInr(pnl.total) : '—'}
          </div>
          {!closed && quotes.updatedAt && (
            <div className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--good)]" />
              {new Date(quotes.updatedAt).toLocaleTimeString('en-IN')}
            </div>
          )}
        </div>
        <Stat label="Realized" hint="Booked by exits">
          <span style={{ color: pnlColor(realized) }}>{signedInr(realized)}</span>
        </Stat>
        <Stat label="Status" hint={closed ? `Closed ${dateTime(draft.closedAt!)}` : `Since ${dateTime(draft.createdAt)}`}>
          <span style={{ color: closed ? 'var(--text-muted)' : 'var(--good-text)' }}>{closed ? 'Closed' : 'Open'}</span>
        </Stat>
        <Stat label="Entry credit / debit" hint="Open legs">
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

      {adjusting && canTrade && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
            <span>Hover a strike and click B / S to add to this draft at the live price. Trading against a held leg reduces it and books the P&amp;L.</span>
            {chain && chain.expiryDates.length > 0 && (
              <select
                aria-label="Expiry"
                className={`${selectClass} ml-auto`}
                value={chainExpiry ?? chain.expiry ?? ''}
                onChange={(e) => setChainExpiry(e.target.value)}
              >
                {chain.expiryDates.map((d) => (
                  <option key={d} value={d}>
                    {formatExpiry(d)}
                  </option>
                ))}
              </select>
            )}
          </div>
          {chain?.rows?.length ? (
            <StrikeChain
              rows={chain.rows}
              spot={spot}
              symbol={draft.symbol}
              lotSize={chain.lotSize}
              expiry={chain.expiry}
              legs={legs}
              maxHeight={520}
              onAddLeg={addFromChain}
              onRemoveLegs={(ids) => ids.forEach((id) => void exitLeg(Number(id)))}
              onClear={close}
            />
          ) : (
            <Card className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">{chainState.error ?? 'Loading option chain…'}</Card>
          )}
        </div>
      )}

      <Card>
        <CardHeader title={`Open legs (${draft.legs.length})`} />
        {draft.legs.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">All legs exited.</div>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-sm tabular">
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
                  {canTrade && <th className="px-3 py-2" />}
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
                      <td className="px-3 py-2 font-medium">{instrument(l)}</td>
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
                      {canTrade && (
                        <td className="px-3 py-2 text-right">
                          <Button size="xs" onClick={() => exitLeg(i)} disabled={busy || price == null} title={`${buy ? 'Sell' : 'Buy back'} at the live price`}>
                            Exit
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {legs.length > 0 && (
        <>
          <PayoffChart
            legs={legs}
            spot={spot}
            symbol={draft.symbol}
            metrics={metrics}
            fallbackIv={fallbackIv}
            oiRows={chain?.rows ?? null}
            capital={metrics.marginEstimate}
            marks={prices}
          />
          <MetricsPanel metrics={metrics} greeks={greeks} hasLegs brokerMargin={null} marginLoading={false} />
        </>
      )}

      {trades.length > 0 && (
        <Card>
          <CardHeader title={`Trade record (${trades.length})`} />
          <div className="relative max-h-80 overflow-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm tabular">
              <thead className="sticky top-0 bg-[var(--surface-card)] text-left text-xs text-[var(--text-muted)]">
                <tr className="border-b border-[var(--border)]">
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Side</th>
                  <th className="px-3 py-2 font-medium">Instrument</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Price</th>
                  <th className="px-3 py-2 text-right font-medium">Booked P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {[...trades].reverse().map((t, i) => (
                  <tr key={i} className="border-b border-[var(--gridline)]">
                    <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">{dateTime(t.at)}</td>
                    <td className="px-3 py-2 text-xs font-semibold" style={{ color: t.action === 'BUY' ? 'var(--series-blue)' : 'var(--critical)' }}>
                      {t.action === 'BUY' ? 'Buy' : 'Sell'}
                    </td>
                    <td className="px-3 py-2">
                      {instrument(t)}
                      {t.expiry && <span className="text-xs text-[var(--text-muted)]"> · {formatExpiry(t.expiry)}</span>}
                    </td>
                    <td className="px-3 py-2 text-right">{t.lots * t.lotSize}</td>
                    <td className="px-3 py-2 text-right">{num(t.price)}</td>
                    <td className="px-3 py-2 text-right" style={{ color: t.realized ? pnlColor(t.realized) : 'var(--text-muted)' }}>
                      {t.realized ? signedInr(t.realized) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
