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

  let missingWeekdays = 0;
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
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
  };
}

/** A symbol → P&L map as chart items. */
export function symbolItems(symbols: Record<string, number>): PnlItem[] {
  return Object.entries(symbols).map(([symbol, pnl]) => ({ key: symbol, symbol, kind: 'position' as const, open: false, pnl, realised: pnl, unrealised: 0, today: 0 }));
}
