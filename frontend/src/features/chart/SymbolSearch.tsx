import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Search, X, XCircle } from 'lucide-react';
import { api } from '../../api/client';
import type { SymbolInfo, UsSearchResult } from '../../api/types';
import { displaySymbol } from '../../lib/markets';

/** A row in the results, from either market. */
interface Hit {
  symbol: string;
  name: string;
  /** "stock", "index", "etf" */
  type: string;
  exchange: string;
  market: 'IN' | 'US';
}

type Tab = 'all' | 'IN' | 'US';

const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'IN', label: 'Indian stocks' },
  { id: 'US', label: 'US stocks' },
];

const NSE_INDICES = new Set(['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'INDIAVIX']);

/** Shown for the US tab before anything is typed. */
const POPULAR_US: Hit[] = [
  ['AAPL', 'Apple Inc.', 'NASDAQ'],
  ['MSFT', 'Microsoft Corporation', 'NASDAQ'],
  ['NVDA', 'NVIDIA Corporation', 'NASDAQ'],
  ['AMZN', 'Amazon.com, Inc.', 'NASDAQ'],
  ['GOOGL', 'Alphabet Inc.', 'NASDAQ'],
  ['META', 'Meta Platforms, Inc.', 'NASDAQ'],
  ['TSLA', 'Tesla, Inc.', 'NASDAQ'],
  ['SPY', 'SPDR S&P 500 ETF Trust', 'NYSE Arca', 'etf'],
  ['QQQ', 'Invesco QQQ Trust', 'NASDAQ', 'etf'],
  ['VOO', 'Vanguard S&P 500 ETF', 'NYSE Arca', 'etf'],
].map(([t, name, exchange, type]) => ({ symbol: `US:${t}`, name, exchange, type: type ?? 'stock', market: 'US' as const }));

/** A stable colour per symbol, for its letter badge. */
const BADGE_COLORS = ['#378ADD', '#1D9E75', '#7F77DD', '#D85A30', '#D4537E', '#BA7517', '#0F6E56', '#534AB7'];
function badgeColor(symbol: string) {
  let h = 0;
  for (const c of symbol) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return BADGE_COLORS[h % BADGE_COLORS.length];
}

/** The ticker with the typed part highlighted, as TradingView does. */
function Ticker({ text, query }: { text: string; query: string }) {
  const q = query.trim().toUpperCase();
  const i = q ? text.toUpperCase().indexOf(q) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <span className="text-[var(--series-blue)]">{text.slice(i, i + q.length)}</span>
      {text.slice(i + q.length)}
    </>
  );
}

/**
 * TradingView-style symbol search: one box for NSE and US symbols, with
 * tabs to narrow to either market and results grouped by market under All.
 * Arrow keys move through results, Enter picks, Escape closes.
 */
export function SymbolSearch({
  symbolInfo,
  title = 'Symbol search',
  exclude = [],
  onPick,
  onClose,
}: {
  symbolInfo: SymbolInfo[];
  title?: string;
  /** Symbols to leave out (e.g. already in the watchlist). */
  exclude?: string[];
  onPick: (symbol: string, name: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [us, setUs] = useState<UsSearchResult[] | null>(null);
  const [usLoading, setUsLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<Element | null>(null);

  useEffect(() => {
    returnFocus.current = document.activeElement;
    input.current?.focus();
    return () => {
      const el = returnFocus.current;
      if (el instanceof HTMLElement) el.focus();
    };
  }, []);

  // US matches come from the server; debounce so typing doesn't fire a request per key.
  useEffect(() => {
    const q = query.trim();
    if (!q || tab === 'IN') {
      setUs(null);
      setUsLoading(false);
      return;
    }
    let cancelled = false;
    setUsLoading(true);
    const t = window.setTimeout(() => {
      api
        .searchUs(q)
        .then((r) => !cancelled && setUs(r.results))
        .catch(() => !cancelled && setUs([]))
        .finally(() => !cancelled && setUsLoading(false));
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query, tab]);

  const skip = useMemo(() => new Set(exclude), [exclude]);

  const indian = useMemo<Hit[]>(() => {
    const q = query.trim().toUpperCase();
    const all = symbolInfo
      .filter((s) => !skip.has(s.symbol) && (!q || s.symbol.includes(q) || s.label.toUpperCase().includes(q)))
      .map((s) => ({ symbol: s.symbol, name: s.label, type: NSE_INDICES.has(s.symbol) ? 'index' : 'stock', exchange: 'NSE', market: 'IN' as const }));
    // Tickers that start with the query first, then the rest — as TradingView ranks.
    return q ? [...all.filter((h) => h.symbol.startsWith(q)), ...all.filter((h) => !h.symbol.startsWith(q))] : all;
  }, [symbolInfo, query, skip]);

  const american = useMemo<Hit[]>(() => {
    const rows = query.trim()
      ? (us ?? []).map((r) => ({ symbol: r.symbol, name: r.name, type: r.type === 'ETF' ? 'etf' : 'stock', exchange: r.exchange, market: 'US' as const }))
      : POPULAR_US;
    return rows.filter((h) => !skip.has(h.symbol));
  }, [us, query, skip]);

  const sections = useMemo(() => {
    const out: { title: string; hits: Hit[]; loading: boolean; empty: string }[] = [];
    if (tab !== 'US') out.push({ title: 'Indian stocks', hits: tab === 'all' ? indian.slice(0, 8) : indian, loading: false, empty: 'No NSE symbol matches.' });
    if (tab !== 'IN')
      out.push({
        title: query.trim() ? 'US stocks' : 'US stocks · popular',
        hits: tab === 'all' ? american.slice(0, 8) : american,
        loading: usLoading && !us,
        empty: 'No US stock or ETF matches.',
      });
    return out;
  }, [tab, indian, american, usLoading, us, query]);

  const flat = useMemo(() => sections.flatMap((s) => s.hits), [sections]);
  useEffect(() => setCursor(0), [query, tab]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const pick = (h: Hit) => {
    onPick(h.symbol, h.name);
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, Math.max(flat.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter' && flat[cursor]) {
      e.preventDefault();
      pick(flat[cursor]);
    }
  };

  let index = -1;
  const row = (h: Hit): ReactNode => {
    index += 1;
    const i = index;
    const ticker = displaySymbol(h.symbol);
    const active = i === cursor;
    return (
      <button
        key={h.symbol}
        type="button"
        role="option"
        aria-selected={active}
        data-index={i}
        onMouseEnter={() => setCursor(i)}
        onClick={() => pick(h)}
        className={`grid w-full grid-cols-[2.25rem_minmax(4.5rem,8rem)_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--gridline)] px-4 py-2.5 text-left max-sm:grid-cols-[2rem_minmax(0,1fr)_auto] max-sm:gap-2 max-sm:px-3 ${
          active ? 'bg-[var(--surface-sunken)]' : ''
        }`}
      >
        <span
          className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold text-white"
          style={{ background: badgeColor(h.symbol) }}
          aria-hidden="true"
        >
          {ticker.slice(0, ticker.length > 4 ? 1 : 2)}
        </span>
        <span className="truncate text-[15px] font-semibold max-sm:flex max-sm:flex-col max-sm:text-sm">
          {/* One element, so the highlighted part stays on the ticker's line in the stacked phone layout. */}
          <span className="truncate">
            <Ticker text={ticker} query={query} />
          </span>
          <span className="truncate text-xs font-normal text-[var(--text-secondary)] sm:hidden">{h.name}</span>
        </span>
        <span className="truncate text-sm text-[var(--text-secondary)] max-sm:hidden">{h.name}</span>
        <span className="flex shrink-0 items-center gap-2 text-xs">
          <span className="text-[var(--text-muted)]">{h.type}</span>
          <span className="font-medium text-[var(--text-primary)]">{h.exchange}</span>
          <span
            className="rounded border border-[var(--border)] px-1 text-[9px] font-semibold tracking-wide text-[var(--text-muted)]"
            title={h.market === 'US' ? 'United States' : 'India'}
          >
            {h.market}
          </span>
        </span>
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 sm:p-6 sm:pt-[8vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="symbol-search-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="flex h-full w-full flex-col overflow-hidden border-[var(--border-strong)] bg-[var(--surface-raised)] shadow-2xl sm:h-[min(78vh,760px)] sm:max-w-3xl sm:rounded-xl sm:border"
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3 max-sm:px-3">
          <h2 id="symbol-search-title" className="text-lg font-semibold">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]">
            <X size={20} />
          </button>
        </div>

        <div className="px-5 max-sm:px-3">
          <div className="flex items-center gap-2 rounded-lg border border-[var(--border-strong)] px-3 focus-within:border-[var(--series-blue)]">
            <Search size={18} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
            <input
              ref={input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Symbol or company, e.g. RELIANCE or Apple"
              aria-label="Search symbols"
              aria-controls="symbol-search-results"
              spellCheck={false}
              autoComplete="off"
              className="h-11 min-w-0 flex-1 bg-transparent text-base outline-none"
            />
            {query && (
              <button type="button" onClick={() => { setQuery(''); input.current?.focus(); }} aria-label="Clear search" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                <XCircle size={18} />
              </button>
            )}
          </div>

          <div className="flex gap-2 overflow-x-auto py-3" role="tablist" aria-label="Market">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => {
                  setTab(t.id);
                  input.current?.focus();
                }}
                className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  tab === t.id ? 'bg-[var(--text-primary)] text-[var(--surface-raised)]' : 'bg-[var(--surface-sunken)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div ref={list} id="symbol-search-results" role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto border-t border-[var(--border)]">
          {sections.map((s) => (
            <Fragment key={s.title}>
              {(tab === 'all' || sections.length > 1) && (
                <div className="sticky top-0 z-10 flex items-center justify-between bg-[var(--surface-raised)] px-4 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] max-sm:px-3">
                  {s.title}
                  {tab === 'all' && s.hits.length >= 8 && (
                    <button
                      type="button"
                      className="normal-case tracking-normal text-[var(--series-blue)] hover:underline"
                      onClick={() => setTab(s.title.startsWith('Indian') ? 'IN' : 'US')}
                    >
                      See all
                    </button>
                  )}
                </div>
              )}
              {s.loading ? (
                <div className="px-4 py-3 text-sm text-[var(--text-muted)]">Searching…</div>
              ) : s.hits.length === 0 ? (
                <div className="px-4 py-3 text-sm text-[var(--text-muted)]">{query.trim() ? s.empty : 'Type to search.'}</div>
              ) : (
                s.hits.map(row)
              )}
            </Fragment>
          ))}
        </div>

        <div className="border-t border-[var(--border)] px-4 py-2 text-center text-[11px] text-[var(--text-muted)] max-sm:hidden">
          ↑ ↓ to move · Enter to open · Esc to close · US data from Yahoo Finance
        </div>
      </div>
    </div>
  );
}
