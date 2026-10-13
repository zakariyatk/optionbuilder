import { describe, expect, it } from 'vitest';
import type { Draft, DraftLeg } from '../api/types';
import { draftKeys, draftPnl, draftPrices } from './drafts';

const leg = (p: Partial<DraftLeg>): DraftLeg => ({
  action: 'SELL',
  type: 'CE',
  strike: 24300,
  premium: 100,
  lots: 1,
  lotSize: 65,
  instrumentKey: 'NSE_FO|1',
  iv: 12,
  expiry: '2026-10-27',
  ...p,
});

const draft = (p: Partial<Draft>): Draft => ({
  id: 'd1',
  name: 'Test',
  symbol: 'NIFTY',
  legs: [leg({}), leg({ action: 'BUY', type: 'PE', premium: 40, instrumentKey: 'NSE_FO|2' })],
  entrySpot: 24200,
  createdAt: 0,
  closedAt: null,
  exitPremiums: null,
  exitSpot: null,
  ...p,
});

describe('draftPnl', () => {
  it('marks each leg to market by direction and quantity', () => {
    const d = draft({});
    const pnl = draftPnl(d.legs, [80, 50]);
    // Short call: (100 − 80) × 65 = +1300; long put: (50 − 40) × 65 = +650.
    expect(pnl.perLeg).toEqual([1300, 650]);
    expect(pnl.total).toBe(1950);
    expect(pnl.complete).toBe(true);
    // Credit 6500, debit 2600.
    expect(pnl.entryNet).toBe(3900);
  });

  it('reports a partial total when a price is missing', () => {
    const pnl = draftPnl(draft({}).legs, [120, null]);
    expect(pnl.perLeg).toEqual([-1300, null]);
    expect(pnl.total).toBe(-1300);
    expect(pnl.complete).toBe(false);
  });
});

describe('draftPrices', () => {
  it('uses live quotes for an open draft and recorded exits once closed', () => {
    const quotes = { 'NSE_FO|1': 90 };
    expect(draftPrices(draft({}), quotes)).toEqual([90, null]);
    expect(draftPrices(draft({ closedAt: 1, exitPremiums: [70, 55] }), quotes)).toEqual([70, 55]);
  });
});

describe('draftKeys', () => {
  it('collects the keys of open drafts only, once each', () => {
    const open = draft({});
    const closed = draft({ id: 'd2', closedAt: 1, legs: [leg({ instrumentKey: 'NSE_FO|9' })] });
    expect(draftKeys([open, open, closed])).toEqual(['NSE_FO|1', 'NSE_FO|2']);
  });
});
