import { describe, expect, it } from 'vitest';
import type { ZerodhaHolding, ZerodhaPosition } from '../api/types';
import { pnlBySegment, segmentOf, topMovers } from './pnl';

const pos = (p: Partial<ZerodhaPosition>): ZerodhaPosition => ({
  symbol: 'X', exchange: 'NFO', product: 'NRML', quantity: 0, buyQty: 0, buyAvg: 0, sellQty: 0, sellAvg: 0,
  average: 0, last: 0, pnl: 0, realised: 0, unrealised: 0, m2m: 0, ...p,
});
const hold = (h: Partial<ZerodhaHolding>): ZerodhaHolding => ({
  symbol: 'H', exchange: 'NSE', quantity: 1, average: 0, last: 0, invested: 0, current: 0, pnl: 0, dayChange: 0, dayChangePct: 0, ...h,
});

describe('segmentOf', () => {
  it('maps exchanges to the three sections', () => {
    expect(segmentOf('NSE')).toBe('equity');
    expect(segmentOf('BSE')).toBe('equity');
    expect(segmentOf('NFO')).toBe('fo');
    expect(segmentOf('BFO')).toBe('fo');
    expect(segmentOf('CDS')).toBe('fo');
    expect(segmentOf('MCX')).toBe('commodity');
  });
});

describe('pnlBySegment', () => {
  const data = {
    positions: [
      pos({ symbol: 'NIFTYCE', exchange: 'NFO', quantity: -75, pnl: 3000, unrealised: 3000, m2m: 500 }),
      pos({ symbol: 'BANKFUT', exchange: 'NFO', quantity: 0, pnl: -1200, realised: -1200, m2m: -1200 }),
      pos({ symbol: 'GOLD', exchange: 'MCX', quantity: 1, pnl: 800, unrealised: 800, m2m: 300 }),
      pos({ symbol: 'RELIANCE', exchange: 'NSE', product: 'MIS', quantity: 0, pnl: 400, realised: 400, m2m: 400 }),
      // A server that already tags the segment wins over the exchange.
      pos({ symbol: 'TAGGED', exchange: 'NSE', segment: 'commodity', quantity: 2, pnl: 10, unrealised: 10 }),
    ],
    holdings: [hold({ symbol: 'TCS', pnl: 5000, dayChange: 120, invested: 80000, current: 85000 })],
  };
  const s = pnlBySegment(data);

  it('keeps each segment apart', () => {
    expect(s.fo).toMatchObject({ total: 1800, realised: -1200, unrealised: 3000, today: -700, openPositions: 1, closedPositions: 1 });
    expect(s.commodity).toMatchObject({ total: 810, unrealised: 810, today: 300, openPositions: 2 });
  });

  it('counts holdings as equity, unrealised against cost', () => {
    expect(s.equity).toMatchObject({ total: 5400, realised: 400, unrealised: 5000, today: 520, holdings: 1, invested: 80000, current: 85000 });
    expect(s.equity.items.map((i) => i.kind)).toEqual(['holding', 'position']);
  });

  it('sums back to the whole account', () => {
    const all = data.positions.reduce((a, p) => a + p.pnl, 0) + data.holdings.reduce((a, h) => a + h.pnl, 0);
    expect(s.equity.total + s.fo.total + s.commodity.total).toBeCloseTo(all);
  });
});

describe('topMovers', () => {
  it('folds the tail into Others, keeping the total', () => {
    const items = [5, -40, 12, 3, -1].map((pnl, i) => ({ key: `k${i}`, symbol: `S${i}`, kind: 'position' as const, open: true, pnl, realised: 0, unrealised: pnl, today: 0 }));
    const rows = topMovers(items, 3);
    expect(rows.map((r) => r.label)).toEqual(['S1', 'S2', 'Others (3)']);
    expect(rows[2].value).toBe(7);
    expect(rows.reduce((a, r) => a + r.value, 0)).toBe(-21);
  });
});

import { presetRange, summarizeHistory } from './pnl';
import type { PnlHistoryDay } from '../api/types';

describe('presetRange', () => {
  it('works out weeks, months and Indian financial years', () => {
    // 2026-11-20 is a Friday.
    expect(presetRange('week', '2026-11-20')).toEqual({ from: '2026-11-16', to: '2026-11-20' });
    expect(presetRange('month', '2026-11-20')).toEqual({ from: '2026-11-01', to: '2026-11-20' });
    expect(presetRange('lastMonth', '2026-11-20')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(presetRange('lastMonth', '2026-01-10')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(presetRange('fy', '2026-11-20')).toEqual({ from: '2026-04-01', to: '2026-11-20' });
    expect(presetRange('fy', '2027-02-10')).toEqual({ from: '2026-04-01', to: '2027-02-10' });
    expect(presetRange('lastFy', '2026-11-20')).toEqual({ from: '2025-04-01', to: '2026-03-31' });
  });
});

describe('summarizeHistory', () => {
  const seg = (realised: number, symbols: Record<string, number>) => ({ source: 'upload' as const, realised, today: null, symbols });
  const days: PnlHistoryDay[] = [
    { date: '2026-10-05', equity: seg(100, { INFY: 100 }), fo: seg(0, {}), commodity: null },
    { date: '2026-10-06', equity: null, fo: seg(-400, { NIFTYPE: -400 }), commodity: seg(250, { GOLDM: 250 }) },
    { date: '2026-10-12', equity: seg(50, { INFY: 50 }), fo: null, commodity: null },
    { date: '2026-11-02', equity: seg(999, { TCS: 999 }), fo: null, commodity: null },
  ];

  it('totals a range by segment, day and symbol', () => {
    const s = summarizeHistory(days, '2026-10-01', '2026-10-31');
    expect(s.total).toBe(0);
    expect(s.segments.equity).toEqual({ realised: 150, symbols: { INFY: 150 }, days: 2 });
    expect(s.segments.fo.realised).toBe(-400);
    expect(s.daily.map((d) => d.total)).toEqual([100, -150, 50]);
    expect(s.profitDays).toBe(2);
    expect(s.lossDays).toBe(1);
    expect(s.best?.date).toBe('2026-10-05');
    expect(s.worst?.date).toBe('2026-10-06');
  });

  it('counts weekdays with no record', () => {
    // 1–9 Oct 2026: records on 5 and 6; data starts on 5 Oct, so only 7, 8, 9 are gaps.
    expect(summarizeHistory(days, '2026-10-01', '2026-10-09').missingWeekdays).toBe(3);
    // An uploaded statement for 1–7 Oct accounts for those days.
    expect(summarizeHistory(days, '2026-10-01', '2026-10-09', undefined, [['2026-10-01', '2026-10-07']]).missingWeekdays).toBe(2);
    // Before the first record nothing is missing: 1947 → 9 Oct counts from 5 Oct (5–9 Oct: 3 gaps).
    expect(summarizeHistory(days, '1947-01-01', '2026-10-09').missingWeekdays).toBe(3);
    expect(summarizeHistory([], '2026-10-01', '2026-10-09').missingWeekdays).toBe(0);
  });

  it('filters to chosen segments', () => {
    const s = summarizeHistory(days, '2026-10-01', '2026-10-31', ['fo']);
    expect(s.total).toBe(-400);
    expect(s.daily.map((d) => d.total)).toEqual([0, -400, 0]);
  });
});
