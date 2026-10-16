import { api } from '../../api/client';
import type { PortfolioTxn } from '../../api/types';
import { istDate, type PricePoints } from '../../domain/portfolio';

/**
 * A sample portfolio for trying the page: Indian and US stocks bought (and one
 * partly sold) on past dates at those days' real closing prices, plus a NIFTY
 * future when a contract is listed. Symbols the price feed can't serve are
 * skipped, so it works on any server.
 */
const STOCKS: { symbol: string; daysAgo: number; qty: number; side?: 'SELL' }[] = [
  { symbol: 'HDFCBANK', daysAgo: 700, qty: 80 },
  { symbol: 'INFY', daysAgo: 620, qty: 90 },
  { symbol: 'RELIANCE', daysAgo: 540, qty: 100 },
  { symbol: 'TCS', daysAgo: 420, qty: 30 },
  { symbol: 'ICICIBANK', daysAgo: 360, qty: 65 },
  { symbol: 'US:AAPL', daysAgo: 330, qty: 15 },
  { symbol: 'US:NVDA', daysAgo: 210, qty: 40 },
  { symbol: 'US:MSFT', daysAgo: 150, qty: 10 },
  { symbol: 'INFY', daysAgo: 120, qty: 30, side: 'SELL' },
];

/** The last close on or before `daysAgo` days back, with its date. */
function closeAgo(points: PricePoints | undefined, daysAgo: number): { date: string; price: number } | null {
  if (!points?.length) return null;
  const target = Date.now() / 1000 - daysAgo * 86_400;
  let hit: [number, number] | null = null;
  for (const p of points) {
    if (p[0] > target) break;
    hit = p;
  }
  return hit ? { date: istDate(hit[0]), price: Math.round(hit[1] * 100) / 100 } : null;
}

export async function buildDemoTransactions(): Promise<PortfolioTxn[]> {
  const symbols = [...new Set(STOCKS.map((s) => s.symbol))];
  const { series } = await api.history([...symbols, 'USDINR', 'NIFTY'], '5y');

  const txns: PortfolioTxn[] = [];
  for (const s of STOCKS) {
    const at = closeAgo(series[s.symbol]?.points, s.daysAgo);
    if (!at) continue;
    // A sell needs its buy; skip it if that symbol's buy was skipped.
    if (s.side === 'SELL' && !txns.some((t) => t.symbol === s.symbol && t.side === 'BUY')) continue;
    const us = s.symbol.startsWith('US:');
    const fx = us ? closeAgo(series.USDINR?.points, s.daysAgo)?.price : undefined;
    if (us && !fx) continue;
    txns.push({
      id: crypto.randomUUID(),
      kind: 'STOCK',
      side: s.side ?? 'BUY',
      symbol: s.symbol,
      date: at.date,
      qty: s.qty,
      price: at.price,
      // Roughly what brokerage and taxes cost: 0.1% in India, $1 a trade in the US.
      fees: us ? 1 : Math.round(s.qty * at.price * 0.001),
      ...(us ? { fx } : {}),
      note: 'Demo',
    });
  }

  // One long NIFTY future, entered ten days ago, on the nearest contract that's still a week out.
  try {
    const { contracts } = await api.futures('NIFTY');
    const weekOut = istDate(Math.floor(Date.now() / 1000) + 7 * 86_400);
    const contract = contracts.find((c) => c.expiry >= weekOut);
    const entry = closeAgo(series.NIFTY?.points, 10);
    if (contract && entry) {
      txns.push({
        id: crypto.randomUUID(),
        kind: 'FUT',
        side: 'BUY',
        symbol: 'NIFTY',
        date: entry.date,
        qty: 1,
        price: Math.round(entry.price + 40),
        fees: 60,
        lotSize: contract.lotSize,
        expiry: contract.expiry,
        instrumentKey: contract.instrumentKey,
        note: 'Demo',
      });
    }
  } catch {
    /* futures are optional in the demo */
  }

  if (txns.length === 0) throw new Error('Couldn’t load prices for the demo stocks. Try again in a moment.');
  return txns;
}
