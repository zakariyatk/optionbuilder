import type { ChainRow, ChainSide } from '../api/types';

const INDEX_STRIKE_STEP: Record<string, number> = { NIFTY: 50, BANKNIFTY: 100, FINNIFTY: 50, MIDCPNIFTY: 25 };

/** Strike spacing — the exchange's for indices, else ~1.5% of spot rounded to a clean number. */
export function strikeStep(symbol: string, spot: number): number {
  if (INDEX_STRIKE_STEP[symbol]) return INDEX_STRIKE_STEP[symbol];
  const raw = spot * 0.015;
  const magnitude = 10 ** Math.floor(Math.log10(raw || 1));
  return Math.max(Math.round(raw / magnitude) * magnitude, 1);
}

/** A synthetic strike ladder around spot, for manual entry when no live chain is available. */
export function generateStrikes(symbol: string, spot: number, count = 20): number[] {
  const step = strikeStep(symbol, spot);
  const atm = Math.round(spot / step) * step;
  const half = Math.floor(count / 2);
  return Array.from({ length: half * 2 + 1 }, (_, i) => atm + (i - half) * step);
}

export function nearestRow(rows: ChainRow[], spot: number): ChainRow | null {
  if (rows.length === 0) return null;
  return rows.reduce((best, r) => (Math.abs(r.strike - spot) < Math.abs(best.strike - spot) ? r : best));
}

/** ATM implied volatility (average of call and put), used to price legs that carry no IV of their own. */
export function atmIv(rows: ChainRow[], spot: number | null): number | null {
  if (!spot) return null;
  const atm = nearestRow(rows, spot);
  if (!atm) return null;
  const ivs = [atm.call?.iv, atm.put?.iv].filter((v): v is number => !!v && v > 0);
  return ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;
}

// --------------------------------------------------------- unusual activity

/** Each side is compared against this many strikes either way. */
const NEIGHBOURS = 4;
/** A strike must be this many times its neighbourhood median to be flagged. */
const MIN_RATIO = 4;
/** Absolute floors, so a 40-lot spike on a dead far strike doesn't light up. */
const FLOORS = { oi: 50_000, volume: 10_000, oiChange: 25_000 } as const;

export type ActivityKind = keyof typeof FLOORS;

export interface UnusualFlag {
  kind: ActivityKind;
  side: 'call' | 'put';
  ratio: number;
  value: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function neighbourhoodMedian(values: number[], i: number): number {
  const around: number[] = [];
  for (let j = Math.max(0, i - NEIGHBOURS); j <= Math.min(values.length - 1, i + NEIGHBOURS); j++) {
    if (j !== i) around.push(values[j]);
  }
  return median(around);
}

function metric(side: ChainSide | null, kind: ActivityKind): number {
  if (!side) return 0;
  if (kind === 'oi') return side.oi ?? 0;
  if (kind === 'volume') return side.volume ?? 0;
  return Math.abs(side.oiChange ?? 0);
}

/**
 * Strikes whose OI, volume or OI change stands out against nearby strikes.
 * Relative to the neighbourhood rather than the whole chain, so the naturally
 * heavy ATM region doesn't drown out a genuine wall further out.
 */
export function detectUnusual(rows: ChainRow[]): Map<number, UnusualFlag[]> {
  const flags = new Map<number, UnusualFlag[]>();
  if (rows.length < NEIGHBOURS * 2 + 1) return flags;

  for (const side of ['call', 'put'] as const) {
    for (const kind of Object.keys(FLOORS) as ActivityKind[]) {
      const values = rows.map((r) => metric(r[side], kind));
      values.forEach((value, i) => {
        if (value < FLOORS[kind]) return;
        const ratio = value / Math.max(neighbourhoodMedian(values, i), FLOORS[kind] / MIN_RATIO);
        if (ratio < MIN_RATIO) return;
        const list = flags.get(rows[i].strike) ?? [];
        list.push({ kind, side, ratio, value });
        flags.set(rows[i].strike, list);
      });
    }
  }
  return flags;
}

const KIND_LABEL: Record<ActivityKind, string> = {
  oi: 'OI wall',
  volume: 'volume surge',
  oiChange: 'position build-up',
};

export function describeFlags(flags: UnusualFlag[]): string {
  return flags
    .map((f) => `${f.side === 'call' ? 'Call' : 'Put'} ${KIND_LABEL[f.kind]} — ${f.ratio.toFixed(1)}× nearby strikes`)
    .join(' · ');
}

export type OiMode = 'oi' | 'change';

export interface StrikeOi {
  strike: number;
  call: number;
  put: number;
}

/**
 * Per-strike call / put open interest (or its change) for strikes inside
 * [min, max], plus the largest absolute value — the scale for OI bars drawn
 * behind the payoff chart — and the narrowest strike spacing, for bar width.
 */
export function strikeOi(rows: ChainRow[], min: number, max: number, mode: OiMode) {
  const pick = (s: ChainRow['call']) => (s ? (mode === 'oi' ? s.oi : s.oiChange) : 0);
  const bars: StrikeOi[] = rows
    .filter((r) => r.strike >= min && r.strike <= max && (r.call || r.put))
    .map((r) => ({ strike: r.strike, call: pick(r.call), put: pick(r.put) }))
    .sort((a, b) => a.strike - b.strike);
  const peak = bars.reduce((m, b) => Math.max(m, Math.abs(b.call), Math.abs(b.put)), 0);
  let step = Infinity;
  for (let i = 1; i < bars.length; i++) step = Math.min(step, bars[i].strike - bars[i - 1].strike);
  return { bars, peak, step: Number.isFinite(step) ? step : null };
}
