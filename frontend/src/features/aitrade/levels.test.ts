import { describe, expect, it } from 'vitest';
import { atr, computeLevels, fairValueGaps, orderBlocks, structureBreaks, swings, tradePlan, type Bar, type Levels } from './levels';

const bar = (i: number, open: number, high: number, low: number, close: number): Bar => ({ time: i * 60_000, open, high, low, close, volume: 0 });
/** Bars from closes: each opens at the previous close, with a 1-point wick each side. */
const fromCloses = (closes: number[]): Bar[] =>
  closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1];
    return bar(i, o, Math.max(o, c) + 1, Math.min(o, c) - 1, c);
  });

describe('atr', () => {
  it('averages true range', () => {
    const bars = Array.from({ length: 30 }, (_, i) => bar(i, 100, 102, 98, 100));
    expect(atr(bars)).toBeCloseTo(4, 5);
  });
});

describe('swings', () => {
  it('marks a peak and a trough', () => {
    const s = swings(fromCloses([100, 101, 102, 105, 102, 101, 100, 99, 96, 99, 100, 101]), 3);
    expect(s.find((p) => p.type === 'high')?.price).toBe(106);
    expect(s.find((p) => p.type === 'low')?.price).toBe(95);
  });
});

describe('fair value gaps', () => {
  it('keeps an open bullish gap and drops a filled one', () => {
    const bars = [
      bar(0, 100, 101, 99, 100),
      bar(1, 100, 110, 100, 110),
      bar(2, 110, 112, 105, 111), // low 105 > high 101: gap 101–105
      bar(3, 111, 113, 106, 112), // stays above the gap, so it is still 101–105
    ];
    const open = fairValueGaps(bars, 4);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ side: 'bull', bottom: 101, top: 105 });

    const filled = fairValueGaps([...bars, bar(4, 112, 112, 100, 101)], 4);
    expect(filled).toHaveLength(0);
  });
});

describe('structure and order blocks', () => {
  // Rally to a swing high at 111, pull back, one down candle, then break above.
  const closes = [100, 103, 106, 110, 107, 105, 104, 106, 108, 109, 107, 109, 112, 115, 118];
  const bars = fromCloses(closes);
  const pts = swings(bars, 3);
  const breaks = structureBreaks(bars, pts, 3);

  it('finds the bullish break of structure', () => {
    expect(breaks.some((b) => b.side === 'bull' && b.price === 111)).toBe(true);
  });

  it('takes the last down candle before the break as the order block', () => {
    const obs = orderBlocks(bars, breaks);
    const bull = obs.find((z) => z.side === 'bull');
    expect(bull).toBeDefined();
    // Bar 10 (109 → 107) is the last bearish candle before the break at bar 12.
    expect(bull).toMatchObject({ top: 110, bottom: 106, from: 10 * 60_000 });
  });
});

describe('trade plan', () => {
  const base = (over: Partial<Omit<Levels, 'plan'>>): Omit<Levels, 'plan'> => ({
    atr: 2,
    trend: 'up',
    last: bar(0, 100, 101, 99, 100),
    swings: [],
    breaks: [],
    supports: [],
    resistances: [],
    fvgs: [],
    orderBlocks: [],
    ...over,
  });

  it('buys at support in an uptrend, stop under the zone, target at resistance', () => {
    const p = tradePlan(
      base({
        supports: [{ kind: 'support', side: 'bull', top: 100.5, bottom: 98, from: 0, touches: 3 }],
        resistances: [{ kind: 'resistance', side: 'bear', top: 112, bottom: 110, from: 0, touches: 2 }],
      }),
    );
    expect(p.action).toBe('BUY');
    expect(p.stop).toBeCloseTo(97.5);
    expect(p.targets[0]).toBe(110);
    expect(p.rr).toBeCloseTo(10 / 2.5);
  });

  it('waits when the first target is too close', () => {
    const p = tradePlan(
      base({
        supports: [{ kind: 'support', side: 'bull', top: 100.5, bottom: 98, from: 0 }],
        resistances: [{ kind: 'resistance', side: 'bear', top: 104, bottom: 103, from: 0 }],
      }),
    );
    expect(p.action).toBe('WAIT');
  });

  it('waits when price sits on an opposing level', () => {
    const p = tradePlan(
      base({
        trend: 'down',
        orderBlocks: [{ kind: 'ob', side: 'bear', top: 101.5, bottom: 99.5, from: 0 }],
        supports: [{ kind: 'support', side: 'bull', top: 100.2, bottom: 99, from: 0, touches: 4 }],
      }),
    );
    expect(p.action).toBe('WAIT');
    expect(p.reason).toContain('sitting on support');
  });

  it('waits in a range', () => {
    expect(tradePlan(base({ trend: 'range' })).action).toBe('WAIT');
  });

  it('sells at an order block in a downtrend', () => {
    const p = tradePlan(base({ trend: 'down', orderBlocks: [{ kind: 'ob', side: 'bear', top: 101.5, bottom: 99.5, from: 0 }] }));
    expect(p.action).toBe('SELL');
    expect(p.stop).toBeCloseTo(102);
    expect(p.targets).toEqual([96, 94]);
  });
});

describe('computeLevels', () => {
  it('needs 30 bars, then returns a full set', () => {
    expect(computeLevels(fromCloses([1, 2, 3]))).toBeNull();
    const closes = Array.from({ length: 200 }, (_, i) => 100 + 10 * Math.sin(i / 8) + i * 0.05);
    const l = computeLevels(fromCloses(closes))!;
    expect(l.atr).toBeGreaterThan(0);
    expect(l.supports.every((z) => z.top <= l.last.close + 1e-9 || (z.top + z.bottom) / 2 < l.last.close)).toBe(true);
    expect(['BUY', 'SELL', 'WAIT']).toContain(l.plan.action);
  });
});
