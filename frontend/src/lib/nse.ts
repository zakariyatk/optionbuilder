import { isUs } from './markets';

/**
 * Exchange sessions: when a market trades and when the candle running now
 * closes. NSE trades 09:15–15:30 IST; US markets 09:30–16:00 New York time,
 * which shifts against IST with US daylight saving. Exchange holidays aren't
 * modelled.
 */
export interface Session {
  name: 'NSE' | 'US';
  /** Minutes after local midnight. */
  open: number;
  close: number;
  /** Offset of the exchange's local time from UTC at an instant, in ms. */
  offsetMs: (utcMs: number) => number;
}

const DAY_MS = 86_400_000;

export const NSE_SESSION: Session = { name: 'NSE', open: 9 * 60 + 15, close: 15 * 60 + 30, offsetMs: () => 330 * 60_000 };

const nyOffset = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' });
/** New York's UTC offset at an instant ("GMT-4" in summer, "GMT-5" in winter). */
function newYorkOffsetMs(ms: number): number {
  const name = nyOffset.formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-5';
  const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return -5 * 3_600_000;
  const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return (m[1] === '-' ? -1 : 1) * minutes * 60_000;
}

export const US_SESSION: Session = { name: 'US', open: 9 * 60 + 30, close: 16 * 60, offsetMs: newYorkOffsetMs };

/** The session a symbol trades in. */
export const sessionFor = (symbol: string): Session => (isUs(symbol) ? US_SESSION : NSE_SESSION);

/** Exchange-local calendar fields of a moment. */
function local(s: Session, ms: number) {
  const d = new Date(ms + s.offsetMs(ms));
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth(),
    d: d.getUTCDate(),
    dow: d.getUTCDay(),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60 + d.getUTCMilliseconds() / 60_000,
  };
}

/**
 * Epoch ms of an exchange-local date at `minutes` past midnight (days overflow
 * like Date.UTC). The offset is taken at the target moment itself, so a time
 * on the far side of a daylight-saving change comes out right.
 */
function localAt(s: Session, y: number, m: number, d: number, minutes: number): number {
  const wall = Date.UTC(y, m, d) + minutes * 60_000;
  return wall - s.offsetMs(wall - s.offsetMs(wall));
}

const isWeekday = (dow: number) => dow >= 1 && dow <= 5;

/** Whether the session is trading now (Mon–Fri, between open and close). */
export function marketOpen(s: Session, now = new Date()): boolean {
  const t = local(s, now.getTime());
  return isWeekday(t.dow) && t.minutes >= s.open && t.minutes < s.close;
}

/** NSE cash session: Mon–Fri, 09:15–15:30 IST. */
export const nseOpen = (now = new Date()) => marketOpen(NSE_SESSION, now);

/** Epoch ms of today's 15:30 IST close. */
export function nseCloseMs(now = new Date()): number {
  const t = local(NSE_SESSION, now.getTime());
  return localAt(NSE_SESSION, t.y, t.m, t.d, NSE_SESSION.close);
}

/** The first trading day on or after the local date of `ms`, as [y, m, d] (day may overflow; localAt normalises it). */
function tradingDayFrom(s: Session, ms: number): [number, number, number] {
  let t = local(s, ms);
  while (!isWeekday(t.dow)) t = local(s, localAt(s, t.y, t.m, t.d + 1, 12 * 60));
  return [t.y, t.m, t.d];
}

/**
 * When the candle running at `now` closes — or, outside the session, when the
 * next one will — for a chart period. Intraday bars are aligned to the open
 * and the last one is cut at the close; D closes at the close, W on Friday's
 * close, M on the month's last weekday close.
 */
export function candleCloseMs(timespan: string, multiplier: number, now: number, s: Session = NSE_SESSION): number {
  const t = local(s, now);
  const tradingToday = isWeekday(t.dow);
  const open = localAt(s, t.y, t.m, t.d, s.open);
  const close = localAt(s, t.y, t.m, t.d, s.close);

  if (timespan === 'minute' || timespan === 'hour') {
    const span = multiplier * (timespan === 'minute' ? 60_000 : 3_600_000);
    if (tradingToday && now >= open && now < close) {
      return Math.min(open + (Math.floor((now - open) / span) + 1) * span, close);
    }
    const [y, m, d] = tradingToday && now < open ? [t.y, t.m, t.d] : tradingDayFrom(s, now + DAY_MS);
    return Math.min(localAt(s, y, m, d, s.open) + span, localAt(s, y, m, d, s.close));
  }

  if (timespan === 'day') {
    if (tradingToday && now < close) return close;
    const [y, m, d] = tradingDayFrom(s, now + DAY_MS);
    return localAt(s, y, m, d, s.close);
  }

  if (timespan === 'week') {
    const friday = localAt(s, t.y, t.m, t.d + ((5 - t.dow + 7) % 7), s.close);
    return friday > now ? friday : localAt(s, t.y, t.m, t.d + ((5 - t.dow + 7) % 7) + 7, s.close);
  }

  // Month: the last weekday of this month, else of next month.
  const lastWeekday = (y: number, m: number) => {
    let day = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    while (!isWeekday(new Date(Date.UTC(y, m, day)).getUTCDay())) day--;
    return localAt(s, y, m, day, s.close);
  };
  const thisMonth = lastWeekday(t.y, t.m);
  return thisMonth > now ? thisMonth : lastWeekday(t.y, t.m + 1);
}

/** Time left in a candle, as TradingView shows it: 05:09, 2:15:30, or 4d 16h for multi-day candles. */
export function fmtLeft(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const two = (n: number) => String(n).padStart(2, '0');
  const days = Math.floor(s / 86_400);
  const hh = Math.floor((s % 86_400) / 3600);
  const mm = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days}d ${hh}h`;
  return hh > 0 ? `${hh}:${two(mm)}:${two(s % 60)}` : `${two(mm)}:${two(s % 60)}`;
}
