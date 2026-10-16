import { bsPrice } from '../../domain/blackScholes';
import { expiryCurve, strategyMetrics, type PayoffPoint } from '../../domain/payoff';
import { TEMPLATES, type StrategyTemplate } from '../../domain/templates';
import type { Leg } from '../../domain/types';

/**
 * The landing page's sample strategy, priced and measured with the same code
 * the builder uses, so every number in the preview is self-consistent.
 */
export const DEMO_SPOT = 24626.15;
export const DEMO_CHANGE_PCT = 0.62;
const LOT = 65; // NIFTY lot size, as in api/lib/symbols.php

export const DEMO_LEGS: Leg[] = [
  { id: 'b', action: 'BUY', type: 'CE', strike: 24600, premium: 185.5, lots: 1, lotSize: LOT },
  { id: 's', action: 'SELL', type: 'CE', strike: 24800, premium: 102.3, lots: 1, lotSize: LOT },
];

export const demoMetrics = strategyMetrics(DEMO_LEGS, DEMO_SPOT, 'NIFTY');
export const demoCurve: PayoffPoint[] = expiryCurve(DEMO_LEGS, 24200, 25200, 60);

/** Expiry payoff for a template around a notional ATM, for the strategy cards' thumbnails. */
export function templateCurve(t: StrategyTemplate): PayoffPoint[] {
  const atm = 24600;
  const step = 100;
  const years = 14 / 365;
  const legs: Leg[] = t.legs.map((l, i) => {
    const strike = atm + l.offset * step;
    return { id: String(i), action: l.action, type: l.type, strike, premium: bsPrice(l.type, atm, strike, years, 0.13), lots: 1, lotSize: 1 };
  });
  return expiryCurve(legs, atm - 700, atm + 700, 40);
}

export const STRATEGY_CARDS = TEMPLATES.map((t) => ({ template: t, curve: templateCurve(t) }));
