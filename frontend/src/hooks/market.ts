import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import type { AuthStatus, BrokerMargin, SymbolInfo } from '../api/types';
import type { Leg } from '../domain/types';
import { useAsync } from './useAsync';

/** Quotes and chain refresh this often while the tab is visible. */
export const MARKET_POLL_MS = 15_000;

export function useSymbols(): SymbolInfo[] {
  const { data } = useAsync(() => api.symbols(), []);
  return data?.all ?? [];
}

export function useSpot(symbol: string) {
  return useAsync(() => api.spot(symbol), [symbol], { pollMs: MARKET_POLL_MS });
}

export function useOptionChain(symbol: string, expiry: string | undefined, enabled: boolean) {
  return useAsync(() => api.optionChain(symbol, expiry), [symbol, expiry], { pollMs: MARKET_POLL_MS, enabled });
}

/**
 * Upstox connection status. Re-checked when the window regains focus, because
 * connecting happens in another tab (the OAuth consent screen).
 */
export function useBrokerStatus() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .authStatus()
      .then((s) => !cancelled && setStatus(s))
      .catch(() => !cancelled && setStatus(null));
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  useEffect(() => {
    const onFocus = () => setNonce((n) => n + 1);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  return { status, refresh: () => setNonce((n) => n + 1) };
}

/**
 * Real SPAN + exposure margin from Upstox. Only requested when every leg came
 * from the live chain — a partial basket would understate the requirement.
 */
export function useBrokerMargin(legs: Leg[], brokerConnected: boolean): { margin: number | null; loading: boolean } {
  const basket = useMemo(() => {
    const priced = legs
      .filter((l) => l.instrumentKey)
      .map((l) => ({ instrumentKey: l.instrumentKey!, quantity: l.lots * l.lotSize, action: l.action }));
    return brokerConnected && priced.length > 0 && priced.length === legs.length ? JSON.stringify(priced) : '';
  }, [legs, brokerConnected]);

  const { data, loading } = useAsync<BrokerMargin>(() => api.margin(JSON.parse(basket)), [basket], {
    enabled: basket !== '',
  });

  return { margin: data?.final_margin ?? data?.required_margin ?? null, loading };
}
