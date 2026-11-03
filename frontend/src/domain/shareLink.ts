import type { LegAction, LegType, NewLeg } from './types';

/**
 * A strategy in a link: `?sym=NIFTY&legs=CE:B:24500:2026-11-27:120.5:1:75,…`
 * — type, B/S, strike, expiry, premium, lots, lot size per leg. Instrument
 * keys and IVs are left out; the builder re-prices from the live chain.
 */

const TYPES: LegType[] = ['CE', 'PE', 'FUT', 'EQ'];

/** US expiries carry a close time (2026-11-20T21:00:00Z); drop its colons so ':' stays the field separator. */
const packExpiry = (e: string) => e.replace(/:/g, '');
const unpackExpiry = (e: string) => e.replace(/T(\d{2})(\d{2})(\d{2})Z$/, 'T$1:$2:$3Z');

export function encodeLegs(legs: NewLeg[]): string {
  return legs
    .map((l) => [l.type, l.action === 'BUY' ? 'B' : 'S', l.strike, packExpiry(l.expiry ?? ''), Number(l.premium.toFixed(2)), l.lots, l.lotSize].join(':'))
    .join(',');
}

export function decodeLegs(text: string): NewLeg[] | null {
  if (!text) return null;
  const legs: NewLeg[] = [];
  for (const part of text.split(',')) {
    const [type, side, strike, expiry, premium, lots, lotSize] = part.split(':');
    const nums = [strike, premium, lots, lotSize].map(Number);
    if (!TYPES.includes(type as LegType) || (side !== 'B' && side !== 'S') || nums.some((n) => !Number.isFinite(n))) return null;
    if (nums[2] < 1 || nums[3] < 1 || nums[1] < 0) return null;
    if (expiry && !/^\d{4}-\d{2}-\d{2}(T\d{6}Z)?$/.test(expiry)) return null;
    legs.push({
      type: type as LegType,
      action: (side === 'B' ? 'BUY' : 'SELL') as LegAction,
      strike: nums[0],
      expiry: expiry ? unpackExpiry(expiry) : null,
      premium: nums[1],
      lots: Math.round(nums[2]),
      lotSize: Math.round(nums[3]),
      instrumentKey: null,
      iv: null,
    });
  }
  return legs.length ? legs : null;
}

/** Full shareable URL for the current page with the strategy in its query string. */
export function shareUrl(location: Pick<Location, 'origin' | 'pathname'>, symbol: string, legs: NewLeg[]): string {
  const q = new URLSearchParams({ sym: symbol, legs: encodeLegs(legs) });
  return `${location.origin}${location.pathname}?${q.toString()}#builder`;
}

/** The strategy carried by a URL's query string, if any. */
export function readShared(search: string): { symbol: string; legs: NewLeg[] } | null {
  const q = new URLSearchParams(search);
  const symbol = q.get('sym')?.toUpperCase() ?? '';
  const legs = decodeLegs(q.get('legs') ?? '');
  const valid = /^[A-Z0-9&_-]{1,20}$/.test(symbol) || /^US:[A-Z][A-Z0-9.-]{0,9}$/.test(symbol);
  return valid && legs ? { symbol, legs } : null;
}
