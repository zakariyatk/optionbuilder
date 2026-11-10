import type { SpotQuote } from '../api/types';

/**
 * Live prices from Binance's public market data, fetched by the browser
 * (Binance allows any origin, and needs no key). Gold charts PAX Gold
 * (PAXG/USDT): a token backed 1:1 by a troy ounce of London gold, so it
 * follows spot gold tick for tick — with no delay, where Yahoo's COMEX
 * futures run ~10 minutes behind. It trades 24/7, weekends included.
 */
const BINANCE_PAIRS: Record<string, string> = {
  'US:XAUUSD': 'PAXGUSDT',
};

/** Binance's market-data-only mirror first, the main API if it's unreachable. */
const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];

/** Chart timeframe → Binance interval, and how many 1000-bar pages of history to load. */
const INTERVALS: Record<string, [string, number]> = {
  '1m': ['1m', 3],
  '3m': ['3m', 2],
  '5m': ['5m', 2],
  '15m': ['15m', 1],
  '30m': ['30m', 1],
  '1h': ['1h', 1],
  '4h': ['4h', 1],
  '1D': ['1d', 1],
  '1W': ['1w', 1],
  '1M': ['1M', 1],
};

export type Candle = [number, number, number, number, number, number];

export const binancePair = (symbol: string): string | undefined => BINANCE_PAIRS[symbol];

async function get<T>(path: string): Promise<T> {
  let error: unknown;
  for (const host of HOSTS) {
    try {
      const res = await fetch(host + path, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Binance ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      error = e;
    }
  }
  throw error;
}

/** Binance kline: [openTime ms, open, high, low, close, volume, closeTime, …] with prices as strings. */
type Kline = [number, string, string, string, string, string, ...unknown[]];

const toCandle = (k: Kline): Candle => [Math.floor(k[0] / 1000), +k[1], +k[2], +k[3], +k[4], +k[5]];

/** Candles shaped like /api/candles: [unix seconds, open, high, low, close, volume], oldest first. */
export async function binanceCandles(
  symbol: string,
  tf: string,
  /** Unix ms: only the bars from this one on (one request), for a live poll that already has the history. */
  since?: number,
): Promise<{ symbol: string; tf: string; candles: Candle[] }> {
  const pair = binancePair(symbol);
  const spec = INTERVALS[tf];
  if (!pair || !spec) throw new Error(`No Binance data for ${symbol} ${tf}`);
  const [interval, pages] = spec;
  if (since) {
    const q = new URLSearchParams({ symbol: pair, interval, startTime: String(since), limit: '1000' });
    return { symbol, tf, candles: (await get<Kline[]>(`/api/v3/klines?${q}`)).map(toCandle) };
  }
  let candles: Candle[] = [];
  let end: number | null = null;
  for (let p = 0; p < pages; p++) {
    const q = new URLSearchParams({ symbol: pair, interval, limit: '1000' });
    if (end !== null) q.set('endTime', String(end));
    const page = (await get<Kline[]>(`/api/v3/klines?${q}`)).map(toCandle);
    if (!page.length) break;
    candles = page.concat(candles);
    end = page[0][0] * 1000 - 1;
    // A young pair runs out of history before the last page.
    if (page.length < 1000) break;
  }
  return { symbol, tf, candles };
}

interface Ticker24h {
  lastPrice: string;
  openPrice: string;
  closeTime: number;
}

/** A live quote shaped like /api/spot. The change is over the last 24 hours (Binance never closes). */
export async function binanceQuote(symbol: string): Promise<SpotQuote> {
  const pair = binancePair(symbol);
  if (!pair) throw new Error(`No Binance data for ${symbol}`);
  const t = await get<Ticker24h>(`/api/v3/ticker/24hr?symbol=${pair}`);
  return {
    symbol,
    ticker: pair,
    price: +t.lastPrice,
    previousClose: +t.openPrice,
    currency: 'USD',
    marketTime: Math.floor(Math.min(t.closeTime, Date.now()) / 1000),
  };
}
