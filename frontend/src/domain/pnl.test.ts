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
