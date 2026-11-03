import type { ChainRow, ChainSide } from '../api/types';
import { nearestRow } from './chain';
import type { LegAction, NewLeg } from './types';

/**
 * One-click strategy presets, built around the current ATM strike.
 * Offsets are in strike steps (rows of the chain), so they adapt to each
 * underlying's spacing automatically.
 */
export interface StrategyTemplate {
  id: string;
  name: string;
  view: 'Bullish' | 'Bearish' | 'Neutral' | 'Volatile' | 'Income';
  description: string;
  /** `lots` defaults to 1 — a butterfly's body is 2. */
  legs: { action: LegAction; type: 'CE' | 'PE'; offset: number; lots?: number }[];
}

export const TEMPLATES: StrategyTemplate[] = [
  {
    id: 'long-call',
    name: 'Long call',
    view: 'Bullish',
    description: 'Buy an ATM call. Risk limited to the premium, upside open.',
    legs: [{ action: 'BUY', type: 'CE', offset: 0 }],
  },
  {
    id: 'short-put',
    name: 'Short put',
    view: 'Bullish',
    description: 'Sell an OTM put. Collects premium if the price holds up.',
    legs: [{ action: 'SELL', type: 'PE', offset: -1 }],
  },
  {
    id: 'long-put',
    name: 'Long put',
    view: 'Bearish',
    description: 'Buy an ATM put. Risk limited to the premium.',
    legs: [{ action: 'BUY', type: 'PE', offset: 0 }],
  },
  {
    id: 'bull-call',
    name: 'Bull call spread',
    view: 'Bullish',
    description: 'Buy ATM call, sell a higher call. Capped risk and reward.',
    legs: [
      { action: 'BUY', type: 'CE', offset: 0 },
      { action: 'SELL', type: 'CE', offset: 2 },
    ],
  },
  {
    id: 'bull-put',
    name: 'Bull put spread',
    view: 'Bullish',
    description: 'Sell OTM put, buy a lower put. Collects a credit.',
    legs: [
      { action: 'SELL', type: 'PE', offset: -1 },
      { action: 'BUY', type: 'PE', offset: -3 },
    ],
  },
  {
    id: 'bear-put',
    name: 'Bear put spread',
    view: 'Bearish',
    description: 'Buy ATM put, sell a lower put. Capped risk and reward.',
    legs: [
      { action: 'BUY', type: 'PE', offset: 0 },
      { action: 'SELL', type: 'PE', offset: -2 },
    ],
  },
  {
    id: 'bear-call',
    name: 'Bear call spread',
    view: 'Bearish',
    description: 'Sell OTM call, buy a higher call. Collects a credit.',
    legs: [
      { action: 'SELL', type: 'CE', offset: 1 },
      { action: 'BUY', type: 'CE', offset: 3 },
    ],
  },
  {
    id: 'long-straddle',
    name: 'Long straddle',
    view: 'Volatile',
    description: 'Buy ATM call and put. Profits from a big move either way.',
    legs: [
      { action: 'BUY', type: 'CE', offset: 0 },
      { action: 'BUY', type: 'PE', offset: 0 },
    ],
  },
  {
    id: 'long-strangle',
    name: 'Long strangle',
    view: 'Volatile',
    description: 'Buy OTM call and put. Cheaper than a straddle, needs a bigger move.',
    legs: [
      { action: 'BUY', type: 'CE', offset: 2 },
      { action: 'BUY', type: 'PE', offset: -2 },
    ],
  },
  {
    id: 'short-straddle',
    name: 'Short straddle',
    view: 'Neutral',
    description: 'Sell ATM call and put. Unlimited risk — margin heavy.',
    legs: [
      { action: 'SELL', type: 'CE', offset: 0 },
      { action: 'SELL', type: 'PE', offset: 0 },
    ],
  },
  {
    id: 'short-strangle',
    name: 'Short strangle',
    view: 'Neutral',
    description: 'Sell OTM call and put. Wider range than a straddle, still unlimited risk.',
    legs: [
      { action: 'SELL', type: 'CE', offset: 2 },
      { action: 'SELL', type: 'PE', offset: -2 },
    ],
  },
  {
    id: 'iron-condor',
    name: 'Iron condor',
    view: 'Neutral',
    description: 'Short strangle with protective wings. Defined risk range trade.',
    legs: [
      { action: 'SELL', type: 'PE', offset: -2 },
      { action: 'BUY', type: 'PE', offset: -4 },
      { action: 'SELL', type: 'CE', offset: 2 },
      { action: 'BUY', type: 'CE', offset: 4 },
    ],
  },
  {
    id: 'iron-butterfly',
    name: 'Iron butterfly',
    view: 'Neutral',
    description: 'Short ATM straddle with wings. Max profit if it pins the strike.',
    legs: [
      { action: 'SELL', type: 'CE', offset: 0 },
      { action: 'SELL', type: 'PE', offset: 0 },
      { action: 'BUY', type: 'CE', offset: 3 },
      { action: 'BUY', type: 'PE', offset: -3 },
    ],
  },
  {
    id: 'call-butterfly',
    name: 'Call butterfly',
    view: 'Neutral',
    description: 'Buy 1 lower and 1 higher call, sell 2 ATM. Cheap bet on a pin.',
    legs: [
      { action: 'BUY', type: 'CE', offset: -2 },
      { action: 'SELL', type: 'CE', offset: 0, lots: 2 },
      { action: 'BUY', type: 'CE', offset: 2 },
    ],
  },
];

export const TEMPLATE_VIEWS: StrategyTemplate['view'][] = ['Bullish', 'Bearish', 'Neutral', 'Volatile'];

/**
 * The template the legs form, if any: same number of legs, and — sorted by
 * strike — the same action, type, relative lot size and strike ordering.
 */
export function matchTemplate(legs: { action: LegAction; type: string; strike: number; lots: number }[]): StrategyTemplate | null {
  if (legs.length === 0 || legs.some((l) => l.type !== 'CE' && l.type !== 'PE')) return null;
  const order = (a: { type: string }, b: { type: string }) => (a.type === b.type ? 0 : a.type === 'PE' ? -1 : 1);
  const mine = [...legs].sort((a, b) => a.strike - b.strike || order(a, b));
  const unit = Math.min(...mine.map((l) => l.lots));
  return (
    TEMPLATES.find((t) => {
      if (t.legs.length !== mine.length) return false;
      const spec = [...t.legs].sort((a, b) => a.offset - b.offset || order(a, b));
      return spec.every((s, i) => {
        const l = mine[i];
        if (s.action !== l.action || s.type !== l.type || l.lots / unit !== (s.lots ?? 1)) return false;
        if (i === 0) return true;
        const sameStrike = spec[i - 1].offset === s.offset;
        return sameStrike ? mine[i - 1].strike === l.strike : mine[i - 1].strike < l.strike;
      });
    }) ?? null
  );
}

/**
 * A normalised expiry-payoff outline for a template's preset card: x and y in
 * 0…1, y up. Built on a notional 100-point strike ladder with rough premiums,
 * so only the shape matters. `zero` is where P&L = 0 falls on the same y scale.
 */
export function templateSketch(t: StrategyTemplate): { points: { x: number; y: number }[]; zero: number } {
  const strike = (o: number) => 100 + o * 5;
  const premium = (type: 'CE' | 'PE', k: number) => Math.max(type === 'CE' ? 100 - k : k - 100, 0) + 2.5 * Math.exp(-Math.abs(k - 100) / 8);
  const pnl = (s: number) =>
    t.legs.reduce((sum, l) => {
      const k = strike(l.offset);
      const value = l.type === 'CE' ? Math.max(s - k, 0) : Math.max(k - s, 0);
      return sum + (l.action === 'BUY' ? 1 : -1) * (l.lots ?? 1) * (value - premium(l.type, k));
    }, 0);
  const xs = Array.from({ length: 41 }, (_, i) => 70 + i * 1.5);
  const ys = xs.map(pnl);
  const lo = Math.min(...ys, 0);
  const hi = Math.max(...ys, 0);
  const norm = (v: number) => (hi === lo ? 0.5 : (v - lo) / (hi - lo));
  return { points: xs.map((x, i) => ({ x: (x - 70) / 60, y: norm(ys[i]) })), zero: norm(0) };
}

/**
 * Turns a template into concrete legs priced off the live chain.
 * Returns null when the chain can't supply every strike (e.g. near the edge).
 */
export function buildFromTemplate(
  template: StrategyTemplate,
  rows: ChainRow[],
  spot: number,
  lotSize: number,
  expiry: string | null,
  /** Fill price per side: last traded (NSE default) or, for the US, the bid / ask mid. */
  priceOf: (side: ChainSide | null) => number = (side) => side?.ltp ?? 0,
): NewLeg[] | null {
  const atm = nearestRow(rows, spot);
  if (!atm) return null;
  const atmIndex = rows.indexOf(atm);

  const legs: NewLeg[] = [];
  for (const spec of template.legs) {
    const row = rows[atmIndex + spec.offset];
    if (!row) return null;
    const side: ChainSide | null = spec.type === 'CE' ? row.call : row.put;
    legs.push({
      action: spec.action,
      type: spec.type,
      strike: row.strike,
      premium: Number(priceOf(side).toFixed(2)),
      lots: spec.lots ?? 1,
      lotSize,
      instrumentKey: side?.instrumentKey ?? null,
      iv: side?.iv ?? null,
      expiry,
    });
  }
  return legs;
}
