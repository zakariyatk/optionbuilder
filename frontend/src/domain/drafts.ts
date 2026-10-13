import type { Draft, DraftLeg, DraftTrade } from '../api/types';
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
  /** Realized P&L plus the open legs that have a price. */
  total: number;
  /** Every leg had a price, so `total` is the whole position. */
  complete: boolean;
  /** + credit received / − debit paid at entry (options only). */
  entryNet: number;
}

/** P&L of a draft at `prices` (one per open leg, null = unknown): booked `realized` plus the open legs marked to market. */
export function draftPnl(legs: DraftLeg[], prices: (number | null | undefined)[], realized = 0): DraftPnl {
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
    total: realized + perLeg.reduce<number>((s, v) => s + (v ?? 0), 0),
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

const sameContract = (a: DraftLeg, b: DraftLeg) =>
  a.type === b.type && a.strike === b.strike && (a.expiry ?? null) === (b.expiry ?? null) && a.lotSize === b.lotSize;

/**
 * Applies a fill (`trade.premium` is the fill price) to a draft's open legs,
 * netting like a broker: an opposite fill reduces or closes held lots and books
 * their P&L, any remainder opens or adds to a leg at the average price.
 */
export function applyDraftTrade(legs: DraftLeg[], trade: DraftLeg): { legs: DraftLeg[]; trade: Omit<DraftTrade, 'at'> } {
  let remaining = trade.lots;
  let realized = 0;
  const out: DraftLeg[] = [];
  for (const leg of legs) {
    if (remaining > 0 && sameContract(leg, trade) && leg.action !== trade.action) {
      const closed = Math.min(leg.lots, remaining);
      remaining -= closed;
      realized += (leg.action === 'BUY' ? 1 : -1) * closed * leg.lotSize * (trade.premium - leg.premium);
      if (leg.lots > closed) out.push({ ...leg, lots: leg.lots - closed });
      continue;
    }
    out.push(leg);
  }
  if (remaining > 0) {
    const i = out.findIndex((l) => sameContract(l, trade) && l.action === trade.action);
    if (i >= 0) {
      const held = out[i];
      const lots = held.lots + remaining;
      out[i] = { ...held, lots, premium: Math.round(((held.premium * held.lots + trade.premium * remaining) / lots) * 100) / 100 };
    } else {
      out.push({ ...trade, lots: remaining });
    }
  }
  const { action, type, strike, expiry, lots, lotSize, premium } = trade;
  return {
    legs: out,
    trade: { action, type, strike, expiry, lots, lotSize, price: premium, realized: Math.round(realized * 100) / 100 },
  };
}

/** Exits one open leg completely at `price`. */
export const exitLegTrade = (leg: DraftLeg, price: number): DraftLeg => ({
  ...leg,
  action: leg.action === 'BUY' ? 'SELL' : 'BUY',
  premium: price,
});
