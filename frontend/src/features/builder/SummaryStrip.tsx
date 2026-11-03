import type { StrategyMetrics } from '../../domain/types';
import { useMarket } from './market';

/** Headline numbers, pinned under the app header while the page scrolls. */
export function SummaryStrip({
  metrics: m,
  pop,
  margin,
  marginIsBroker,
}: {
  metrics: StrategyMetrics;
  pop: number | null;
  /** India: broker or estimated margin. US: capital at risk (max loss). */
  margin: number | null;
  marginIsBroker: boolean;
}) {
  const mk = useMarket();
  const credit = m.netPremium >= 0;
  const us = mk.id === 'US';
  const items: { label: string; value: string; color?: string; title?: string }[] = [
    { label: credit ? 'Net credit' : 'Net debit', value: mk.money(Math.abs(m.netPremium)) },
    { label: 'Max profit', value: m.maxProfit === null ? 'Unlimited' : mk.signedMoney(m.maxProfit), color: 'var(--good-text)' },
    { label: 'Max loss', value: m.maxLoss === null ? 'Unlimited' : mk.signedMoney(m.maxLoss), color: 'var(--critical)' },
    { label: 'Chance of profit', value: pop === null ? '—' : `${Math.round(pop * 100)}%`, title: 'Lognormal probability of a profit at expiry, from implied volatility' },
    us
      ? { label: 'Capital at risk', value: margin === null ? 'Unlimited' : mk.money(margin), title: 'The most the position can lose at expiry' }
      : {
          label: marginIsBroker ? 'Margin (Upstox)' : 'Est. margin',
          value: margin === null ? '—' : mk.money(margin),
          title: marginIsBroker ? 'Live SPAN + exposure from Upstox' : 'Estimate — confirm with your broker',
        },
  ];
  return (
    <div
      className="sticky z-20 -mx-[var(--gutter)] grid grid-cols-3 gap-x-4 gap-y-1 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-page)_88%,transparent)] px-[var(--gutter)] py-2 backdrop-blur sm:grid-cols-5"
      style={{ top: 'calc(var(--header-h) + env(safe-area-inset-top))' }}
    >
      {items.map((it, i) => (
        <div key={it.label} className={`min-w-0 ${i === 4 ? 'max-sm:hidden' : ''} ${i === 3 ? 'max-sm:col-span-3' : ''}`} title={it.title}>
          <div className="truncate text-[11px] text-[var(--text-muted)]">{it.label}</div>
          <div className="truncate text-sm font-semibold tabular" style={{ color: it.color }}>
            {it.value}
          </div>
        </div>
      ))}
    </div>
  );
}
