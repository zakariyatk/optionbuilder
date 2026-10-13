/**
 * Black-Scholes pricing and Greeks for European options.
 *
 * NSE index options are European-style, so this is the right model for the
 * target-date curve. Stock options are also cash-settled European on NSE.
 */

/** India 91-day T-bill ballpark. Small enough that a stale value barely moves the curve. */
export const RISK_FREE_RATE = 0.07;

/** Standard normal CDF — Abramowitz & Stegun 7.1.26, max error ~1.5e-7. */
export function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return 0.5 * (1 + sign * (1 - poly * Math.exp(-z * z)));
}

export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function d1d2(spot: number, strike: number, years: number, vol: number, rate: number) {
  const sqrtT = Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (rate + (vol * vol) / 2) * years) / (vol * sqrtT);
  return { d1, d2: d1 - vol * sqrtT, sqrtT };
}

/**
 * Option value. `vol` is a decimal (0.14 for 14%), `years` is time to expiry.
 * At or past expiry, or with no volatility, returns intrinsic value.
 */
export function bsPrice(
  type: 'CE' | 'PE',
  spot: number,
  strike: number,
  years: number,
  vol: number,
  rate = RISK_FREE_RATE,
): number {
  if (spot <= 0 || strike <= 0) return 0;
  if (years <= 0 || vol <= 0) return Math.max(type === 'CE' ? spot - strike : strike - spot, 0);

  const { d1, d2 } = d1d2(spot, strike, years, vol, rate);
  const discounted = strike * Math.exp(-rate * years);
  return type === 'CE'
    ? spot * normCdf(d1) - discounted * normCdf(d2)
    : discounted * normCdf(-d2) - spot * normCdf(-d1);
}

export interface UnitGreeks {
  delta: number;
  gamma: number;
  /** Per calendar day */
  theta: number;
  /** Per 1 vol point (1%) */
  vega: number;
}

/** Greeks for one unit (one share-equivalent) of a long option. */
export function bsGreeks(
  type: 'CE' | 'PE',
  spot: number,
  strike: number,
  years: number,
  vol: number,
  rate = RISK_FREE_RATE,
): UnitGreeks {
  if (spot <= 0 || strike <= 0 || years <= 0 || vol <= 0) {
    const itm = type === 'CE' ? spot > strike : spot < strike;
    return { delta: itm ? (type === 'CE' ? 1 : -1) : 0, gamma: 0, theta: 0, vega: 0 };
  }

  const { d1, d2, sqrtT } = d1d2(spot, strike, years, vol, rate);
  const pdf = normPdf(d1);
  const discount = Math.exp(-rate * years);

  const delta = type === 'CE' ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = pdf / (spot * vol * sqrtT);
  const vega = (spot * pdf * sqrtT) / 100;
  const decay = -(spot * pdf * vol) / (2 * sqrtT);
  const thetaYear =
    type === 'CE'
      ? decay - rate * strike * discount * normCdf(d2)
      : decay + rate * strike * discount * normCdf(-d2);

  return { delta, gamma, theta: thetaYear / 365, vega };
}

/**
 * The volatility (decimal) at which Black-Scholes reproduces `price`, by
 * bisection. Null when no volatility can — the price is below intrinsic
 * value, above the spot / strike bound, or there's no time left.
 */
export function impliedVol(
  type: 'CE' | 'PE',
  spot: number,
  strike: number,
  years: number,
  price: number,
  rate = RISK_FREE_RATE,
): number | null {
  if (!(spot > 0) || !(strike > 0) || !(years > 0) || !(price > 0)) return null;
  let lo = 1e-4;
  let hi = 5;
  const f = (v: number) => bsPrice(type, spot, strike, years, v, rate) - price;
  if (f(lo) > 0 || f(hi) < 0) return null;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) hi = mid;
    else lo = mid;
    if (hi - lo < 1e-10) break;
  }
  return (lo + hi) / 2;
}
