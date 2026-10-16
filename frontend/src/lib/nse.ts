/** NSE session times, in IST minutes after midnight. Exchange holidays aren't modelled. */
const OPEN_MIN = 9 * 60 + 15;
const CLOSE_MIN = 15 * 60 + 30;
const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** IST calendar fields of a moment. */
function ist(ms: number) {
  const d = new Date(ms + IST_OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth(),
    d: d.getUTCDate(),
    dow: d.getUTCDay(),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60 + d.getUTCMilliseconds() / 60_000,
  };
}

/** Epoch ms of an IST date at `minutes` past midnight (days overflow like Date.UTC). */
const istAt = (y: number, m: number, d: number, minutes: number) => Date.UTC(y, m, d) + minutes * 60_000 - IST_OFFSET_MS;

const isWeekday = (dow: number) => dow >= 1 && dow <= 5;

/** NSE cash session: Mon–Fri, 09:15–15:30 IST. */
export function nseOpen(now = new Date()): boolean {
  const t = ist(now.getTime());
  return isWeekday(t.dow) && t.minutes >= OPEN_MIN && t.minutes < CLOSE_MIN;
}

/** Epoch ms of today's 15:30 IST close. */
export function nseCloseMs(now = new Date()): number {
  const t = ist(now.getTime());
  return istAt(t.y, t.m, t.d, CLOSE_MIN);
}

/** The first trading day on or after the IST date of `ms`, as [y, m, d] (day may overflow; istAt normalises it). */
function tradingDayFrom(ms: number): [number, number, number] {
  let t = ist(ms);
  while (!isWeekday(t.dow)) t = ist(istAt(t.y, t.m, t.d + 1, 12 * 60));
  return [t.y, t.m, t.d];
}

/**
 * When the candle running at `now` closes — or, outside the session, when the
 * next one will — for a chart period. Intraday bars are aligned to the 09:15
 * open and the last one is cut at 15:30; D closes at 15:30, W on Friday's
 * close, M on the month's last weekday close.
 */
export function candleCloseMs(timespan: string, multiplier: number, now: number): number {
  const t = ist(now);
  const tradingToday = isWeekday(t.dow);
  const open = istAt(t.y, t.m, t.d, OPEN_MIN);
  const close = istAt(t.y, t.m, t.d, CLOSE_MIN);

  if (timespan === 'minute' || timespan === 'hour') {
    const span = multiplier * (timespan === 'minute' ? 60_000 : 3_600_000);
    if (tradingToday && now >= open && now < close) {
      return Math.min(open + (Math.floor((now - open) / span) + 1) * span, close);
    }
    const [y, m, d] = tradingToday && now < open ? [t.y, t.m, t.d] : tradingDayFrom(now + DAY_MS);
    return Math.min(istAt(y, m, d, OPEN_MIN) + span, istAt(y, m, d, CLOSE_MIN));
  }

  if (timespan === 'day') {
    if (tradingToday && now < close) return close;
    const [y, m, d] = tradingDayFrom(now + DAY_MS);
    return istAt(y, m, d, CLOSE_MIN);
  }

  if (timespan === 'week') {
    const friday = istAt(t.y, t.m, t.d + ((5 - t.dow + 7) % 7), CLOSE_MIN);
    return friday > now ? friday : friday + 7 * DAY_MS;
  }

  // Month: the last weekday of this month, else of next month.
  const lastWeekday = (y: number, m: number) => {
    let day = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    while (!isWeekday(new Date(Date.UTC(y, m, day)).getUTCDay())) day--;
    return istAt(y, m, day, CLOSE_MIN);
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
