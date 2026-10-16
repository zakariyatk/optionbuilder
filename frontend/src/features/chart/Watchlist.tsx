import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Plus, X } from 'lucide-react';
import { api } from '../../api/client';
import type { SpotQuote, SymbolInfo, UsSearchResult, WatchQuote } from '../../api/types';
import { Button } from '../../components/ui';
import { useAsync } from '../../hooks/useAsync';
import { num } from '../../lib/format';
import { marketOpen, NSE_SESSION, sessionFor, US_SESSION } from '../../lib/nse';
import { displaySymbol, isUs } from '../../lib/markets';
import { activeList, useWatchlist } from '../../store/watchlist';
import { WatchlistMenu } from './WatchlistMenu';

/** Names of US symbols seen in search this session (the watchlist stores symbols only). */
const usNames = new Map<string, string>();

/** Near-live while a market the list covers trades; prices don't move once it's closed. */
const WATCH_POLL_OPEN_MS = 5_000;
const WATCH_POLL_CLOSED_MS = 60_000;

const isQuote = (q: WatchQuote | undefined): q is SpotQuote => !!q && !('error' in q);
const changeColor = (v: number) => (v > 0 ? 'var(--good-text)' : v < 0 ? 'var(--critical)' : 'var(--text-secondary)');

/**
 * TradingView-style watchlist: live NSE and US prices for the user's symbols.
 * Clicking a row loads it on the chart; the card underneath details the
 * selected symbol.
 */
export function Watchlist({
  symbolInfo,
  selected,
  onSelect,
  onOpenBuilder,
}: {
  symbolInfo: SymbolInfo[];
  selected: string;
  onSelect: (symbol: string) => void;
  onOpenBuilder: (symbol: string) => void;
}) {
  const { lists, activeId, add, remove } = useWatchlist();
  const symbols = activeList({ lists, activeId }).symbols;
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');

  const open = marketOpen(sessionFor(selected));
  const anyOpen = (symbols.some((s) => !isUs(s)) && marketOpen(NSE_SESSION)) || (symbols.some(isUs) && marketOpen(US_SESSION));
  const quotes = useAsync(() => api.watch(symbols), [symbols.join(',')], {
    pollMs: anyOpen ? WATCH_POLL_OPEN_MS : WATCH_POLL_CLOSED_MS,
    enabled: symbols.length > 0,
  });
  const bySymbol = useMemo(() => new Map((quotes.data?.quotes ?? []).map((q) => [q.symbol, q])), [quotes.data]);
  const label = (s: string) => symbolInfo.find((i) => i.symbol === s)?.label ?? usNames.get(s) ?? displaySymbol(s);

  // US stocks and ETFs from Yahoo, searched as the user types.
  const [usMatches, setUsMatches] = useState<UsSearchResult[]>([]);
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setUsMatches([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      api
        .searchUs(q)
        .then((r) => {
          if (cancelled) return;
          r.results.forEach((x) => usNames.set(x.symbol, x.name));
          setUsMatches(r.results);
        })
        .catch(() => !cancelled && setUsMatches([]));
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query]);

  const matches = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return [];
    const nse = symbolInfo
      .filter((i) => !symbols.includes(i.symbol) && (i.symbol.includes(q) || i.label.toUpperCase().includes(q)))
      .slice(0, 6)
      .map((i) => ({ symbol: i.symbol, label: i.label, exchange: 'NSE' }));
    const us = usMatches
      .filter((r) => !symbols.includes(r.symbol))
      .slice(0, 6)
      .map((r) => ({ symbol: r.symbol, label: r.name, exchange: r.type === 'ETF' ? `${r.exchange} · ETF` : r.exchange }));
    return [...nse, ...us];
  }, [query, symbolInfo, symbols, usMatches]);

  const pick = (symbol: string) => {
    add(symbol);
    onSelect(symbol);
    setQuery('');
    setAdding(false);
  };

  const sel = bySymbol.get(selected);
  const selQuote = isQuote(sel) ? sel : null;
  const selChange = selQuote ? selQuote.price - selQuote.previousClose : null;
  const selPct = selQuote && selQuote.previousClose ? (selChange! / selQuote.previousClose) * 100 : null;

  return (
    <aside className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-card)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
        <WatchlistMenu />
        <button
          type="button"
          onClick={() => setAdding((a) => !a)}
          aria-expanded={adding}
          aria-label="Add symbol"
          title="Add symbol"
          className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)] pointer-coarse:h-11 pointer-coarse:w-11"
        >
          <Plus size={20} aria-hidden="true" />
        </button>
      </div>

      {adding && (
        <div className="border-b border-[var(--border)] p-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches[0]) pick(matches[0].symbol);
              if (e.key === 'Escape') setAdding(false);
            }}
            placeholder="Search NSE or US symbol…"
            aria-label="Search symbol to add"
            className="w-full rounded-md border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none focus:border-[var(--series-blue)]"
          />
          {matches.length > 0 && (
            <ul className="mt-1 max-h-56 overflow-auto">
              {matches.map((m) => (
                <li key={m.symbol}>
                  <button
                    type="button"
                    onClick={() => pick(m.symbol)}
                    className="flex w-full items-baseline justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-[var(--surface-sunken)]"
                  >
                    <span className="text-sm font-medium">{displaySymbol(m.symbol)}</span>
                    <span className="min-w-0 flex-1 truncate text-right text-xs text-[var(--text-muted)]">{m.label}</span>
                    <span className="shrink-0 text-[10px] text-[var(--text-muted)]">{m.exchange}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.trim() && matches.length === 0 && <div className="px-2 py-2 text-xs text-[var(--text-muted)]">No matching symbol.</div>}
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-3 border-b border-[var(--border)] px-3 py-1.5 text-[11px] text-[var(--text-muted)]">
        <span>Symbol</span>
        <span className="w-[4.5rem] text-right">Last</span>
        <span className="w-12 text-right">Chg</span>
        <span className="w-12 text-right">Chg%</span>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Watchlist symbols">
        {symbols.length === 0 && <li className="px-3 py-6 text-center text-xs text-[var(--text-muted)]">Add symbols with +</li>}
        {symbols.map((s) => {
          const q = bySymbol.get(s);
          const quote = isQuote(q) ? q : null;
          const chg = quote ? quote.price - quote.previousClose : null;
          const pct = quote && quote.previousClose ? (chg! / quote.previousClose) * 100 : null;
          const active = s === selected;
          return (
            <li key={s} className="group relative">
              <button
                type="button"
                onClick={() => onSelect(s)}
                aria-current={active ? 'true' : undefined}
                className={`grid w-full grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-x-3 border-b border-[var(--gridline)] px-3 py-2 text-left text-[13px] tabular pointer-coarse:py-3 pointer-coarse:pr-12 ${
                  active ? 'bg-[var(--surface-sunken)] shadow-[inset_2px_0_0_var(--series-blue)]' : 'hover:bg-[var(--surface-sunken)]'
                }`}
              >
                <span className="flex min-w-0 items-center gap-1 font-medium" title={label(s)}>
                  <span className="truncate">{displaySymbol(s)}</span>
                  {isUs(s) && <span className="shrink-0 rounded border border-[var(--border)] px-0.5 text-[9px] text-[var(--text-muted)]">US</span>}
                </span>
                <span className="w-[4.5rem] text-right">{quote ? num(quote.price) : q ? '—' : '…'}</span>
                <span className="w-12 text-right" style={{ color: chg === null ? undefined : changeColor(chg) }}>
                  {chg === null ? '' : `${chg > 0 ? '+' : ''}${chg.toFixed(chg !== 0 && Math.abs(chg) < 10 ? 2 : 1)}`}
                </span>
                <span className="w-12 text-right" style={{ color: pct === null ? undefined : changeColor(pct) }}>
                  {pct === null ? '' : `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`}
                </span>
              </button>
              <button
                type="button"
                onClick={() => remove(s)}
                aria-label={`Remove ${displaySymbol(s)}`}
                title="Remove"
                className="absolute right-1 top-1/2 hidden h-6 w-6 -translate-y-1/2 items-center justify-center rounded bg-[var(--surface-raised)] text-[var(--text-muted)] shadow hover:text-[var(--critical)] group-hover:flex focus:flex pointer-coarse:flex pointer-coarse:h-9 pointer-coarse:w-9"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-[var(--border)] px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-base font-semibold">{displaySymbol(selected)}</span>
          <span className="text-[11px] text-[var(--text-muted)]">{isUs(selected) ? 'US' : 'NSE'}</span>
        </div>
        <div className="truncate text-xs text-[var(--text-muted)]">{label(selected)}</div>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
          <span className="text-2xl font-bold tabular">{selQuote ? num(selQuote.price) : '—'}</span>
          <span className="text-xs text-[var(--text-muted)]">{isUs(selected) ? 'USD' : 'INR'}</span>
          {selChange !== null && (
            <span className="text-sm font-medium tabular" style={{ color: changeColor(selChange) }}>
              {selChange > 0 ? '+' : ''}
              {num(selChange)} ({selPct !== null ? `${selPct > 0 ? '+' : ''}${selPct.toFixed(2)}%` : '—'})
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-xs" style={{ color: open ? 'var(--good-text)' : 'var(--text-muted)' }}>
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: open ? 'var(--good)' : 'var(--text-muted)' }} />
          {open ? 'Market open' : 'Market closed'}
        </div>
        {selQuote && (
          <dl className="mt-3 grid grid-cols-2 gap-y-1 text-xs tabular">
            <dt className="text-[var(--text-muted)]">Prev close</dt>
            <dd className="text-right">{num(selQuote.previousClose)}</dd>
            <dt className="text-[var(--text-muted)]">Last update</dt>
            <dd className="text-right">
              {selQuote.marketTime ? new Date(selQuote.marketTime * 1000).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'}
            </dd>
          </dl>
        )}
        {/* Options strategies need an NSE option chain. */}
        {!isUs(selected) && (
          <Button className="mt-3 w-full" onClick={() => onOpenBuilder(selected)}>
            Build strategy on {selected}
            <ArrowRight size={16} aria-hidden="true" />
          </Button>
        )}
      </div>
    </aside>
  );
}
