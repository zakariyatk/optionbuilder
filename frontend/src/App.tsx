import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, onLoginRequired } from './api/client';
import type { ChainSide, Session } from './api/types';
import { AppHeader } from './components/AppHeader';
import { TABS, type TabId } from './components/tabs';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LegsTable } from './components/LegsTable';
import { LoginGate } from './components/LoginGate';
import { MarketBar } from './components/MarketBar';
import { MetricsPanel } from './components/MetricsPanel';
import { OptionChainTable } from './components/OptionChainTable';
import { PayoffChart } from './components/PayoffChart';
import { StrategyToolbar } from './components/StrategyToolbar';
import { Button, Notice } from './components/ui';
import { atmIv, generateStrikes } from './domain/chain';
import { strategyGreeks, strategyMetrics } from './domain/payoff';
import { buildFromTemplate, type StrategyTemplate } from './domain/templates';
import type { LegAction } from './domain/types';
import { DailyReport } from './features/report/DailyReport';
import { useBrokerMargin, useBrokerStatus, useOptionChain, useSpot, useSymbols } from './hooks/market';
import { useStrategy } from './store/strategy';

const TAB_KEY = 'option-builder-tab';

function initialTab(): TabId {
  const fromHash = window.location.hash.slice(1);
  if (TABS.some((t) => t.id === fromHash)) return fromHash as TabId;
  try {
    const stored = localStorage.getItem(TAB_KEY);
    if (TABS.some((t) => t.id === stored)) return stored as TabId;
  } catch {
    /* ignore */
  }
  return 'builder';
}

/** Session gate: shows the login form until the backend says we're in. */
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  const check = useCallback(() => {
    api
      .session()
      .then((s) => {
        setSession(s);
        setUnreachable(false);
      })
      .catch(() => setUnreachable(true));
  }, []);

  useEffect(check, [check]);
  // Any request that finds the session expired drops the user back to the gate.
  useEffect(() => onLoginRequired(() => setSession((s) => (s ? { ...s, loggedIn: false } : s))), []);

  if (unreachable) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
        <div className="text-sm text-[var(--critical)]">Cannot reach the Option Builder server.</div>
        <div className="text-xs text-[var(--text-muted)]">Check your connection, or that the backend is running.</div>
        <Button onClick={check}>Retry</Button>
      </main>
    );
  }
  if (session === null) return null;
  if (!session.loggedIn) return <LoginGate onSuccess={check} />;

  return (
    <Workspace
      showLogout={session.authRequired}
      onLogout={() => {
        api.logout().finally(check);
      }}
    />
  );
}

function Workspace({ showLogout, onLogout }: { showLogout: boolean; onLogout: () => void }) {
  const symbols = useSymbols();
  const { symbol, lotSize, legs, saved, setSymbol, addLeg, replaceLegs, updateLeg, removeLeg, clearLegs, toggleLegAction, saveStrategy, loadStrategy, deleteStrategy } =
    useStrategy();

  const [tab, setTab] = useState<TabId>(initialTab);
  const [expiry, setExpiry] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);

  const { status: broker } = useBrokerStatus();
  const brokerConnected = !!broker?.authenticated;
  const spotState = useSpot(symbol);
  const chainState = useOptionChain(symbol, expiry, brokerConnected);
  const chain = chainState.data;
  const { margin: brokerMargin, loading: marginLoading } = useBrokerMargin(legs, brokerConnected);

  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      /* ignore */
    }
    if (window.location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
  }, [tab]);

  // A new underlying has its own expiry list; let the backend pick the nearest.
  useEffect(() => setExpiry(undefined), [symbol]);

  // Sync the stored lot size once the symbol list arrives (lot sizes get revised by NSE).
  useEffect(() => {
    const info = symbols.find((s) => s.symbol === symbol);
    if (info && info.lotSize !== lotSize) setSymbol(symbol, info.lotSize);
  }, [symbols, symbol, lotSize, setSymbol]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const spot = spotState.data?.price ?? chain?.underlyingValue ?? null;
  const effectiveLot = chain?.lotSize ?? lotSize;
  const activeExpiry = expiry ?? chain?.expiry ?? null;

  const metrics = useMemo(() => strategyMetrics(legs, spot ?? 0, symbol), [legs, spot, symbol]);
  const fallbackIv = useMemo(() => atmIv(chain?.rows ?? [], spot), [chain, spot]);
  const greeks = useMemo(() => strategyGreeks(legs, spot ?? 0, fallbackIv), [legs, spot, fallbackIv]);

  const changeSymbol = (next: string) => {
    if (next === symbol) return;
    if (legs.length > 0 && !window.confirm(`Switching to ${next} clears the ${legs.length} leg(s) in your current strategy. Continue?`)) return;
    setSymbol(next, symbols.find((s) => s.symbol === next)?.lotSize ?? 1);
  };

  const addFromChain = (type: 'CE' | 'PE', action: LegAction, strike: number, premium: number, side: ChainSide | null) => {
    addLeg({
      action,
      type,
      strike,
      premium,
      lots: 1,
      lotSize: effectiveLot,
      instrumentKey: side?.instrumentKey ?? null,
      iv: side?.iv ?? null,
      expiry: chain?.expiry ?? null,
    });
    setNotice(`Added ${action === 'BUY' ? 'Buy' : 'Sell'} ${strike.toLocaleString('en-IN')} ${type}`);
  };

  const applyTemplate = (t: StrategyTemplate) => {
    const rows = chain?.rows?.length ? chain.rows : spot ? generateStrikes(symbol, spot, 30).map((strike) => ({ strike, call: null, put: null })) : [];
    const built = spot ? buildFromTemplate(t, rows, spot, effectiveLot, chain?.expiry ?? null) : null;
    if (!built) {
      setNotice('Not enough strikes around the money to build that template.');
      return;
    }
    if (legs.length > 0 && !window.confirm(`Replace the ${legs.length} leg(s) in your strategy with a ${t.name}?`)) return;
    replaceLegs(built);
    if (!chain?.rows?.length) setNotice(`${t.name} added — enter premiums manually (no live chain).`);
  };

  const chainProps = {
    rows: chain?.rows ?? null,
    loading: chainState.loading,
    spot,
    symbol,
    lotSize: effectiveLot,
    expiry: chain?.expiry ?? null,
    onAddLeg: addFromChain,
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <AppHeader tab={tab} onTab={setTab} broker={broker} onLogout={onLogout} showLogout={showLogout} />

      <div className="mb-4 flex flex-col gap-2">
        <MarketBar
          symbols={symbols}
          symbol={symbol}
          onSymbolChange={changeSymbol}
          expiryDates={chain?.expiryDates ?? []}
          expiry={activeExpiry}
          onExpiryChange={setExpiry}
          spot={spotState.data}
          spotError={spotState.error}
          updatedAt={chainState.updatedAt ?? spotState.updatedAt}
        />
        {brokerConnected && chainState.error && !chain && <Notice tone="critical">Option chain: {chainState.error}</Notice>}
      </div>

      {notice && (
        <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-md bg-[var(--accent)] px-3 py-2 text-xs text-[var(--accent-text)] shadow-lg" role="status">
          {notice}
        </div>
      )}

      {tab === 'report' && (
        <section id="panel-report" role="tabpanel" aria-labelledby="tab-report">
          <ErrorBoundary label="the daily report">
            <DailyReport symbol={symbol} brokerConnected={brokerConnected} />
          </ErrorBoundary>
        </section>
      )}

      {tab === 'chain' && (
        <section id="panel-chain" role="tabpanel" aria-labelledby="tab-chain" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
            <span>Click B / S on any strike to add it to your strategy.</span>
            {legs.length > 0 && (
              <Button onClick={() => setTab('builder')}>
                {legs.length} leg{legs.length > 1 ? 's' : ''} in strategy — open builder →
              </Button>
            )}
          </div>
          <ErrorBoundary label="the option chain">
            <OptionChainTable {...chainProps} maxHeight={720} detailed />
          </ErrorBoundary>
        </section>
      )}

      {tab === 'builder' && (
        <section id="panel-builder" role="tabpanel" aria-labelledby="tab-builder" className="grid grid-cols-1 gap-4 lg:grid-cols-[420px_minmax(0,1fr)]">
          <div className="order-2 lg:order-1">
            <ErrorBoundary label="the option chain">
              <OptionChainTable {...chainProps} />
            </ErrorBoundary>
          </div>
          <div className="order-1 flex min-w-0 flex-col gap-4 lg:order-2">
            <StrategyToolbar
              canBuild={spot !== null}
              hasLegs={legs.length > 0}
              symbol={symbol}
              saved={saved}
              onTemplate={applyTemplate}
              onSave={(name) => {
                saveStrategy(name);
                setNotice(`Saved “${name}”`);
              }}
              onLoad={(id) => {
                const entry = saved.find((s) => s.id === id);
                if (legs.length > 0 && !window.confirm('Replace your current strategy with the saved one?')) return;
                loadStrategy(id);
                if (entry && entry.symbol !== symbol) setNotice(`Switched to ${entry.symbol} to load “${entry.name}”`);
              }}
              onDelete={deleteStrategy}
            />
            <ErrorBoundary label="the payoff chart">
              <PayoffChart legs={legs} spot={spot} metrics={metrics} fallbackIv={fallbackIv} oiRows={chain?.rows ?? null} />
            </ErrorBoundary>
            <MetricsPanel metrics={metrics} greeks={greeks} hasLegs={legs.length > 0} brokerMargin={brokerMargin} marginLoading={marginLoading} />
            <LegsTable
              legs={legs}
              onUpdate={updateLeg}
              onRemove={removeLeg}
              onToggleAction={toggleLegAction}
              onClear={() => {
                if (window.confirm('Remove all legs from this strategy?')) clearLegs();
              }}
              onAddBlank={() =>
                addLeg({ action: 'BUY', type: 'CE', strike: Math.round(spot ?? 100), premium: 0, lots: 1, lotSize: effectiveLot, expiry: chain?.expiry ?? null })
              }
              onAddEquity={() =>
                addLeg({ action: 'BUY', type: 'EQ', strike: 0, premium: Number((spot ?? 0).toFixed(2)), lots: 1, lotSize: effectiveLot })
              }
            />
          </div>
        </section>
      )}

      <footer className="mt-8 border-t border-[var(--border)] pt-3 text-[10px] leading-relaxed text-[var(--text-muted)]">
        Option Builder is an analysis tool, not investment advice. Prices, margins and Greeks are estimates — verify with your broker before trading.
      </footer>
    </div>
  );
}
