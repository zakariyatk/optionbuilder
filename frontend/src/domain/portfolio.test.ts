import { describe, expect, it } from 'vitest';
import type { PortfolioTxn } from '../api/types';
import {
  benchmarkSeries,
  betaAlpha,
  buildBook,
  monthlyReturns,
  portfolioSeries,
  rebase,
  seriesStats,
  validateTxn,
  valueBook,
  type PricePoints,
} from './portfolio';

let n = 0;
const txn = (p: Partial<PortfolioTxn>): PortfolioTxn => ({
  id: `t${n++}`,
  kind: 'STOCK',
  side: 'BUY',
  symbol: 'INFY',
  date: '2026-01-05',
  qty: 10,
  price: 100,
  fees: 0,
  ...p,
});

/** Unix seconds at 10:00 UTC (15:30 IST) on a date. */
const ts = (d: string) => Date.parse(`${d}T10:00:00Z`) / 1000;
const pts = (rows: [string, number][]): PricePoints => rows.map(([d, c]) => [ts(d), c]);

describe('buildBook — stocks', () => {
  it('averages cost across buys, fees included', () => {
    const book = buildBook([txn({ qty: 10, price: 100, fees: 10 }), txn({ qty: 10, price: 120, date: '2026-01-06' })]);
    const h = book.stocks[0];
    expect(h.qty).toBe(20);
    expect(h.avgCost).toBeCloseTo(110.5);
    expect(h.invested).toBeCloseTo(2210);
  });

  it('books realised P&L at average cost on a sell and keeps the average', () => {
    const book = buildBook([
      txn({ qty: 10, price: 100 }),
      txn({ qty: 10, price: 120, date: '2026-01-06' }),
      txn({ side: 'SELL', qty: 5, price: 130, fees: 5, date: '2026-01-07' }),
    ]);
    const h = book.stocks[0];
    expect(h.qty).toBe(15);
    expect(h.avgCost).toBeCloseTo(110);
    expect(h.realized).toBeCloseTo(5 * 20 - 5);
    expect(book.realized).toBeCloseTo(95);
  });

  it('processes transactions in date order regardless of entry order', () => {
    const book = buildBook([txn({ side: 'SELL', qty: 10, price: 150, date: '2026-02-01' }), txn({ qty: 10, price: 100 })]);
    expect(book.stocks[0].qty).toBe(0);
    expect(book.realized).toBeCloseTo(500);
  });
});

describe('buildBook — futures', () => {
  const fut = (p: Partial<PortfolioTxn>) => txn({ kind: 'FUT', symbol: 'NIFTY', lotSize: 65, expiry: '2026-10-27', qty: 1, ...p });

  it('averages adds and realises on a partial close', () => {
    const book = buildBook([fut({ qty: 1, price: 24000 }), fut({ qty: 1, price: 24100 }), fut({ side: 'SELL', qty: 1, price: 24200 })]);
    const f = book.futures[0];
    expect(f.lots).toBe(1);
    expect(f.avgEntry).toBeCloseTo(24050);
    expect(f.realized).toBeCloseTo(150 * 65);
  });

  it('handles a short and a flip', () => {
    const book = buildBook([fut({ side: 'SELL', qty: 2, price: 24000 }), fut({ side: 'BUY', qty: 3, price: 23900 })]);
    const f = book.futures[0];
    expect(f.lots).toBe(1);
    expect(f.avgEntry).toBe(23900);
    expect(f.realized).toBeCloseTo(2 * 65 * 100);
  });
});

describe('validateTxn', () => {
  const held = [txn({ qty: 10, date: '2026-01-05' })];

  it('rejects selling more than was held on that date', () => {
    expect(validateTxn(held, txn({ side: 'SELL', qty: 11, date: '2026-01-06' }))).toMatch(/held only 10/);
    expect(validateTxn(held, txn({ side: 'SELL', qty: 5, date: '2026-01-04' }))).toMatch(/held no INFY/);
    expect(validateTxn(held, txn({ side: 'SELL', qty: 10, date: '2026-01-06' }))).toBeNull();
  });

  it('rejects a backdated sell that breaks a later one', () => {
    const book = [...held, txn({ side: 'SELL', qty: 8, date: '2026-03-01' })];
    expect(validateTxn(book, txn({ side: 'SELL', qty: 5, date: '2026-02-01' }))).toMatch(/later INFY sell/);
  });

  it('checks basic fields', () => {
    expect(validateTxn([], txn({ price: 0 }))).toMatch(/price/);
    expect(validateTxn([], txn({ qty: 1.5 }))).toMatch(/whole number/);
    expect(validateTxn([], txn({ kind: 'FUT', expiry: undefined, lotSize: undefined }))).toMatch(/expiry/);
  });
});

describe('valueBook', () => {
  it('totals value, cost, unrealised, realised and the day move', () => {
    const book = buildBook([
      txn({ qty: 10, price: 100 }),
      txn({ side: 'SELL', qty: 4, price: 110, date: '2026-01-06' }),
      txn({ kind: 'FUT', symbol: 'NIFTY', lotSize: 50, expiry: '2026-10-27', qty: 1, price: 24000 }),
    ]);
    const v = valueBook(book, { INFY: { price: 120, previousClose: 115 }, NIFTY: { price: 24100, previousClose: 24080 } }, {}, '2026-10-10');
    expect(v.currentValue).toBe(720);
    expect(v.invested).toBe(600);
    expect(v.unrealizedStocks).toBe(120);
    expect(v.unrealizedFutures).toBe(100 * 50);
    expect(v.realized).toBe(40);
    expect(v.totalPnl).toBe(120 + 5000 + 40);
    expect(v.dayPnl).toBe(6 * 5 + 50 * 20);
  });

  it('counts shares bought today from their purchase price', () => {
    const book = buildBook([txn({ qty: 10, price: 100, date: '2026-01-05' }), txn({ qty: 10, price: 118, date: '2026-10-10' })]);
    const v = valueBook(book, { INFY: { price: 120, previousClose: 115 } }, {}, '2026-10-10');
    expect(v.dayPnl).toBeCloseTo(10 * 5 + 10 * 2);
  });

  it('prefers the future’s own LTP over the underlying', () => {
    const book = buildBook([txn({ kind: 'FUT', symbol: 'NIFTY', lotSize: 50, expiry: '2026-10-27', qty: 1, price: 24000, instrumentKey: 'NSE_FO|1' })]);
    const v = valueBook(book, { NIFTY: { price: 24100, previousClose: 24000 } }, { 'NSE_FO|1': 24150 });
    expect(v.unrealizedFutures).toBe(150 * 50);
  });
});

describe('performance', () => {
  const cal = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08'];

  it('is unaffected by adding money (time-weighted)', () => {
    const history = { INFY: pts([['2026-01-05', 100], ['2026-01-06', 110], ['2026-01-07', 110], ['2026-01-08', 121]]) };
    const once = portfolioSeries([txn({ qty: 10, price: 100 })], history, cal);
    const topUp = portfolioSeries([txn({ qty: 10, price: 100 }), txn({ qty: 90, price: 110, date: '2026-01-07' })], history, cal);
    expect(once[once.length - 1].value).toBeCloseTo(1.21);
    expect(topUp[topUp.length - 1].value).toBeCloseTo(1.21);
  });

  it('includes futures P&L from the underlying', () => {
    const history = {
      INFY: pts([['2026-01-05', 100], ['2026-01-06', 100], ['2026-01-07', 100], ['2026-01-08', 100]]),
      NIFTY: pts([['2026-01-05', 1000], ['2026-01-06', 1010], ['2026-01-07', 1010], ['2026-01-08', 1010]]),
    };
    const s = portfolioSeries(
      [txn({ qty: 100, price: 100 }), txn({ kind: 'FUT', symbol: 'NIFTY', lotSize: 10, expiry: '2026-12-29', qty: 1, price: 1000 })],
      history,
      cal,
    );
    // 10 units × +10 on a ₹10,000 stock base = +1%
    expect(s[1].value).toBeCloseTo(1.01);
  });

  it('builds benchmarks with FX conversion and rebases', () => {
    const spx = pts([['2026-01-05', 100], ['2026-01-07', 110]]);
    const fx = pts([['2026-01-05', 80], ['2026-01-06', 80], ['2026-01-07', 88]]);
    const usd = benchmarkSeries(spx, cal);
    const inr = benchmarkSeries(spx, cal, fx);
    expect(usd.map((p) => p.value)).toEqual([1, 1, 1.1, 1.1]);
    expect(inr[2].value).toBeCloseTo(1.21);
    expect(rebase(inr, '2026-01-07')[0].value).toBe(1);
  });

  it('computes return, drawdown, beta and monthly returns', () => {
    const s = [1, 1.1, 0.99, 1.2].map((value, i) => ({ date: cal[i], value }));
    const st = seriesStats(s)!;
    expect(st.totalReturn).toBeCloseTo(20);
    expect(st.maxDrawdown).toBeCloseTo(-10);

    const days = Array.from({ length: 60 }, (_, i) => `2026-0${1 + Math.floor(i / 30)}-${String((i % 30) + 1).padStart(2, '0')}`);
    let b = 1;
    let p = 1;
    const bench = days.map((date, i) => ({ date, value: (b *= 1 + (i % 2 ? 0.01 : -0.008)) }));
    const port = days.map((date, i) => ({ date, value: (p *= 1 + 2 * (i % 2 ? 0.01 : -0.008)) }));
    expect(betaAlpha(port, bench)!.beta).toBeCloseTo(2, 1);
    expect(monthlyReturns(port).map((m) => m.month)).toEqual(['2026-01', '2026-02']);
  });
});
