const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

/**
 * Parses an expiry as "YYYY-MM-DD" (Upstox) or "DD-Mon-YYYY" (NSE).
 * Pinned to 10:00 UTC — 15:30 IST, the NSE close — so time-to-expiry counts
 * down to the actual settlement moment.
 */
export function parseExpiry(s: string): Date | null {
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 10, 0, 0));
  }
  const nse = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (nse) {
    const [, d, mon, y] = nse;
    const month = MONTHS[mon];
    return month === undefined ? null : new Date(Date.UTC(Number(y), month, Number(d), 10, 0, 0));
  }
  return null;
}

const MS_PER_YEAR = 365 * 24 * 3600 * 1000;

export function yearsToExpiry(from: Date, expiry: string): number {
  const d = parseExpiry(expiry);
  return d ? Math.max(0, (d.getTime() - from.getTime()) / MS_PER_YEAR) : 0;
}

/** Local calendar date as YYYY-MM-DD — what an <input type="date"> expects. */
export function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function daysToExpiry(expiry: string, now = new Date()): number | null {
  const d = parseExpiry(expiry);
  return d ? Math.max(0, Math.ceil((d.getTime() - now.getTime()) / 86_400_000)) : null;
}

/** "25 Aug" style label for an expiry, with the year only when it isn't the current one. */
export function formatExpiry(expiry: string, now = new Date()): string {
  const d = parseExpiry(expiry);
  if (!d) return expiry;
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(d.getUTCFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
    timeZone: 'Asia/Kolkata',
  });
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}
