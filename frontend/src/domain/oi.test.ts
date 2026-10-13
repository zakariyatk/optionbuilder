import { describe, expect, it } from 'vitest';
import type { ChainRow, ChainSide } from '../api/types';
import { fullDayFromChain, isWeekly, mergeWindows, pcr, strikesAround, windowFromHistory, type OiHistory } from './oi';

const side = (oi: number, oiChange: number): ChainSide =>
  ({ instrumentKey: null, ltp: 0, change: 0, oi, oiChange, volume: 0, iv: 0, delta: null, theta: null, bid: 0, ask: 0 }) as ChainSide;

describe('fullDayFromChain', () => {
  it('runs from yesterday’s close to now', () => {
    const [r] = fullDayFromChain([{ strike: 100, call: side(500, 200), put: null }]);
    expect(r.call).toEqual({ start: 300, end: 500 });
    expect(r.put).toEqual({ start: 0, end: 0 });
  });
});

describe('windowFromHistory', () => {
  const h: OiHistory = {
    expiry: '2026-10-21',
    times: [1, 2, 3, 4],
    spot: [10, 11, 12, 13],
    rows: [{ strike: 100, call: { prevOi: 50, oi: [60, null, 80, 90] }, put: null }],
  };

  it('measures from yesterday’s close when the window starts at the open', () => {
    expect(windowFromHistory(h, 0, 3)[0].call).toEqual({ start: 50, end: 90 });
  });

  it('forward-fills minutes without a print', () => {
    expect(windowFromHistory(h, 1, 2)[0].call).toEqual({ start: 60, end: 80 });
  });
});

describe('mergeWindows', () => {
  it('sums expiries per strike', () => {
    const a = [{ strike: 100, call: { start: 1, end: 2 }, put: { start: 3, end: 4 } }];
    const b = [
      { strike: 100, call: { start: 10, end: 20 }, put: { start: 0, end: 0 } },
      { strike: 50, call: { start: 5, end: 5 }, put: { start: 0, end: 1 } },
    ];
    expect(mergeWindows([a, b])).toEqual([
      { strike: 50, call: { start: 5, end: 5 }, put: { start: 0, end: 1 } },
      { strike: 100, call: { start: 11, end: 22 }, put: { start: 3, end: 4 } },
    ]);
  });
});

describe('strikesAround', () => {
  it('takes n strikes each side of ATM, clamped to the chain', () => {
    const strikes = [100, 150, 200, 250, 300];
    expect(strikesAround(strikes, 210, 1)).toEqual({ min: 150, max: 250 });
    expect(strikesAround(strikes, 110, 3)).toEqual({ min: 100, max: 250 });
  });
});

describe('isWeekly / pcr', () => {
  it('marks the last expiry of a month as monthly', () => {
    const e = ['2026-10-14', '2026-10-21', '2026-10-28', '2026-11-04'];
    expect(isWeekly('2026-10-21', e)).toBe(true);
    expect(isWeekly('2026-10-28', e)).toBe(false);
  });

  it('divides put OI by call OI', () => {
    const rows: ChainRow[] = [{ strike: 1, call: side(100, 0), put: side(140, 0) }];
    expect(pcr(rows)).toBeCloseTo(1.4);
  });
});
