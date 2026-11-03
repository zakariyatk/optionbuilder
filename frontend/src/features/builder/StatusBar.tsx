import { useEffect, useState } from 'react';
import { marketOpen } from '../../lib/nse';
import { useMarket } from './market';

/** Market session, quote source and freshness, and the model behind the numbers. */
export function StatusBar({ updatedAt, source }: { updatedAt: number | null; source: string }) {
  const mk = useMarket();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const open = marketOpen(mk.session, new Date(now));
  const secs = updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null;
  const stale = secs !== null && secs > (mk.id === 'US' ? 300 : 60) && open;
  const exchange = mk.id === 'US' ? 'US market' : 'NSE';
  const model =
    mk.id === 'US'
      ? `Black-Scholes · r ${(mk.model.rate * 100).toFixed(2)}% · q ${(mk.model.dividendYield * 100).toFixed(2)}% · 100-share contracts`
      : `Black-Scholes · r ${(mk.model.rate * 100).toFixed(1)}%`;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[var(--border)] bg-[var(--surface-card)] px-3 py-1.5 text-[11px] text-[var(--text-muted)]">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: open ? 'var(--good)' : 'var(--text-muted)' }} aria-hidden="true" />
        {exchange} {open ? 'open' : 'closed'}
      </span>
      <span aria-hidden="true">·</span>
      <span className="tabular" style={{ color: stale ? 'var(--warning)' : undefined }}>
        {source}
        {secs !== null && ` · updated ${secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m`} ago`}
      </span>
      <span className="ml-auto tabular">{model} · estimates, not advice</span>
    </div>
  );
}
