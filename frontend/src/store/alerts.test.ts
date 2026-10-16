import { beforeEach, describe, expect, it } from 'vitest';
import { activeAlerts, crossed, useAlerts } from './alerts';

const state = () => useAlerts.getState();

describe('price alerts', () => {
  beforeEach(() => useAlerts.setState({ alerts: [] }));

  it('waits on the side the market was on, and fires on reaching the level', () => {
    const below = state().add('NIFTY', 23000, 23100); // set above the level → fires going down
    expect(below.above).toBe(true);
    expect(state().observe('NIFTY', 23005)).toEqual([]);
    const fired = state().observe('NIFTY', 22999.5, 42);
    expect(fired.map((a) => a.id)).toEqual([below.id]);
    expect(state().alerts[0]).toMatchObject({ triggeredAt: 42, triggerPrice: 22999.5 });
    // Fired once only.
    expect(state().observe('NIFTY', 22900)).toEqual([]);
  });

  it('fires going up when set below the market', () => {
    const a = state().add('TCS', 3500, 3400);
    expect(a.above).toBe(false);
    expect(crossed(a, 3499.95)).toBe(false);
    expect(crossed(a, 3500)).toBe(true);
  });

  it('takes its side from the first quote when no price was known', () => {
    state().add('INFY', 1500, null);
    expect(state().observe('INFY', 1490)).toEqual([]);
    expect(state().alerts[0].above).toBe(false);
    expect(state().observe('INFY', 1500.5)).toHaveLength(1);
  });

  it('ignores other symbols and moves re-pick the side', () => {
    const a = state().add('NIFTY', 23000, 23100);
    expect(state().observe('BANKNIFTY', 1)).toEqual([]);
    state().move(a.id, 23200, 23100);
    expect(state().alerts[0]).toMatchObject({ price: 23200, above: false });
    expect(state().observe('NIFTY', 23200)).toHaveLength(1);
  });

  it('lists only alerts still waiting', () => {
    const a = state().add('NIFTY', 23000, 23100);
    state().add('TCS', 3500, 3400);
    state().observe('NIFTY', 22990);
    expect(activeAlerts(state().alerts).map((x) => x.symbol)).toEqual(['TCS']);
    expect(activeAlerts(state().alerts, 'NIFTY')).toEqual([]);
    state().remove(a.id);
    expect(state().alerts).toHaveLength(1);
  });
});
