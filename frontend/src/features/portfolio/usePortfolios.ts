import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import type { Portfolio, PortfolioTxn, WatchQuote } from '../../api/types';
import type { LiveQuote } from '../../domain/portfolio';
import { useAsync } from '../../hooks/useAsync';
import { MARKET_POLL_MS } from '../../hooks/market';

const SELECTED_KEY = 'option-builder-portfolio';

function storedSelection(): string | null {
  try {
    return localStorage.getItem(SELECTED_KEY);
  } catch {
    return null;
  }
}

/** Portfolios from the server, the selected one, and mutations that keep local state in sync. */
export function usePortfolios() {
  const [portfolios, setPortfolios] = useState<Portfolio[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(storedSelection);

  const load = useCallback(() => {
    api
      .portfolios()
      .then((r) => {
        setPortfolios(r.portfolios);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  const selected = portfolios?.find((p) => p.id === selectedId) ?? portfolios?.[0] ?? null;

  const select = useCallback((id: string) => {
    setSelectedId(id);
    try {
      localStorage.setItem(SELECTED_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const replace = (p: Portfolio) => setPortfolios((list) => (list ?? []).map((x) => (x.id === p.id ? p : x)));

  return {
    portfolios,
    selected,
    error,
    reload: load,
    select,
    create: async (name: string) => {
      const { portfolio } = await api.createPortfolio(name);
      setPortfolios((list) => [...(list ?? []), portfolio]);
      select(portfolio.id);
      return portfolio;
    },
    rename: async (id: string, name: string) => replace((await api.renamePortfolio(id, name)).portfolio),
    remove: async (id: string) => {
      await api.deletePortfolio(id);
      setPortfolios((list) => (list ?? []).filter((p) => p.id !== id));
    },
    saveTxns: async (id: string, transactions: PortfolioTxn[]) => replace((await api.savePortfolioTxns(id, transactions)).portfolio),
  };
}

/** Live spot quotes for many symbols; /api/watch takes 30 at a time. */
export function useLiveQuotes(symbols: string[]) {
  const key = [...new Set(symbols)].sort().join(',');
  const state = useAsync(
    async () => {
      const list = key ? key.split(',') : [];
      const chunks: string[][] = [];
      for (let i = 0; i < list.length; i += 30) chunks.push(list.slice(i, i + 30));
      const results = await Promise.all(chunks.map((c) => api.watch(c)));
      const out: Record<string, LiveQuote> = {};
      for (const q of results.flatMap((r) => r.quotes) as WatchQuote[]) {
        if (!('error' in q)) out[q.symbol] = { price: q.price, previousClose: q.previousClose };
      }
      return out;
    },
    [key],
    { pollMs: MARKET_POLL_MS, enabled: key !== '' },
  );
  return state;
}

/** LTPs of the open futures contracts — needs the broker; callers fall back to the underlying. */
export function useFuturesQuotes(keys: string[], brokerConnected: boolean) {
  const key = [...new Set(keys)].sort().join(',');
  return useAsync(() => api.quotes(key.split(',')).then((r) => r.quotes), [key], {
    pollMs: MARKET_POLL_MS,
    enabled: brokerConnected && key !== '',
  });
}

/** Daily closes for holdings and benchmarks. Fetched once per symbol set; the server caches for 6 h. */
export function usePriceHistory(symbols: string[], range: string) {
  const key = useMemo(() => [...new Set(symbols)].sort().join(','), [symbols]);
  return useAsync(() => api.history(key.split(','), range).then((r) => r.series), [key, range], { enabled: key !== '' });
}
