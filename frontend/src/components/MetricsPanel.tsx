import type { Greeks, StrategyMetrics } from '../domain/types';
import { inr, num } from '../lib/format';
import { Card, Stat } from './ui';

function riskReward(m: StrategyMetrics, hasLegs: boolean): string {
  if (!hasLegs) return '—';
  if (m.riskRewardRatio !== null) return `1 : ${m.riskRewardRatio.toFixed(2)}`;
  if (m.maxProfit === null || m.maxLoss === null) return 'Unlimited';
  return m.maxLoss === 0 ? 'No risk' : '—';
}

function GreeksRow({ greeks }: { greeks: Greeks | null }) {
  if (!greeks) return null;
  const signed = (v: number, d: number) => `${v >= 0 ? '+' : ''}${num(v, d)}`;
  return (
    <div className="mt-4 grid grid-cols-2 gap-4 border-t border-[var(--border)] pt-3 sm:grid-cols-4">
      <Stat label="Delta" value={signed(greeks.delta, 1)} hint="₹ per 1-pt move" />
      <Stat label="Gamma" value={signed(greeks.gamma, 3)} hint="Δ change per pt" />
      <Stat label="Theta" value={signed(greeks.theta, 0)} hint="₹ per day" tone={greeks.theta >= 0 ? 'good' : 'critical'} />
      <Stat label="Vega" value={signed(greeks.vega, 0)} hint="₹ per 1% IV" />
    </div>
  );
}

export function MetricsPanel({
  metrics: m,
  greeks,
  hasLegs,
  brokerMargin,
  marginLoading,
}: {
  metrics: StrategyMetrics;
  greeks: Greeks | null;
  hasLegs: boolean;
  brokerMargin: number | null;
  marginLoading: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Max profit" value={m.maxProfit === null ? 'Unlimited' : inr(m.maxProfit)} tone="good" />
        <Stat label="Max loss" value={m.maxLoss === null ? 'Unlimited' : inr(Math.abs(m.maxLoss))} tone="critical" />
        <Stat label="Risk : Reward" value={riskReward(m, hasLegs)} />
        <Stat
          label="Breakeven"
          value={
            m.breakevens.length === 0
              ? '—'
              : m.breakevens.map((b) => b.toLocaleString('en-IN', { maximumFractionDigits: 1 })).join(', ')
          }
        />
        <Stat
          label={m.netPremium >= 0 ? 'Net credit received' : 'Net debit paid'}
          value={inr(Math.abs(m.netPremium))}
          tone={m.netPremium >= 0 ? 'good' : 'critical'}
        />
        <Stat
          label={brokerMargin === null ? 'Est. capital required' : 'Margin required (Upstox)'}
          value={marginLoading && brokerMargin === null ? '…' : inr(brokerMargin ?? m.marginEstimate)}
        />
        {m.equityOutlay > 0 && (
          <>
            <Stat label="Stock outlay" value={inr(m.equityOutlay)} />
            <Stat
              label="Premium yield on stock"
              value={m.premiumYield === null ? '—' : `${(m.premiumYield * 100).toFixed(2)}%`}
              tone={m.premiumYield === null ? undefined : 'good'}
            />
          </>
        )}
      </div>

      {hasLegs && <GreeksRow greeks={greeks} />}

      <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
        {brokerMargin === null
          ? `Margin is a ${m.isDefinedRisk ? 'defined-risk (max-loss based)' : 'naked-write, formula-based'} estimate, not your broker's exact SPAN + exposure figure — connect Upstox, or confirm with your broker's margin calculator, before placing the trade.`
          : 'Margin is the live SPAN + exposure figure from Upstox for these exact contracts.'}
        {hasLegs && greeks && ' Greeks use Black-Scholes with each leg’s IV (ATM IV where a leg has none).'}
      </p>
    </Card>
  );
}
