import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, FlaskConical, Pencil, Plus, Trash2 } from 'lucide-react';
import { errorMessage } from '../../api/client';
import type { PortfolioTxn, SymbolInfo } from '../../api/types';
import { Button, Notice, Skeleton } from '../../components/ui';
import { daysToExpiry, formatExpiry } from '../../domain/dates';
import {
  benchmarkSeries,
  buildBook,
  FX_KEY,
  findOversell,
  futurePrice,
  holdingValue,
  istDate,
  portfolioSeries,
  rebase,
  replaceTxn,
  tradingCalendar,
  valueBook,
  type HoldingValue,
  type PricePoints,
  type SeriesPoint,
  type StockHolding,
} from '../../domain/portfolio';
import { confirmDialog, promptDialog } from '../../lib/dialog';
import { inr, num, signedInr } from '../../lib/format';
import { displaySymbol, isUs } from '../../lib/markets';
import { nameOf } from '../../lib/symbolNames';
import { marketOpen, NSE_SESSION, US_SESSION } from '../../lib/nse';
import { buildDemoTransactions } from './demo';
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

/** Colours are the app's theme tokens, so both themes look right. */
const BENCHMARKS: Benchmark[] = [
  { key: 'NIFTY', label: 'NIFTY 50', color: 'var(--warning)', usd: false },
  { key: 'QQQ', label: 'Nasdaq-100 (QQQ)', color: 'var(--series-violet)', usd: true },
  { key: 'SP500', label: 'S&P 500', color: 'var(--good)', usd: true },
  { key: 'BANKNIFTY', label: 'Bank Nifty', color: '#D4537E', usd: false },
  { key: 'SENSEX', label: 'Sensex', color: '#D85A30', usd: false },
  { key: 'DOW', label: 'Dow Jones', color: 'var(--text-muted)', usd: true },
  { key: 'GOLD', label: 'Gold', color: '#BA7517', usd: true },
];
const DEFAULT_BENCHMARKS = ['NIFTY', 'QQQ', 'SP500'];
const PORTFOLIO_COLOR = 'var(--series-blue)';
/** Allocation slices, in order of size; the remainder ("Other") is always the neutral baseline colour. */
const ALLOC_COLORS = ['var(--series-blue)', 'var(--series-violet)', 'var(--good)', 'var(--warning)', '#D4537E', '#5DCAA5', '#D85A30'];
const OTHER_COLOR = 'var(--baseline)';

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

const totalReturn = (s: SeriesPoint[]) => (s.length > 1 ? (s[s.length - 1].value / s[0].value - 1) * 100 : null);

// ------------------------------------------------------------- helpers

const pnlColor = (v: number) => (v > 0 ? 'var(--good-text)' : v < 0 ? 'var(--critical)' : 'var(--text-secondary)');
const pct = (v: number | null, d = 2) => (v === null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}%`);
/** Share counts: whole for NSE, up to 6 decimals for fractional US shares. */
const fmtQty = (q: number) => q.toLocaleString('en-IN', { maximumFractionDigits: 6 });
/** A price in the symbol's own currency. */
const px = (symbol: string, v: number) => (isUs(symbol) ? `$${num(v)}` : num(v));
/** ₹17,35,877 → ₹17.36L, for chips and the donut's centre. */
const lakhs = (v: number) => (Math.abs(v) >= 1e7 ? `₹${(v / 1e7).toFixed(2)}Cr` : Math.abs(v) >= 1e5 ? `₹${(v / 1e5).toFixed(2)}L` : inr(v));

const thBase = 'whitespace-nowrap bg-[var(--surface-sunken)] px-3 py-2 text-[10px] font-normal uppercase tracking-[0.08em] text-[var(--text-muted)]';
const th = `${thBase} text-right`;
const td = 'whitespace-nowrap px-3 py-2.5 text-right tabular';

function Panel({ title, right, children, className = '' }: { title: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-[var(--border)] bg-[var(--surface-card)] ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 pb-2">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.1em]">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, sub, accent, valueColor }: { label: string; value: ReactNode; sub?: ReactNode; accent: string; valueColor?: string }) {
  return (
    <div className="min-w-0 rounded-r-lg border border-l-[3px] border-[var(--border)] bg-[var(--surface-card)] px-4 py-3" style={{ borderLeftColor: accent }}>
      <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">{label}</div>
      <div className="mt-0.5 truncate text-xl font-semibold tabular" style={{ color: valueColor }}>
        {value}
      </div>
      {sub && <div className="truncate text-[11px] text-[var(--text-muted)] tabular">{sub}</div>}
    </div>
  );
}

function Chip({ children, tone }: { children: ReactNode; tone?: 'good' | 'critical' }) {
  const style =
    tone === 'good'
      ? { background: 'var(--good-fill)', color: 'var(--good-text)', borderColor: 'transparent' }
      : tone === 'critical'
        ? { background: 'var(--critical-fill)', color: 'var(--critical)', borderColor: 'transparent' }
        : undefined;
  return (
    <span className="whitespace-nowrap rounded-full border border-[var(--border)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--text-secondary)] tabular" style={style}>
      {children}
    </span>
  );
}

/** Segmented buttons, e.g. All · India · US. */
function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex">
      {options.map((o, i) => {
        const on = o.v === value;
        return (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.v)}
            className={`-ml-px border px-2.5 py-1 text-[11px] font-semibold first:ml-0 ${i === 0 ? 'rounded-l' : ''} ${i === options.length - 1 ? 'rounded-r' : ''} ${
              on ? 'relative z-10 border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--surface-page)]' : 'border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Ring chart: slices drawn as dashed strokes on a circle of circumference 100. */
function Donut({ slices, center, caption }: { slices: { value: number; color: string }[]; center: string; caption: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  let offset = 25; // start at 12 o'clock
  return (
    <svg viewBox="0 0 42 42" className="h-32 w-32 shrink-0" role="img" aria-label={`${center}, ${caption}`}>
      <circle cx="21" cy="21" r="15.9155" fill="none" stroke="var(--gridline)" strokeWidth="5" />
      {slices.map((s, i) => {
        const len = (s.value / total) * 100;
        const el = <circle key={i} cx="21" cy="21" r="15.9155" fill="none" stroke={s.color} strokeWidth="5" strokeDasharray={`${len} ${100 - len}`} strokeDashoffset={offset} />;
        offset -= len;
        return el;
      })}
      <text x="21" y="21" textAnchor="middle" fontSize={center.length > 7 ? 4.2 : 5} fontWeight={700} fill="var(--text-primary)">
        {center}
      </text>
      <text x="21" y="26" textAnchor="middle" fontSize="2.6" fill="var(--text-muted)" letterSpacing="0.2">
        {caption}
      </text>
    </svg>
  );
}

function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

// ---------------------------------------------------------------- page

type AllocView = 'all' | 'IN' | 'US';

export function PortfolioPage({ brokerConnected, symbols }: { brokerConnected: boolean; symbols: SymbolInfo[] }) {
  const store = usePortfolios();
  const portfolio = store.selected;
  const txns = useMemo(() => portfolio?.transactions ?? [], [portfolio]);
  const book = useMemo(() => buildBook(txns), [txns]);
  const now = useNow(1000);

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
  const [showTxns, setShowTxns] = useState(false);
  const [showAllTxns, setShowAllTxns] = useState(false);
  const [allocView, setAllocView] = useState<AllocView>('all');
  const [actionError, setActionError] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);

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

    const lines: (ChartLine & { ret: number | null })[] = [];
    const port = rebase(portfolioFull, start);
    if (port.length > 1) lines.push({ key: 'portfolio', label: portfolio?.name ?? 'Portfolio', color: PORTFOLIO_COLOR, points: port, primary: true, ret: totalReturn(port) });
    // Benchmarks start where the portfolio does, so "All" compares like with like.
    const benchStart = port[0]?.date ?? start;
    for (const b of BENCHMARKS.filter((x) => settings.benchmarks.includes(x.key))) {
      const p = pts(b.key);
      if (!p) continue;
      const s = rebase(benchmarkSeries(p, calendar, b.usd ? usdinr : undefined), benchStart);
      if (s.length > 1) lines.push({ key: b.key, label: b.label, color: b.color, points: s, ret: totalReturn(s) });
    }
    return { lines, portRet: lines.find((l) => l.primary)?.ret ?? null, missing: historySymbols.filter((s) => !h[s]) };
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

  const loadDemo = () =>
    run(async () => {
      setDemoBusy(true);
      try {
        const sample = await buildDemoTransactions();
        const p = await store.create('Demo portfolio');
        await store.saveTxns(p.id, sample);
      } finally {
        setDemoBusy(false);
      }
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
  const toggleRow = (key: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  // ----- render: loading / empty
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

  const demoButton = (
    <Button onClick={loadDemo} disabled={demoBusy} title="Adds a separate “Demo portfolio” with sample Indian and US stocks — your own portfolios aren’t touched">
      <FlaskConical size={14} aria-hidden="true" /> {demoBusy ? 'Loading demo…' : 'Load demo portfolio'}
    </Button>
  );

  if (!portfolio) {
    return (
      <section className="flex flex-col items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-card)] px-6 py-12 text-center">
        <div className="text-base font-semibold">Track your investments</div>
        <div className="max-w-md text-sm text-[var(--text-muted)]">
          Add Indian and US stocks and futures to see total and daily P&amp;L, and how your portfolio performs against NIFTY 50, the Nasdaq-100 and the S&amp;P 500.
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={newPortfolio}>
            <Plus size={14} aria-hidden="true" /> Create portfolio
          </Button>
          {demoButton}
        </div>
        {actionError && <span className="text-xs text-[var(--critical)]">{actionError}</span>}
      </section>
    );
  }

  // ----- derived view data
  const today = istDate(Math.floor(now / 1000));
  const openStocksAlpha = book.stocks.filter((s) => s.qty > 0);
  const closedStocks = book.stocks.filter((s) => s.qty === 0);
  const openFutures = book.futures.filter((f) => f.lots !== 0);
  const closedFutures = book.futures.filter((f) => f.lots === 0);
  const values = new Map<string, HoldingValue>(openStocksAlpha.map((h) => [h.symbol, holdingValue(h, live, today)]));
  // Largest first, as the allocation shows them; each holding keeps its allocation colour everywhere.
  const openStocks = [...openStocksAlpha].sort((a, b) => values.get(b.symbol)!.value - values.get(a.symbol)!.value);
  const colorOf = (symbol: string) => {
    const i = openStocks.findIndex((h) => h.symbol === symbol);
    const shown = openStocks.length > 6 ? 5 : 6;
    return i >= 0 && i < shown ? ALLOC_COLORS[i % ALLOC_COLORS.length] : OTHER_COLOR;
  };
  const stockTotal = openStocks.reduce((s, h) => s + values.get(h.symbol)!.value, 0);
  const v = valuation;
  const fx = live[FX_KEY]?.price ?? null;
  const nseOpen = marketOpen(NSE_SESSION, new Date(now));
  const usOpen = marketOpen(US_SESSION, new Date(now));
  const sortedTxns = [...txns].sort((a, b) => b.date.localeCompare(a.date));
  const secsAgo = quotes.updatedAt ? Math.max(0, Math.round((now - quotes.updatedAt) / 1000)) : null;

  // Allocation for the chosen market.
  const inMarket = (h: StockHolding) => (allocView === 'all' ? true : allocView === 'US' ? h.currency === 'USD' : h.currency === 'INR');
  const allocHoldings = openStocks.filter(inMarket);
  const allocTotal = allocHoldings.reduce((s, h) => s + values.get(h.symbol)!.value, 0);
  const top = allocHoldings.slice(0, allocHoldings.length > 6 ? 5 : 6);
  const rest = allocHoldings.slice(top.length);
  const slices = [
    ...top.map((h, i) => ({
      label: displaySymbol(h.symbol),
      us: h.currency === 'USD',
      value: values.get(h.symbol)!.value,
      // In All the colours match the holdings table; a single market gets its own palette.
      color: allocView === 'all' ? colorOf(h.symbol) : ALLOC_COLORS[i % ALLOC_COLORS.length],
    })),
    ...(rest.length ? [{ label: `Other ${rest.length}`, us: false, value: rest.reduce((s, h) => s + values.get(h.symbol)!.value, 0), color: OTHER_COLOR }] : []),
  ];
  const sumOf = (list: StockHolding[], f: (hv: HoldingValue) => number) => list.reduce((s, h) => s + f(values.get(h.symbol)!), 0);
  const india = openStocks.filter((h) => h.currency === 'INR');
  const usa = openStocks.filter((h) => h.currency === 'USD');
  const usDollars = usa.reduce((s, h) => s + h.qty * (live[h.symbol]?.price ?? h.avgCost), 0);
  const allocCenter = allocView === 'US' ? `$${Math.round(usDollars).toLocaleString('en-US')}` : lakhs(allocTotal);
  const allocFooter: [string, string] =
    allocView === 'all'
      ? [`India ${stockTotal ? ((sumOf(india, (x) => x.value) / stockTotal) * 100).toFixed(1) : '0.0'}% · ${lakhs(sumOf(india, (x) => x.value))}`, `US ${stockTotal ? ((sumOf(usa, (x) => x.value) / stockTotal) * 100).toFixed(1) : '0.0'}% · ${lakhs(sumOf(usa, (x) => x.value))}`]
      : allocView === 'IN'
        ? [`P&L ${signedInr(sumOf(india, (x) => x.pnl))}`, `Today ${signedInr(sumOf(india, (x) => x.dayPnl))}`]
        : [fx ? `≈ ${lakhs(sumOf(usa, (x) => x.value))} at ₹${fx.toFixed(2)}` : 'Waiting for USD/INR', `P&L ${signedInr(sumOf(usa, (x) => x.pnl))}`];

  const periodLabel = settings.period === 'All' ? 'Since start' : settings.period;

  return (
    <div className="flex flex-col gap-3">
      {/* ---------- header bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-3">
        <label className="sr-only" htmlFor="portfolio-select">
          Portfolio
        </label>
        <select
          id="portfolio-select"
          className="max-w-[16rem] truncate rounded-md border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm font-bold uppercase tracking-[0.04em] text-[var(--text-primary)] hover:border-[var(--border-strong)]"
          value={portfolio.id}
          onChange={(e) => store.select(e.target.value)}
        >
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
        <Button variant="ghost" onClick={newPortfolio} title="New portfolio">
          <Plus size={14} aria-hidden="true" /> New
        </Button>
        {!store.portfolios.some((p) => p.name === 'Demo portfolio') && (
          <Button variant="ghost" onClick={loadDemo} disabled={demoBusy} title="Adds a separate “Demo portfolio” with sample Indian and US stocks — your own portfolios aren’t touched">
            <FlaskConical size={14} aria-hidden="true" /> {demoBusy ? 'Loading…' : 'Demo'}
          </Button>
        )}
        {txns.length > 0 && (
          <span className="hidden flex-wrap items-center gap-1.5 md:flex">
            <Chip>VALUE {lakhs(v.currentValue)}</Chip>
            <Chip tone={v.totalPnl >= 0 ? 'good' : 'critical'}>TOTAL {pct(v.totalPnlPct, 1)}</Chip>
          </span>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <Chip>
            <span style={{ color: nseOpen ? 'var(--good)' : 'var(--text-muted)' }}>●</span> NSE {nseOpen ? 'open' : 'closed'}
          </Chip>
          <Chip>
            <span style={{ color: usOpen ? 'var(--good)' : 'var(--text-muted)' }}>●</span> US {usOpen ? 'open' : 'closed'}
          </Chip>
          <Button variant="primary" className="min-h-8" onClick={() => setDialog({ kind: 'STOCK', side: 'BUY' })}>
            <Plus size={14} aria-hidden="true" /> Add transaction
          </Button>
        </span>
      </div>

      {actionError && <Notice tone="critical">{actionError}</Notice>}
      {quotes.error && <Notice>Live prices: {quotes.error}</Notice>}
      {v.unpriced.length > 0 && !quotes.loading && (
        <Notice tone="info">No live price yet for {v.unpriced.map(displaySymbol).join(', ')} — valued at cost until one arrives.</Notice>
      )}

      {txns.length === 0 ? (
        <section className="flex flex-col items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-card)] px-6 py-10 text-center">
          <div className="text-base font-semibold">Add your first transaction</div>
          <div className="max-w-md text-sm text-[var(--text-muted)]">
            Record a stock buy or a futures trade with its date and price. Holdings, P&amp;L and performance are worked out from your transactions.
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" onClick={() => setDialog({ kind: 'STOCK', side: 'BUY' })}>
              <Plus size={14} aria-hidden="true" /> Add transaction
            </Button>
            {demoButton}
          </div>
        </section>
      ) : (
        <>
          {/* ---------- KPI cards */}
          <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label="Current value"
              accent="var(--series-blue)"
              value={inr(v.currentValue)}
              sub={`${openStocks.length} holding${openStocks.length === 1 ? '' : 's'}${openFutures.length ? ` · ${openFutures.length} future${openFutures.length === 1 ? '' : 's'}` : ''}`}
            />
            <Kpi label="Invested" accent="var(--series-violet)" value={inr(v.invested)} sub={v.realized !== 0 ? `Realised ${signedInr(v.realized)}` : 'Cost of holdings'} />
            <Kpi
              label="Total P&L"
              accent="var(--good)"
              valueColor={pnlColor(v.totalPnl)}
              value={
                <>
                  {signedInr(v.totalPnl)} <span className="text-xs">{pct(v.totalPnlPct, 1)}</span>
                </>
              }
              sub={Math.abs(v.currencyGain) >= 1 ? `incl. ${signedInr(v.currencyGain)} from USD/INR` : 'Unrealised + realised'}
            />
            <Kpi
              label="Today’s P&L"
              accent="var(--warning)"
              valueColor={pnlColor(v.dayPnl)}
              value={
                <>
                  {signedInr(v.dayPnl)} <span className="text-xs">{pct(v.dayPnlPct)}</span>
                </>
              }
              sub={`NSE ${nseOpen ? 'open' : 'closed'} · US ${usOpen ? 'open' : 'closed'}`}
            />
          </div>

          {/* ---------- allocation + performance */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.55fr)]">
            <Panel
              title="Allocation"
              right={
                <Segmented
                  label="Market"
                  value={allocView}
                  onChange={setAllocView}
                  options={[
                    { v: 'all', label: 'All' },
                    { v: 'IN', label: 'India' },
                    { v: 'US', label: 'US' },
                  ]}
                />
              }
            >
              {allocHoldings.length === 0 ? (
                <div className="px-4 pb-6 pt-4 text-center text-sm text-[var(--text-muted)]">
                  No {allocView === 'US' ? 'US' : allocView === 'IN' ? 'Indian' : ''} stocks held.
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-4 px-4 pb-3">
                    <Donut slices={slices} center={allocCenter} caption={`${allocHoldings.length} HOLDING${allocHoldings.length === 1 ? '' : 'S'}`} />
                    <ul className="flex min-w-0 flex-1 flex-col gap-2">
                      {slices.map((s) => {
                        const share = allocTotal ? (s.value / allocTotal) * 100 : 0;
                        return (
                          <li key={s.label} className="min-w-0">
                            <div className="flex items-baseline justify-between gap-2 text-xs">
                              <span className="truncate">
                                <span style={{ color: s.color }}>■</span> <span className="font-semibold">{s.label}</span>
                                {s.us && <span className="ml-1 text-[10px] text-[var(--text-muted)]">US</span>}
                              </span>
                              <span className="font-semibold tabular" style={{ color: s.color === OTHER_COLOR ? 'var(--text-muted)' : s.color }}>
                                {share.toFixed(1)}%
                              </span>
                            </div>
                            <div className="mt-1 h-0.5 bg-[var(--gridline)]">
                              <div className="h-0.5" style={{ width: `${Math.min(100, share * 2)}%`, background: s.color }} />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  <div className="flex flex-wrap justify-between gap-2 border-t border-[var(--border)] px-4 py-2 text-[11px] text-[var(--text-muted)] tabular">
                    <span>{allocFooter[0]}</span>
                    <span>{allocFooter[1]}</span>
                  </div>
                </>
              )}
            </Panel>

            <Panel
              title="Performance vs benchmarks"
              right={
                <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Period">
                  {PERIODS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={settings.period === p}
                      onClick={() => updateSettings({ period: p })}
                      className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${
                        settings.period === p ? 'border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--surface-page)]' : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              }
            >
              <div className="px-4 pb-3">
                {/* Legend doubles as the benchmark switches. */}
                <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                  <span className="flex items-center gap-1.5 font-semibold">
                    <span className="inline-block h-0.5 w-4" style={{ background: PORTFOLIO_COLOR }} />
                    {portfolio.name} <span style={{ color: pnlColor(perf?.portRet ?? 0) }}>{perf?.portRet == null ? '' : pct(perf.portRet, 1)}</span>
                  </span>
                  {BENCHMARKS.map((b) => {
                    const on = settings.benchmarks.includes(b.key);
                    const line = perf?.lines.find((l) => l.key === b.key);
                    return (
                      <button
                        key={b.key}
                        type="button"
                        aria-pressed={on}
                        onClick={() => updateSettings({ benchmarks: on ? settings.benchmarks.filter((k) => k !== b.key) : [...settings.benchmarks, b.key] })}
                        className={`flex items-center gap-1.5 ${on ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)] opacity-60 hover:opacity-100'}`}
                        title={on ? `Hide ${b.label}` : `Show ${b.label}`}
                      >
                        <span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: on ? b.color : 'var(--text-muted)' }} />
                        {b.label}
                        {on && line?.ret != null && <span style={{ color: b.color }}>{pct(line.ret, 1)}</span>}
                      </button>
                    );
                  })}
                  <span className="ml-auto flex items-center gap-1 text-[var(--text-muted)]">
                    US in
                    {(['INR', 'USD'] as const).map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-pressed={settings.currency === c}
                        onClick={() => updateSettings({ currency: c })}
                        title={c === 'INR' ? 'Includes USD/INR moves — what an Indian investor earns' : 'The index in its own currency'}
                        className={`rounded px-1.5 font-semibold ${settings.currency === c ? 'bg-[var(--surface-sunken)] text-[var(--text-primary)]' : 'hover:text-[var(--text-primary)]'}`}
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
                  <PerformanceChart lines={perf.lines} callout={perf.portRet == null ? undefined : `${periodLabel} ${pct(perf.portRet, 1)}`} />
                )}

                {perf && perf.portRet != null && perf.lines.length > 1 && (
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 rounded bg-[var(--surface-sunken)] px-3 py-1.5 text-[11px] text-[var(--text-muted)] tabular">
                    {perf.lines
                      .filter((l) => !l.primary && l.ret != null)
                      .map((l) => {
                        const diff = perf.portRet! - l.ret!;
                        return (
                          <span key={l.key}>
                            vs {l.label}{' '}
                            <span style={{ color: pnlColor(diff) }}>
                              {diff >= 0 ? 'ahead' : 'behind'} {Math.abs(diff).toFixed(1)} pts
                            </span>
                          </span>
                        );
                      })}
                  </div>
                )}
                {perf && perf.missing.length > 0 && (
                  <div className="mt-1 text-[11px] text-[var(--warning)]">No price history for {perf.missing.map(displaySymbol).join(', ')} — left out of the chart.</div>
                )}
              </div>
            </Panel>
          </div>

          {/* ---------- holdings */}
          <Panel
            title="Holdings & P&L"
            right={
              <span className="flex gap-2">
                <Button variant="primary" onClick={() => setDialog({ kind: 'STOCK', side: 'BUY' })}>
                  <Plus size={14} aria-hidden="true" /> Add transaction
                </Button>
                <Button onClick={() => setShowTxns((s) => !s)} aria-expanded={showTxns}>
                  Transactions ({txns.length}) {showTxns ? '↑' : '→'}
                </Button>
              </span>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead>
                  <tr>
                    <th className={`${thBase} text-left`}>Stock</th>
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
                    const open = expanded.has(h.symbol);
                    const dot = colorOf(h.symbol);
                    return (
                      <Fragment key={h.symbol}>
                        <tr className="cursor-pointer border-t border-[var(--gridline)] hover:bg-[var(--surface-sunken)]" onClick={() => toggleRow(h.symbol)}>
                          <td className="px-3 py-2.5 text-left">
                            <span className="inline-flex items-center gap-1.5">
                              {open ? <ChevronDown size={14} aria-hidden="true" className="text-[var(--text-muted)]" /> : <ChevronRight size={14} aria-hidden="true" className="text-[var(--text-muted)]" />}
                              <span style={{ color: dot }}>●</span>
                              <span className="font-bold">{displaySymbol(h.symbol)}</span>
                              <span className="text-xs text-[var(--text-muted)]">
                                {isUs(h.symbol) ? 'US · ' : ''}
                                {symbols.find((s) => s.symbol === h.symbol)?.label ?? nameOf(h.symbol) ?? `since ${formatExpiry(h.firstDate)}`}
                              </span>
                            </span>
                          </td>
                          <td className={td}>{fmtQty(h.qty)}</td>
                          <td className={td} title={h.currency === 'USD' ? `₹${num(h.avgCostInr)} a share at the rates you paid` : undefined}>
                            {px(h.symbol, h.avgCost)}
                          </td>
                          <td className={td}>{q ? px(h.symbol, q.price) : '—'}</td>
                          <td className={td} style={{ color: hv.dayPct === null ? undefined : pnlColor(hv.dayPct) }}>
                            {pct(hv.dayPct)}
                          </td>
                          <td className={td}>{inr(hv.value)}</td>
                          <td className={td} style={{ color: hv.priced ? pnlColor(hv.pnl) : undefined }}>
                            {hv.priced ? (
                              <>
                                {signedInr(hv.pnl)} <span className="text-xs text-[var(--text-muted)]">{pct(h.invested > 0 ? (hv.pnl / h.invested) * 100 : null, 1)}</span>
                                {h.currency === 'USD' && (
                                  <div className="text-[10px] text-[var(--text-muted)]" title="The stock's own move at today's rate, and the effect of USD/INR since you bought">
                                    stock {signedInr(hv.stockGain)} · FX {signedInr(hv.fxGain)}
                                  </div>
                                )}
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className={td}>{stockTotal > 0 ? `${((hv.value / stockTotal) * 100).toFixed(1)}%` : '—'}</td>
                          <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
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

                  {openFutures.map((f) => {
                    const own = f.instrumentKey ? futQuotes.data?.[f.instrumentKey] : undefined;
                    const price = futurePrice(f, futQuotes.data ?? {}, live);
                    const mtm = price === null ? null : f.lots * f.lotSize * (price - f.avgEntry);
                    const u = live[f.symbol];
                    const day = u && u.previousClose ? ((u.price - u.previousClose) / u.previousClose) * 100 : null;
                    const dte = daysToExpiry(f.expiry);
                    const expired = f.expiry < today;
                    const long = f.lots > 0;
                    const open = expanded.has(f.key);
                    return (
                      <Fragment key={f.key}>
                        <tr className="cursor-pointer border-t border-[var(--gridline)] hover:bg-[var(--surface-sunken)]" onClick={() => toggleRow(f.key)}>
                          <td className="px-3 py-2.5 text-left">
                            <span className="inline-flex items-center gap-1.5">
                              {open ? <ChevronDown size={14} aria-hidden="true" className="text-[var(--text-muted)]" /> : <ChevronRight size={14} aria-hidden="true" className="text-[var(--text-muted)]" />}
                              <span className="text-[var(--text-muted)]">●</span>
                              <span className="font-bold">{f.symbol} FUT</span>
                              <span className="text-xs" style={{ color: expired ? 'var(--warning)' : 'var(--text-muted)' }}>
                                {formatExpiry(f.expiry)} · {long ? 'Long' : 'Short'} {Math.abs(f.lots)} lot{Math.abs(f.lots) === 1 ? '' : 's'} · {expired ? 'expired' : `${dte}d`}
                              </span>
                            </span>
                          </td>
                          <td className={td}>{(Math.abs(f.lots) * f.lotSize).toLocaleString('en-IN')}</td>
                          <td className={td}>{num(f.avgEntry)}</td>
                          <td className={td} title={own ? 'Futures LTP from Upstox' : 'Underlying spot — connect Upstox for the future’s own price'}>
                            {price === null ? '—' : num(price)}
                            {!own && price !== null && <span className="ml-1 text-[10px] text-[var(--text-muted)]">≈ spot</span>}
                          </td>
                          <td className={td} style={{ color: day === null ? undefined : pnlColor(day) }}>
                            {pct(day)}
                          </td>
                          <td className={`${td} text-[var(--text-muted)]`}>MTM</td>
                          <td className={td} style={{ color: mtm === null ? undefined : pnlColor(mtm) }}>
                            {mtm === null ? '—' : signedInr(mtm)}
                          </td>
                          <td className={`${td} text-[var(--text-muted)]`}>—</td>
                          <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                            <Button size="xs" variant={expired ? 'primary' : 'default'} onClick={() => setDialog({ kind: 'FUT', side: long ? 'SELL' : 'BUY', symbol: f.symbol, expiry: f.expiry, qty: Math.abs(f.lots) })}>
                              {expired ? 'Record exit' : 'Exit'}
                            </Button>
                          </td>
                        </tr>
                        {open && (
                          <tr className="bg-[var(--surface-sunken)]">
                            <td colSpan={9} className="px-4 py-2">
                              <TxnList txns={f.txns} onDelete={deleteTxn} onEdit={editTxn} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {(closedStocks.length > 0 || closedFutures.length > 0) && (
              <div className="border-t border-[var(--border)] px-4 py-2 text-[11px] text-[var(--text-muted)] tabular">
                Closed:{' '}
                {closedStocks.map((s) => (
                  <span key={s.symbol} className="mr-3">
                    {displaySymbol(s.symbol)} <span style={{ color: pnlColor(s.realized) }}>{signedInr(s.realized)}</span>
                  </span>
                ))}
                {closedFutures.map((f) => (
                  <span key={f.key} className="mr-3">
                    {f.symbol} FUT {formatExpiry(f.expiry)} <span style={{ color: pnlColor(f.realized) }}>{signedInr(f.realized)}</span>
                  </span>
                ))}
              </div>
            )}
          </Panel>

          {showTxns && (
            <Panel title={`Transactions (${txns.length})`}>
              <div className="px-4 pb-3">
                <TxnList txns={showAllTxns ? sortedTxns : sortedTxns.slice(0, 15)} onDelete={deleteTxn} onEdit={editTxn} />
                {sortedTxns.length > 15 && (
                  <Button variant="ghost" className="mt-1" onClick={() => setShowAllTxns((s) => !s)}>
                    {showAllTxns ? 'Show fewer' : `Show all ${sortedTxns.length}`}
                  </Button>
                )}
              </div>
            </Panel>
          )}

          {/* ---------- status line */}
          <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-[var(--border)] px-1 pt-2 text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)] tabular">
            <span style={{ color: quotes.error ? 'var(--warning)' : 'var(--good-text)' }}>● {quotes.error ? 'Prices delayed' : 'Prices live'}</span>
            {secsAgo !== null && <span>Updated {secsAgo < 60 ? `${secsAgo}s` : `${Math.floor(secsAgo / 60)}m`} ago</span>}
            {firstDate && <span>Since {formatExpiry(firstDate)}</span>}
            <span className="ml-auto">US data · Yahoo Finance{fx ? ` · USD/INR ₹${fx.toFixed(2)}` : ''}</span>
          </div>
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
              {fmtQty(t.qty)} {t.kind === 'FUT' ? `lot${t.qty === 1 ? '' : 's'}` : 'sh'} @ {px(t.symbol, t.price)}
            </span>
            <span className="text-[var(--text-muted)]">
              {isUs(t.symbol) ? `$${num(units * t.price)} at ₹${num(t.fx ?? 0)} = ${inr(units * t.price * (t.fx ?? 0))}` : inr(units * t.price)}
              {t.fees > 0 && ` + ${isUs(t.symbol) ? `$${num(t.fees)}` : inr(t.fees)} fees`}
            </span>
            {t.note && <span className="truncate text-[var(--text-muted)] italic">{t.note}</span>}
            <button type="button" onClick={() => onEdit(t)} className="ml-auto rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)]" aria-label={`Edit ${t.side.toLowerCase()} ${displaySymbol(t.symbol)} on ${t.date}`} title="Edit transaction">
              <Pencil size={13} />
            </button>
            <button type="button" onClick={() => onDelete(t)} className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--critical-fill)] hover:text-[var(--critical)]" aria-label={`Delete ${t.side.toLowerCase()} ${displaySymbol(t.symbol)} on ${t.date}`} title="Delete transaction">
              <Trash2 size={13} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
