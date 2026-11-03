import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { api } from '../../api/client';
import type { SymbolInfo, UsSearchResult } from '../../api/types';
import { displaySymbol } from '../../lib/markets';

const INDICES = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];

/** NSE underlying: a native select hidden over a styled label, so it keeps the platform picker. */
export function NseSymbolSelect({ symbols, symbol, onChange }: { symbols: SymbolInfo[]; symbol: string; onChange: (s: string) => void }) {
  const label = symbols.find((s) => s.symbol === symbol)?.label ?? symbol;
  const options = symbols.length ? symbols : [{ symbol, label: symbol, lotSize: 0 }];
  const indices = options.filter((s) => INDICES.includes(s.symbol));
  const stocks = options.filter((s) => !INDICES.includes(s.symbol));
  return (
    <label className="relative flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 hover:bg-[var(--surface-sunken)]">
      <span className="text-base font-bold">{symbol}</span>
      {label !== symbol && <span className="truncate text-xs text-[var(--text-muted)] max-sm:hidden">{label}</span>}
      <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-[var(--text-muted)]" />
      <select aria-label="Underlying" className="absolute inset-0 cursor-pointer opacity-0" value={symbol} onChange={(e) => onChange(e.target.value)}>
        {indices.length > 0 && (
          <optgroup label="Indices">
            {indices.map((s) => (
              <option key={s.symbol} value={s.symbol}>
                {s.label}
              </option>
            ))}
          </optgroup>
        )}
        {stocks.length > 0 && (
          <optgroup label="Stocks">
            {stocks.map((s) => (
              <option key={s.symbol} value={s.symbol}>
                {s.label}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </label>
  );
}

const POPULAR: { symbol: string; name: string }[] = [
  { symbol: 'US:SPY', name: 'SPDR S&P 500 ETF' },
  { symbol: 'US:QQQ', name: 'Invesco QQQ Trust' },
  { symbol: 'US:IWM', name: 'iShares Russell 2000 ETF' },
  { symbol: 'US:AAPL', name: 'Apple' },
  { symbol: 'US:NVDA', name: 'NVIDIA' },
  { symbol: 'US:TSLA', name: 'Tesla' },
  { symbol: 'US:MSFT', name: 'Microsoft' },
  { symbol: 'US:AMZN', name: 'Amazon' },
  { symbol: 'US:META', name: 'Meta Platforms' },
];

/** US underlying: popular tickers, plus a search over US stocks and ETFs. */
export function UsSymbolPicker({ symbol, onChange }: { symbol: string; onChange: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UsSearchResult[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const name = POPULAR.find((p) => p.symbol === symbol)?.name;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setResults(null);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      api
        .searchUs(q)
        .then((r) => !cancelled && setResults(r.results))
        .catch(() => !cancelled && setResults([]));
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query]);

  const pick = (s: string) => {
    setOpen(false);
    setQuery('');
    onChange(s);
  };
  const list = results ? results.map((r) => ({ symbol: r.symbol, name: `${r.name} · ${r.exchange}` })) : POPULAR;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Underlying"
        onClick={() => setOpen((o) => !o)}
        className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 hover:bg-[var(--surface-sunken)]"
      >
        <span className="text-base font-bold">{displaySymbol(symbol)}</span>
        {name && <span className="truncate text-xs text-[var(--text-muted)] max-sm:hidden">{name}</span>}
        <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-[var(--text-muted)]" />
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] p-1 shadow-xl">
          <label className="flex items-center gap-2 rounded-md border border-[var(--border)] px-2 focus-within:border-[var(--focus)]">
            <Search size={14} aria-hidden="true" className="text-[var(--text-muted)]" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && list[0] && pick(list[0].symbol)}
              placeholder="Search US stocks and ETFs"
              aria-label="Search US stocks and ETFs"
              className="ob-bare-input min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none"
            />
          </label>
          <div className="mt-1 px-2 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{results ? 'Results' : 'Popular'}</div>
          <ul role="listbox" className="max-h-72 overflow-auto">
            {list.length === 0 && <li className="px-2 py-2 text-xs text-[var(--text-muted)]">No matches</li>}
            {list.map((r) => (
              <li key={r.symbol}>
                <button
                  type="button"
                  role="option"
                  aria-selected={r.symbol === symbol}
                  onClick={() => pick(r.symbol)}
                  className="flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left hover:bg-[var(--surface-sunken)]"
                >
                  <span className="w-14 shrink-0 text-xs font-semibold">{displaySymbol(r.symbol)}</span>
                  <span className="truncate text-xs text-[var(--text-muted)]">{r.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
