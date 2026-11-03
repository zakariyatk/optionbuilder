import type { ChainRow, ChainSide } from '../api/types';
import { normCdf } from './blackScholes';
import { breakevens, pnlAtExpiry, pnlOnDate, strategyGreeks } from './payoff';
import { NSE_MODEL, type PricingModel } from './pricing';
import { isLinear, type Greeks, type Leg } from './types';

/**
 * Probability and scenario analysis for the strategy builder: chance of
 * profit, expected value and expected move under a lognormal model of the
 * underlying at expiry, plus the price × date grid behind the P&L heatmap.
 * Drift is ignored (zero-mean log return), which is the usual broker
 * convention for "probability of profit".
 */

/** One-standard-deviation move of the underlying by expiry, in price points. */
export function expectedMove(spot: number, ivPct: number | null, years: number): number | null {
  if (!(spot > 0) || !ivPct || ivPct <= 0 || !(years > 0)) return null;
  return spot * (ivPct / 100) * Math.sqrt(years);
}

/** P(S_T ≤ x) for a lognormal with zero-drift median at `spot` and total volatility `sigma`. */
function cdfAt(spot: number, sigma: number, x: number): number {
  if (x <= 0) return 0;
  if (!Number.isFinite(x)) return 1;
  return normCdf((Math.log(x / spot) + (sigma * sigma) / 2) / sigma);
}

/**
 * Chance the strategy ends with a profit at expiry. Exact for the piecewise-linear
 * expiry payoff: the price line splits at the breakevens, and each profitable
 * segment contributes its lognormal probability mass.
 */
export function probabilityOfProfit(legs: Leg[], spot: number, ivPct: number | null, years: number): number | null {
  if (legs.length === 0 || !(spot > 0) || !ivPct || ivPct <= 0 || !(years > 0)) return null;
  const sigma = (ivPct / 100) * Math.sqrt(years);
  const edges = [0, ...breakevens(legs).filter((b) => b > 0), Infinity];
  let p = 0;
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i];
    const hi = edges[i + 1];
    const probe = !Number.isFinite(hi) ? Math.max(lo * 1.5, spot * 2) : lo === 0 ? hi / 2 : (lo + hi) / 2;
    if (pnlAtExpiry(legs, probe) > 1e-9) p += cdfAt(spot, sigma, hi) - cdfAt(spot, sigma, lo);
  }
  return Math.min(Math.max(p, 0), 1);
}

/** A price interval; null ends are open (down to zero, or up without limit). */
export interface Zone {
  lo: number | null;
  hi: number | null;
}

const optionStrikes = (legs: Leg[]) =>
  Array.from(new Set(legs.filter((l) => !isLinear(l.type)).map((l) => l.strike))).sort((a, b) => a - b);

/** Price ranges where the expiry P&L is positive. */
export function profitZones(legs: Leg[]): Zone[] {
  if (legs.length === 0) return [];
  const edges = breakevens(legs).filter((b) => b > 0);
  const cuts = [0, ...edges, Infinity];
  const zones: Zone[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const lo = cuts[i];
    const hi = cuts[i + 1];
    const probe = !Number.isFinite(hi) ? Math.max(lo * 1.5, (optionStrikes(legs).at(-1) ?? lo) * 1.5, 1) : lo === 0 ? hi / 2 : (lo + hi) / 2;
    if (pnlAtExpiry(legs, probe) > 1e-9) zones.push({ lo: lo === 0 ? null : lo, hi: Number.isFinite(hi) ? hi : null });
  }
  return zones;
}

/**
 * Where the expiry payoff reaches `value` (its max profit or max loss, both
 * finite): runs of adjacent strikes that attain it, widened to an open end
 * when the payoff stays flat past the lowest or highest strike. An iron
 * condor's max loss is two zones — below the put wing and above the call wing.
 */
export function extremeZones(legs: Leg[], value: number): Zone[] {
  const kinks = [0, ...optionStrikes(legs)];
  const tol = Math.max(1e-6, Math.abs(value) * 1e-9);
  const hit = kinks.map((k) => Math.abs(pnlAtExpiry(legs, k) - value) <= tol);
  const top = kinks.length - 1;
  const flatAbove = Math.abs(pnlAtExpiry(legs, kinks[top] * 2 + 1) - value) <= tol;
  const zones: Zone[] = [];
  for (let i = 0; i <= top; i++) {
    if (!hit[i]) continue;
    let j = i;
    while (j < top && hit[j + 1]) j++;
    zones.push({ lo: i === 0 ? null : kinks[i], hi: j === top && flatAbove ? null : kinks[j] });
    i = j;
  }
  return zones;
}

/** Inverse standard normal CDF — Acklam's rational approximation, ~1e-9 relative error. */
export function normInv(u: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lowTail = 0.02425;
  if (u <= 0) return -Infinity;
  if (u >= 1) return Infinity;
  if (u < lowTail) {
    const q = Math.sqrt(-2 * Math.log(u));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (u > 1 - lowTail) {
    const q = Math.sqrt(-2 * Math.log(1 - u));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = u - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Average expiry P&L over the lognormal distribution (quantile sampling). */
export function expectedValue(legs: Leg[], spot: number, ivPct: number | null, years: number, samples = 400): number | null {
  if (legs.length === 0 || !(spot > 0) || !ivPct || ivPct <= 0 || !(years > 0)) return null;
  const sigma = (ivPct / 100) * Math.sqrt(years);
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const z = normInv((i + 0.5) / samples);
    sum += pnlAtExpiry(legs, spot * Math.exp(-(sigma * sigma) / 2 + sigma * z));
  }
  return sum / samples;
}

/** Legs with every IV multiplied by `factor` — the "what if IV moves" slider. */
export function scaleIv(legs: Leg[], factor: number): Leg[] {
  if (factor === 1) return legs;
  return legs.map((l) => (l.iv ? { ...l, iv: l.iv * factor } : l));
}

/**
 * Up to `maxCols` dates from now to expiry for the heatmap columns: now, then
 * evenly spaced calendar days, always ending on the expiry itself.
 */
export function heatmapDates(nowMs: number, expiryMs: number, maxCols = 12): number[] {
  if (!(expiryMs > nowMs)) return [nowMs];
  const DAY = 86_400_000;
  const days = Math.ceil((expiryMs - nowMs) / DAY);
  const cols = Math.min(maxCols, days + 1);
  if (cols <= 1) return [nowMs, expiryMs];
  const out: number[] = [];
  for (let i = 0; i < cols - 1; i++) {
    const t = nowMs + Math.round((i * days) / (cols - 1)) * DAY;
    // A column within half a day of expiry would repeat the expiry's date.
    if (i === 0 || t <= expiryMs - DAY / 2) out.push(t);
  }
  return Array.from(new Set([...out, expiryMs]));
}

/** Price rows for the heatmap: centred on spot, `step` apart, highest first. */
export function heatmapPrices(spot: number, step: number, rows: number): number[] {
  const centre = Math.round(spot / step) * step;
  const half = Math.floor(rows / 2);
  return Array.from({ length: half * 2 + 1 }, (_, i) => centre + (half - i) * step).filter((p) => p > 0);
}

/** P&L for every (price, date) pair; dates at or past the nearest expiry use the expiry payoff. */
export function heatmapGrid(
  legs: Leg[],
  prices: number[],
  dates: number[],
  fallbackIv: number | null,
  expiryMs: number | null,
  model: PricingModel = NSE_MODEL,
): number[][] {
  return prices.map((price) =>
    dates.map((t) =>
      expiryMs !== null && t >= expiryMs ? pnlAtExpiry(legs, price) : (pnlOnDate(legs, price, new Date(t), fallbackIv, model) ?? pnlAtExpiry(legs, price)),
    ),
  );
}

export type GreekKey = keyof Greeks;

/** Position Greek at each price on `date` — the overlay curve on the payoff chart. */
export function greekCurve(
  legs: Leg[],
  prices: number[],
  date: Date,
  fallbackIv: number | null,
  key: GreekKey,
  model: PricingModel = NSE_MODEL,
): { price: number; value: number }[] {
  return prices.map((price) => ({ price, value: strategyGreeks(legs, price, fallbackIv, date, model)?.[key] ?? 0 }));
}

/** Mid of bid / ask when both are quoted, else the last traded price. */
export function sideMid(side: ChainSide | null | undefined): number | null {
  if (!side) return null;
  if (side.bid > 0 && side.ask > 0) return (side.bid + side.ask) / 2;
  return side.ltp > 0 ? side.ltp : null;
}

/** The chain row and side a leg trades, when the leg is an option on the chain's expiry. */
export function chainSideFor(leg: Leg, rows: ChainRow[] | null | undefined, chainExpiry: string | null): ChainSide | null {
  if (!rows || isLinear(leg.type) || (leg.expiry && chainExpiry && leg.expiry !== chainExpiry)) return null;
  const row = rows.find((r) => r.strike === leg.strike);
  return (leg.type === 'CE' ? row?.call : row?.put) ?? null;
}

/**
 * Moves an option leg `steps` strikes along the chain and re-prices it from the
 * chain at its new strike. Legs off the chain's expiry, or that would run off
 * its end, are returned unchanged.
 */
export function shiftLegStrike(leg: Leg, rows: ChainRow[], chainExpiry: string | null, steps: number): Leg {
  if (isLinear(leg.type) || rows.length === 0 || (leg.expiry && chainExpiry && leg.expiry !== chainExpiry)) return leg;
  const strikes = rows.map((r) => r.strike);
  let i = strikes.indexOf(leg.strike);
  if (i < 0) {
    // Not on the chain (typed by hand): snap to the nearest listed strike first.
    i = strikes.reduce((best, s, j) => (Math.abs(s - leg.strike) < Math.abs(strikes[best] - leg.strike) ? j : best), 0);
    steps = 0;
  }
  const row = rows[i + steps];
  if (!row) return leg;
  const side = leg.type === 'CE' ? row.call : row.put;
  return {
    ...leg,
    strike: row.strike,
    premium: Number((sideMid(side) ?? leg.premium).toFixed(2)),
    iv: side?.iv ?? leg.iv,
    instrumentKey: side?.instrumentKey ?? null,
    expiry: leg.expiry ?? chainExpiry,
  };
}
