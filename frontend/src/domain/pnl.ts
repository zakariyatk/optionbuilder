import type { ZerodhaPnl, ZerodhaPosition } from '../api/types';

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
