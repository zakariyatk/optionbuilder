import type { PnlHistoryDay, ZerodhaPnl, ZerodhaPosition } from '../api/types';

/** The P&L Report's three sections. */
export type Segment = 'equity' | 'fo' | 'commodity';

export const SEGMENTS: { id: Segment; label: string; note: string }[] = [
  { id: 'equity', label: 'Equity', note: 'NSE / BSE cash trades and long-term holdings' },
  { id: 'fo', label: 'F&O', note: 'Futures and options on NFO / BFO, plus currency derivatives' },
  { id: 'commodity', label: 'Commodity', note: 'MCX futures and options' },
];

/** Segment of an exchange, for servers that don't tag positions yet. */
export function segmentOf(exchange: string): Segment {
  const ex = exchange.toUpperCase();
  if (['NFO', 'BFO', 'CDS', 'BCD'].includes(ex)) return 'fo';
  if (['MCX', 'NCO', 'NCDEX'].includes(ex)) return 'commodity';
  return 'equity';
}

export const positionSegment = (p: ZerodhaPosition): Segment => p.segment ?? segmentOf(p.exchange);

/** One instrument's contribution, positions and holdings alike. */
export interface PnlItem {
  key: string;
  symbol: string;
  kind: 'position' | 'holding';
  /** Still open (a position with quantity, or any holding). */
  open: boolean;
  pnl: number;
  realised: number;
  unrealised: number;
  /** Today's move: M2M for positions, day change for holdings. */
  today: number;
}

export interface SegmentPnl {
  segment: Segment;
  /** realised + unrealised */
  total: number;
  realised: number;
  unrealised: number;
  today: number;
  openPositions: number;
  closedPositions: number;
  holdings: number;
  /** Holdings only (equity): cost and market value. */
  invested: number;
  current: number;
  items: PnlItem[];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function empty(segment: Segment): SegmentPnl {
  return { segment, total: 0, realised: 0, unrealised: 0, today: 0, openPositions: 0, closedPositions: 0, holdings: 0, invested: 0, current: 0, items: [] };
}

/**
 * Splits the account's P&L into Equity, F&O and Commodity. Holdings count as
 * equity: their P&L against average cost is unrealised, their day change is
 * today's move.
 */
export function pnlBySegment(data: Pick<ZerodhaPnl, 'positions' | 'holdings'>): Record<Segment, SegmentPnl> {
  const out: Record<Segment, SegmentPnl> = { equity: empty('equity'), fo: empty('fo'), commodity: empty('commodity') };

  for (const p of data.positions) {
    const s = out[positionSegment(p)];
    const open = p.quantity !== 0;
    s.items.push({ key: `p:${p.exchange}:${p.symbol}:${p.product}`, symbol: p.symbol, kind: 'position', open, pnl: p.pnl, realised: p.realised, unrealised: p.unrealised, today: p.m2m });
    s.realised += p.realised;
    s.unrealised += p.unrealised;
    s.today += p.m2m;
    if (open) s.openPositions += 1;
    else s.closedPositions += 1;
  }

  const eq = out.equity;
  for (const h of data.holdings) {
    eq.items.push({ key: `h:${h.exchange}:${h.symbol}`, symbol: h.symbol, kind: 'holding', open: true, pnl: h.pnl, realised: 0, unrealised: h.pnl, today: h.dayChange });
    eq.unrealised += h.pnl;
    eq.today += h.dayChange;
    eq.invested += h.invested;
    eq.current += h.current;
    eq.holdings += 1;
  }

  for (const s of Object.values(out)) {
    s.realised = round2(s.realised);
    s.unrealised = round2(s.unrealised);
    s.today = round2(s.today);
    s.total = round2(s.realised + s.unrealised);
    s.invested = round2(s.invested);
    s.current = round2(s.current);
    s.items.sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
  }
  return out;
}

/** Rows for a ranked bar chart: the biggest movers, the rest folded into one "Others" row. */
export function topMovers(items: PnlItem[], max = 8): { key: string; label: string; value: number; items: PnlItem[] }[] {
  const ranked = [...items].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
  const shown = ranked.length > max ? ranked.slice(0, max - 1) : ranked;
  const rest = ranked.slice(shown.length);
  const rows = shown.map((i) => ({ key: i.key, label: i.symbol, value: i.pnl, items: [i] }));
  if (rest.length) rows.push({ key: 'others', label: `Others (${rest.length})`, value: round2(rest.reduce((s, i) => s + i.pnl, 0)), items: rest });
  return rows;
}

// ------------------------------------------------------------------- history


export type RangeId = 'today' | 'week' | 'month' | 'lastMonth' | 'fy' | 'lastFy' | 'custom';

export const RANGES: { id: RangeId; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
  { id: 'fy', label: 'This FY' },
  { id: 'lastFy', label: 'Last FY' },
  { id: 'custom', label: 'Custom' },
];

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Today in India as YYYY-MM-DD, whatever the browser's time zone. */
export function istToday(now = Date.now()): string {
  return new Date(now + 19_800_000).toISOString().slice(0, 10);
}

/** The from–to dates (inclusive, YYYY-MM-DD) of a preset range; Indian financial years start 1 April. */
export function presetRange(id: Exclude<RangeId, 'custom'>, today: string): { from: string; to: string } {
  const [y, m, d] = today.split('-').map(Number);
  switch (id) {
    case 'today':
      return { from: today, to: today };
    case 'week': {
      const dt = new Date(Date.UTC(y, m - 1, d));
      const back = (dt.getUTCDay() + 6) % 7; // days since Monday
      dt.setUTCDate(dt.getUTCDate() - back);
      return { from: dt.toISOString().slice(0, 10), to: today };
    }
    case 'month':
      return { from: iso(y, m, 1), to: today };
    case 'lastMonth': {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { from: iso(py, pm, 1), to: iso(py, pm, new Date(Date.UTC(py, pm, 0)).getUTCDate()) };
    }
    case 'fy': {
      const start = m >= 4 ? y : y - 1;
      return { from: iso(start, 4, 1), to: today };
    }
    case 'lastFy': {
      const start = (m >= 4 ? y : y - 1) - 1;
      return { from: iso(start, 4, 1), to: iso(start + 1, 3, 31) };
    }
  }
}

export interface HistoryDay {
  date: string;
  equity: number;
  fo: number;
  commodity: number;
  total: number;
}

export interface HistorySummary {
  total: number;
  segments: Record<Segment, { realised: number; symbols: Record<string, number>; days: number }>;
  /** Days with any record, oldest first — values for the chosen segments only. */
  daily: HistoryDay[];
  profitDays: number;
  lossDays: number;
  best: HistoryDay | null;
  worst: HistoryDay | null;
  /** Weekdays in the range with no record at all (market holidays count too). */
  missingWeekdays: number;
  /** Charges and taxes known for the chosen segments, per segment and per day. */
  charges: Record<Segment, number>;
  chargesByDate: Record<string, Partial<Record<Segment, number>>>;
  /** Days with realised P&L but no charges on record (tradebook uploads). */
  unpricedDays: number;
}

/**
 * Realised P&L over a date range, by segment, by day and by symbol.
 * `covered` are periods an uploaded tradebook or statement accounts for:
 * their days aren't missing even when nothing was traded on them.
 */
export function summarizeHistory(
  days: PnlHistoryDay[],
  from: string,
  to: string,
  only: Segment[] = ['equity', 'fo', 'commodity'],
  covered: [string, string][] = [],
): HistorySummary {
  const segments = Object.fromEntries(SEGMENTS.map((s) => [s.id, { realised: 0, symbols: {} as Record<string, number>, days: 0 }])) as HistorySummary['segments'];
  const daily: HistoryDay[] = [];
  const seen = new Set<string>();
  const charges: Record<Segment, number> = { equity: 0, fo: 0, commodity: 0 };
  const chargesByDate: HistorySummary['chargesByDate'] = {};
  const unpriced = new Set<string>();

  for (const d of days) {
    if (d.date < from || d.date > to) continue;
    const row: HistoryDay = { date: d.date, equity: 0, fo: 0, commodity: 0, total: 0 };
    let any = false;
    for (const seg of ['equity', 'fo', 'commodity'] as Segment[]) {
      const s = d[seg];
      if (!s) continue;
      any = true;
      if (!only.includes(seg)) continue;
      row[seg] = s.realised;
      row.total += s.realised;
      const agg = segments[seg];
      agg.realised += s.realised;
      if (s.realised !== 0) agg.days += 1;
      for (const [sym, v] of Object.entries(s.symbols)) agg.symbols[sym] = (agg.symbols[sym] ?? 0) + v;
      if (typeof s.charges === 'number') {
        if (s.charges !== 0) {
          charges[seg] += s.charges;
          (chargesByDate[d.date] ??= {})[seg] = s.charges;
        }
      } else if (s.realised !== 0) {
        unpriced.add(d.date);
      }
    }
    if (any) seen.add(d.date);
    row.total = round2(row.total);
    daily.push(row);
  }

  for (const s of Object.values(segments)) {
    s.realised = round2(s.realised);
    for (const k of Object.keys(s.symbols)) s.symbols[k] = round2(s.symbols[k]);
  }
  const traded = daily.filter((d) => d.total !== 0);
  const best = traded.reduce<HistoryDay | null>((a, d) => (!a || d.total > a.total ? d : a), null);
  const worst = traded.reduce<HistoryDay | null>((a, d) => (!a || d.total < a.total ? d : a), null);

  // Gaps only count from where the data starts: a range reaching back to 1947
  // isn't "missing" decades before the first trade or upload.
  const starts = [...days.map((d) => d.date), ...covered.map(([f]) => f)].sort();
  const start = starts.length && starts[0] > from ? starts[0] : from;
  let missingWeekdays = 0;
  for (let t = Date.parse(`${start}T00:00:00Z`); starts.length && t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const dt = new Date(t);
    const wd = dt.getUTCDay();
    const day = dt.toISOString().slice(0, 10);
    if (wd !== 0 && wd !== 6 && !seen.has(day) && !covered.some(([f, t]) => day >= f && day <= t)) missingWeekdays += 1;
  }

  return {
    total: round2(Object.values(segments).reduce((a, s) => a + s.realised, 0)),
    segments,
    daily,
    profitDays: traded.filter((d) => d.total > 0).length,
    lossDays: traded.filter((d) => d.total < 0).length,
    best: best && best.total > 0 ? best : null,
    worst: worst && worst.total < 0 ? worst : null,
    missingWeekdays,
    charges: { equity: round2(charges.equity), fo: round2(charges.fo), commodity: round2(charges.commodity) },
    chargesByDate,
    unpricedDays: unpriced.size,
  };
}

/** A symbol → P&L map as chart items. */
export function symbolItems(symbols: Record<string, number>): PnlItem[] {
  return Object.entries(symbols).map(([symbol, pnl]) => ({ key: symbol, symbol, kind: 'position' as const, open: false, pnl, realised: pnl, unrealised: 0, today: 0 }));
}

/** How the history chart groups days. Years are Indian financial years (April–March). */
export type Period = 'day' | 'week' | 'month' | 'year';

export const PERIODS: { id: Period; label: string; adjective: string; noun: string }[] = [
  { id: 'day', label: 'Day', adjective: 'Daily', noun: 'day' },
  { id: 'week', label: 'Week', adjective: 'Weekly', noun: 'week' },
  { id: 'month', label: 'Month', adjective: 'Monthly', noun: 'month' },
  { id: 'year', label: 'Year', adjective: 'Yearly', noun: 'year' },
];

const DAY_MS = 86_400_000;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10);

/** First day of the period a date falls in: itself, its Monday, the 1st, or 1 April of its FY. */
export function periodStart(date: string, p: Period): string {
  const [y, m] = date.split('-').map(Number);
  switch (p) {
    case 'day':
      return date;
    case 'week': {
      const t = utc(date);
      return isoOf(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY_MS);
    }
    case 'month':
      return `${date.slice(0, 7)}-01`;
    case 'year':
      return `${m >= 4 ? y : y - 1}-04-01`;
  }
}

function nextStart(start: string, p: Period): string {
  const [y, m] = start.split('-').map(Number);
  switch (p) {
    case 'day':
      return isoOf(utc(start) + DAY_MS);
    case 'week':
      return isoOf(utc(start) + 7 * DAY_MS);
    case 'month':
      return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    case 'year':
      return `${y + 1}-04-01`;
  }
}

/** The period a range reads best in when the user hasn't picked one. */
export function defaultPeriod(from: string, to: string): Period {
  const days = (utc(to) - utc(from)) / DAY_MS;
  return days <= 92 ? 'day' : 'month';
}

/**
 * Days summed into periods, oldest first, each dated by its first day. Weeks,
 * months and years include empty periods between the first and last with P&L
 * (so bars sit on a true time scale) while that stays under `maxBars`; days
 * are only those with a record.
 */
export function groupByPeriod(daily: HistoryDay[], p: Period, maxBars = 400): HistoryDay[] {
  const by = new Map<string, HistoryDay>();
  for (const d of daily) {
    const k = periodStart(d.date, p);
    const g = by.get(k) ?? { date: k, equity: 0, fo: 0, commodity: 0, total: 0 };
    g.equity = round2(g.equity + d.equity);
    g.fo = round2(g.fo + d.fo);
    g.commodity = round2(g.commodity + d.commodity);
    g.total = round2(g.total + d.total);
    by.set(k, g);
  }
  const keys = [...by.keys()].sort();
  if (p === 'day' || keys.length < 2) return keys.map((k) => by.get(k)!);
  const filled: HistoryDay[] = [];
  for (let k = keys[0]; k <= keys[keys.length - 1]; k = nextStart(k, p)) {
    filled.push(by.get(k) ?? { date: k, equity: 0, fo: 0, commodity: 0, total: 0 });
    if (filled.length > maxBars) return keys.map((key) => by.get(key)!);
  }
  return filled;
}

/** A period's name: short for the chart axis, long for figures. */
export function periodLabel(start: string, p: Period, long = false): string {
  const fmt = (o: Intl.DateTimeFormatOptions) => new Date(`${start}T00:00:00Z`).toLocaleDateString('en-IN', { ...o, timeZone: 'UTC' });
  switch (p) {
    case 'day':
      return long ? fmt({ day: 'numeric', month: 'short', year: 'numeric' }) : fmt({ day: 'numeric', month: 'short' });
    case 'week':
      return long ? `Week of ${fmt({ day: 'numeric', month: 'short', year: 'numeric' })}` : fmt({ day: 'numeric', month: 'short', year: '2-digit' });
    case 'month':
      return long ? fmt({ month: 'long', year: 'numeric' }) : fmt({ month: 'short', year: '2-digit' });
    case 'year': {
      const y = Number(start.slice(0, 4));
      return long ? `FY ${y}-${String(y + 1).slice(2)}` : `FY${String(y).slice(2)}-${String(y + 1).slice(2)}`;
    }
  }
}

/** One point of the running P&L: the period's P&L, the total so far, its high-water mark and the fall from it. */
export interface CumPoint {
  date: string;
  value: number;
  cum: number;
  /** Highest running total so far (at least 0: the range starts flat). */
  peak: number;
  /** cum − peak: 0 at a new high, negative while below it. */
  drawdown: number;
}

/** Running total of realised P&L across periods, with the drawdown from its peak. */
export function cumulativeSeries(groups: HistoryDay[]): CumPoint[] {
  let cum = 0;
  let peak = 0;
  return groups.map((g) => {
    cum = round2(cum + g.total);
    peak = Math.max(peak, cum);
    return { date: g.date, value: g.total, cum, peak, drawdown: round2(cum - peak) };
  });
}

/** The deepest fall from a peak: how much, from when, to when, and when (if ever) it was made back. */
export function maxDrawdown(points: CumPoint[]): { amount: number; peakDate: string | null; troughDate: string; recoveredDate: string | null } | null {
  let worst: CumPoint | null = null;
  for (const p of points) if (p.drawdown < 0 && (!worst || p.drawdown < worst.drawdown)) worst = p;
  if (!worst) return null;
  const i = points.indexOf(worst);
  // The peak is the last point before the trough sitting at that high-water mark (none if it was the start).
  let peakDate: string | null = null;
  for (let j = i - 1; j >= 0; j--) {
    if (points[j].cum === worst.peak) {
      peakDate = points[j].date;
      break;
    }
  }
  const recovered = points.slice(i + 1).find((p) => p.cum >= worst!.peak);
  return { amount: worst.drawdown, peakDate, troughDate: worst.date, recoveredDate: recovered?.date ?? null };
}

/** The summary's days with each segment's charges taken off: net P&L per day. */
export function netDaily(sum: HistorySummary): HistoryDay[] {
  return sum.daily.map((d) => {
    const c = sum.chargesByDate[d.date] ?? {};
    const row = { date: d.date, equity: round2(d.equity - (c.equity ?? 0)), fo: round2(d.fo - (c.fo ?? 0)), commodity: round2(d.commodity - (c.commodity ?? 0)), total: 0 };
    row.total = round2(row.equity + row.fo + row.commodity);
    return row;
  });
}
