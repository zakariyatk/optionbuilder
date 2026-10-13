import type { Leg, LegAction, NewLeg } from './types';

/** Same contract: option type, strike and expiry. */
const sameContract = (a: Pick<Leg, 'type' | 'strike' | 'expiry'>, b: Pick<Leg, 'type' | 'strike' | 'expiry'>) =>
  a.type === b.type && a.strike === b.strike && (a.expiry ?? null) === (b.expiry ?? null);

/**
 * Applies a trade from the option chain to the strategy the way a broker nets
 * a position: buying more of a held contract adds lots (at the average
 * premium), trading against it reduces or closes it, and anything left over
 * opens a new leg in the trade's direction.
 */
export function netTrade(legs: Leg[], trade: NewLeg, newId: () => string): Leg[] {
  let remaining = trade.lots;
  const out: Leg[] = [];
  for (const leg of legs) {
    if (remaining > 0 && sameContract(leg, trade) && leg.action !== trade.action && leg.lotSize === trade.lotSize) {
      const closed = Math.min(leg.lots, remaining);
      remaining -= closed;
      if (leg.lots > closed) out.push({ ...leg, lots: leg.lots - closed });
      continue;
    }
    out.push(leg);
  }
  if (remaining <= 0) return out;

  const same = out.findIndex((l) => sameContract(l, trade) && l.action === trade.action && l.lotSize === trade.lotSize);
  if (same >= 0) {
    const held = out[same];
    const lots = held.lots + remaining;
    const premium = (held.premium * held.lots + trade.premium * remaining) / lots;
    out[same] = { ...held, lots, premium: Math.round(premium * 100) / 100, iv: trade.iv ?? held.iv };
    return out;
  }
  return [...out, { ...trade, lots: remaining, id: newId() }];
}

export interface StrikePosition {
  action: LegAction;
  /** Units (lots × lot size). */
  quantity: number;
  ids: string[];
}

/** Held legs per "strike:CE|PE" for one expiry, split by direction — what the chain shows as badges. */
export function positionsByStrike(legs: Leg[], expiry: string | null): Map<string, StrikePosition[]> {
  const map = new Map<string, StrikePosition[]>();
  for (const leg of legs) {
    if (leg.type !== 'CE' && leg.type !== 'PE') continue;
    if (expiry && leg.expiry && leg.expiry !== expiry) continue;
    const key = `${leg.strike}:${leg.type}`;
    const list = map.get(key) ?? [];
    const entry = list.find((p) => p.action === leg.action);
    if (entry) {
      entry.quantity += leg.lots * leg.lotSize;
      entry.ids.push(leg.id);
    } else {
      list.push({ action: leg.action, quantity: leg.lots * leg.lotSize, ids: [leg.id] });
    }
    map.set(key, list);
  }
  return map;
}
