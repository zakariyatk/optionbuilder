import { useEffect, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import type { SpotQuote, SymbolInfo } from '../api/types';
import { daysToExpiry, formatExpiry } from '../domain/dates';
import { num } from '../lib/format';
import { Card, Skeleton, selectClass } from './ui';

/** "Updated 12s ago" that ticks on its own, so a stalled feed is visible at a glance. */
function Freshness({ at }: { at: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  if (!at) return null;
  const secs = Math.max(0, Math.round((now - at) / 1000));
  const stale = secs > 60;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] tabular" style={{ color: stale ? 'var(--warning)' : 'var(--text-muted)' }}>
      {stale && <TriangleAlert size={14} aria-hidden="true" />}
      Updated {secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m`} ago
    </span>
  );
}

export function MarketBar({
  symbols,
  symbol,
  onSymbolChange,
  expiryDates,
  expiry,
  onExpiryChange,
  spot,
  spotError,
  updatedAt,
}: {
  symbols: SymbolInfo[];
  symbol: string;
  onSymbolChange: (s: string) => void;
  expiryDates: string[];
  expiry: string | null;
  onExpiryChange: (e: string) => void;
  spot: SpotQuote | null;
  spotError: string | null;
  updatedAt: number | null;
}) {
  const change = spot ? spot.price - spot.previousClose : null;
  const changePct = spot && spot.previousClose ? (change! / spot.previousClose) * 100 : null;
  const up = (change ?? 0) >= 0;

  // Keep the current symbol selectable even before /api/symbols has answered.
  const options = symbols.length ? symbols : [{ symbol, label: symbol, lotSize: 0 }];
  const indices = options.filter((s) => ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'].includes(s.symbol));
  const stocks = options.filter((s) => !indices.includes(s));

  return (
    <Card className="flex flex-wrap items-center gap-2 px-3 py-3 sm:gap-3 sm:px-4">
      <label className="sr-only" htmlFor="symbol-select">
        Underlying
      </label>
      <select id="symbol-select" className={`${selectClass} font-medium max-sm:flex-[3_1_0%]`} value={symbol} onChange={(e) => onSymbolChange(e.target.value)}>
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

      <label className="sr-only" htmlFor="expiry-select">
        Expiry
      </label>
      <select
        id="expiry-select"
        className={`${selectClass} max-sm:flex-[2_1_0%]`}
        value={expiry ?? ''}
        disabled={expiryDates.length === 0}
        onChange={(e) => onExpiryChange(e.target.value)}
      >
        {expiryDates.length === 0 && <option value="">No expiry data</option>}
        {expiryDates.map((e) => {
          const dte = daysToExpiry(e);
          return (
            <option key={e} value={e}>
              {formatExpiry(e)}
              {dte !== null ? ` · ${dte}d` : ''}
            </option>
          );
        })}
      </select>

      <div className="ml-1 flex items-baseline gap-2 tabular max-sm:order-last max-sm:ml-0 max-sm:basis-full max-sm:flex-wrap" aria-live="polite">
        {spot ? (
          <>
            <span className="text-lg font-semibold">{spot.price.toLocaleString('en-IN')}</span>
            {change !== null && changePct !== null && (
              <span className="text-sm" style={{ color: up ? 'var(--good-text)' : 'var(--critical)' }}>
                {up ? '+' : ''}
                {num(change)} ({up ? '+' : ''}
                {changePct.toFixed(2)}%)
              </span>
            )}
          </>
        ) : spotError ? (
          <span className="text-sm text-[var(--critical)]" title={spotError}>
            Spot price unavailable
          </span>
        ) : (
          <Skeleton className="h-6 w-36" />
        )}
      </div>

      <div className="ml-auto max-sm:order-last max-sm:-mt-1 max-sm:ml-0">
        <Freshness at={updatedAt} />
      </div>
    </Card>
  );
}
