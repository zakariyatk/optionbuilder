import { useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { extremeZones, profitZones, type Zone } from '../../domain/analysis';
import { US_COMMISSION_PER_CONTRACT } from '../../domain/pricing';
import { isLinear, type Greeks, type Leg, type StrategyMetrics } from '../../domain/types';
import { num } from '../../lib/format';
import { useMarket, type MarketView } from './market';
import { Segmented } from './parts';

const pct = (v: number, spot: number) => `${v >= spot ? '+' : '−'}${Math.abs(((v - spot) / spot) * 100).toFixed(1)}%`;
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

function zoneText(z: Zone, price: (v: number) => string): string {
  if (z.lo === null && z.hi === null) return 'at any price';
  if (z.lo === null) return `below ${price(z.hi!)}`;
  if (z.hi === null) return `above ${price(z.lo)}`;
  return z.lo === z.hi ? `at ${price(z.lo)}` : `between ${price(z.lo)} and ${price(z.hi)}`;
}

/** One-line summary of where the trade makes money at expiry. */
function profitSentence(zones: Zone[], symbol: string, spot: number | null, expiry: string | null, mk: MarketView): ReactNode {
  const on = expiry ? ` on ${expiry}` : ' at expiry';
  const text = (z: Zone) => zoneText(z, mk.id === 'US' ? (v) => `$${mk.price(v)}` : mk.price);
  if (zones.length === 0) return 'This position does not make a profit at expiry at any price.';
  if (zones.length === 1 && zones[0].lo === null && zones[0].hi === null) return `Profits at any price${on}.`;
  const move = (z: Zone) =>
    spot ? ` (${[z.lo, z.hi].filter((v): v is number => v !== null).map((v) => pct(v, spot)).join(' / ')})` : '';
  if (zones.length === 1) {
    const z = zones[0];
    const verb = z.lo !== null && z.hi !== null ? 'stays' : 'ends';
    return `Profit if ${symbol} ${verb} ${text(z)}${on}${move(z)}.`;
  }
  return `Profit if ${symbol} ends ${zones.map(text).join(' or ')}${on}.`;
}

function Tile({ label, value, hint, tone, tip }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'good' | 'critical'; tip?: string }) {
  return (
    <div className="min-w-0 border-t border-[var(--border)] px-3 py-2.5 odd:border-r">
      <div className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
        {label}
        {tip && (
          <span title={tip} className="cursor-help">
            <Info size={12} aria-label={tip} />
          </span>
        )}
      </div>
      <div className="truncate text-base font-semibold tabular" style={{ color: tone === 'good' ? 'var(--good-text)' : tone === 'critical' ? 'var(--critical)' : undefined }}>
        {value}
      </div>
      {hint && <div className="text-[11px] text-[var(--text-muted)]">{hint}</div>}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="col-span-2 border-t border-[var(--border)] px-3 pb-1 pt-3 text-xs font-semibold">{children}</div>;
}

export function AnalysisPanel({
  legs,
  symbol,
  spot,
  expiryLabel,
  daysLeft,
  metrics: m,
  greeks,
  pop,
  expectedValue,
  expectedMove,
  atmIv,
  margin,
  marginIsBroker,
  marginLoading,
  onOpenChainPage,
  onViewDrafts,
}: {
  legs: Leg[];
  symbol: string;
  spot: number | null;
  expiryLabel: string | null;
  /** Calendar days to the nearest expiry. */
  daysLeft: number | null;
  metrics: StrategyMetrics;
  greeks: Greeks | null;
  pop: number | null;
  expectedValue: number | null;
  expectedMove: number | null;
  atmIv: number | null;
  /** India: margin. US: capital at risk. */
  margin: number | null;
  marginIsBroker: boolean;
  marginLoading: boolean;
  /** India only: the full chain page. */
  onOpenChainPage: (() => void) | null;
  /** India only: draft portfolios. */
  onViewDrafts: (() => void) | null;
}) {
  const mk = useMarket();
  const us = mk.id === 'US';
  const [mode, setMode] = useState<'simple' | 'pro'>('simple');
  const has = legs.length > 0;
  const credit = m.netPremium >= 0;
  const hasOptions = legs.some((l) => l.type === 'CE' || l.type === 'PE');
  const name = mk.display(symbol);
  const zoneFmt = us ? (v: number) => `$${mk.price(v)}` : mk.price;

  const best =
    m.maxProfit === null
      ? `Unlimited as ${name} keeps rising`
      : `${mk.signedMoney(m.maxProfit)} if it ends ${extremeZones(legs, m.maxProfit).map((z) => zoneText(z, zoneFmt)).join(' or ')}`;
  const worst =
    m.maxLoss === null
      ? `Unlimited as ${name} keeps rising`
      : `${mk.signedMoney(m.maxLoss)} if it ends ${extremeZones(legs, m.maxLoss).map((z) => zoneText(z, zoneFmt)).join(' or ')}`;
  const rr = m.riskRewardRatio !== null ? `1 : ${m.riskRewardRatio.toFixed(2)}` : m.maxProfit === null || m.maxLoss === null ? 'Unlimited' : '—';

  // India: margin-based. US: risk-based, as US brokers quote it.
  const marginValue = marginLoading && margin === null ? '…' : margin === null ? '—' : mk.money(margin);
  const returnOnMargin = m.maxProfit !== null && margin && margin > 0 ? `${((m.maxProfit / margin) * 100).toFixed(1)}%` : '—';
  const capitalAtRisk = m.maxLoss === null ? null : Math.abs(m.maxLoss);
  const returnOnRisk = m.maxProfit !== null && capitalAtRisk ? m.maxProfit / capitalAtRisk : null;
  const annualised = returnOnRisk !== null && daysLeft ? returnOnRisk * (365 / Math.max(daysLeft, 1)) : null;
  const optionLegs = legs.filter((l) => !isLinear(l.type));
  const contracts = optionLegs.reduce((n, l) => n + l.lots, 0);
  const commission = contracts * US_COMMISSION_PER_CONTRACT;
  const unitLots = optionLegs.length ? optionLegs.reduce((g, l) => gcd(g, l.lots), optionLegs[0].lots) : 1;
  const sharesPerUnit = unitLots * (optionLegs[0]?.lotSize ?? 100);
  const target = credit && m.netPremium > 0 ? m.netPremium / 2 : null;

  const greekRows = greeks
    ? [
        { sym: 'Δ', name: 'Delta', value: num(greeks.delta, 1), unit: us ? 'shares' : `${mk.currencySymbol} per 1-pt move` },
        { sym: 'Γ', name: 'Gamma', value: num(greeks.gamma, 3), unit: 'Δ per pt' },
        { sym: 'Θ', name: 'Theta', value: mk.signedMoney(greeks.theta), unit: 'per day', tone: greeks.theta >= 0 },
        { sym: 'ν', name: 'Vega', value: mk.signedMoney(greeks.vega), unit: 'per vol point' },
        ...(us ? [{ sym: 'ρ', name: 'Rho', value: mk.signedMoney(greeks.rho), unit: 'per 1% rate' }] : []),
      ]
    : [];

  return (
    <section className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface-card)]" aria-label="Analysis">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <h2 className="text-sm font-semibold">Analysis</h2>
        <Segmented
          label="Detail"
          size="xs"
          value={mode}
          onChange={setMode}
          options={[
            { id: 'simple', label: 'Simple' },
            { id: 'pro', label: 'Pro' },
          ]}
        />
      </div>

      {!has ? (
        <div className="flex flex-1 items-center justify-center px-4 py-10 text-center text-sm text-[var(--text-muted)]">
          Build a position to see what it pays, where it makes money and what it can lose.
        </div>
      ) : (
        <>
          <div className="border-t border-[var(--border)] px-3 py-3">
            {hasOptions && (
              <div className="text-base font-semibold">
                {credit ? 'You receive' : 'You pay'} <span className="tabular">{mk.money(Math.abs(m.netPremium))}</span>.
              </div>
            )}
            <p className="mt-0.5 text-sm text-[var(--text-secondary)]">{profitSentence(profitZones(legs), name, spot, expiryLabel, mk)}</p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-[var(--text-muted)]">Best case</dt>
              <dd className="tabular" style={{ color: 'var(--good-text)' }}>
                {best}
              </dd>
              <dt className="text-[var(--text-muted)]">Worst case</dt>
              <dd className="tabular" style={{ color: 'var(--critical)' }}>
                {worst}
              </dd>
            </dl>
          </div>

          <div className="grid grid-cols-2">
            <Tile label={credit ? 'Net credit' : 'Net debit'} value={mk.money(Math.abs(m.netPremium))} hint={credit ? 'received' : 'paid'} />
            <Tile label="Chance of profit" value={pop === null ? '—' : `${(pop * 100).toFixed(1)}%`} tip="Probability the position ends in profit at expiry, from a lognormal model at ATM implied volatility" />
            <Tile label="Max profit" value={m.maxProfit === null ? 'Unlimited' : mk.signedMoney(m.maxProfit)} tone="good" />
            <Tile label="Max loss" value={m.maxLoss === null ? 'Unlimited' : mk.signedMoney(m.maxLoss)} tone="critical" />
            {mode === 'pro' && (
              <>
                <Tile label="Breakevens" value={m.breakevens.length ? m.breakevens.map((b) => mk.price(b)).join(' · ') : '—'} />
                <Tile
                  label="Expected value"
                  value={expectedValue === null ? '—' : mk.signedMoney(expectedValue)}
                  tone={expectedValue === null ? undefined : expectedValue >= 0 ? 'good' : 'critical'}
                  tip="Average expiry P&L over the lognormal distribution of prices"
                />
                <Tile label="Risk : reward" value={rr} />
                {us ? (
                  <Tile
                    label="Est. commission"
                    value={mk.money(commission)}
                    hint={`${contracts} contract${contracts === 1 ? '' : 's'} × $${US_COMMISSION_PER_CONTRACT.toFixed(2)}`}
                    tip="Opening commission at a typical per-contract rate; many brokers charge $0"
                  />
                ) : (
                  <Tile
                    label={marginIsBroker ? 'Margin (Upstox)' : 'Est. margin'}
                    value={marginValue}
                    tip={marginIsBroker ? 'Live SPAN + exposure from Upstox for these contracts' : 'A formula estimate, not your broker’s exact figure — confirm before trading'}
                  />
                )}

                {us ? (
                  <>
                    <SectionTitle>Income</SectionTitle>
                    <Tile label="Capital at risk" value={capitalAtRisk === null ? 'Unlimited' : mk.money(capitalAtRisk)} tip="The most the position can lose at expiry" />
                    <Tile label="Return on risk" value={returnOnRisk === null ? '—' : `${(returnOnRisk * 100).toFixed(2)}%`} hint="max profit ÷ capital at risk" />
                    <Tile
                      label="Annualised"
                      value={annualised === null ? '—' : `${(annualised * 100).toFixed(1)}%`}
                      hint={daysLeft ? `Assumes you can repeat this trade every ${daysLeft} days` : undefined}
                    />
                    <Tile
                      label="50% profit target"
                      value={target === null ? '—' : `$${(target / sharesPerUnit).toFixed(2)}`}
                      hint={target === null ? 'For credit trades' : `${mk.money(target)} total`}
                      tip="Close when half the credit is captured: buy the spread back at this price per share"
                    />
                  </>
                ) : (
                  <Tile label="Return on margin" value={returnOnMargin} hint="max profit ÷ margin" />
                )}
                <Tile label="Theta" value={greeks ? `${mk.signedMoney(greeks.theta)}/day` : '—'} tone={greeks ? (greeks.theta >= 0 ? 'good' : 'critical') : undefined} />
                <Tile
                  label="Expected move"
                  value={expectedMove === null ? '—' : `±${us ? `$${expectedMove.toFixed(2)}` : Math.round(expectedMove).toLocaleString('en-IN')}`}
                  hint={expectedMove !== null && spot ? `±${((expectedMove / spot) * 100).toFixed(1)}% by expiry` : undefined}
                />
                <Tile label="ATM IV" value={atmIv === null ? '—' : `${atmIv.toFixed(1)}%`} />
                {us && <Tile label="Rate · dividend" value={`${(mk.model.rate * 100).toFixed(2)}% · ${(mk.model.dividendYield * 100).toFixed(2)}%`} tip="Black-Scholes inputs: US risk-free rate and the underlying's dividend yield" />}
                {m.equityOutlay > 0 && (
                  <>
                    <Tile label="Stock outlay" value={mk.money(m.equityOutlay)} />
                    <Tile label="Premium yield" value={m.premiumYield === null ? '—' : `${(m.premiumYield * 100).toFixed(2)}%`} />
                  </>
                )}
              </>
            )}
          </div>

          {mode === 'pro' && greekRows.length > 0 && (
            <div className="border-t border-[var(--border)] px-3 py-2.5">
              <div className="mb-1.5 text-xs font-semibold">
                Greeks <span className="font-normal text-[var(--text-muted)]">{us ? 'position, per share-equivalent' : 'position, rupee terms'}</span>
              </div>
              <table className="w-full text-xs tabular">
                <tbody>
                  {greekRows.map((g) => (
                    <tr key={g.name} className="border-t border-[var(--gridline)] first:border-t-0">
                      <td className="w-7 py-1.5">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-[var(--surface-sunken)] text-[var(--text-secondary)]">{g.sym}</span>
                      </td>
                      <td className="py-1.5">{g.name}</td>
                      <td className="py-1.5 text-right font-semibold" style={{ color: 'tone' in g && g.tone !== undefined ? (g.tone ? 'var(--good-text)' : 'var(--critical)') : undefined }}>
                        {g.value}
                      </td>
                      <td className="w-32 py-1.5 pl-2 text-[var(--text-muted)]">{g.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(onOpenChainPage || onViewDrafts) && (
            <div className="mt-auto border-t border-[var(--border)] px-3 py-2.5 text-xs">
              <div className="mb-1 font-semibold text-[var(--text-muted)]">Next</div>
              <div className="flex flex-col items-start gap-1">
                {onOpenChainPage && (
                  <button type="button" className="text-[var(--series-blue)] hover:underline" onClick={onOpenChainPage}>
                    {name} full option chain with OI and IV →
                  </button>
                )}
                {onViewDrafts && (
                  <button type="button" className="text-[var(--series-blue)] hover:underline" onClick={onViewDrafts}>
                    Track saved strategies in Draft Portfolios →
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
