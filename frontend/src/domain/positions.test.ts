import { describe, expect, it } from 'vitest';
import { netTrade, positionsByStrike } from './positions';
import type { Leg, NewLeg } from './types';

let n = 0;
const ids = () => `new${n++}`;
const trade = (p: Partial<NewLeg>): NewLeg => ({
  action: 'BUY',
  type: 'CE',
  strike: 100,
  premium: 10,
  lots: 1,
  lotSize: 50,
  expiry: '2026-10-27',
  ...p,
});
const leg = (p: Partial<Leg>): Leg => ({ id: `l${n++}`, ...trade(p), ...p });

describe('netTrade', () => {
  it('opens a new leg for a contract not held', () => {
    const out = netTrade([leg({ strike: 200 })], trade({ strike: 100 }), ids);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ strike: 100, action: 'BUY', lots: 1 });
  });

  it('adds lots to a held contract at the average premium', () => {
    const out = netTrade([leg({ premium: 10 })], trade({ premium: 20, lots: 3 }), ids);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ lots: 4, premium: 17.5 });
  });

  it('reduces, closes and flips an opposite position', () => {
    const held = leg({ action: 'SELL', lots: 3 });
    expect(netTrade([held], trade({ action: 'BUY', lots: 1 }), ids)[0]).toMatchObject({ action: 'SELL', lots: 2 });
    expect(netTrade([held], trade({ action: 'BUY', lots: 3 }), ids)).toEqual([]);
    const flipped = netTrade([held], trade({ action: 'BUY', lots: 5 }), ids);
    expect(flipped).toHaveLength(1);
    expect(flipped[0]).toMatchObject({ action: 'BUY', lots: 2 });
  });

  it('treats other expiries and option types as different contracts', () => {
    const held = [leg({ action: 'SELL', expiry: '2026-11-24' }), leg({ action: 'SELL', type: 'PE' })];
    expect(netTrade(held, trade({ action: 'BUY' }), ids)).toHaveLength(3);
  });
});

describe('positionsByStrike', () => {
  it('sums quantity per strike, side and direction for the expiry', () => {
    const a = leg({ action: 'SELL', lots: 2 });
    const b = leg({ action: 'BUY', type: 'PE', strike: 90 });
    const other = leg({ expiry: '2026-11-24' });
    const map = positionsByStrike([a, b, other], '2026-10-27');
    expect(map.get('100:CE')).toEqual([{ action: 'SELL', quantity: 100, ids: [a.id] }]);
    expect(map.get('90:PE')).toEqual([{ action: 'BUY', quantity: 50, ids: [b.id] }]);
    expect(map.size).toBe(2);
  });
});
