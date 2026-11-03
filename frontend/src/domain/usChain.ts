import type { ChainRow, ChainSide, OptionChain } from '../api/types';
import { US_SESSION } from '../lib/nse';
import { bsPrice } from './blackScholes';
import { yearsToExpiry } from './dates';
import { US_CONTRACT_SIZE, usStrikeStep, type PricingModel } from './pricing';

/**
 * The model-price fallback for the US builder when Yahoo's chain is
 * unavailable: listed-style expiries and strikes, priced with Black-Scholes
 * at one flat IV the user can adjust. Premiums are theoretical — the UI says so.
 */

const DAY = 86_400_000;

/**
 * A US expiry date (YYYY-MM-DD) as the UTC timestamp of that day's 16:00 New
 * York close — 20:00 or 21:00 UTC with daylight saving — so time to expiry
 * counts down to the real settlement and not the NSE close.
 */
export function usExpiryStamp(date: string): string {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d, 16, 0);
  return new Date(naive - US_SESSION.offsetMs(naive)).toISOString().replace('.000Z', 'Z');
}

/** A Yahoo chain with its expiries stamped at the US close. */
export function stampUsChain(chain: OptionChain): OptionChain {
  return {
    ...chain,
    expiryDates: chain.expiryDates.map(usExpiryStamp),
    expiry: chain.expiry ? usExpiryStamp(chain.expiry) : null,
  };
}

/** The next `weeklies` Friday expiries plus `monthlies` third-Friday monthly expiries, stamped at the US close. */
export function usExpiries(now: Date, weeklies = 8, monthlies = 6): string[] {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const toFriday = (5 - start.getUTCDay() + 7) % 7 || 7;
  const first = start.getTime() + toFriday * DAY;
  const out = new Set<string>();
  for (let i = 0; i < weeklies; i++) out.add(new Date(first + i * 7 * DAY).toISOString().slice(0, 10));
  for (let m = 1; m <= monthlies + 1 && out.size < weeklies + monthlies; m++) {
    const firstOfMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m, 1));
    const third = firstOfMonth.getTime() + (((5 - firstOfMonth.getUTCDay() + 7) % 7) + 14) * DAY;
    if (third > first) out.add(new Date(third).toISOString().slice(0, 10));
  }
  return [...out].sort().map(usExpiryStamp);
}

/** A modelled chain around `spot` for one expiry. */
export function modelChain(
  symbol: string,
  spot: number,
  ivPct: number,
  expiry: string | null,
  model: PricingModel,
  now = new Date(),
  strikesEachSide = 20,
): OptionChain {
  const expiryDates = usExpiries(now);
  const target = expiry && expiryDates.includes(expiry) ? expiry : expiryDates[0];
  const years = Math.max(yearsToExpiry(now, target), 1 / 365);
  const step = usStrikeStep(spot);
  const atm = Math.round(spot / step) * step;
  const vol = ivPct / 100;
  const side = (type: 'CE' | 'PE', strike: number): ChainSide => {
    const mid = Math.max(bsPrice(type, spot, strike, years, vol, model.rate, model.dividendYield), 0.01);
    const half = Math.max(0.005, mid * 0.015);
    return {
      instrumentKey: null,
      ltp: Number(mid.toFixed(2)),
      change: 0,
      oi: 0,
      oiChange: 0,
      volume: 0,
      iv: ivPct,
      delta: null,
      theta: null,
      bid: Number((mid - half).toFixed(2)),
      ask: Number((mid + half).toFixed(2)),
    };
  };
  const rows: ChainRow[] = [];
  for (let i = -strikesEachSide; i <= strikesEachSide; i++) {
    const strike = Math.round((atm + i * step) * 100) / 100;
    if (strike > 0) rows.push({ strike, call: side('CE', strike), put: side('PE', strike) });
  }
  return {
    source: 'model',
    symbol,
    lotSize: US_CONTRACT_SIZE,
    underlyingValue: spot,
    timestamp: now.toISOString(),
    expiryDates,
    expiry: target,
    rows,
    dividendYield: model.dividendYield,
  };
}
