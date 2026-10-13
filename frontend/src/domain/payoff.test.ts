import { describe, expect, it } from 'vitest';
import { bsGreeks, bsPrice, impliedVol, normCdf } from './blackScholes';
import { breakevens, calibrateLegs, pnlAtExpiry, pnlOnDate, strategyGreeks, strategyMetrics } from './payoff';
import type { Leg } from './types';

let n = 0;
const leg = (p: Partial<Leg>): Leg => ({
  id: String(n++),
  action: 'BUY',
  type: 'CE',
  strike: 100,
  premium: 0,
  lots: 1,
  lotSize: 1,
  ...p,
});

describe('normCdf', () => {
  it('matches known values', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
});

describe('bsPrice', () => {
  it('matches a textbook value (S=100 K=100 T=1 σ=20% r=5%)', () => {
    expect(bsPrice('CE', 100, 100, 1, 0.2, 0.05)).toBeCloseTo(10.4506, 3);
    expect(bsPrice('PE', 100, 100, 1, 0.2, 0.05)).toBeCloseTo(5.5735, 3);
  });

  it('satisfies put-call parity', () => {
    const [S, K, T, v, r] = [24250, 24300, 30 / 365, 0.13, 0.07];
    const lhs = bsPrice('CE', S, K, T, v, r) - bsPrice('PE', S, K, T, v, r);
    expect(lhs).toBeCloseTo(S - K * Math.exp(-r * T), 6);
  });

  it('returns intrinsic value at expiry', () => {
    expect(bsPrice('CE', 110, 100, 0, 0.2)).toBe(10);
    expect(bsPrice('PE', 110, 100, 0, 0.2)).toBe(0);
  });
});

describe('bsGreeks', () => {
  it('ATM call delta is a bit above 0.5, put delta = call delta − 1', () => {
    const c = bsGreeks('CE', 100, 100, 1, 0.2, 0.05);
    const p = bsGreeks('PE', 100, 100, 1, 0.2, 0.05);
    expect(c.delta).toBeCloseTo(0.6368, 3);
    expect(p.delta).toBeCloseTo(c.delta - 1, 9);
    expect(c.gamma).toBeCloseTo(p.gamma, 9);
    expect(c.theta).toBeLessThan(0);
  });
});

describe('expiry payoff', () => {
  it('long call', () => {
    const l = leg({ strike: 100, premium: 5 });
    expect(pnlAtExpiry([l], 90)).toBe(-5);
    expect(pnlAtExpiry([l], 110)).toBe(5);
  });

  it('bull call spread: capped both sides with one breakeven', () => {
    const legs = [
      leg({ action: 'BUY', strike: 100, premium: 6, lotSize: 50 }),
      leg({ action: 'SELL', strike: 110, premium: 2, lotSize: 50 }),
    ];
    const m = strategyMetrics(legs, 100, 'NIFTY');
    expect(m.maxLoss).toBe(-200);
    expect(m.maxProfit).toBe(300);
    expect(m.breakevens).toEqual([104]);
    expect(m.netPremium).toBe(-200);
    expect(m.isDefinedRisk).toBe(true);
    expect(m.riskRewardRatio).toBeCloseTo(1.5);
  });

  it('short straddle: unlimited loss, two breakevens', () => {
    const legs = [
      leg({ action: 'SELL', type: 'CE', strike: 100, premium: 5 }),
      leg({ action: 'SELL', type: 'PE', strike: 100, premium: 5 }),
    ];
    const m = strategyMetrics(legs, 100, 'NIFTY');
    expect(m.maxProfit).toBe(10);
    expect(m.maxLoss).toBeNull();
    expect(m.isDefinedRisk).toBe(false);
    expect(breakevens(legs)).toEqual([90, 110]);
    expect(m.marginEstimate).toBeGreaterThan(0);
  });

  it('long call has unlimited profit and a breakeven beyond the last strike', () => {
    const m = strategyMetrics([leg({ strike: 100, premium: 5 })], 100, 'NIFTY');
    expect(m.maxProfit).toBeNull();
    expect(m.maxLoss).toBe(-5);
    expect(m.breakevens).toEqual([105]);
  });

  it('covered call reports stock outlay and premium yield', () => {
    const legs = [
      leg({ action: 'BUY', type: 'EQ', strike: 0, premium: 1000, lotSize: 100 }),
      leg({ action: 'SELL', type: 'CE', strike: 1050, premium: 20, lotSize: 100 }),
    ];
    const m = strategyMetrics(legs, 1000, 'RELIANCE');
    expect(m.equityOutlay).toBe(100_000);
    expect(m.premiumYield).toBeCloseTo(0.02);
    expect(m.maxProfit).toBe(7000);
  });
});

describe('target-date curve', () => {
  it('is null when no option leg has IV to price with', () => {
    expect(pnlOnDate([leg({ strike: 100, premium: 5 })], 100, new Date(), null)).toBeNull();
  });

  it('a long option before expiry is worth more than at expiry', () => {
    const l = leg({ strike: 100, premium: 5, iv: 20, expiry: '2099-12-31' });
    const today = pnlOnDate([l], 100, new Date('2099-01-01T00:00:00Z'), null)!;
    expect(today).toBeGreaterThan(pnlAtExpiry([l], 100));
  });
});

describe('strategyGreeks', () => {
  it('straddle is roughly delta-neutral, long vega, short theta', () => {
    const exp = '2099-12-31';
    const g = strategyGreeks(
      [
        leg({ type: 'CE', strike: 100, iv: 20, expiry: exp }),
        leg({ type: 'PE', strike: 100, iv: 20, expiry: exp }),
      ],
      100,
      null,
      new Date('2099-12-01T00:00:00Z'),
    )!;
    // Not exactly zero: the 7% rate drift pushes an ATM call's delta a little above 0.5.
    expect(Math.abs(g.delta)).toBeLessThan(0.15);
    expect(g.vega).toBeGreaterThan(0);
    expect(g.theta).toBeLessThan(0);
  });

  it('stock legs contribute delta of one per share', () => {
    const g = strategyGreeks([leg({ type: 'EQ', lotSize: 100 })], 100, null)!;
    expect(g.delta).toBe(100);
  });
});

describe('impliedVol', () => {
  it('recovers the volatility a price was made with', () => {
    const price = bsPrice('CE', 24200, 24300, 20 / 365, 0.13);
    expect(impliedVol('CE', 24200, 24300, 20 / 365, price)).toBeCloseTo(0.13, 5);
  });

  it('gives up on prices no volatility can produce', () => {
    expect(impliedVol('CE', 110, 100, 0.1, 5)).toBeNull(); // below intrinsic 10
    expect(impliedVol('PE', 100, 100, 0, 3)).toBeNull(); // expired
  });
});

describe('calibrateLegs', () => {
  const now = new Date('2026-10-13T06:00:00Z');
  const option = (p: Partial<Leg>) => leg({ strike: 24300, lotSize: 65, expiry: '2026-10-27', iv: 25, ...p });

  it('projects zero P&L now when the market price equals the entry price', () => {
    // A stale 25% IV would price this leg well above its 80 premium and show a fake loss on the short.
    const legs = [option({ action: 'SELL', premium: 80 })];
    expect(Math.abs(pnlOnDate(legs, 24200, now, null)!)).toBeGreaterThan(100);
    const calibrated = calibrateLegs(legs, 24200, now);
    expect(pnlOnDate(calibrated, 24200, now, null)!).toBeCloseTo(0, 2);
  });

  it('projects the mark-to-market P&L now when the market has moved', () => {
    const legs = [option({ action: 'BUY', premium: 80 })];
    const calibrated = calibrateLegs(legs, 24200, now, [95]);
    expect(pnlOnDate(calibrated, 24200, now, null)!).toBeCloseTo((95 - 80) * 65, 2);
  });
});
