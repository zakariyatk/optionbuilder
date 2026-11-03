import { describe, expect, it } from 'vitest';
import { bsGreeks, bsPrice, impliedVol } from './blackScholes';
import { formatExpiry, parseExpiry, yearsToExpiry } from './dates';
import { pnlOnDate, strategyGreeks } from './payoff';
import { NSE_MODEL, usModel, usStrikeStep } from './pricing';
import type { Leg } from './types';
import { modelChain, repairUsChain, stampUsChain, usExpiries, usExpiryStamp } from './usChain';
import type { OptionChain } from '../api/types';

const leg = (p: Partial<Leg>): Leg => ({ id: 'x', action: 'BUY', type: 'CE', strike: 100, premium: 0, lots: 1, lotSize: 100, ...p });

describe('dividend-adjusted Black-Scholes', () => {
  it('keeps put-call parity with a dividend yield', () => {
    const [S, K, T, v, r, q] = [683.4, 690, 31 / 365, 0.18, 0.0405, 0.011];
    const lhs = bsPrice('CE', S, K, T, v, r, q) - bsPrice('PE', S, K, T, v, r, q);
    expect(lhs).toBeCloseTo(S * Math.exp(-q * T) - K * Math.exp(-r * T), 8);
  });

  it('matches a textbook value (Hull: S=100 K=100 T=1 σ=20% r=5% q=3%)', () => {
    expect(bsPrice('CE', 100, 100, 1, 0.2, 0.05, 0.03)).toBeCloseTo(8.652, 2);
  });

  it('is unchanged for India when q defaults to 0', () => {
    expect(bsPrice('CE', 24200, 24300, 0.02, 0.13)).toBe(bsPrice('CE', 24200, 24300, 0.02, 0.13, NSE_MODEL.rate, 0));
  });

  it('recovers the IV it priced with', () => {
    const p = bsPrice('PE', 683.4, 670, 0.1, 0.21, 0.0405, 0.011);
    expect(impliedVol('PE', 683.4, 670, 0.1, p, 0.0405, 0.011)!).toBeCloseTo(0.21, 6);
  });

  it('gives call rho positive and put rho negative', () => {
    expect(bsGreeks('CE', 100, 100, 0.5, 0.2, 0.04, 0.01).rho).toBeGreaterThan(0);
    expect(bsGreeks('PE', 100, 100, 0.5, 0.2, 0.04, 0.01).rho).toBeLessThan(0);
  });

  it('threads the US model through the strategy P&L and Greeks', () => {
    const legs = [leg({ strike: 680, premium: 15, iv: 20, expiry: '2026-12-04T21:00:00Z' })];
    const when = new Date('2026-11-04T15:00:00Z');
    const us = pnlOnDate(legs, 683.4, when, null, usModel(0.011))!;
    const nse = pnlOnDate(legs, 683.4, when, null, NSE_MODEL)!;
    expect(us).not.toBeCloseTo(nse, 0);
    expect(strategyGreeks(legs, 683.4, null, when, usModel(0.011))!.rho).toBeGreaterThan(0);
  });
});

describe('US expiries', () => {
  it('stamps the 16:00 New York close across daylight saving', () => {
    expect(usExpiryStamp('2026-07-17')).toBe('2026-07-17T20:00:00Z');
    expect(usExpiryStamp('2026-12-18')).toBe('2026-12-18T21:00:00Z');
  });

  it('parses and labels stamped expiries on their New York date', () => {
    const s = usExpiryStamp('2026-12-04');
    expect(parseExpiry(s)?.toISOString()).toBe('2026-12-04T21:00:00.000Z');
    expect(formatExpiry(s, new Date('2026-11-01'))).toBe('4 Dec');
    // Time to expiry runs to the US close, not the NSE close (~11 hours later).
    expect(yearsToExpiry(new Date('2026-12-04T15:00:00Z'), s) * 365 * 24).toBeCloseTo(6, 6);
  });

  it('lists upcoming Fridays plus monthlies, in order and unique', () => {
    const list = usExpiries(new Date('2026-11-03T12:00:00Z'));
    expect(list[0]).toBe('2026-11-06T21:00:00Z');
    expect(new Set(list).size).toBe(list.length);
    expect([...list].sort()).toEqual(list);
    expect(list.every((e) => new Date(e).getUTCDay() === 5)).toBe(true);
  });

  it('stamps a Yahoo chain', () => {
    const chain = stampUsChain({ source: 'yahoo', symbol: 'US:SPY', lotSize: 100, underlyingValue: 683, timestamp: '', expiryDates: ['2026-12-04'], expiry: '2026-12-04', rows: [] });
    expect(chain.expiry).toBe('2026-12-04T21:00:00Z');
  });
});

describe('closed-market IV repair', () => {
  const now = new Date('2026-11-03T12:00:00Z');
  const model = usModel(0.0075);
  const expiry = '2026-12-04T21:00:00Z';
  const side = (ltp: number, iv: number) => ({ instrumentKey: null, ltp, change: 0, oi: 0, oiChange: 0, volume: 0, iv, delta: null, theta: null, bid: 0, ask: 0 });
  const chainOf = (rows: OptionChain['rows']): OptionChain => ({ source: 'yahoo', symbol: 'US:SPY', lotSize: 100, underlyingValue: 683, timestamp: '', expiryDates: [expiry], expiry, rows });

  it('solves near-zero IVs from the last traded price', () => {
    const years = yearsToExpiry(now, expiry);
    const ltp = Number(bsPrice('CE', 683.4, 685, years, 0.18, model.rate, model.dividendYield).toFixed(2));
    const { chain, repaired } = repairUsChain(chainOf([{ strike: 685, call: side(ltp, 0.1), put: side(0, 0) }]), 683.4, model, now);
    expect(repaired).toBe(1);
    expect(chain.rows[0].call!.iv!).toBeCloseTo(18, 0);
    // No trade to solve from: cleared, so ATM IV skips it instead of using ~0%.
    expect(chain.rows[0].put!.iv).toBe(0);
  });

  it('leaves plausible Yahoo IVs alone', () => {
    const input = chainOf([{ strike: 685, call: side(14.2, 17.5), put: null }]);
    const { chain, repaired } = repairUsChain(input, 683.4, model, now);
    expect(repaired).toBe(0);
    expect(chain.rows[0].call!.iv).toBe(17.5);
  });
});

describe('model chain fallback', () => {
  it('builds 100-share contracts on the listed strike grid', () => {
    const chain = modelChain('US:SPY', 683.4, 20, null, usModel(0.011), new Date('2026-11-03T12:00:00Z'));
    expect(chain.source).toBe('model');
    expect(chain.lotSize).toBe(100);
    expect(chain.rows[1].strike - chain.rows[0].strike).toBe(usStrikeStep(683.4));
    const atm = chain.rows.find((r) => r.strike === 685)!;
    expect(atm.call!.bid).toBeLessThan(atm.call!.ask);
    expect(atm.call!.iv).toBe(20);
  });

  it('uses the listed US strike spacing', () => {
    expect(usStrikeStep(18)).toBe(0.5);
    expect(usStrikeStep(80)).toBe(1);
    expect(usStrikeStep(185)).toBe(2.5);
    expect(usStrikeStep(683)).toBe(5);
  });
});
