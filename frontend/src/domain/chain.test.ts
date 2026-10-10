import { describe, expect, it } from 'vitest';
import type { ChainRow, ChainSide } from '../api/types';
import { atmIv, detectUnusual, generateStrikes, strikeStep } from './chain';
import { TEMPLATES, buildFromTemplate } from './templates';
import { parseExpiry, yearsToExpiry } from './dates';

const side = (p: Partial<ChainSide> = {}): ChainSide => ({
  instrumentKey: 'K',
  ltp: 10,
  change: 0,
  oi: 100_000,
  oiChange: 0,
  volume: 20_000,
  iv: 12,
  delta: null,
  theta: null,
  bid: 0,
  ask: 0,
  ...p,
});

const rows = (count: number, start = 24000, step = 50): ChainRow[] =>
  Array.from({ length: count }, (_, i) => ({ strike: start + i * step, call: side(), put: side() }));

describe('strikes', () => {
  it('uses exchange spacing for indices', () => {
    expect(strikeStep('BANKNIFTY', 52000)).toBe(100);
    expect(generateStrikes('NIFTY', 24260, 4)).toEqual([24150, 24200, 24250, 24300, 24350]);
  });

  it('derives a clean step for stocks', () => {
    expect(strikeStep('RELIANCE', 1400)).toBe(20);
  });
});

describe('detectUnusual', () => {
  it('flags a strike far above its neighbours and nothing else', () => {
    const r = rows(15);
    r[7].call = side({ oi: 2_000_000 });
    const flags = detectUnusual(r);
    expect([...flags.keys()]).toEqual([r[7].strike]);
    expect(flags.get(r[7].strike)![0]).toMatchObject({ kind: 'oi', side: 'call' });
  });

  it('needs enough strikes to compare against', () => {
    expect(detectUnusual(rows(5)).size).toBe(0);
  });
});

describe('atmIv', () => {
  it('averages call and put IV at the nearest strike', () => {
    const r = rows(5);
    r[2] = { strike: r[2].strike, call: side({ iv: 10 }), put: side({ iv: 14 }) };
    expect(atmIv(r, r[2].strike + 10)).toBe(12);
  });
});

describe('templates', () => {
  it('iron condor picks strikes symmetrically around ATM', () => {
    const r = rows(21);
    const condor = TEMPLATES.find((t) => t.id === 'iron-condor')!;
    const legs = buildFromTemplate(condor, r, 24500, 65, '2026-08-25')!;
    expect(legs.map((l) => `${l.action} ${l.type} ${l.strike}`)).toEqual([
      'SELL PE 24400',
      'BUY PE 24300',
      'SELL CE 24600',
      'BUY CE 24700',
    ]);
    expect(legs.every((l) => l.lotSize === 65 && l.expiry === '2026-08-25')).toBe(true);
  });

  it('returns null when the chain is too short for the wings', () => {
    const condor = TEMPLATES.find((t) => t.id === 'iron-condor')!;
    expect(buildFromTemplate(condor, rows(3), 24050, 65, null)).toBeNull();
  });
});

describe('dates', () => {
  it('parses both expiry formats to the NSE close', () => {
    expect(parseExpiry('2026-08-25')!.toISOString()).toBe('2026-08-25T10:00:00.000Z');
    expect(parseExpiry('25-Aug-2026')!.toISOString()).toBe('2026-08-25T10:00:00.000Z');
    expect(parseExpiry('garbage')).toBeNull();
  });

  it('never returns negative time to expiry', () => {
    expect(yearsToExpiry(new Date('2030-01-01'), '2026-08-25')).toBe(0);
  });
});
