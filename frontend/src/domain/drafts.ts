import type { Draft, DraftLeg } from '../api/types';
import type { Leg } from './types';

export const draftLegToLeg = (l: DraftLeg, i: number): Leg => ({ ...l, id: String(i) });

export const legToDraftLeg = (l: Leg): DraftLeg => ({
  action: l.action,
  type: l.type,
  strike: l.strike,
  premium: l.premium,
  lots: l.lots,
  lotSize: l.lotSize,
  instrumentKey: l.instrumentKey ?? null,
  iv: l.iv ?? null,
  expiry: l.expiry ?? null,
});

export interface DraftPnl {
  /** P&L per leg; null where no current price is known. */
  perLeg: (number | null)[];
  /** Sum over the legs that have a price. */
  total: number;
  /** Every leg had a price, so `total` is the whole position. */
  complete: boolean;
  /** + credit received / − debit paid at entry (options only). */
  entryNet: number;
}

/** Mark-to-market P&L of a draft at `prices` (one per leg, null = unknown). */
export function draftPnl(legs: DraftLeg[], prices: (number | null | undefined)[]): DraftPnl {
  const perLeg = legs.map((l, i) => {
    const p = prices[i];
    if (p == null || !Number.isFinite(p)) return null;
    return (l.action === 'BUY' ? 1 : -1) * l.lots * l.lotSize * (p - l.premium);
  });
  const entryNet = legs
    .filter((l) => l.type === 'CE' || l.type === 'PE')
    .reduce((s, l) => s + (l.action === 'SELL' ? 1 : -1) * l.premium * l.lots * l.lotSize, 0);
  return {
    perLeg,
    total: perLeg.reduce<number>((s, v) => s + (v ?? 0), 0),
    complete: perLeg.every((v) => v !== null),
    entryNet,
  };
}

/** Current price per leg: recorded exits for a closed draft, else live quotes by instrument key. */
export function draftPrices(draft: Draft, quotes: Record<string, number> | null | undefined): (number | null)[] {
  if (draft.closedAt !== null && draft.exitPremiums) return draft.exitPremiums;
  return draft.legs.map((l) => (l.instrumentKey && quotes?.[l.instrumentKey] !== undefined ? quotes[l.instrumentKey] : null));
}

/** Instrument keys an open draft needs live quotes for. */
export function draftKeys(drafts: Draft[]): string[] {
  const keys = new Set<string>();
  for (const d of drafts) if (d.closedAt === null) for (const l of d.legs) if (l.instrumentKey) keys.add(l.instrumentKey);
  return [...keys].sort();
}
