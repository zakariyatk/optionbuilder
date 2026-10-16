import { useEffect, useMemo } from 'react';
import { BellRing, X } from 'lucide-react';
import { api } from '../../api/client';
import { marketOpen, sessionFor } from '../../lib/nse';
import { activeAlerts, useAlerts } from '../../store/alerts';
import { alertDetail, alertTitle, signalAlerts } from './alertSignals';

/** Checks every few seconds while a watched market (NSE or US) trades; a slow heartbeat otherwise. */
const OPEN_POLL_MS = 4_000;
const CLOSED_POLL_MS = 60_000;

/**
 * Watches every waiting price alert, on whatever page you're on, and shows
 * the ones that fired until you dismiss them. Runs while the app is open —
 * there is no server-side alerting.
 */
export function AlertMonitor() {
  const alerts = useAlerts((s) => s.alerts);
  const symbols = useMemo(() => [...new Set(activeAlerts(alerts).map((a) => a.symbol))].sort(), [alerts]);
  const key = symbols.join(',');

  useEffect(() => {
    if (!key) return;
    const list = key.split(',');
    const trading = () => list.some((s) => marketOpen(sessionFor(s)));
    let timer = 0;
    let cancelled = false;
    const check = async () => {
      if (document.visibilityState === 'visible' || trading()) {
        try {
          const { quotes } = await api.watch(list);
          if (cancelled) return;
          const observe = useAlerts.getState().observe;
          for (const q of quotes) if (!('error' in q) && q.price > 0) signalAlerts(observe(q.symbol, q.price));
        } catch {
          /* next check retries */
        }
      }
      if (!cancelled) timer = window.setTimeout(check, trading() ? OPEN_POLL_MS : CLOSED_POLL_MS);
    };
    void check();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [key]);

  const fired = alerts.filter((a) => a.triggeredAt !== null).sort((a, b) => (b.triggeredAt ?? 0) - (a.triggeredAt ?? 0));
  const remove = useAlerts((s) => s.remove);
  if (fired.length === 0) return null;

  return (
    <div
      className="fixed right-3 z-50 flex w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-2"
      style={{ bottom: 'calc(var(--tabbar-h, 0px) + 0.75rem)' }}
      aria-live="assertive"
    >
      {fired.slice(0, 4).map((a) => (
        <div key={a.id} role="alert" className="flex items-start gap-3 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] p-3 shadow-lg">
          <BellRing size={18} className="mt-0.5 shrink-0 text-[var(--warning)]" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{alertTitle(a)}</div>
            <div className="text-xs text-[var(--text-muted)]">{alertDetail(a)}</div>
          </div>
          <button
            type="button"
            onClick={() => remove(a.id)}
            aria-label={`Dismiss alert ${alertTitle(a)}`}
            className="-m-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ))}
      {fired.length > 4 && <div className="text-right text-xs text-[var(--text-muted)]">+{fired.length - 4} more</div>}
    </div>
  );
}
