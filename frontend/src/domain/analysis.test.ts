import { describe, expect, it } from 'vitest';
import type { ChainRow } from '../api/types';
import { normCdf } from './blackScholes';
import {
  expectedMove,
  expectedValue,
  extremeZones,
  heatmapDates,
  heatmapGrid,
  heatmapPrices,
  normInv,
  probabilityOfProfit,
  profitZones,
  shiftLegStrike,
  sideMid,
} from './analysis';
import { decodeLegs, encodeLegs, readShared } from './shareLink';
import { matchTemplate, TEMPLATES, templateSketch } from './templates';
import type { Leg } from './types';

let n = 0;
const leg = (p: Partial<Leg>): Leg => ({ id: String(n++), action: 'BUY', type: 'CE', strike: 100, premium: 0, lots: 1, lotSize: 1, ...p });

describe('expectedMove', () => {
  it('is spot × IV × √T', () => {
    expect(expectedMove(100, 20, 1)).toBeCloseTo(20, 9);
    expect(expectedMove(24000, 13, 30 / 365)).toBeCloseTo(24000 * 0.13 * Math.sqrt(30 / 365), 6);
  });
  it('is null without IV or time', () => {
    expect(expectedMove(100, null, 1)).toBeNull();
    expect(expectedMove(100, 20, 0)).toBeNull();
  });
});

describe('probabilityOfProfit', () => {
  it('matches the lognormal tail for a long call', () => {
    // Long 100 call for 5: profit above 105.
    const sigma = 0.2 * Math.sqrt(0.25);
    const expected = 1 - normCdf((Math.log(105 / 100) + (sigma * sigma) / 2) / sigma);
    expect(probabilityOfProfit([leg({ strike: 100, premium: 5 })], 100, 20, 0.25)).toBeCloseTo(expected, 9);
  });

  it('long and short of the same position sum to one', () => {
    const long = [leg({ type: 'PE', strike: 95, premium: 1 }), leg({ type: 'CE', strike: 105, premium: 1 })];
    const short = long.map((l) => ({ ...l, action: 'SELL' as const }));
    const a = probabilityOfProfit(long, 100, 25, 0.1)!;
    const b = probabilityOfProfit(short, 100, 25, 0.1)!;
    expect(a + b).toBeCloseTo(1, 9);
    expect(b).toBeGreaterThan(a);
  });

  it('is 1 for a riskless credit and 0 for a sure loss', () => {
    expect(probabilityOfProfit([leg({ type: 'EQ', strike: 0, premium: 50 })], 100, 20, 0.1)).toBeGreaterThan(0.999);
    expect(probabilityOfProfit([leg({ strike: 100, premium: 1000 })], 100, 20, 0.1)).toBeCloseTo(0, 6);
  });
});

describe('expectedValue', () => {
  it('is close to the Black-Scholes value minus premium for a long call (r = 0)', () => {
    // BS value of an ATM call with σ=20%, T=1, r=0 is ~7.966.
    expect(expectedValue([leg({ strike: 100, premium: 0 })], 100, 20, 1, 4000)!).toBeCloseTo(7.966, 1);
  });
});

describe('zones', () => {
  const condor = [
    leg({ action: 'BUY', type: 'PE', strike: 90, premium: 1 }),
    leg({ action: 'SELL', type: 'PE', strike: 95, premium: 2 }),
    leg({ action: 'SELL', type: 'CE', strike: 105, premium: 2 }),
    leg({ action: 'BUY', type: 'CE', strike: 110, premium: 1 }),
  ];
  it('finds the profit range', () => {
    expect(profitZones(condor)).toEqual([{ lo: 93, hi: 107 }]);
    expect(profitZones([leg({ strike: 100, premium: 5 })])).toEqual([{ lo: 105, hi: null }]);
  });
  it('locates the best and worst case', () => {
    expect(extremeZones(condor, 2)).toEqual([{ lo: 95, hi: 105 }]);
    // Max loss of −3 on both wings: below the put wing, and above the call wing.
    expect(extremeZones(condor, -3)).toEqual([
      { lo: null, hi: 90 },
      { lo: 110, hi: null },
    ]);
    expect(extremeZones([leg({ strike: 100, premium: 5 })], -5)).toEqual([{ lo: null, hi: 100 }]);
  });
});

describe('normInv', () => {
  it('inverts normCdf', () => {
    for (const u of [0.001, 0.02, 0.3, 0.5, 0.8, 0.99]) expect(normCdf(normInv(u))).toBeCloseTo(u, 6);
  });
});

describe('heatmap helpers', () => {
  it('spreads dates from now to expiry, ending on expiry', () => {
    const now = Date.UTC(2026, 10, 3);
    const exp = now + 30 * 86_400_000;
    const dates = heatmapDates(now, exp, 12);
    expect(dates[0]).toBe(now);
    expect(dates[dates.length - 1]).toBe(exp);
    expect(dates.length).toBeLessThanOrEqual(12);
  });
  it('never repeats the expiry date in a day column', () => {
    const now = Date.UTC(2026, 10, 3, 4, 30);
    const exp = Date.UTC(2026, 10, 10, 10);
    const dates = heatmapDates(now, exp, 12);
    const days = dates.map((d) => new Date(d).toISOString().slice(0, 10));
    expect(new Set(days).size).toBe(days.length);
    expect(dates[dates.length - 1]).toBe(exp);
  });
  it('centres price rows on spot, highest first', () => {
    expect(heatmapPrices(24012, 50, 4)).toEqual([24100, 24050, 24000, 23950, 23900]);
  });
  it('uses the expiry payoff at expiry', () => {
    const legs = [leg({ strike: 100, premium: 5, iv: 20, expiry: '2026-12-01' })];
    const exp = Date.UTC(2026, 11, 1, 10);
    const grid = heatmapGrid(legs, [120, 100], [exp], 20, exp);
    expect(grid).toEqual([[15], [-5]]);
  });
});

describe('chain helpers', () => {
  const side = (ltp: number, bid = 0, ask = 0) => ({ instrumentKey: `k${ltp}`, ltp, change: 0, oi: 0, oiChange: 0, volume: 0, iv: 15, delta: null, theta: null, bid, ask });
  const rows: ChainRow[] = [100, 110, 120].map((strike) => ({ strike, call: side(130 - strike, 129 - strike, 131 - strike), put: side(strike - 90) }));

  it('mid uses bid / ask when quoted', () => {
    expect(sideMid(rows[0].call)).toBe(30);
    expect(sideMid(rows[0].put)).toBe(10);
  });
  it('shifts a leg along the chain and re-prices it', () => {
    const moved = shiftLegStrike(leg({ strike: 100, expiry: 'E' }), rows, 'E', 1);
    expect(moved.strike).toBe(110);
    expect(moved.premium).toBe(20);
    expect(moved.instrumentKey).toBe('k20');
    expect(shiftLegStrike(leg({ strike: 120, expiry: 'E' }), rows, 'E', 1).strike).toBe(120);
    expect(shiftLegStrike(leg({ strike: 100, expiry: 'OTHER' }), rows, 'E', 1).strike).toBe(100);
  });
});

describe('templates', () => {
  it('recognises the strategy legs form', () => {
    const condor = [
      leg({ action: 'BUY', type: 'PE', strike: 90 }),
      leg({ action: 'SELL', type: 'PE', strike: 95 }),
      leg({ action: 'SELL', type: 'CE', strike: 105 }),
      leg({ action: 'BUY', type: 'CE', strike: 110 }),
    ];
    expect(matchTemplate(condor)?.id).toBe('iron-condor');
    expect(matchTemplate([leg({ type: 'CE', strike: 100 }), leg({ type: 'PE', strike: 100 })])?.id).toBe('long-straddle');
    expect(matchTemplate([leg({ type: 'CE', strike: 110 }), leg({ type: 'PE', strike: 90 })])?.id).toBe('long-strangle');
    const fly = [leg({ strike: 90 }), leg({ action: 'SELL', strike: 100, lots: 2 }), leg({ strike: 110 })];
    expect(matchTemplate(fly)?.id).toBe('call-butterfly');
    expect(matchTemplate([leg({ type: 'FUT' })])).toBeNull();
  });
  it('sketches every template inside the unit box', () => {
    for (const t of TEMPLATES) {
      const { points, zero } = templateSketch(t);
      expect(zero).toBeGreaterThan(0);
      expect(zero).toBeLessThan(1);
      for (const p of points) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('share links', () => {
  it('round-trips legs', () => {
    const legs = [
      { action: 'SELL' as const, type: 'CE' as const, strike: 24500, premium: 120.5, lots: 2, lotSize: 75, expiry: '2026-11-27', instrumentKey: null, iv: null },
      { action: 'BUY' as const, type: 'EQ' as const, strike: 0, premium: 2950, lots: 1, lotSize: 100, expiry: null, instrumentKey: null, iv: null },
    ];
    expect(decodeLegs(encodeLegs(legs))).toEqual(legs);
    expect(readShared(`?sym=nifty&legs=${encodeURIComponent(encodeLegs(legs))}`)?.symbol).toBe('NIFTY');
  });
  it('round-trips a US leg with a timestamped expiry', () => {
    const legs = [{ action: 'BUY' as const, type: 'PE' as const, strike: 682.5, premium: 4.2, lots: 1, lotSize: 100, expiry: '2026-12-04T21:00:00Z', instrumentKey: null, iv: null }];
    expect(decodeLegs(encodeLegs(legs))).toEqual(legs);
    const shared = readShared(`?sym=US:SPY&legs=${encodeURIComponent(encodeLegs(legs))}`);
    expect(shared?.symbol).toBe('US:SPY');
    expect(shared?.legs[0].expiry).toBe('2026-12-04T21:00:00Z');
  });
  it('rejects malformed input', () => {
    expect(decodeLegs('XX:B:1:2026-01-01:1:1:1')).toBeNull();
    expect(decodeLegs('CE:B:abc::1:1:1')).toBeNull();
    expect(decodeLegs('CE:B:100::1:0:1')).toBeNull();
    expect(readShared('?sym=NIFTY')).toBeNull();
  });
});
