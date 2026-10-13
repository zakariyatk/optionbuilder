import { bsGreeks, bsPrice, impliedVol } from './blackScholes';
import { yearsToExpiry } from './dates';
import { isLinear, type Greeks, type Leg, type StrategyMetrics } from './types';

const direction = (leg: Leg) => (leg.action === 'BUY' ? 1 : -1);
const quantity = (leg: Leg) => leg.lots * leg.lotSize;

/** Per-unit value of a leg's instrument at expiry with the underlying at `price`. */
function valueAtExpiry(leg: Leg, price: number): number {
  if (leg.type === 'CE') return Math.max(price - leg.strike, 0);
  if (leg.type === 'PE') return Math.max(leg.strike - price, 0);
  return price;
}

export function legPnlAtExpiry(leg: Leg, price: number): number {
  return direction(leg) * quantity(leg) * (valueAtExpiry(leg, price) - leg.premium);
}

export function pnlAtExpiry(legs: Leg[], price: number): number {
  return legs.reduce((sum, leg) => sum + legPnlAtExpiry(leg, price), 0);
}

/**
 * Strategy P&L on `date` with the underlying at `price`, valuing options with
 * Black-Scholes. Legs without their own IV fall back to `fallbackIv` (percent).
 * Returns null when no option leg could be priced — the curve would just
 * duplicate the expiry line and mislead.
 */
export function pnlOnDate(legs: Leg[], price: number, date: Date, fallbackIv: number | null): number | null {
  let pricedAny = false;
  const total = legs.reduce((sum, leg) => {
    if (isLinear(leg.type)) return sum + legPnlAtExpiry(leg, price);
    const vol = (leg.iv || fallbackIv || 0) / 100;
    const years = leg.expiry ? yearsToExpiry(date, leg.expiry) : null;
    if (years === null || vol <= 0) return sum + legPnlAtExpiry(leg, price);
    pricedAny = true;
    const value = bsPrice(leg.type as 'CE' | 'PE', price, leg.strike, years, vol);
    return sum + direction(leg) * quantity(leg) * (value - leg.premium);
  }, 0);
  return pricedAny ? total : null;
}

/**
 * Re-prices option legs off the market: each leg's IV becomes the volatility
 * implied by its current market price (`marks[i]`, else its own premium) at
 * `spot` and `now`. Projections then start from the real market — at today's
 * spot and time, P&L is exactly (market − entry) × quantity, as a broker shows
 * it, instead of a model-vs-market gap. Legs that can't be solved keep their IV.
 */
export function calibrateLegs(legs: Leg[], spot: number | null, now: Date, marks?: (number | null | undefined)[]): Leg[] {
  if (!spot || spot <= 0) return legs;
  return legs.map((leg, i) => {
    if (isLinear(leg.type) || !leg.expiry) return leg;
    const mark = marks?.[i] ?? leg.premium;
    const vol = impliedVol(leg.type as 'CE' | 'PE', spot, leg.strike, yearsToExpiry(now, leg.expiry), mark);
    return vol === null ? leg : { ...leg, iv: vol * 100 };
  });
}

export interface PayoffPoint {
  price: number;
  pnl: number;
}

/** Slope of the expiry payoff above the highest strike — the net upside exposure in units. */
function upsideSlope(legs: Leg[]): number {
  return legs.reduce((s, leg) => (leg.type === 'PE' ? s : s + direction(leg) * quantity(leg)), 0);
}

/** The payoff is piecewise linear with kinks only at strikes, so these points pin down its exact shape. */
function kinkPoints(legs: Leg[]): number[] {
  const strikes = legs.filter((l) => !isLinear(l.type)).map((l) => l.strike);
  return Array.from(new Set([0, ...strikes])).sort((a, b) => a - b);
}

export function expiryCurve(legs: Leg[], min: number, max: number, samples = 120): PayoffPoint[] {
  const xs = new Set<number>([min, max, ...kinkPoints(legs).filter((k) => k > min && k < max)]);
  for (let i = 0; i <= samples; i++) xs.add(min + ((max - min) * i) / samples);
  return Array.from(xs)
    .sort((a, b) => a - b)
    .map((price) => ({ price, pnl: pnlAtExpiry(legs, price) }));
}

export function targetDateCurve(
  legs: Leg[],
  prices: number[],
  date: Date,
  fallbackIv: number | null,
): PayoffPoint[] | null {
  if (legs.length === 0) return null;
  const points = prices.map((price) => ({ price, pnl: pnlOnDate(legs, price, date, fallbackIv) }));
  return points.some((p) => p.pnl === null) ? null : (points as PayoffPoint[]);
}

/** Exact breakevens: sign changes between kinks, plus any crossing on the open-ended upside. */
export function breakevens(legs: Leg[]): number[] {
  if (legs.length === 0) return [];
  const xs = kinkPoints(legs);
  const ys = xs.map((x) => pnlAtExpiry(legs, x));
  const found: number[] = [];
  const add = (x: number) => {
    if (!found.some((f) => Math.abs(f - x) < 1e-6)) found.push(x);
  };

  for (let i = 0; i < xs.length; i++) {
    if (Math.abs(ys[i]) < 1e-9) add(xs[i]);
    if (i < xs.length - 1) {
      const [y0, y1] = [ys[i], ys[i + 1]];
      if ((y0 < 0 && y1 > 0) || (y0 > 0 && y1 < 0)) {
        add(xs[i] + ((0 - y0) * (xs[i + 1] - xs[i])) / (y1 - y0));
      }
    }
  }

  const slope = upsideSlope(legs);
  const lastX = xs[xs.length - 1];
  const lastY = ys[ys.length - 1];
  if (Math.abs(slope) > 1e-9) {
    const x = lastX - lastY / slope;
    if (x > lastX && lastY > 0 !== slope > 0) add(x);
  }
  return found.sort((a, b) => a - b);
}

const INDICES = new Set(['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY']);

/**
 * Rough SPAN-like margin for a short option when the broker figure is not
 * available: ~10% (index) / ~18% (stock) of notional, reduced for OTM strikes
 * with a 30% floor. A ballpark only — the UI says so.
 */
function nakedShortMargin(leg: Leg, spot: number, symbol: string): number {
  const rate = INDICES.has(symbol) ? 0.1 : 0.18;
  const moneyness = leg.type === 'CE' ? (spot - leg.strike) / spot : (leg.strike - spot) / spot;
  const otmRelief = Math.min(Math.max(-moneyness, 0), 1) * 0.5 * rate;
  return Math.max(rate - otmRelief, rate * 0.3) * spot * quantity(leg);
}

const EMPTY_METRICS: StrategyMetrics = {
  maxProfit: 0,
  maxLoss: 0,
  breakevens: [],
  netPremium: 0,
  riskRewardRatio: null,
  marginEstimate: 0,
  isDefinedRisk: true,
  equityOutlay: 0,
  premiumYield: null,
};

export function strategyMetrics(legs: Leg[], spot: number, symbol: string): StrategyMetrics {
  if (legs.length === 0) return EMPTY_METRICS;

  const atKinks = kinkPoints(legs).map((x) => pnlAtExpiry(legs, x));
  const slope = upsideSlope(legs);
  const maxProfit = slope > 1e-9 ? null : Math.max(...atKinks);
  const maxLoss = slope < -1e-9 ? null : Math.min(...atKinks);

  const netPremium = legs
    .filter((l) => !isLinear(l.type))
    .reduce((s, l) => s + (l.action === 'SELL' ? 1 : -1) * l.premium * quantity(l), 0);
  const equityOutlay = legs
    .filter((l) => l.type === 'EQ')
    .reduce((s, l) => s + direction(l) * l.premium * quantity(l), 0);

  const isDefinedRisk = maxLoss !== null;
  const marginEstimate = isDefinedRisk
    ? Math.abs(maxLoss)
    : legs
        .filter((l) => l.action === 'SELL' && !isLinear(l.type))
        .reduce((s, l) => s + nakedShortMargin(l, spot, symbol), 0);

  return {
    maxProfit,
    maxLoss,
    breakevens: breakevens(legs),
    netPremium,
    riskRewardRatio: maxProfit !== null && maxLoss !== null && maxLoss !== 0 ? maxProfit / Math.abs(maxLoss) : null,
    marginEstimate,
    isDefinedRisk,
    equityOutlay,
    premiumYield: equityOutlay > 0 && netPremium > 0 ? netPremium / equityOutlay : null,
  };
}

/**
 * Position Greeks for the whole strategy, in rupee terms for its full size.
 * Option legs without an expiry or any IV are skipped (they can't be modelled);
 * FUT/EQ contribute delta 1 per unit.
 */
export function strategyGreeks(
  legs: Leg[],
  spot: number,
  fallbackIv: number | null,
  now = new Date(),
): Greeks | null {
  if (legs.length === 0 || spot <= 0) return null;
  const total: Greeks = { delta: 0, gamma: 0, theta: 0, vega: 0 };
  for (const leg of legs) {
    const units = direction(leg) * quantity(leg);
    if (isLinear(leg.type)) {
      total.delta += units;
      continue;
    }
    const vol = (leg.iv || fallbackIv || 0) / 100;
    const years = leg.expiry ? yearsToExpiry(now, leg.expiry) : 0;
    const g = bsGreeks(leg.type as 'CE' | 'PE', spot, leg.strike, years, vol);
    total.delta += units * g.delta;
    total.gamma += units * g.gamma;
    total.theta += units * g.theta;
    total.vega += units * g.vega;
  }
  return total;
}
