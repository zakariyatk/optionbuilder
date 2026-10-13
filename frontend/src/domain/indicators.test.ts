import { describe, expect, it } from 'vitest';
import { bollinger, ema, heikinAshi, rsi, sma, vwap, type Candle } from './indicators';

describe('sma', () => {
  it('averages the trailing window', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
});

describe('ema', () => {
  it('seeds with the SMA, then weights recent values', () => {
    const out = ema([1, 2, 3, 4], 3);
    expect(out.slice(0, 3)).toEqual([null, null, 2]);
    // k = 0.5 → 4 × 0.5 + 2 × 0.5
    expect(out[3]).toBe(3);
  });
});

describe('bollinger', () => {
  it('is flat for constant prices and widens with variance', () => {
    const flat = bollinger([5, 5, 5, 5], 2, 2);
    expect(flat.upper[3]).toBe(5);
    expect(flat.lower[3]).toBe(5);
    const moving = bollinger([4, 6], 2, 2);
    // mid 5, sd 1
    expect(moving.upper[1]).toBe(7);
    expect(moving.lower[1]).toBe(3);
  });
});

describe('rsi', () => {
  it('is 100 when prices only rise and 50 when moves balance', () => {
    expect(rsi([1, 2, 3, 4, 5], 2)[4]).toBe(100);
    expect(rsi([10, 11, 10, 11, 10], 2)[2]).toBeCloseTo(50, 6);
  });
});

const candle = (time: number, close: number, volume: number): Candle => ({ time, open: close, high: close, low: close, close, volume });

describe('vwap', () => {
  it('weights by volume and resets each IST day', () => {
    // 2026-10-13 09:15 IST and 10:15 IST, then the next day.
    const d1 = Date.UTC(2026, 9, 13, 3, 45) / 1000;
    const out = vwap([candle(d1, 100, 1), candle(d1 + 3600, 200, 3), candle(d1 + 86400, 50, 2)]);
    expect(out).toEqual([100, 175, 50]);
  });

  it('is empty without volume (indices)', () => {
    expect(vwap([candle(0, 100, 0)])).toEqual([null]);
  });
});

describe('heikinAshi', () => {
  it('averages each bar and chains opens', () => {
    const [a, b] = heikinAshi([
      { time: 1, open: 10, high: 14, low: 8, close: 12, volume: 0 },
      { time: 2, open: 12, high: 16, low: 11, close: 15, volume: 0 },
    ]);
    expect(a.close).toBe(11);
    expect(a.open).toBe(11);
    expect(b.open).toBe(11);
    expect(b.close).toBe(13.5);
    expect(b.high).toBe(16);
  });
});
