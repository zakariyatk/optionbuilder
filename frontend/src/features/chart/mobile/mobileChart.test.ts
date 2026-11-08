import { describe, expect, it, vi } from 'vitest';

// The prefs store persists to localStorage; give it an in-memory one (before the imports below run).
vi.hoisted(() => {
  const data = new Map<string, string>();
  globalThis.localStorage ??= {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
});
import { alignCloses, barSpan, rebase } from '../compare';
import { heikinAshi } from '../heikinAshi';
import { paramLabel, parseParam, indicatorInfo } from './indicatorCatalog';
import { prefsFor, useMobilePrefs } from './mobilePrefs';
import { barTime, priceStep } from './mobileChartUtils';

describe('heikin ashi', () => {
  it('averages the bar for the close and the previous HA body for the open', () => {
    const ha = heikinAshi([
      { open: 10, high: 14, low: 8, close: 12 },
      { open: 12, high: 16, low: 11, close: 15 },
    ]);
    expect(ha[0]).toEqual({ open: 11, close: 11, high: 14, low: 8 });
    expect(ha[1].open).toBe(11);
    expect(ha[1].close).toBe(13.5);
    expect(ha[1].high).toBe(16);
    expect(ha[1].low).toBe(11);
  });

  it('stretches the wick to cover the HA body', () => {
    const [, b] = heikinAshi([
      { open: 100, high: 101, low: 99, close: 100 },
      { open: 90, high: 91, low: 89, close: 90 },
    ]);
    expect(b.high).toBe(100);
    expect(b.low).toBe(89);
  });
});

describe('compare', () => {
  it("takes the other symbol's latest close within each bar", () => {
    const times = [0, 60, 120, 180];
    expect(alignCloses(times, [[30, 5], [130, 7]], 60)).toEqual([5, 5, 7, 7]);
    expect(alignCloses(times, [[100, 5]], 60)).toEqual([null, 5, 5, 5]);
  });

  it('rebases on the first bar with a value', () => {
    expect(rebase([null, 50, 55], [99, 100, 104], 0)).toEqual([null, 100, 110]);
    expect(rebase([50, 25], [100, 200], 1)).toEqual([400, 200]);
    expect(rebase([null, null], [1, 2], 0)).toEqual([null, null]);
  });

  it('reads the bar length from the commonest gap', () => {
    expect(barSpan([0, 60, 120, 1000, 1060])).toBe(60);
    expect(barSpan([5])).toBe(60_000);
  });
});

describe('alert price step', () => {
  it('is a tidy number near 0.1% of the price', () => {
    expect(priceStep(24150)).toBe(20);
    expect(priceStep(1172)).toBe(1);
    expect(priceStep(88.7)).toBeCloseTo(0.05);
    expect(priceStep(0)).toBe(1);
  });
});

describe('indicator settings', () => {
  it('names the fields', () => {
    expect(paramLabel(indicatorInfo('MACD'), 2)).toBe('Signal length');
    expect(paramLabel(indicatorInfo('MA'), 1)).toBe('Line 2 length');
    expect(paramLabel(undefined, 0)).toBe('Value 1');
  });

  it('accepts positive numbers only, whole ones where the setting is', () => {
    expect(parseParam('14', true)).toBe(14);
    expect(parseParam('14.6', true)).toBe(15);
    expect(parseParam('0.02', false)).toBe(0.02);
    expect(parseParam('', true)).toBeNull();
    expect(parseParam('-3', true)).toBeNull();
    expect(parseParam('abc', false)).toBeNull();
  });
});

describe('readout time', () => {
  it('shows IST, with the time only for intraday bars', () => {
    // 15 Oct 2026 10:45 IST = 05:15 UTC
    const t = Date.UTC(2026, 9, 15, 5, 15);
    expect(barTime(t, true)).toBe('Thu 15 Oct 10:45');
    expect(barTime(t, false)).toBe("Thu 15 Oct '26");
  });
});

describe('phone chart preferences', () => {
  it('keeps interval, chart type and compare list per symbol', () => {
    const s = useMobilePrefs.getState();
    s.set('NIFTY', { tf: '5m', style: 'heikinashi' });
    s.addCompare('NIFTY', 'BANKNIFTY');
    s.addCompare('NIFTY', 'NIFTY');
    s.addCompare('NIFTY', 'BANKNIFTY');
    const state = useMobilePrefs.getState();
    expect(prefsFor(state, 'NIFTY', 'candles')).toEqual({ tf: '5m', style: 'heikinashi', compare: ['BANKNIFTY'] });
    expect(prefsFor(state, 'TCS', 'bars')).toEqual({ tf: '15m', style: 'bars', compare: [] });
    state.removeCompare('NIFTY', 'BANKNIFTY');
    expect(prefsFor(useMobilePrefs.getState(), 'NIFTY', 'candles').compare).toEqual([]);
  });

  it('allows three compared symbols at most', () => {
    const s = useMobilePrefs.getState();
    for (const c of ['A', 'B', 'C', 'D']) s.addCompare('X', c);
    expect(prefsFor(useMobilePrefs.getState(), 'X', 'candles').compare).toEqual(['A', 'B', 'C']);
  });
});
