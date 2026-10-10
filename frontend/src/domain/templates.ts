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
  legs: { action: LegAction; type: 'CE' | 'PE'; offset: number }[];
}

export const TEMPLATES: StrategyTemplate[] = [
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
];

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
      premium: side?.ltp ?? 0,
      lots: 1,
      lotSize,
      instrumentKey: side?.instrumentKey ?? null,
      iv: side?.iv ?? null,
      expiry,
    });
  }
  return legs;
}
