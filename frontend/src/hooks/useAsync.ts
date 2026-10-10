import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../api/client';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** When `data` was last refreshed successfully. */
  updatedAt: number | null;
  reload: () => void;
}

interface Options {
  /** Re-fetch every N ms. Paused while the tab is hidden, resumed (with an immediate fetch) on return. */
  pollMs?: number;
  /** Skip fetching entirely (e.g. a route that needs a broker session that isn't there). */
  enabled?: boolean;
}

/**
 * Fetch-on-deps with optional polling. Keeps the last good data through a
 * failed refresh — a flaky poll shouldn't blank a panel that was fine a
 * moment ago — and ignores responses that arrive after the deps changed.
 */
export function useAsync<T>(fetcher: () => Promise<T>, deps: unknown[], { pollMs, enabled = true }: Options = {}): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!enabled) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let timer: number | undefined;
    setLoading(true);

    const run = () => {
      window.clearTimeout(timer);
      fetcherRef
        .current()
        .then((d) => {
          if (cancelled) return;
          setData(d);
          setError(null);
          setUpdatedAt(Date.now());
        })
        .catch((e) => {
          if (!cancelled) setError(errorMessage(e));
        })
        .finally(() => {
          if (cancelled) return;
          setLoading(false);
          if (pollMs && document.visibilityState === 'visible') timer = window.setTimeout(run, pollMs);
        });
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible' && pollMs) run();
      else window.clearTimeout(timer);
    };

    run();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are supplied by the caller
  }, [...deps, enabled, pollMs, nonce]);

  // When the deps change, the old data belongs to a different query.
  const depsKey = JSON.stringify(deps);
  const lastKey = useRef(depsKey);
  if (lastKey.current !== depsKey) {
    lastKey.current = depsKey;
    if (data !== null) setData(null);
  }

  return { data, error, loading, updatedAt, reload: () => setNonce((n) => n + 1) };
}
