import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { errorMessage } from '../../api/client';
import type { PortfolioTxn, SymbolInfo } from '../../api/types';
import { Button, Card, CardHeader, Notice, Skeleton, selectClass } from '../../components/ui';
import { daysToExpiry, formatExpiry } from '../../domain/dates';
import {
  benchmarkSeries,
  betaAlpha,
  buildBook,
  FX_KEY,
  findOversell,
  futurePrice,
  holdingValue,
  istDate,
  monthlyReturns,
  portfolioSeries,
  rebase,
  replaceTxn,
  seriesStats,
  tradingCalendar,
  valueBook,
  type PricePoints,
} from '../../domain/portfolio';
import { confirmDialog, promptDialog } from '../../lib/dialog';
import { inr, num, signedInr } from '../../lib/format';
import { displaySymbol, isUs } from '../../lib/markets';
import { PerformanceChart, type ChartLine } from './PerformanceChart';
import { TransactionDialog, type TxnDraft } from './TransactionDialog';
import { useFuturesQuotes, useLiveQuotes, usePortfolios, usePriceHistory } from './usePortfolios';

// ------------------------------------------------------------ settings

interface Benchmark {
  key: string;
  label: string;
  color: string;
  /** Priced in dollars — converted to rupees unless the user picks $. */
  usd: boolean;
}

const BENCHMARKS: Benchmark[] = [
  { key: 'NIFTY', label: 'NIFTY 50', color: '#EF9F27', usd: false },
  { key: 'QQQ', label: 'Nasdaq-100 (QQQ)', color: 'var(--series-violet)', usd: true },
  { key: 'SP500', label: 'S&P 500', color: '#1D9E75', usd: true },
  { key: 'BANKNIFTY', label: 'Bank Nifty', color: '#D4537E', usd: false },
  { key: 'SENSEX', label: 'Sensex', color: '#D85A30', usd: false },
  { key: 'DOW', label: 'Dow Jones', color: '#888780', usd: true },
  { key: 'GOLD', label: 'Gold', color: '#BA7517', usd: true },
];
const DEFAULT_BENCHMARKS = ['NIFTY', 'QQQ', 'SP500'];
const PORTFOLIO_COLOR = 'var(--series-blue)';
const ALLOC_COLORS = ['#378ADD', '#1D9E75', '#7F77DD', '#EF9F27', '#D4537E', '#D85A30', '#5DCAA5', '#888780'];

const PERIODS = ['1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', 'All'] as const;
type Period = (typeof PERIODS)[number];

const SETTINGS_KEY = 'option-builder-portfolio-view';
interface ViewSettings {
  benchmarks: string[];
  currency: 'INR' | 'USD';
  period: Period;
}

function loadSettings(): ViewSettings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<ViewSettings> | null;
    return {
      benchmarks: Array.isArray(s?.benchmarks) ? s.benchmarks.filter((k) => BENCHMARKS.some((b) => b.key === k)) : DEFAULT_BENCHMARKS,
      currency: s?.currency === 'USD' ? 'USD' : 'INR',
      period: PERIODS.includes(s?.period as Period) ? (s!.period as Period) : '1Y',
    };
  } catch {
    return { benchmarks: DEFAULT_BENCHMARKS, currency: 'INR', period: '1Y' };
  }
}

/** First calendar date of a period ending on `last`. */
function periodStart(period: Period, last: string, first: string): string {
  if (period === 'All') return first;
  if (period === 'YTD') return `${last.slice(0, 4)}-01-01`;
  const d = new Date(`${last}T00:00:00Z`);
  const months = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '3Y': 36, '5Y': 60 }[period];
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------- helpers

const pnlColor = (v: number) => (v > 0 ? 'var(--good-text)' : v < 0 ? 'var(--critical)' : 'var(--text-secondary)');
const signedPctOrDash = (v: number | null, d = 2) => (v === null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}%`);
const th = 'px-2 py-2 text-right text-[11px] font-normal text-[var(--text-muted)]';
/** A price in the symbol's own currency. */
const px = (symbol: string, v: number) => (isUs(symbol) ? `$${num(v)}` : num(v));

function MarketTag({ symbol }: { symbol: string }) {
  return isUs(symbol) ? (
    <span className="rounded border border-[var(--border)] px-1 text-[9px] font-semibold tracking-wide text-[var(--text-muted)]" title="US stock — priced in dollars, valued in rupees">
      US
    </span>
  ) : null;
}
const td = 'px-2 py-2 text-right tabular';

function SummaryTile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <Card className="px-4 py-3">
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
      <div className="truncate text-xl font-semibold tabular" style={{ color }}>
        {value}
      </div>
      {sub && (
        <div className="text-[11px] tabular" style={{ color: color ?? 'var(--text-muted)' }}>
          {sub}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- page

export function PortfolioPage({ brokerConnected, symbols }: { brokerConnected: boolean; symbols: SymbolInfo[] }) {
  const store = usePortfolios();
  const portfolio = store.selected;
  const txns = useMemo(() => portfolio?.transactions ?? [], [portfolio]);
  const book = useMemo(() => buildBook(txns), [txns]);

  const [settings, setSettings] = useState(loadSettings);
  const updateSettings = (patch: Partial<ViewSettings>) =>
    setSettings((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });

  const [dialog, setDialog] = useState<TxnDraft | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAllTxns, setShowAllTxns] = useState(false);
  const [allocBy, setAllocBy] = useState<'stock' | 'market'>('stock');
  const [actionError, setActionError] = useState<string | null>(null);

  // ----- live prices
  const quoteSymbols = useMemo(() => {
    const held = book.stocks.filter((s) => s.qty > 0);
    return [
      ...held.map((s) => s.symbol),
      ...book.futures.filter((f) => f.lots !== 0).map((f) => f.symbol),
      ...(held.some((s) => s.currency === 'USD') ? [FX_KEY] : []),
    ];
  }, [book]);
  const quotes = useLiveQuotes(quoteSymbols);
  const futKeys = useMemo(() => book.futures.filter((f) => f.lots !== 0 && f.instrumentKey).map((f) => f.instrumentKey!), [book]);
  const futQuotes = useFuturesQuotes(futKeys, brokerConnected);
  const live = useMemo(() => quotes.data ?? {}, [quotes.data]);
  const valuation = useMemo(() => valueBook(book, live, futQuotes.data ?? {}), [book, live, futQuotes.data]);

  // ----- history and performance
  const firstDate = useMemo(() => txns.reduce<string | null>((m, t) => (m === null || t.date < m ? t.date : m), null), [txns]);
  const range = firstDate && Date.parse(firstDate) < Date.now() - 5 * 365 * 864e5 ? 'max' : '5y';
  // Wait for the portfolio, so history isn't fetched once without its holdings and again with them.
  const loaded = store.portfolios !== null;
  const historySymbols = useMemo(
    () => (loaded ? [...new Set([...txns.map((t) => t.symbol), 'NIFTY', 'USDINR', ...settings.benchmarks])] : []),
    [loaded, txns, settings.benchmarks],
  );
  const history = usePriceHistory(historySymbols, range);

  const perf = useMemo(() => {
    const h = history.data;
    if (!h) return null;
    const pts = (k: string): PricePoints | undefined => h[k]?.points;
    // Indian trading days drive the axis; US closes are carried onto them.
    const calendar = tradingCalendar(pts('NIFTY') ?? pts(historySymbols[0]));
    if (calendar.length === 0) return null;
    const last = calendar[calendar.length - 1];

    const portfolioFull = portfolioSeries(txns, Object.fromEntries(Object.entries(h).map(([k, v]) => [k, v.points])), calendar);
    const start = periodStart(settings.period, last, portfolioFull[0]?.date ?? calendar[0]);
    const usdinr = settings.currency === 'INR' ? pts('USDINR') : undefined;

    const lines: (ChartLine & { stats: ReturnType<typeof seriesStats> })[] = [];
    const port = rebase(portfolioFull, start);
    if (port.length > 1) lines.push({ key: 'portfolio', label: portfolio?.name ?? 'My portfolio', color: PORTFOLIO_COLOR, points: port, primary: true, stats: seriesStats(port) });
    // Benchmarks start where the portfolio does, so "All" compares like with like.
    const benchStart = port[0]?.date ?? start;
    for (const b of BENCHMARKS.filter((x) => settings.benchmarks.includes(x.key))) {
      const p = pts(b.key);
      if (!p) continue;
      const s = rebase(benchmarkSeries(p, calendar, b.usd ? usdinr : undefined), benchStart);
      if (s.length > 1) lines.push({ key: b.key, label: b.label + (b.usd ? (settings.currency === 'INR' ? ' (₹)' : ' ($)') : ''), color: b.color, points: s, stats: seriesStats(s) });
    }

    const nifty = pts('NIFTY') ? rebase(benchmarkSeries(pts('NIFTY')!, calendar), benchStart) : [];
    const months = port.length > 1 ? monthlyReturns(port) : [];
    const best = months.reduce<{ month: string; ret: number } | null>((m, x) => (m === null || x.ret > m.ret ? x : m), null);
    const worst = months.reduce<{ month: string; ret: number } | null>((m, x) => (m === null || x.ret < m.ret ? x : m), null);
    return {
      lines,
      portStats: lines.find((l) => l.key === 'portfolio')?.stats ?? null,
      ba: port.length > 1 && nifty.length > 1 ? betaAlpha(port, nifty) : null,
      best: months.length > 1 ? best : null,
      worst: months.length > 1 ? worst : null,
      missing: historySymbols.filter((s) => !h[s]),
      from: benchStart,
    };
  }, [history.data, txns, settings, portfolio?.name, historySymbols]);

  // ----- actions
  const run = async (fn: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(errorMessage(e));
    }
  };

  const newPortfolio = () =>
    run(async () => {
      const name = await promptDialog({ title: 'Name your portfolio', placeholder: 'Long-term', confirmLabel: 'Create' });
      if (name?.trim()) await store.create(name.trim());
    });

  const renamePortfolio = () =>
    run(async () => {
      if (!portfolio) return;
      const name = await promptDialog({ title: 'Rename portfolio', defaultValue: portfolio.name, confirmLabel: 'Rename' });
      if (name?.trim() && name.trim() !== portfolio.name) await store.rename(portfolio.id, name.trim());
    });

  const deletePortfolio = () =>
    run(async () => {
      if (!portfolio) return;
      const ok = await confirmDialog({
        title: `Delete “${portfolio.name}”?`,
        message: `This removes its ${txns.length} transaction${txns.length === 1 ? '' : 's'} for good.`,
        confirmLabel: 'Delete portfolio',
      });
      if (ok) await store.remove(portfolio.id);
    });

  const deleteTxn = (t: PortfolioTxn) =>
    run(async () => {
      if (!portfolio) return;
      const ok = await confirmDialog({
        title: 'Delete this transaction?',
        message: `${t.side === 'BUY' ? 'Buy' : 'Sell'} ${t.qty} ${t.kind === 'FUT' ? `lot${t.qty === 1 ? '' : 's'} ${t.symbol} ${formatExpiry(t.expiry ?? '')} FUT` : displaySymbol(t.symbol)} @ ${px(t.symbol, t.price)} on ${t.date}`,
        confirmLabel: 'Delete',
      });
      if (!ok) return;
      const rest = txns.filter((x) => x.id !== t.id);
      // Removing a buy can strand a later sell; refuse rather than corrupt the book.
      const problem = findOversell(rest);
      if (problem) throw new Error(`Can’t delete that buy: ${problem.charAt(0).toLowerCase()}${problem.slice(1)} Delete or edit that sell first.`);
      await store.saveTxns(portfolio.id, rest);
    });

  const editTxn = (t: PortfolioTxn) => setDialog({ kind: t.kind, side: t.side, edit: t });
  const livePrice = (s: string) => live[s]?.price ?? null;

  // ----- render
  if (store.portfolios === null) {
    return store.error ? (
      <Notice tone="critical" action={<Button onClick={store.reload}>Retry</Button>}>
        Portfolios: {store.error}
      </Notice>
    ) : (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (!portfolio) {
    return (
      <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <div className="text-base font-semibold">Track your investments</div>
        <div className="max-w-md text-sm text-[var(--text-muted)]">
          Add your stock and futures trades to see total and daily profit and loss, and how your portfolio performs against NIFTY 50, the Nasdaq-100 and the S&amp;P 500.
        </div>
        <Button variant="primary" onClick={newPortfolio}>
          <Plus size={14} aria-hidden="true" /> Create portfolio
        </Button>
        {actionError && <span className="text-xs text-[var(--critical)]">{actionError}</span>}
      </Card>
    );
  }

  const openStocks = book.stocks.filter((s) => s.qty > 0);
  const closedStocks = book.stocks.filter((s) => s.qty === 0);
  const openFutures = book.futures.filter((f) => f.lots !== 0);
  const closedFutures = book.futures.filter((f) => f.lots === 0);
  const today = istDate(Math.floor(Date.now() / 1000));
  const values = new Map(openStocks.map((h) => [h.symbol, holdingValue(h, live, today)]));
  const byStock = openStocks.map((h) => ({ symbol: displaySymbol(h.symbol), value: values.get(h.symbol)!.value }));
  const byMarket = [
    { symbol: 'India', value: openStocks.filter((h) => h.currency === 'INR').reduce((t, h) => t + values.get(h.symbol)!.value, 0) },
    { symbol: 'US', value: openStocks.filter((h) => h.currency === 'USD').reduce((t, h) => t + values.get(h.symbol)!.value, 0) },
  ].filter((a) => a.value > 0);
  const hasUs = openStocks.some((h) => h.currency === 'USD');
  const allocation = (allocBy === 'market' && hasUs ? byMarket : byStock).sort((a, b) => b.value - a.value);
  const allocTotal = allocation.reduce((s, a) => s + a.value, 0);
  const allocShown = allocation.length > 7 ? [...allocation.slice(0, 6), { symbol: 'Other', value: allocation.slice(6).reduce((s, a) => s + a.value, 0) }] : allocation;
  const sortedTxns = [...txns].sort((a, b) => b.date.localeCompare(a.date));
  const v = valuation;

  return (
    <div className="flex flex-col gap-4">
      {/* ---------- toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="portfolio-select">
          Portfolio
        </label>
        <select id="portfolio-select" className={`${selectClass} font-medium`} value={portfolio.id} onChange={(e) => store.select(e.target.value)}>
          {store.portfolios.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Button variant="ghost" onClick={renamePortfolio} title="Rename portfolio" aria-label="Rename portfolio">
          <Pencil size={14} />
        </Button>
        <Button variant="ghost" onClick={deletePortfolio} title="Delete portfolio" aria-label="Delete portfolio">
          <Trash2 size={14} />
        </Button>
        <Button onClick={newPortfolio}>
          <Plus size={14} aria-hidden="true" /> New portfolio
        </Button>
        <Button variant="primary" className="ml-auto min-h-8" onClick={() => setDialog({ kind: 'STOCK', side: 'BUY' })}>
          <Plus size={14} aria-hidden="true" /> Add transaction
        </Button>
      </div>

      {actionError && <Notice tone="critical">{actionError}</Notice>}
      {quotes.error && <Notice>Live prices: {quotes.error}</Notice>}
      {v.unpriced.length > 0 && !quotes.loading && <Notice tone="info">No live price yet for {v.unpriced.join(', ')} — valued at cost until one arrives.</Notice>}

      {txns.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <div className="text-base font-semibold">Add your first transaction</div>
          <div className="max-w-md text-sm text-[var(--text-muted)]">Record a stock buy or a futures trade with its date and price. Holdings, P&amp;L and performance are worked out from your transactions.</div>
          <Button variant="primary" onClick={() => setDialog({ kind: 'STOCK', side: 'BUY' })}>
            <Plus size={14} aria-hidden="true" /> Add transaction
          </Button>
        </Card>
      ) : (
        <>
          {/* ---------- summary */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryTile label="Current value" value={inr(v.currentValue)} sub={openFutures.length ? `+ ${openFutures.length} open future${openFutures.length === 1 ? '' : 's'}` : undefined} />
            <SummaryTile label="Invested" value={inr(v.invested)} sub={v.realized !== 0 ? `Realised ${signedInr(v.realized)}` : undefined} />
            <SummaryTile label="Total P&L" value={signedInr(v.totalPnl)} sub={`${signedPctOrDash(v.totalPnlPct)}${Math.abs(v.currencyGain) >= 1 ? ` · ${signedInr(v.currencyGain)} from USD/INR` : ''}`} color={pnlColor(v.totalPnl)} />
            <SummaryTile label="Today’s P&L" value={signedInr(v.dayPnl)} sub={signedPctOrDash(v.dayPnlPct)} color={pnlColor(v.dayPnl)} />
          </div>

          {/* ---------- performance */}
          <Card>
            <CardHeader title="Performance vs benchmarks">
              <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Period">
                {PERIODS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={settings.period === p}
                    onClick={() => updateSettings({ period: p })}
                    className={`rounded px-2 py-0.5 text-[11px] font-medium ${settings.period === p ? 'bg-[var(--surface-sunken)] text-[var(--text-primary)] ring-1 ring-[var(--border-strong)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </CardHeader>
            <div className="p-3">
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <span className="flex items-center gap-1.5 rounded border border-[var(--border)] px-2 py-1 text-[11px]">
                  <span className="inline-block h-0.5 w-3" style={{ background: PORTFOLIO_COLOR }} />
                  {portfolio.name}
                </span>
                {BENCHMARKS.map((b) => {
                  const on = settings.benchmarks.includes(b.key);
                  return (
                    <button
                      key={b.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => updateSettings({ benchmarks: on ? settings.benchmarks.filter((k) => k !== b.key) : [...settings.benchmarks, b.key] })}
                      className={`flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] ${on ? 'border-[var(--border-strong)] text-[var(--text-primary)]' : 'border-dashed border-[var(--border)] text-[var(--text-muted)]'}`}
                    >
                      <span className="inline-block h-0.5 w-3" style={{ background: on ? b.color : 'var(--text-muted)' }} />
                      {b.label}
                    </button>
                  );
                })}
                <span className="ml-auto flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                  US in
                  {(['INR', 'USD'] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={settings.currency === c}
                      onClick={() => updateSettings({ currency: c })}
                      title={c === 'INR' ? 'Includes USD/INR moves — what an Indian investor earns' : 'The index in its own currency'}
                      className={`rounded px-1.5 py-0.5 font-medium ${settings.currency === c ? 'bg-[var(--surface-sunken)] text-[var(--text-primary)]' : 'hover:text-[var(--text-primary)]'}`}
                    >
                      {c === 'INR' ? '₹' : '$'}
                    </button>
                  ))}
                </span>
              </div>

              {history.error && !history.data ? (
                <Notice tone="critical" action={<Button onClick={history.reload}>Retry</Button>}>
                  Price history: {history.error}
                </Notice>
              ) : !perf ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <>
                  <PerformanceChart lines={perf.lines} />
                  {perf.missing.length > 0 && (
                    <div className="mt-1 text-[11px] text-[var(--warning)]">No price history for {perf.missing.join(', ')} — left out of the chart.</div>
                  )}
                </>
              )}
            </div>

            {perf && perf.lines.length > 0 && (
              <div className="overflow-x-auto border-t border-[var(--border)]">
                <table className="w-full min-w-[560px] border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className={`${th} text-left`}>Since {formatExpiry(perf.from)}</th>
                      <th className={th}>Return</th>
                      <th className={th}>vs portfolio</th>
                      <th className={th} title="Annualised standard deviation of daily returns">Volatility</th>
                      <th className={th} title="Largest fall from a peak">Max drawdown</th>
                      <th className={th} title="Return above a 6.5% risk-free rate, per unit of volatility">Sharpe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perf.lines.map((l) => {
                      const diff = perf.portStats && l.stats && !l.primary ? perf.portStats.totalReturn - l.stats.totalReturn : null;
                      return (
                        <tr key={l.key} className="border-t border-[var(--gridline)]">
                          <td className="px-2 py-2 text-left">
                            <span style={{ color: l.color }}>●</span> <span className={l.primary ? 'font-semibold' : ''}>{l.label}</span>
                          </td>
                          <td className={td} style={{ color: pnlColor(l.stats?.totalReturn ?? 0) }}>
                            {signedPctOrDash(l.stats?.totalReturn ?? null)}
                          </td>
                          <td className={td} style={{ color: diff === null ? undefined : pnlColor(diff) }}>
                            {diff === null ? '—' : `${diff >= 0 ? 'ahead' : 'behind'} ${Math.abs(diff).toFixed(1)} pts`}
                          </td>
                          <td className={td}>{l.stats ? `${l.stats.volatility.toFixed(1)}%` : '—'}</td>
                          <td className={td} style={{ color: 'var(--critical)' }}>
                            {l.stats ? signedPctOrDash(l.stats.maxDrawdown, 1) : '—'}
                          </td>
                          <td className={td}>{l.stats?.sharpe == null ? '—' : l.stats.sharpe.toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="px-3 py-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
                  Portfolio return is time-weighted, so adding or withdrawing money doesn’t distort it. Daily closes from Yahoo Finance; futures are approximated with their underlying’s closes.
                </p>
              </div>
            )}
          </Card>

          {perf && (perf.ba || perf.best) && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <SummaryTile label="Beta vs NIFTY 50" value={perf.ba ? perf.ba.beta.toFixed(2) : '—'} sub={perf.ba ? (perf.ba.beta < 1 ? 'Less volatile than the index' : 'More volatile than the index') : 'Needs 20+ days of history'} />
              <SummaryTile label="Alpha vs NIFTY 50" value={perf.ba ? signedPctOrDash(perf.ba.alpha, 1) : '—'} sub="Annualised, risk-adjusted" color={perf.ba ? pnlColor(perf.ba.alpha) : undefined} />
              <SummaryTile label="Best month" value={perf.best ? signedPctOrDash(perf.best.ret, 1) : '—'} sub={perf.best ? formatExpiry(`${perf.best.month}-01`).replace(/^\d+ /, '') : undefined} color={perf.best ? pnlColor(perf.best.ret) : undefined} />
              <SummaryTile label="Worst month" value={perf.worst ? signedPctOrDash(perf.worst.ret, 1) : '—'} sub={perf.worst ? formatExpiry(`${perf.worst.month}-01`).replace(/^\d+ /, '') : undefined} color={perf.worst ? pnlColor(perf.worst.ret) : undefined} />
            </div>
          )}

          {/* ---------- allocation */}
          {allocShown.length > 0 && allocTotal > 0 && (
            <Card className="p-3">
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">Allocation</h2>
                {hasUs ? (
                  <span className="flex gap-1 text-[11px]" role="radiogroup" aria-label="Group allocation by">
                    {(['stock', 'market'] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        role="radio"
                        aria-checked={allocBy === k}
                        onClick={() => setAllocBy(k)}
                        className={`rounded px-1.5 py-0.5 ${allocBy === k ? 'bg-[var(--surface-sunken)] font-medium text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                      >
                        {k === 'stock' ? 'By stock' : 'India vs US'}
                      </button>
                    ))}
                  </span>
                ) : (
                  <span className="text-[11px] text-[var(--text-muted)]">Stocks by current value</span>
                )}
              </div>
              <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={allocShown.map((a) => `${a.symbol} ${((a.value / allocTotal) * 100).toFixed(0)}%`).join(', ')}>
                {allocShown.map((a, i) => (
                  <div key={a.symbol} style={{ width: `${(a.value / allocTotal) * 100}%`, background: ALLOC_COLORS[i % ALLOC_COLORS.length] }} />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-secondary)]">
                {allocShown.map((a, i) => (
                  <span key={a.symbol} className="tabular">
                    <span style={{ color: ALLOC_COLORS[i % ALLOC_COLORS.length] }}>●</span> {a.symbol} {((a.value / allocTotal) * 100).toFixed(1)}%
                  </span>
                ))}
              </div>
            </Card>
          )}

          {/* ---------- stocks */}
          {(openStocks.length > 0 || closedStocks.length > 0) && (
            <Card>
              <CardHeader title={`Stocks · ${openStocks.length} holding${openStocks.length === 1 ? '' : 's'}`}>
                <Button onClick={() => setDialog({ kind: 'STOCK', side: 'BUY' })}>
                  <Plus size={14} aria-hidden="true" /> Buy
                </Button>
              </CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className={`${th} text-left`}>Stock</th>
                      <th className={th}>Qty</th>
                      <th className={th}>Avg cost</th>
                      <th className={th}>LTP</th>
                      <th className={th}>Day</th>
                      <th className={th}>Value</th>
                      <th className={th}>P&amp;L</th>
                      <th className={th}>Weight</th>
                      <th className={th}>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {openStocks.map((h) => {
                      const q = live[h.symbol];
                      const hv = values.get(h.symbol)!;
                      const value = hv.value;
                      const pnl = hv.pnl;
                      const day = hv.dayPct;
                      const open = expanded.has(h.symbol);
                      return (
                        <Fragment key={h.symbol}>
                          <tr className="cursor-pointer border-t border-[var(--gridline)] hover:bg-[var(--surface-sunken)]" onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(h.symbol)) n.delete(h.symbol); else n.add(h.symbol); return n; })}>
                            <td className="px-2 py-2 text-left">
                              <span className="inline-flex items-center gap-1 font-semibold">
                                {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                                {displaySymbol(h.symbol)}
                                <MarketTag symbol={h.symbol} />
                              </span>
                              <div className="pl-5 text-[11px] text-[var(--text-muted)]">{symbols.find((s) => s.symbol === h.symbol)?.label ?? `since ${formatExpiry(h.firstDate)}`}</div>
                            </td>
                            <td className={td}>{h.qty.toLocaleString('en-IN')}</td>
                            <td className={td} title={h.currency === 'USD' ? `₹${num(h.avgCostInr)} a share at the rates you paid` : undefined}>
                              {px(h.symbol, h.avgCost)}
                            </td>
                            <td className={td}>{q ? px(h.symbol, q.price) : '—'}</td>
                            <td className={td} style={{ color: day === null ? undefined : pnlColor(day) }}>
                              {signedPctOrDash(day)}
                            </td>
                            <td className={td}>{inr(value)}</td>
                            <td className={td} style={{ color: pnlColor(pnl) }}>
                              {hv.priced ? signedInr(pnl) : '—'}
                              <div className="text-[11px]">{hv.priced ? signedPctOrDash(h.invested > 0 ? (pnl / h.invested) * 100 : null) : ''}</div>
                              {h.currency === 'USD' && hv.priced && (
                                <div className="whitespace-nowrap text-[10px] text-[var(--text-muted)]" title="Stock’s own move at today’s rate, and the effect of USD/INR since you bought">
                                  stock {signedInr(hv.stockGain)} · FX {signedInr(hv.fxGain)}
                                </div>
                              )}
                            </td>
                            <td className={td}>{allocTotal > 0 ? `${((value / allocTotal) * 100).toFixed(1)}%` : '—'}</td>
                            <td className="px-2 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                              <span className="inline-flex gap-1">
                                <Button size="xs" onClick={() => setDialog({ kind: 'STOCK', side: 'BUY', symbol: h.symbol })}>
                                  Buy
                                </Button>
                                <Button size="xs" variant="danger" onClick={() => setDialog({ kind: 'STOCK', side: 'SELL', symbol: h.symbol, qty: h.qty })}>
                                  Sell
                                </Button>
                              </span>
                            </td>
                          </tr>
                          {open && (
                            <tr className="bg-[var(--surface-sunken)]">
                              <td colSpan={9} className="px-4 py-2">
                                <TxnList txns={h.txns} onDelete={deleteTxn} onEdit={editTxn} />
                                {h.realized !== 0 && (
                                  <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                                    Realised on sells: <span style={{ color: pnlColor(h.realized) }}>{signedInr(h.realized)}</span>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {closedStocks.length > 0 && (
                <div className="border-t border-[var(--border)] px-3 py-2 text-[11px] text-[var(--text-muted)]">
                  Fully sold: {closedStocks.map((s) => (
                    <span key={s.symbol} className="mr-3 tabular">
                      {displaySymbol(s.symbol)} <span style={{ color: pnlColor(s.realized) }}>{signedInr(s.realized)}</span>
                    </span>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* ---------- futures */}
          {(openFutures.length > 0 || closedFutures.length > 0) && (
            <Card>
              <CardHeader title={`Futures · ${openFutures.length} open`}>
                <Button onClick={() => setDialog({ kind: 'FUT', side: 'BUY' })}>
                  <Plus size={14} aria-hidden="true" /> Trade future
                </Button>
              </CardHeader>
              {openFutures.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] border-collapse text-sm">
                    <thead>
                      <tr>
                        <th className={`${th} text-left`}>Contract</th>
                        <th className={th}>Side</th>
                        <th className={th}>Lots</th>
                        <th className={th}>Avg entry</th>
                        <th className={th}>LTP</th>
                        <th className={th}>Expiry</th>
                        <th className={th}>MTM P&amp;L</th>
                        <th className={th}>
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {openFutures.map((f) => {
                        const own = f.instrumentKey ? futQuotes.data?.[f.instrumentKey] : undefined;
                        const price = futurePrice(f, futQuotes.data ?? {}, live);
                        const mtm = price === null ? null : f.lots * f.lotSize * (price - f.avgEntry);
                        const dte = daysToExpiry(f.expiry);
                        const expired = f.expiry < today;
                        const long = f.lots > 0;
                        return (
                          <tr key={f.key} className="border-t border-[var(--gridline)]">
                            <td className="px-2 py-2 text-left">
                              <span className="font-semibold">{f.symbol} FUT</span>
                              <div className="text-[11px] text-[var(--text-muted)]">lot {f.lotSize}</div>
                            </td>
                            <td className={td}>
                              <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ background: long ? 'var(--good-fill)' : 'var(--critical-fill)', color: long ? 'var(--good-text)' : 'var(--critical)' }}>
                                {long ? 'Long' : 'Short'}
                              </span>
                            </td>
                            <td className={td}>{Math.abs(f.lots)}</td>
                            <td className={td}>{num(f.avgEntry)}</td>
                            <td className={td} title={own ? 'Futures LTP from Upstox' : 'Underlying spot — connect Upstox for the future’s own price'}>
                              {price === null ? '—' : num(price)}
                              {!own && price !== null && <div className="text-[10px] text-[var(--text-muted)]">≈ spot</div>}
                            </td>
                            <td className={td}>
                              {formatExpiry(f.expiry)}
                              <div className="text-[11px]" style={{ color: expired ? 'var(--warning)' : 'var(--text-muted)' }}>
                                {expired ? 'Expired' : `${dte}d`}
                              </div>
                            </td>
                            <td className={td} style={{ color: mtm === null ? undefined : pnlColor(mtm) }}>
                              {mtm === null ? '—' : signedInr(mtm)}
                            </td>
                            <td className="px-2 py-2 text-right">
                              <Button size="xs" variant={expired ? 'primary' : 'default'} onClick={() => setDialog({ kind: 'FUT', side: long ? 'SELL' : 'BUY', symbol: f.symbol, expiry: f.expiry, qty: Math.abs(f.lots) })}>
                                {expired ? 'Record exit' : 'Exit'}
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {closedFutures.length > 0 && (
                <div className="border-t border-[var(--border)] px-3 py-2 text-[11px] text-[var(--text-muted)]">
                  Closed: {closedFutures.length} contract{closedFutures.length === 1 ? '' : 's'} · Realised{' '}
                  <span style={{ color: pnlColor(closedFutures.reduce((s, f) => s + f.realized, 0)) }}>{signedInr(closedFutures.reduce((s, f) => s + f.realized, 0))}</span>
                </div>
              )}
            </Card>
          )}

          {/* ---------- transactions */}
          <Card>
            <CardHeader title={`Transactions (${txns.length})`} />
            <div className="px-3 py-2">
              <TxnList txns={showAllTxns ? sortedTxns : sortedTxns.slice(0, 10)} onDelete={deleteTxn} onEdit={editTxn} />
              {sortedTxns.length > 10 && (
                <Button variant="ghost" className="mt-1" onClick={() => setShowAllTxns((s) => !s)}>
                  {showAllTxns ? 'Show fewer' : `Show all ${sortedTxns.length}`}
                </Button>
              )}
            </div>
          </Card>
        </>
      )}

      {dialog && (
        <TransactionDialog
          initial={dialog}
          existing={dialog.edit ? txns.filter((t) => t.id !== dialog.edit!.id) : txns}
          symbols={symbols}
          livePrice={livePrice}
          onClose={() => setDialog(null)}
          onSave={(t) => store.saveTxns(portfolio.id, dialog.edit ? replaceTxn(txns, t) : [...txns, t])}
        />
      )}
    </div>
  );
}

function TxnList({ txns, onDelete, onEdit }: { txns: PortfolioTxn[]; onDelete: (t: PortfolioTxn) => void; onEdit: (t: PortfolioTxn) => void }) {
  const sorted = [...txns].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <ul className="flex flex-col divide-y divide-[var(--gridline)] text-xs">
      {sorted.map((t) => {
        const units = t.kind === 'FUT' ? t.qty * (t.lotSize ?? 1) : t.qty;
        return (
          <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5 tabular">
            <span className="w-20 text-[var(--text-muted)]">{formatExpiry(t.date)}</span>
            <span className="w-10 font-semibold" style={{ color: t.side === 'BUY' ? 'var(--good-text)' : 'var(--critical)' }}>
              {t.side === 'BUY' ? 'Buy' : 'Sell'}
            </span>
            <span className="min-w-28 font-medium">
              {displaySymbol(t.symbol)}
              {t.kind === 'FUT' && ` FUT ${formatExpiry(t.expiry ?? '')}`}
            </span>
            <span className="text-[var(--text-secondary)]">
              {t.qty.toLocaleString('en-IN')} {t.kind === 'FUT' ? `lot${t.qty === 1 ? '' : 's'}` : 'sh'} @ {px(t.symbol, t.price)}
            </span>
            <span className="text-[var(--text-muted)]">
              {isUs(t.symbol) ? `$${num(units * t.price)} at ₹${num(t.fx ?? 0)} = ${inr(units * t.price * (t.fx ?? 0))}` : inr(units * t.price)}
              {t.fees > 0 && ` + ${isUs(t.symbol) ? `$${num(t.fees)}` : inr(t.fees)} fees`}
            </span>
            {t.note && <span className="truncate text-[var(--text-muted)] italic">{t.note}</span>}
            <button type="button" onClick={() => onEdit(t)} className="ml-auto rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)]" aria-label={`Edit ${t.side.toLowerCase()} ${t.symbol} on ${t.date}`} title="Edit transaction">
              <Pencil size={13} />
            </button>
            <button type="button" onClick={() => onDelete(t)} className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--critical-fill)] hover:text-[var(--critical)]" aria-label={`Delete ${t.side.toLowerCase()} ${t.symbol} on ${t.date}`} title="Delete transaction">
              <Trash2 size={13} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
