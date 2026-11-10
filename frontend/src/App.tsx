import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { api, errorMessage, onLoginRequired } from './api/client';
import type { ChainSide, Draft, Session } from './api/types';
import { AppHeader } from './components/AppHeader';
import { parseRoute, routeHash, type PageId, type Route } from './components/tabs';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginGate } from './components/LoginGate';
import { isAuthRedirect, isDesktopApp } from './api/supabase';
import { MarketBar } from './components/MarketBar';
import { OptionChainTable } from './components/OptionChainTable';
import { Button, Card, Notice } from './components/ui';
import { atmIv, generateStrikes } from './domain/chain';
import { legToDraftLeg } from './domain/drafts';
import { strategyMetrics } from './domain/payoff';
import { readShared, shareUrl } from './domain/shareLink';
import { buildFromTemplate, type StrategyTemplate } from './domain/templates';
import type { LegAction } from './domain/types';
import { AlertMonitor } from './features/alerts/AlertMonitor';
import { BuilderPage, MarketSwitch } from './features/builder/BuilderPage';
import { INDIA_VIEW } from './features/builder/market';
import { NseSymbolSelect } from './features/builder/SymbolPickers';
import { UsBuilder } from './features/builder/UsBuilder';
import { isUs } from './lib/markets';
import { DraftMonitor } from './features/drafts/DraftMonitor';
import { DraftsPage } from './features/drafts/DraftsPage';
import { OpenInterestPage } from './features/oi/OpenInterestPage';
import { PortfolioPage } from './features/portfolio/PortfolioPage';
import { DailyReport } from './features/report/DailyReport';
import { useBrokerMargin, useBrokerStatus, useOptionChain, useSpot, useSymbols } from './hooks/market';
import { useAsync } from './hooks/useAsync';
import { confirmDialog } from './lib/dialog';
import { loadBuilderMarket, saveBuilderMarket, useStrategy, useUsStrategy, type BuilderMarket } from './store/strategy';

const PAGE_KEY = 'option-builder-tab';

// The chart engine is large, so its page loads only when opened.
const ChartPage = lazy(() => import('./features/chart/ChartPage').then((m) => ({ default: m.ChartPage })));
// Only visitors who aren't signed in see the landing page.
const Landing = lazy(() => import('./features/landing/Landing').then((m) => ({ default: m.Landing })));
// The Windows app's start screen in place of the landing page.
const DesktopHome = lazy(() => import('./features/landing/DesktopHome').then((m) => ({ default: m.DesktopHome })));

function initialRoute(): Route {
  const fromHash = parseRoute(window.location.hash);
  if (fromHash) return fromHash;
  try {
    const stored = parseRoute(`#${localStorage.getItem(PAGE_KEY) ?? ''}`);
    if (stored) return { page: stored.page };
  } catch {
    /* ignore */
  }
  return { page: 'builder' };
}

/** Pages that show the symbol / expiry bar and use the live chain. */
const MARKET_PAGES: PageId[] = ['builder', 'chain', 'report'];

/** Session gate: the landing page, then the login form, until the backend says we're in. */
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  // Coming back from Google goes straight to the login gate, which finishes the sign-in.
  const [signingIn, setSigningIn] = useState(isAuthRedirect);

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
        <div className="text-sm text-[var(--critical)]">Cannot reach the AddStock server.</div>
        <div className="text-xs text-[var(--text-muted)]">Check your connection, or that the backend is running.</div>
        <Button onClick={check}>Retry</Button>
      </main>
    );
  }
  if (session === null) return null;
  if (!session.loggedIn) {
    if (signingIn) {
      return (
        <LoginGate
          supabase={session.supabase ?? null}
          passwordLogin={session.passwordLogin ?? true}
          onSuccess={check}
          onBack={() => setSigningIn(false)}
        />
      );
    }
    if (isDesktopApp()) {
      return (
        <Suspense fallback={null}>
          <DesktopHome
            onSignIn={(page) => {
              // The workspace opens on the page in the address bar once signed in.
              if (page) history.replaceState(null, '', routeHash({ page }));
              setSigningIn(true);
            }}
          />
        </Suspense>
      );
    }
    return (
      <Suspense fallback={null}>
        <Landing
          onSignIn={() => {
            setSigningIn(true);
            window.scrollTo({ top: 0 });
          }}
        />
      </Suspense>
    );
  }

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
  const {
    symbol,
    lotSize,
    legs,
    saved,
    setSymbol,
    addLeg,
    tradeLeg,
    replaceLegs,
    updateLeg,
    removeLeg,
    removeLegs,
    clearLegs,
    deleteStrategy,
  } = useStrategy();

  const [route, setRoute] = useState<Route>(initialRoute);
  const [builderMarket, setBuilderMarketState] = useState<BuilderMarket>(loadBuilderMarket);
  const setBuilderMarket = useCallback((m: BuilderMarket) => {
    setBuilderMarketState(m);
    saveBuilderMarket(m);
  }, []);
  const [expiry, setExpiry] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);

  const { status: broker } = useBrokerStatus();
  // Live NSE data: today's Upstox login, or the 1-year analytics token on the server.
  const brokerConnected = !!(broker?.authenticated || broker?.marketData);
  // Broker margin still needs today's login.
  const brokerSession = !!broker?.authenticated;
  const marketPage = MARKET_PAGES.includes(route.page);
  const spotState = useSpot(symbol);
  const indiaBuilder = route.page === 'builder' && builderMarket === 'IN';
  const chainState = useOptionChain(symbol, expiry, brokerConnected && (indiaBuilder || route.page === 'chain'));
  const chain = chainState.data;
  const { margin: brokerMargin, loading: marginLoading } = useBrokerMargin(legs, brokerSession && indiaBuilder);
  const draftsState = useAsync(() => api.drafts(), []);
  const drafts = draftsState.data?.drafts ?? null;

  const navigate = useCallback((next: Route) => {
    setRoute(next);
    const hash = routeHash(next);
    if (window.location.hash !== hash) history.pushState(null, '', hash);
    window.scrollTo({ top: 0 });
  }, []);

  // Browser back / forward between pages.
  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.hash) ?? { page: 'builder' });
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PAGE_KEY, route.page);
    } catch {
      /* ignore */
    }
    const hash = routeHash(route);
    if (window.location.hash !== hash) history.replaceState(null, '', hash);
  }, [route]);

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
  // Live LTP of each leg from the chain (same expiry only), so the payoff projection starts from the market.
  const marks = useMemo(
    () =>
      legs.map((l) => {
        if ((l.type !== 'CE' && l.type !== 'PE') || !chain || (l.expiry && l.expiry !== chain.expiry)) return null;
        const row = chain.rows.find((r) => r.strike === l.strike);
        return (l.type === 'CE' ? row?.call : row?.put)?.ltp ?? null;
      }),
    [legs, chain],
  );

  /** Resolves true once the switch happened (it clears the legs, so it asks first). */
  const changeSymbol = async (next: string): Promise<boolean> => {
    if (next === symbol) return true;
    if (
      legs.length > 0 &&
      !(await confirmDialog({
        title: `Switch to ${next}?`,
        message: `This clears the ${legs.length} leg${legs.length > 1 ? 's' : ''} in your current strategy.`,
        confirmLabel: 'Yes, Switch',
      }))
    )
      return false;
    setSymbol(next, symbols.find((s) => s.symbol === next)?.lotSize ?? 1);
    return true;
  };

  const addFromChain = (type: 'CE' | 'PE', action: LegAction, strike: number, premium: number, side: ChainSide | null, lots = 1) => {
    tradeLeg({
      action,
      type,
      strike,
      premium,
      lots,
      lotSize: effectiveLot,
      instrumentKey: side?.instrumentKey ?? null,
      iv: side?.iv ?? null,
      expiry: chain?.expiry ?? null,
    });
    setNotice(`${action === 'BUY' ? 'Bought' : 'Sold'} ${lots * effectiveLot} × ${strike.toLocaleString('en-IN')} ${type}`);
  };

  const applyTemplate = async (t: StrategyTemplate) => {
    const rows = chain?.rows?.length ? chain.rows : spot ? generateStrikes(symbol, spot, 30).map((strike) => ({ strike, call: null, put: null })) : [];
    const built = spot ? buildFromTemplate(t, rows, spot, effectiveLot, chain?.expiry ?? null) : null;
    if (!built) {
      setNotice('Not enough strikes around the money to build that template.');
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
    if (!chain?.rows?.length) setNotice(`${t.name} added — enter premiums manually (no live chain).`);
  };

  // A shared link (?sym=…&legs=…) loads its strategy once, then the query is dropped from the address.
  useEffect(() => {
    const shared = readShared(window.location.search);
    if (!shared) return;
    history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`);
    void (async () => {
      const us = isUs(shared.symbol);
      const store = us ? useUsStrategy : useStrategy;
      const { legs: current, symbol: currentSymbol } = store.getState();
      if (
        current.length > 0 &&
        !(await confirmDialog({
          title: 'Open the shared strategy?',
          message: `It replaces the ${current.length} leg${current.length > 1 ? 's' : ''} in your current ${currentSymbol} strategy.`,
          confirmLabel: 'Yes, Open',
        }))
      )
        return;
      store.getState().setSymbol(shared.symbol, shared.legs[0]?.lotSize ?? 1);
      store.getState().replaceLegs(shared.legs);
      setBuilderMarket(us ? 'US' : 'IN');
      setRoute({ page: 'builder' });
    })();
  }, [setBuilderMarket]);

  const share = async () => {
    const url = shareUrl(window.location, symbol, legs);
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Link copied — anyone with it can open this strategy');
    } catch {
      window.prompt('Copy this link', url);
    }
  };

  const confirmClear = async () => {
    if (await confirmDialog({ title: 'Are you sure you want to clear all legs?', confirmLabel: 'Yes, Clear' })) clearLegs();
  };

  /** Records the working strategy, at its current premiums, as a draft portfolio. */
  const saveDraft = async (name: string): Promise<boolean> => {
    try {
      await api.createDraft({ name, symbol, legs: legs.map(legToDraftLeg), entrySpot: spot });
      draftsState.reload();
      setNotice(`Saved “${name}” to Draft Portfolios`);
      return true;
    } catch (e) {
      setNotice(`Could not save draft: ${errorMessage(e)}`);
      return false;
    }
  };

  const openDraftInBuilder = async (d: Draft) => {
    if (
      legs.length > 0 &&
      !(await confirmDialog({
        title: 'Replace your current strategy?',
        message: `“${d.name}” will be loaded into the builder in its place.`,
        confirmLabel: 'Yes, Replace',
      }))
    )
      return;
    setSymbol(d.symbol, symbols.find((s) => s.symbol === d.symbol)?.lotSize ?? d.legs[0]?.lotSize ?? lotSize);
    replaceLegs(d.legs);
    navigate({ page: 'builder' });
  };

  const importLocalSaved = async () => {
    try {
      for (const s of saved) {
        await api.createDraft({ name: s.name, symbol: s.symbol, legs: s.legs.map(legToDraftLeg), entrySpot: null });
        deleteStrategy(s.id);
      }
      setNotice('Imported into Draft Portfolios');
    } catch (e) {
      setNotice(`Import stopped: ${errorMessage(e)}`);
    }
    draftsState.reload();
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

  const monitored = route.page === 'drafts' && route.draftId ? (drafts?.find((d) => d.id === route.draftId) ?? null) : null;

  return (
    <>
      <AppHeader route={route} onNavigate={navigate} broker={broker} onLogout={onLogout} showLogout={showLogout} />
      <AlertMonitor />

      <main
        className={`safe-x w-full pt-4 md:ml-[var(--sidebar-w)] md:w-auto md:transition-[margin] md:duration-200 ${route.page === 'chart' ? 'md:py-3' : 'md:py-5'}`}
        style={{ paddingBottom: `calc(var(--tabbar-h) + ${route.page === 'chart' ? '0.75rem' : '1.25rem'})` }}
      >
        {marketPage && route.page !== 'builder' && (
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
        )}

        {notice && (
          <div
            className="fixed left-1/2 z-50 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-md bg-[var(--accent)] px-3 py-2 text-center text-xs text-[var(--accent-text)] shadow-lg pointer-coarse:text-sm"
            style={{ bottom: 'calc(var(--tabbar-h) + 1rem)' }}
            role="status"
          >
            {notice}
          </div>
        )}

        {route.page === 'report' && (
          <ErrorBoundary label="the daily report">
            <DailyReport symbol={symbol} brokerConnected={brokerConnected} />
          </ErrorBoundary>
        )}

        {route.page === 'chart' && (
          <ErrorBoundary label="the chart">
            <Suspense fallback={<Card className="px-4 py-10 text-center text-sm text-[var(--text-muted)]">Loading chart…</Card>}>
              <ChartPage
                symbol={symbol}
                symbolInfo={symbols}
                brokerConnected={brokerConnected}
                onOpenBuilder={async (next) => {
                  if (await changeSymbol(next)) navigate({ page: 'builder' });
                }}
              />
            </Suspense>
          </ErrorBoundary>
        )}

        {route.page === 'oi' && (
          <ErrorBoundary label="open interest">
            <OpenInterestPage symbol={symbol} spot={spotState.data} brokerConnected={brokerConnected} />
          </ErrorBoundary>
        )}

        {route.page === 'portfolio' && (
          <ErrorBoundary label="the portfolio">
            <PortfolioPage brokerConnected={brokerConnected} symbols={symbols} />
          </ErrorBoundary>
        )}

        {route.page === 'drafts' &&
          (route.draftId ? (
            <ErrorBoundary label="the draft">
              {monitored ? (
                <DraftMonitor
                  key={monitored.id}
                  draft={monitored}
                  brokerConnected={brokerConnected}
                  onBack={() => navigate({ page: 'drafts' })}
                  onChanged={() => draftsState.reload()}
                  onDeleted={() => {
                    draftsState.reload();
                    navigate({ page: 'drafts' });
                  }}
                  onOpenInBuilder={openDraftInBuilder}
                />
              ) : drafts ? (
                <Card className="px-4 py-10 text-center text-sm text-[var(--text-muted)]">
                  This draft no longer exists.{' '}
                  <button type="button" className="text-[var(--series-blue)] hover:underline" onClick={() => navigate({ page: 'drafts' })}>
                    Back to drafts
                  </button>
                </Card>
              ) : (
                <Card className="px-4 py-10 text-center text-sm text-[var(--text-muted)]">Loading draft…</Card>
              )}
            </ErrorBoundary>
          ) : (
            <ErrorBoundary label="draft portfolios">
              <DraftsPage
                drafts={drafts}
                loading={draftsState.loading}
                error={draftsState.error}
                brokerConnected={brokerConnected}
                localSavedCount={saved.length}
                onImportLocal={() => void importLocalSaved()}
                onOpen={(id) => navigate({ page: 'drafts', draftId: id })}
                onNew={() => navigate({ page: 'builder' })}
              />
            </ErrorBoundary>
          ))}

        {route.page === 'chain' && (
          <section className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
              <span>Tap B / S on any strike to add it to your strategy.</span>
              {legs.length > 0 && (
                <Button onClick={() => navigate({ page: 'builder' })}>
                  {legs.length} leg{legs.length > 1 ? 's' : ''} in strategy — open builder
                  <ArrowRight size={16} aria-hidden="true" />
                </Button>
              )}
            </div>
            <ErrorBoundary label="the option chain">
              <OptionChainTable {...chainProps} maxHeight="min(720px, calc(100dvh - var(--tabbar-h) - 9rem))" detailed />
            </ErrorBoundary>
          </section>
        )}

        {route.page === 'builder' && builderMarket === 'US' && (
          <UsBuilder marketSwitch={<MarketSwitch value="US" onChange={setBuilderMarket} />} onNotice={setNotice} />
        )}

        {indiaBuilder && (
          <BuilderPage
            market={INDIA_VIEW}
            marketSwitch={<MarketSwitch value="IN" onChange={setBuilderMarket} />}
            picker={<NseSymbolSelect symbols={symbols} symbol={symbol} onChange={(s) => void changeSymbol(s)} />}
            symbol={symbol}
            spotQuote={spotState.data}
            spotError={spotState.error}
            spot={spot}
            chain={chain}
            chainLoading={chainState.loading}
            chainNotice={brokerConnected && chainState.error && !chain ? <Notice tone="critical">Option chain: {chainState.error}</Notice> : null}
            quoteSource={chain?.rows?.length ? 'Live Upstox quotes' : 'No live chain — premiums are manual'}
            expiry={activeExpiry}
            onExpiryChange={setExpiry}
            updatedAt={chainState.updatedAt ?? spotState.updatedAt}
            legs={legs}
            lotSize={effectiveLot}
            metrics={metrics}
            fallbackIv={fallbackIv}
            marks={marks}
            brokerMargin={brokerMargin}
            marginLoading={marginLoading}
            draftCount={drafts?.filter((d) => d.closedAt === null).length ?? 0}
            onTemplate={applyTemplate}
            onAddFromChain={addFromChain}
            onAddLeg={addLeg}
            onUpdateLeg={updateLeg}
            onRemoveLeg={removeLeg}
            onRemoveLegs={removeLegs}
            onClear={confirmClear}
            onSaveDraft={saveDraft}
            onShare={() => void share()}
            onViewDrafts={() => navigate({ page: 'drafts' })}
            onOpenChainPage={() => navigate({ page: 'chain' })}
          />
        )}

        <footer
          className={`mt-8 border-t border-[var(--border)] pt-3 text-[10px] leading-relaxed text-[var(--text-muted)] ${route.page === 'chart' ? 'hidden' : ''}`}
        >
          AddStock is an analysis tool, not investment advice. Prices, margins and Greeks are estimates — verify with your broker before trading.
        </footer>
      </main>
    </>
  );
}
