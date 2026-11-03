import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../../api/client';
import type { ChainSide } from '../../api/types';
import { Notice } from '../../components/ui';
import { sideMid } from '../../domain/analysis';
import { atmIv } from '../../domain/chain';
import { strategyMetrics } from '../../domain/payoff';
import { US_CONTRACT_SIZE, usModel } from '../../domain/pricing';
import { shareUrl } from '../../domain/shareLink';
import { buildFromTemplate, type StrategyTemplate } from '../../domain/templates';
import type { LegAction } from '../../domain/types';
import { modelChain, repairUsChain, stampUsChain } from '../../domain/usChain';
import { useSpot } from '../../hooks/market';
import { useAsync } from '../../hooks/useAsync';
import { confirmDialog } from '../../lib/dialog';
import { displaySymbol } from '../../lib/markets';
import { useUsStrategy } from '../../store/strategy';
import { BuilderPage, ModelPriceNotice } from './BuilderPage';
import { usView } from './market';
import { UsSymbolPicker } from './SymbolPickers';

/** Yahoo's chain is delayed ~15 minutes anyway; a minute between polls is plenty. */
const US_CHAIN_POLL_MS = 60_000;

/**
 * The US builder: Yahoo's listed option chain (delayed) priced with the US
 * model — 100-share contracts, US risk-free rate, the underlying's dividend
 * yield. When Yahoo can't serve a chain it falls back to Black-Scholes model
 * prices at an IV the user sets, and says so.
 */
export function UsBuilder({ marketSwitch, onNotice }: { marketSwitch: ReactNode; onNotice: (msg: string) => void }) {
  const { symbol, legs, setSymbol, addLeg, tradeLeg, replaceLegs, updateLeg, removeLeg, removeLegs, clearLegs } = useUsStrategy();
  const [expiry, setExpiry] = useState<string | undefined>(undefined);
  const [modelIv, setModelIv] = useState(25);

  useEffect(() => setExpiry(undefined), [symbol]);

  const spotState = useSpot(symbol);
  // The backend takes the calendar date; the app keeps US expiries stamped at the 16:00 New York close.
  const chainState = useAsync(() => api.usOptionChain(symbol, expiry?.slice(0, 10)), [symbol, expiry], { pollMs: US_CHAIN_POLL_MS });
  const stamped = useMemo(() => (chainState.data?.rows?.length ? stampUsChain(chainState.data) : null), [chainState.data]);
  const spot = spotState.data?.price ?? stamped?.underlyingValue ?? null;
  const fallingBack = !stamped && !chainState.loading && spot !== null;
  const dividendYield = stamped?.dividendYield ?? 0;
  const market = useMemo(() => usView(dividendYield), [dividendYield]);
  // Outside US hours Yahoo sends ~0% IVs; solve those from last traded prices instead.
  const repair = useMemo(() => (stamped && spot ? repairUsChain(stamped, spot, usModel(dividendYield)) : null), [stamped, spot, dividendYield]);
  const live = repair?.chain ?? stamped;
  const modelled = useMemo(
    () => (fallingBack && spot ? modelChain(symbol, spot, modelIv, expiry ?? null, usModel(dividendYield)) : null),
    [fallingBack, spot, symbol, modelIv, expiry, dividendYield],
  );
  const chain = live ?? modelled;
  const activeExpiry = expiry ?? chain?.expiry ?? null;

  const metrics = useMemo(() => strategyMetrics(legs, spot ?? 0, symbol), [legs, spot, symbol]);
  const fallbackIv = useMemo(() => atmIv(chain?.rows ?? [], spot), [chain, spot]);
  const marks = useMemo(
    () =>
      legs.map((l) => {
        if ((l.type !== 'CE' && l.type !== 'PE') || !chain || (l.expiry && l.expiry !== chain.expiry)) return null;
        const row = chain.rows.find((r) => r.strike === l.strike);
        return sideMid(l.type === 'CE' ? row?.call : row?.put);
      }),
    [legs, chain],
  );

  const changeSymbol = async (next: string) => {
    if (next === symbol) return;
    if (
      legs.length > 0 &&
      !(await confirmDialog({
        title: `Switch to ${displaySymbol(next)}?`,
        message: `This clears the ${legs.length} leg${legs.length > 1 ? 's' : ''} in your current US strategy.`,
        confirmLabel: 'Yes, Switch',
      }))
    )
      return;
    setSymbol(next, US_CONTRACT_SIZE);
  };

  // US fills default to the bid / ask mid, as US brokers quote spreads.
  const addFromChain = (type: 'CE' | 'PE', action: LegAction, strike: number, premium: number, side: ChainSide | null, lots = 1) => {
    const fill = sideMid(side) ?? premium;
    tradeLeg({ action, type, strike, premium: Number(fill.toFixed(2)), lots, lotSize: US_CONTRACT_SIZE, instrumentKey: null, iv: side?.iv ?? null, expiry: chain?.expiry ?? null });
    onNotice(`${action === 'BUY' ? 'Bought' : 'Sold'} ${lots} × ${displaySymbol(symbol)} ${strike} ${type === 'CE' ? 'call' : 'put'}`);
  };

  const applyTemplate = async (t: StrategyTemplate) => {
    const built = spot && chain?.rows.length ? buildFromTemplate(t, chain.rows, spot, US_CONTRACT_SIZE, chain.expiry, (s) => sideMid(s) ?? 0) : null;
    if (!built) {
      onNotice('Not enough strikes around the money to build that template.');
      return;
    }
    if (
      legs.length > 0 &&
      !(await confirmDialog({
        title: `Replace your strategy with a ${t.name}?`,
        message: `The ${legs.length} leg${legs.length > 1 ? 's' : ''} you have now will be removed.`,
        confirmLabel: 'Yes, Replace',
      }))
    )
      return;
    replaceLegs(built);
  };

  const confirmClear = async () => {
    if (await confirmDialog({ title: 'Are you sure you want to clear all legs?', confirmLabel: 'Yes, Clear' })) clearLegs();
  };

  const share = async () => {
    const url = shareUrl(window.location, symbol, legs);
    try {
      await navigator.clipboard.writeText(url);
      onNotice('Link copied — anyone with it can open this strategy');
    } catch {
      window.prompt('Copy this link', url);
    }
  };

  const notice = fallingBack ? (
    <ModelPriceNotice iv={modelIv} onIvChange={setModelIv} reason={chainState.error ? 'Yahoo’s option chain is unavailable right now' : `no listed options found for ${displaySymbol(symbol)}`} />
  ) : spotState.error && !spot ? (
    <Notice tone="critical">Could not get a price for {displaySymbol(symbol)}: {spotState.error}</Notice>
  ) : null;

  return (
    <BuilderPage
      market={market}
      marketSwitch={marketSwitch}
      picker={<UsSymbolPicker symbol={symbol} onChange={(s) => void changeSymbol(s)} />}
      symbol={symbol}
      spotQuote={spotState.data}
      spotError={spotState.error}
      spot={spot}
      chain={chain}
      chainLoading={chainState.loading}
      chainNotice={notice}
      quoteSource={
        live
          ? repair?.repaired
            ? 'Yahoo option quotes, ~15 min delayed · IV from last prices (market closed)'
            : 'Yahoo option quotes, ~15 min delayed'
          : fallingBack ? 'Model prices (Black-Scholes)' : 'Loading the option chain…'}
      expiry={activeExpiry}
      onExpiryChange={setExpiry}
      updatedAt={chainState.updatedAt ?? spotState.updatedAt}
      legs={legs}
      lotSize={US_CONTRACT_SIZE}
      metrics={metrics}
      fallbackIv={fallbackIv}
      marks={marks}
      brokerMargin={null}
      marginLoading={false}
      draftCount={0}
      onTemplate={(t) => void applyTemplate(t)}
      onAddFromChain={addFromChain}
      onAddLeg={addLeg}
      onUpdateLeg={updateLeg}
      onRemoveLeg={removeLeg}
      onRemoveLegs={removeLegs}
      onClear={() => void confirmClear()}
      onSaveDraft={null}
      onShare={() => void share()}
      onViewDrafts={null}
      onOpenChainPage={null}
    />
  );
}
