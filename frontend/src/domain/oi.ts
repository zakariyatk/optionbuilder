import type { ChainRow } from '../api/types';

/** Intraday OI history for one expiry, as /api/oi-intraday returns it. */
export interface OiHistory {
  expiry: string;
  /** Unix seconds, one per minute with data. */
  times: number[];
  spot: (number | null)[];
  rows: {
    strike: number;
    call: { prevOi: number; oi: (number | null)[] } | null;
    put: { prevOi: number; oi: (number | null)[] } | null;
  }[];
}

/** OI at the start and end of the chosen window. */
export interface SideOi {
  start: number;
  end: number;
}

export interface StrikeOiWindow {
  strike: number;
  call: SideOi;
  put: SideOi;
}

const ZERO: SideOi = { start: 0, end: 0 };

/** The whole session from the chain: yesterday's closing OI → OI now. */
export function fullDayFromChain(rows: ChainRow[]): StrikeOiWindow[] {
  const side = (s: ChainRow['call']): SideOi => (s ? { start: s.oi - s.oiChange, end: s.oi } : ZERO);
  return rows.map((r) => ({ strike: r.strike, call: side(r.call), put: side(r.put) }));
}

/**
 * OI between two minutes of the history. A window starting at the first
 * minute measures from yesterday's close, so "Full Day" matches the chain.
 */
export function windowFromHistory(h: OiHistory, startIdx: number, endIdx: number): StrikeOiWindow[] {
  const at = (s: OiHistory['rows'][number]['call'], i: number): number | null => {
    if (!s) return null;
    for (let k = Math.min(i, s.oi.length - 1); k >= 0; k--) if (s.oi[k] != null) return s.oi[k];
    return null;
  };
  const side = (s: OiHistory['rows'][number]['call']): SideOi => {
    if (!s) return ZERO;
    const start = startIdx <= 0 ? s.prevOi : (at(s, startIdx) ?? s.prevOi);
    const end = at(s, endIdx) ?? start;
    return { start, end };
  };
  return h.rows.map((r) => ({ strike: r.strike, call: side(r.call), put: side(r.put) }));
}

/** Sums several expiries strike by strike. */
export function mergeWindows(lists: StrikeOiWindow[][]): StrikeOiWindow[] {
  const by = new Map<number, StrikeOiWindow>();
  for (const list of lists) {
    for (const r of list) {
      const cur = by.get(r.strike) ?? { strike: r.strike, call: { ...ZERO }, put: { ...ZERO } };
      cur.call = { start: cur.call.start + r.call.start, end: cur.call.end + r.call.end };
      cur.put = { start: cur.put.start + r.put.start, end: cur.put.end + r.put.end };
      by.set(r.strike, cur);
    }
  }
  return [...by.values()].sort((a, b) => a.strike - b.strike);
}

/** The strike range covering `count` strikes either side of the one nearest spot. */
export function strikesAround(strikes: number[], spot: number, count: number): { min: number; max: number } | null {
  const sorted = [...new Set(strikes)].sort((a, b) => a - b);
  if (!sorted.length) return null;
  let atm = 0;
  for (let i = 1; i < sorted.length; i++) if (Math.abs(sorted[i] - spot) < Math.abs(sorted[atm] - spot)) atm = i;
  return { min: sorted[Math.max(0, atm - count)], max: sorted[Math.min(sorted.length - 1, atm + count)] };
}

/** Weekly unless it's the last listed expiry of its month (the monthly). */
export function isWeekly(expiry: string, expiries: string[]): boolean {
  const month = expiry.slice(0, 7);
  const inMonth = expiries.filter((e) => e.slice(0, 7) === month).sort();
  return inMonth[inMonth.length - 1] !== expiry;
}

/** Put-call ratio of open interest. */
export function pcr(rows: ChainRow[]): number | null {
  let call = 0;
  let put = 0;
  for (const r of rows) {
    call += r.call?.oi ?? 0;
    put += r.put?.oi ?? 0;
  }
  return call > 0 ? put / call : null;
}
