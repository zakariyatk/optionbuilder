import { useMemo } from 'react';
import { api } from '../../api/client';
import type { Draft } from '../../api/types';
import { draftKeys } from '../../domain/drafts';
import { useAsync } from '../../hooks/useAsync';

const DRAFT_POLL_MS = 5_000;

export const dateTime = (ms: number) =>
  new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

/** Live quotes for every leg of every open draft, polled while the page is visible. */
export function useDraftQuotes(drafts: Draft[], brokerConnected: boolean) {
  const keys = useMemo(() => draftKeys(drafts), [drafts]);
  return useAsync(() => api.quotes(keys), [keys.join(',')], { pollMs: DRAFT_POLL_MS, enabled: brokerConnected && keys.length > 0 });
}
