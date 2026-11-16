/**
 * Price-action levels for the AI Trade page, computed in the browser from
 * candles: swing points, support / resistance zones, fair value gaps, order
 * blocks, market structure, and a rule-based trade plan with a stop loss and
 * targets. Claude reviews this (aiBrief.ts); the chart draws it.
 *
 * Every function is pure and works on bars oldest first.
 */

export interface Bar {
  /** Epoch ms. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Side = 'bull' | 'bear';

export interface Swing {
  index: number;
  time: number;
  price: number;
  type: 'high' | 'low';
}

export interface Zone {
  kind: 'support' | 'resistance' | 'fvg' | 'ob';
  /** bull = demand below price (support, bullish FVG / OB); bear = supply above. */
  side: Side;
  top: number;
  bottom: number;
  /** Epoch ms the zone starts from, for drawing. */
  from: number;
  /** Swing points that formed it (support / resistance only). */
  touches?: number;
}

export interface StructureBreak {
  index: number;
  time: number;
  /** The swing level that was closed through, and when that swing formed (epoch ms). */
  price: number;
  from: number;
  side: Side;
}

export type Action = 'BUY' | 'SELL' | 'WAIT';

export interface TradePlan {
  action: Action;
  entry: number | null;
  stop: number | null;
  targets: number[];
  /** Reward to the first target per unit of risk. */
  rr: number | null;
  reason: string;
}

export interface Levels {
  atr: number;
  trend: 'up' | 'down' | 'range';
  last: Bar;
  swings: Swing[];
  breaks: StructureBreak[];
  supports: Zone[];
  resistances: Zone[];
  fvgs: Zone[];
  orderBlocks: Zone[];
  plan: TradePlan;
}

/** Wilder's average true range over the last `period` bars. */
export function atr(bars: Bar[], period = 14): number {
  if (bars.length < 2) return bars[0] ? bars[0].high - bars[0].low : 0;
  let value = 0;
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const prev = bars[i - 1].close;
    const tr = Math.max(b.high - b.low, Math.abs(b.high - prev), Math.abs(b.low - prev));
    value = i <= period ? value + (tr - value) / i : value + (tr - value) / period;
  }
  return value;
}

/** Fractal swing highs / lows: a bar higher (lower) than `k` bars each side. */
export function swings(bars: Bar[], k = 3): Swing[] {
  const out: Swing[] = [];
  for (let i = k; i < bars.length - k; i++) {
    let high = true;
    let low = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      // Ties to the left disqualify, so a flat top marks once (its last bar).
      if (j < i ? bars[j].high >= bars[i].high : bars[j].high > bars[i].high) high = false;
      if (j < i ? bars[j].low <= bars[i].low : bars[j].low < bars[i].low) low = false;
    }
    if (high) out.push({ index: i, time: bars[i].time, price: bars[i].high, type: 'high' });
    if (low) out.push({ index: i, time: bars[i].time, price: bars[i].low, type: 'low' });
  }
  return out;
}

/**
 * Support and resistance: swing prices clustered within `tol` of each other.
 * Zones below the last close are support, above it resistance; nearest first,
 * preferring levels touched at least twice.
 */
export function supportResistance(bars: Bar[], points: Swing[], range: number, perSide = 3): { supports: Zone[]; resistances: Zone[] } {
  const close = bars[bars.length - 1]?.close ?? 0;
  const tol = range * 0.6;
  const sorted = [...points].sort((a, b) => a.price - b.price);
  const clusters: Swing[][] = [];
  for (const p of sorted) {
    const cur = clusters[clusters.length - 1];
    if (cur && p.price - cur[0].price <= tol) cur.push(p);
    else clusters.push([p]);
  }
  const minHeight = range * 0.15;
  const zones = clusters.map((c): Zone => {
    let bottom = Math.min(...c.map((p) => p.price));
    let top = Math.max(...c.map((p) => p.price));
    if (top - bottom < minHeight) {
      const mid = (top + bottom) / 2;
      bottom = mid - minHeight / 2;
      top = mid + minHeight / 2;
    }
    const isSupport = (top + bottom) / 2 < close;
    return { kind: isSupport ? 'support' : 'resistance', side: isSupport ? 'bull' : 'bear', top, bottom, from: Math.min(...c.map((p) => p.time)), touches: c.length };
  });
  const pick = (list: Zone[]) => {
    const strong = list.filter((z) => (z.touches ?? 0) >= 2);
    return (strong.length >= perSide ? strong : [...strong, ...list.filter((z) => (z.touches ?? 0) < 2)]).slice(0, perSide).sort((a, b) => dist(a, close) - dist(b, close));
  };
  const byDistance = (a: Zone, b: Zone) => dist(a, close) - dist(b, close);
  return {
    supports: pick(zones.filter((z) => z.kind === 'support').sort(byDistance)),
    resistances: pick(zones.filter((z) => z.kind === 'resistance').sort(byDistance)),
  };
}

const dist = (z: Zone, price: number) => (price > z.top ? price - z.top : price < z.bottom ? z.bottom - price : 0);

/**
 * Fair value gaps: a three-bar imbalance where bar 3 doesn't trade back into
 * bar 1 (bullish: low[3] > high[1]). Later bars shrink a gap as they trade
 * into it; a gap traded through is filled and dropped.
 */
export function fairValueGaps(bars: Bar[], range: number, perSide = 3): Zone[] {
  const minSize = range * 0.1;
  const bull: Zone[] = [];
  const bear: Zone[] = [];
  for (let i = 2; i < bars.length; i++) {
    const a = bars[i - 2];
    const c = bars[i];
    if (c.low - a.high >= minSize) {
      let top = c.low;
      const bottom = a.high;
      let filled = false;
      for (let j = i + 1; j < bars.length && !filled; j++) {
        if (bars[j].low <= bottom) filled = true;
        else top = Math.min(top, bars[j].low);
      }
      if (!filled && top - bottom >= minSize / 2) bull.push({ kind: 'fvg', side: 'bull', top, bottom, from: bars[i - 1].time });
    } else if (a.low - c.high >= minSize) {
      const top = a.low;
      let bottom = c.high;
      let filled = false;
      for (let j = i + 1; j < bars.length && !filled; j++) {
        if (bars[j].high >= top) filled = true;
        else bottom = Math.max(bottom, bars[j].high);
      }
      if (!filled && top - bottom >= minSize / 2) bear.push({ kind: 'fvg', side: 'bear', top, bottom, from: bars[i - 1].time });
    }
  }
  return [...bull.slice(-perSide), ...bear.slice(-perSide)];
}

/**
 * Breaks of structure: a close through the most recent confirmed swing high
 * (bullish) or low (bearish). A swing counts once it is confirmed, `k` bars
 * after it formed, and breaks once.
 */
export function structureBreaks(bars: Bar[], points: Swing[], k = 3): StructureBreak[] {
  const out: StructureBreak[] = [];
  let high: Swing | null = null;
  let low: Swing | null = null;
  let p = 0;
  const ordered = [...points].sort((a, b) => a.index - b.index);
  for (let i = 0; i < bars.length; i++) {
    while (p < ordered.length && ordered[p].index + k <= i) {
      if (ordered[p].type === 'high') high = ordered[p];
      else low = ordered[p];
      p++;
    }
    if (high && bars[i].close > high.price) {
      out.push({ index: i, time: bars[i].time, price: high.price, from: high.time, side: 'bull' });
      high = null;
    }
    if (low && bars[i].close < low.price) {
      out.push({ index: i, time: bars[i].time, price: low.price, from: low.time, side: 'bear' });
      low = null;
    }
  }
  return out;
}

/**
 * Order blocks: the last opposite candle before a move that broke structure
 * (the last down candle before a bullish break, and the reverse). A block
 * stays valid until a close goes through its far side.
 */
export function orderBlocks(bars: Bar[], breaks: StructureBreak[], perSide = 2): Zone[] {
  const bull: Zone[] = [];
  const bear: Zone[] = [];
  const seen = new Set<number>();
  for (const b of breaks) {
    const want = b.side === 'bull' ? (x: Bar) => x.close < x.open : (x: Bar) => x.close > x.open;
    let k = b.index - 1;
    // Look back along the impulse (at most 15 bars) for the candle it started from.
    while (k >= 0 && b.index - k <= 15 && !want(bars[k])) k--;
    if (k < 0 || b.index - k > 15 || seen.has(k)) continue;
    seen.add(k);
    const ob = bars[k];
    const zone: Zone = { kind: 'ob', side: b.side, top: ob.high, bottom: ob.low, from: ob.time };
    let broken = false;
    for (let j = k + 1; j < bars.length && !broken; j++) {
      broken = b.side === 'bull' ? bars[j].close < zone.bottom : bars[j].close > zone.top;
    }
    if (!broken) (b.side === 'bull' ? bull : bear).push(zone);
  }
  return [...bull.slice(-perSide), ...bear.slice(-perSide)];
}

/** Trend from the latest break of structure, unless that break is stale. */
export function trendOf(bars: Bar[], breaks: StructureBreak[]): Levels['trend'] {
  const last = breaks[breaks.length - 1];
  if (!last || bars.length - last.index > 120) return 'range';
  return last.side === 'bull' ? 'up' : 'down';
}

const MIN_RR = 1.5;

/**
 * A rule-based trade: with the trend, from a demand (supply) zone at or just
 * under (over) price. Stop beyond the zone with a quarter-ATR buffer;
 * targets at the next opposing levels, else 2R and 3R. Below 1.5R it waits.
 */
export function tradePlan(l: Omit<Levels, 'plan'>): TradePlan {
  const close = l.last.close;
  const wait = (reason: string): TradePlan => ({ action: 'WAIT', entry: null, stop: null, targets: [], rr: null, reason });
  if (!(l.atr > 0)) return wait('Not enough data.');
  if (l.trend === 'range') return wait('No clear trend: no recent break of structure.');

  const long = l.trend === 'up';
  const side: Side = long ? 'bull' : 'bear';
  const zones = [...(long ? l.supports : l.resistances), ...l.orderBlocks, ...l.fvgs].filter((z) => z.side === side);
  // A zone price is sitting in, or within 1.5 ATR of.
  const near = zones
    .filter((z) => (long ? z.bottom <= close && close - z.top <= 1.5 * l.atr : z.top >= close && z.bottom - close <= 1.5 * l.atr))
    .sort((a, b) => dist(a, close) - dist(b, close));
  const zone = near[0];
  if (!zone) return wait(`Trend is ${l.trend}, but price is not at a ${long ? 'demand' : 'supply'} zone. Wait for a pullback.`);
  // Buying into resistance (selling into support) right away: let price clear it first.
  const blocking = (long ? l.resistances : l.supports).find((z) => dist(z, close) <= l.atr * 0.25);
  if (blocking)
    return wait(`Trend is ${l.trend} and price is at a ${long ? 'demand' : 'supply'} zone, but it is sitting on ${long ? 'resistance' : 'support'} (${blocking.bottom.toFixed(2)}–${blocking.top.toFixed(2)}). Wait for a clean break or a rejection.`);

  const buffer = l.atr * 0.25;
  let stop = long ? zone.bottom - buffer : zone.top + buffer;
  // Never a stop tighter than half an ATR: noise would take it out.
  if (Math.abs(close - stop) < l.atr * 0.5) stop = long ? close - l.atr * 0.5 : close + l.atr * 0.5;
  const risk = Math.abs(close - stop);

  const opposing = (long ? l.resistances.map((z) => z.bottom) : l.supports.map((z) => z.top))
    .filter((p) => (long ? p - close >= risk : close - p >= risk))
    .sort((a, b) => (long ? a - b : b - a));
  const targets = opposing.slice(0, 2);
  const step = (r: number) => (long ? close + r * risk : close - r * risk);
  if (targets.length === 0) targets.push(step(2), step(3));
  else if (targets.length === 1) targets.push(step(Math.max(3, Math.abs(targets[0] - close) / risk + 1)));

  const rr = Math.abs(targets[0] - close) / risk;
  const what = zone.kind === 'ob' ? 'order block' : zone.kind === 'fvg' ? 'fair value gap' : zone.kind;
  if (rr < MIN_RR) return wait(`At a ${what}, but the first target is only ${rr.toFixed(1)}R away.`);
  return {
    action: long ? 'BUY' : 'SELL',
    entry: close,
    stop,
    targets,
    rr,
    reason: `${long ? 'Uptrend' : 'Downtrend'} (last break of structure ${long ? 'up' : 'down'}), price at a ${long ? 'bullish' : 'bearish'} ${what}.`,
  };
}

/** Everything the page shows, from the bars on the chart. */
export function computeLevels(bars: Bar[]): Levels | null {
  if (bars.length < 30) return null;
  const k = 3;
  const range = atr(bars);
  const pts = swings(bars, k);
  const breaks = structureBreaks(bars, pts, k);
  const { supports, resistances } = supportResistance(bars, pts.slice(-60), range);
  const base = {
    atr: range,
    trend: trendOf(bars, breaks),
    last: bars[bars.length - 1],
    swings: pts,
    breaks,
    supports,
    resistances,
    fvgs: fairValueGaps(bars, range),
    orderBlocks: orderBlocks(bars, breaks),
  };
  return { ...base, plan: tradePlan(base) };
}
