import type { PortfolioTxn } from '../api/types';
import { isUs } from '../lib/markets';

/**
 * Portfolio accounting: holdings from transactions, live valuation, and a
 * time-weighted performance series with the usual risk statistics.
 *
 * Everything is derived from the raw transaction list, so editing or deleting
 * a transaction recomputes the whole book consistently.
 *
 * Totals are in rupees. A US stock's prices and fees are in dollars and each
 * of its transactions carries the USD/INR rate of its date (`fx`), so its cost
 * in rupees is fixed at what was actually paid and a later move in the rupee
 * shows up as currency gain.
 */

/** Live USD/INR is quoted under this key alongside the stock quotes. */
export const FX_KEY = 'USDINR';

/** Share counts, rounded so fractional US shares (0.1 + 0.2) don't leave float dust like 0.30000000000000004. */
const roundQty = (q: number) => Math.round(q * 1e6) / 1e6;

/** US stocks trade in fractions of a share; NSE shares and futures lots are whole. */
export const allowsFractional = (t: Pick<PortfolioTxn, 'kind' | 'symbol'>) => t.kind === 'STOCK' && isUs(t.symbol);

/** Rupees per unit of the transaction's currency — 1 for Indian stocks. */
const txnFx = (t: PortfolioTxn) => (isUs(t.symbol) ? (t.fx ?? 0) : 1);

// ------------------------------------------------------------------ book

export interface StockHolding {
  symbol: string;
  currency: 'INR' | 'USD';
  /** Shares held now. */
  qty: number;
  /** Average cost per share in the stock's own currency, fees included (average-cost convention). */
  avgCost: number;
  /** Average cost per share in rupees, at the exchange rates actually paid. */
  avgCostInr: number;
  /** Cost basis of the shares still held, in rupees. */
  invested: number;
  /** P&L booked by sells, net of fees, in rupees. */
  realized: number;
  firstDate: string;
  txns: PortfolioTxn[];
}

export interface FuturePosition {
  /** `SYMBOL|YYYY-MM-DD` */
  key: string;
  symbol: string;
  expiry: string;
  lotSize: number;
  /** Net lots: positive long, negative short, 0 closed. */
  lots: number;
  /** Average entry price of the open lots. */
  avgEntry: number;
  realized: number;
  instrumentKey: string | null;
  txns: PortfolioTxn[];
}

export interface Book {
  stocks: StockHolding[];
  futures: FuturePosition[];
  /** P&L booked by all sells and futures exits. */
  realized: number;
}

const EPS = 1e-9;

/** Date order; same-day transactions keep the order they were entered in. */
export function sortTxns(txns: PortfolioTxn[]): PortfolioTxn[] {
  return txns
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : a.i - b.i))
    .map((x) => x.t);
}

export const futureKey = (symbol: string, expiry: string) => `${symbol}|${expiry}`;

export function buildBook(txns: PortfolioTxn[]): Book {
  const stocks = new Map<string, StockHolding>();
  const futures = new Map<string, FuturePosition>();
  let realized = 0;

  for (const t of sortTxns(txns)) {
    if (t.kind === 'STOCK') {
      const h =
        stocks.get(t.symbol) ??
        ({
          symbol: t.symbol,
          currency: isUs(t.symbol) ? 'USD' : 'INR',
          qty: 0,
          avgCost: 0,
          avgCostInr: 0,
          invested: 0,
          realized: 0,
          firstDate: t.date,
          txns: [],
        } as StockHolding);
      h.txns.push(t);
      const fx = txnFx(t);
      if (t.side === 'BUY') {
        const cost = t.qty * t.price + t.fees;
        h.avgCost = (h.qty * h.avgCost + cost) / (h.qty + t.qty);
        h.invested += cost * fx;
        h.qty = roundQty(h.qty + t.qty);
        h.avgCostInr = h.invested / h.qty;
      } else {
        // Overselling is rejected at entry; clamp so a bad import can't go negative.
        const sold = Math.min(t.qty, h.qty);
        const pnl = (sold * t.price - t.fees) * fx - sold * h.avgCostInr;
        h.realized += pnl;
        realized += pnl;
        h.qty = roundQty(h.qty - sold);
        h.invested = h.qty > 0 ? h.qty * h.avgCostInr : 0;
        if (h.qty === 0) {
          h.avgCost = 0;
          h.avgCostInr = 0;
        }
      }
      stocks.set(t.symbol, h);
      continue;
    }

    const key = futureKey(t.symbol, t.expiry ?? '');
    const f =
      futures.get(key) ??
      ({
        key,
        symbol: t.symbol,
        expiry: t.expiry ?? '',
        lotSize: t.lotSize ?? 1,
        lots: 0,
        avgEntry: 0,
        realized: 0,
        instrumentKey: t.instrumentKey ?? null,
        txns: [],
      } as FuturePosition);
    f.txns.push(t);
    f.instrumentKey ??= t.instrumentKey ?? null;
    const signed = t.side === 'BUY' ? t.qty : -t.qty;

    if (f.lots === 0 || Math.sign(f.lots) === Math.sign(signed)) {
      // Opening or adding: weighted-average the entry.
      const total = Math.abs(f.lots) + t.qty;
      f.avgEntry = (Math.abs(f.lots) * f.avgEntry + t.qty * t.price) / total;
      f.lots += signed;
      f.realized -= t.fees;
      realized -= t.fees;
    } else {
      // Reducing, closing or flipping.
      const closing = Math.min(Math.abs(f.lots), t.qty);
      const dir = Math.sign(f.lots);
      const pnl = closing * f.lotSize * (t.price - f.avgEntry) * dir - t.fees;
      f.realized += pnl;
      realized += pnl;
      f.lots += signed;
      if (Math.abs(f.lots) < EPS) {
        f.lots = 0;
        f.avgEntry = 0;
      } else if (Math.sign(f.lots) !== dir) {
        f.avgEntry = t.price; // flipped: the remainder opened at this price
      }
    }
    futures.set(key, f);
  }

  return {
    stocks: [...stocks.values()].sort((a, b) => a.symbol.localeCompare(b.symbol)),
    futures: [...futures.values()].sort((a, b) => a.expiry.localeCompare(b.expiry) || a.symbol.localeCompare(b.symbol)),
    realized,
  };
}

/**
 * The first stock sell that would sell more shares than were held at the
 * time, as an error message — or null when the whole history is consistent.
 */
export function findOversell(txns: PortfolioTxn[]): string | null {
  const held = new Map<string, number>();
  for (const t of sortTxns(txns)) {
    if (t.kind !== 'STOCK') continue;
    const qty = roundQty((held.get(t.symbol) ?? 0) + (t.side === 'BUY' ? t.qty : -t.qty));
    if (qty < 0) return `The ${t.symbol} sell on ${t.date} would sell more shares than you held then.`;
    held.set(t.symbol, qty);
  }
  return null;
}

/** Swaps the transaction with `txn.id` for `txn`. */
export const replaceTxn = (txns: PortfolioTxn[], txn: PortfolioTxn) => txns.map((t) => (t.id === txn.id ? txn : t));

/**
 * Why a transaction can't be saved, or null when it's fine. `existing` is
 * the portfolio without it — for an edit, everything except the original.
 */
export function validateTxn(existing: PortfolioTxn[], txn: PortfolioTxn): string | null {
  if (!txn.symbol) return 'Enter a symbol.';
  if (!(txn.qty > 0)) return txn.kind === 'FUT' ? 'Lots must be above 0.' : 'Quantity must be above 0.';
  if (!allowsFractional(txn) && !Number.isInteger(txn.qty))
    return txn.kind === 'FUT' ? 'Lots must be a whole number.' : 'NSE shares are whole numbers — fractions are for US stocks only.';
  if (allowsFractional(txn) && roundQty(txn.qty) !== txn.qty) return 'Use at most 6 decimal places for the quantity.';
  if (!(txn.price > 0)) return 'Enter a price above 0.';
  if (txn.fees < 0) return 'Fees can’t be negative.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(txn.date)) return 'Enter a valid date.';
  if (txn.kind === 'FUT' && (!txn.expiry || !(txn.lotSize && txn.lotSize > 0))) return 'Pick a contract expiry.';
  if (isUs(txn.symbol)) {
    if (txn.kind === 'FUT') return 'Futures are NSE only.';
    if (!(txn.fx && txn.fx > 0)) return 'Enter the USD/INR rate for that date.';
    if (txn.fx < 10 || txn.fx > 1000) return 'That USD/INR rate looks wrong — it should be around 80–90.';
  }

  if (txn.kind === 'STOCK' && txn.side === 'SELL') {
    // Holdings as of the sell date — selling shares bought later isn't possible.
    const before = existing.filter((t) => t.kind === 'STOCK' && t.symbol === txn.symbol && t.date <= txn.date);
    const held = buildBook(before).stocks.find((s) => s.symbol === txn.symbol)?.qty ?? 0;
    if (roundQty(txn.qty - held) > 0) return held === 0 ? `You held no ${txn.symbol} on ${txn.date}.` : `You held only ${held} ${txn.symbol} on ${txn.date}.`;
  }
  // It mustn't make any other sell impossible — e.g. a later sell after a
  // backdated one, or every sell after an edited-down or renamed buy.
  const problem = findOversell([...existing, txn]);
  return problem && `That change doesn’t fit your history: ${problem.charAt(0).toLowerCase()}${problem.slice(1)}`;
}

// ------------------------------------------------------------- valuation

export interface LiveQuote {
  price: number;
  previousClose: number;
}

export interface Valuation {
  /** Market value of the stocks held. */
  currentValue: number;
  /** Cost basis of the stocks held. */
  invested: number;
  /** Stocks: value − cost of what's held. */
  unrealizedStocks: number;
  /** Futures: open lots marked to market. */
  unrealizedFutures: number;
  realized: number;
  totalPnl: number;
  /** totalPnl / invested; null with nothing invested. */
  totalPnlPct: number | null;
  dayPnl: number;
  dayPnlPct: number | null;
  /** Part of the stocks' unrealised P&L that comes from USD/INR moves (US stocks only). */
  currencyGain: number;
  /** Symbols with no live price yet — valued at cost meanwhile. */
  unpriced: string[];
}

/** Price used for an open futures position: its own LTP when known, else the underlying's. */
export function futurePrice(f: FuturePosition, futQuotes: Record<string, number>, quotes: Record<string, LiveQuote>): number | null {
  if (f.instrumentKey && futQuotes[f.instrumentKey] > 0) return futQuotes[f.instrumentKey];
  return quotes[f.symbol]?.price ?? null;
}

export function valueBook(
  book: Book,
  quotes: Record<string, LiveQuote>,
  futQuotes: Record<string, number> = {},
  today = istDate(Math.floor(Date.now() / 1000)),
): Valuation {
  let currentValue = 0;
  let invested = 0;
  let dayPnl = 0;
  let prevValue = 0;
  let unrealizedFutures = 0;
  let currencyGain = 0;
  const unpriced: string[] = [];

  for (const h of book.stocks) {
    if (h.qty === 0) continue;
    const hv = holdingValue(h, quotes, today);
    invested += h.invested;
    currentValue += hv.value;
    if (!hv.priced) {
      unpriced.push(h.symbol);
      continue;
    }
    dayPnl += hv.dayPnl;
    prevValue += hv.prevValue;
    currencyGain += hv.fxGain;
  }

  for (const f of book.futures) {
    if (f.lots === 0) continue;
    const price = futurePrice(f, futQuotes, quotes);
    if (price === null) {
      unpriced.push(f.symbol);
      continue;
    }
    const units = f.lots * f.lotSize;
    unrealizedFutures += units * (price - f.avgEntry);
    const u = quotes[f.symbol];
    if (u) dayPnl += units * (u.price - u.previousClose); // underlying's move ≈ the future's
  }

  const unrealizedStocks = currentValue - invested;
  const totalPnl = unrealizedStocks + unrealizedFutures + book.realized;
  return {
    currentValue,
    invested,
    unrealizedStocks,
    unrealizedFutures,
    realized: book.realized,
    totalPnl,
    totalPnlPct: invested > EPS ? (totalPnl / invested) * 100 : null,
    dayPnl,
    dayPnlPct: prevValue > EPS ? (dayPnl / prevValue) * 100 : null,
    currencyGain,
    unpriced,
  };
}

export interface HoldingValue {
  /** False until both the stock's price and (for US stocks) USD/INR are known; values are at cost meanwhile. */
  priced: boolean;
  /** Current market value in rupees. */
  value: number;
  /** Unrealised P&L in rupees… */
  pnl: number;
  /** …of which from the stock's own price move (at today's rate)… */
  stockGain: number;
  /** …and from the rupee's move since purchase. Always 0 for Indian stocks. */
  fxGain: number;
  /** Today's P&L in rupees, including today's USD/INR move for US stocks. */
  dayPnl: number;
  /** Value at yesterday's close (or today's purchase price), for the day %. */
  prevValue: number;
  /** Today's % move of the stock in its own currency. */
  dayPct: number | null;
}

/** One holding valued at live prices, in rupees. */
export function holdingValue(h: StockHolding, quotes: Record<string, LiveQuote>, today = istDate(Math.floor(Date.now() / 1000))): HoldingValue {
  const q = quotes[h.symbol];
  const fxq = h.currency === 'USD' ? quotes[FX_KEY] : undefined;
  const fxNow = h.currency === 'USD' ? fxq?.price : 1;
  const fxPrev = h.currency === 'USD' ? (fxq?.previousClose || fxq?.price) : 1;
  if (!q || !fxNow || !fxPrev) {
    return { priced: false, value: h.invested, pnl: 0, stockGain: 0, fxGain: 0, dayPnl: 0, prevValue: 0, dayPct: null };
  }

  const value = h.qty * q.price * fxNow;
  const pnl = value - h.invested;
  const stockGain = h.qty * (q.price - h.avgCost) * fxNow;

  // Shares bought today gain from their purchase price, not yesterday's close.
  const boughtToday = h.txns.filter((t) => t.side === 'BUY' && t.date === today);
  const boughtQty = boughtToday.reduce((s, t) => s + t.qty, 0);
  const newQty = Math.min(h.qty, boughtQty);
  const oldQty = h.qty - newQty;
  const newCost = newQty > 0 ? boughtToday.reduce((s, t) => s + t.qty * t.price * txnFx(t), 0) * (newQty / boughtQty) : 0;
  const prevValue = oldQty * q.previousClose * fxPrev + newCost;

  return {
    priced: true,
    value,
    pnl,
    stockGain,
    fxGain: pnl - stockGain,
    dayPnl: value - prevValue,
    prevValue,
    dayPct: q.previousClose ? ((q.price - q.previousClose) / q.previousClose) * 100 : null,
  };
}

// ----------------------------------------------------------- performance

/** [unix seconds, close] oldest first — the shape /api/history returns. */
export type PricePoints = [number, number][];

/** IST calendar date of a unix timestamp. */
export const istDate = (t: number) => new Date((t + 19800) * 1000).toISOString().slice(0, 10);

/** Daily closes keyed by IST date. */
function byDate(points: PricePoints): Map<string, number> {
  const m = new Map<string, number>();
  for (const [t, c] of points) m.set(istDate(t), c);
  return m;
}

/** Forward-filled close lookup on a sorted calendar. */
function filler(points: PricePoints | undefined) {
  const m = points ? byDate(points) : new Map<string, number>();
  let last: number | null = null;
  return (date: string): number | null => {
    const v = m.get(date);
    if (v !== undefined) last = v;
    return last;
  };
}

export interface SeriesPoint {
  date: string;
  /** Growth of 1 since the start. */
  value: number;
}

/**
 * Time-weighted return of the portfolio, one point per trading day.
 *
 * Each day's return is a Modified-Dietz return with flows at the start of the
 * day: (V_end − V_start − flow + futures P&L) / (V_start + flow). Chaining
 * daily returns removes the effect of money moving in and out, which is how
 * Yahoo, Investing.com and fund factsheets report performance.
 *
 * Futures are marked with their underlying's closes (the basis is ignored)
 * and stop at expiry; trades are assumed filled at that day's close.
 */
export function portfolioSeries(txns: PortfolioTxn[], history: Record<string, PricePoints>, calendar: string[]): SeriesPoint[] {
  const sorted = sortTxns(txns);
  if (sorted.length === 0) return [];
  const start = sorted[0].date;
  const days = calendar.filter((d) => d >= start);
  if (days.length === 0) return [];

  const symbols = new Set(sorted.map((t) => t.symbol));
  const close: Record<string, (d: string) => number | null> = {};
  for (const s of symbols) close[s] = filler(history[s]);
  // US stocks are valued in rupees at each day's USD/INR close.
  const fxClose = filler(history[FX_KEY]);
  // Prime the fillers with any closes before the first day.
  for (const d of calendar.filter((x) => x < start)) {
    fxClose(d);
    for (const s of symbols) close[s](d);
  }
  let lastFx: number | null = null;

  const shares = new Map<string, number>();
  const lastPrice = new Map<string, number>();
  const futUnits = new Map<string, { symbol: string; expiry: string; units: number }>();
  let i = 0;
  let vPrev = 0;
  let value = 1;
  const prevClose = new Map<string, number>();
  const out: SeriesPoint[] = [];

  for (const day of days) {
    const fxDay = fxClose(day) ?? lastFx;
    const today: Record<string, number | null> = {};
    for (const s of symbols) {
      const c = close[s](day);
      // In rupees; a US close with no exchange rate yet is treated as missing.
      today[s] = c == null ? null : isUs(s) ? (fxDay == null ? null : c * fxDay) : c;
    }

    // Futures P&L on lots held overnight, at the underlying's close-to-close move.
    let fut = 0;
    for (const f of futUnits.values()) {
      if (f.units === 0 || day > f.expiry) continue;
      const c = today[f.symbol];
      const p = prevClose.get(f.symbol);
      if (c != null && p != null) fut += f.units * (c - p);
    }

    let flow = 0;
    while (i < sorted.length && sorted[i].date <= day) {
      const t = sorted[i++];
      if (t.kind === 'STOCK') {
        const q = t.side === 'BUY' ? t.qty : -t.qty;
        shares.set(t.symbol, (shares.get(t.symbol) ?? 0) + q);
        const fx = txnFx(t);
        if (isUs(t.symbol) && fx > 0) lastFx ??= fx;
        lastPrice.set(t.symbol, t.price * fx);
        flow += (t.side === 'BUY' ? t.qty * t.price + t.fees : -(t.qty * t.price - t.fees)) * fx;
      } else {
        const k = futureKey(t.symbol, t.expiry ?? '');
        const f = futUnits.get(k) ?? { symbol: t.symbol, expiry: t.expiry ?? '', units: 0 };
        f.units += (t.side === 'BUY' ? 1 : -1) * t.qty * (t.lotSize ?? 1);
        futUnits.set(k, f);
        fut -= t.fees;
      }
    }

    let v = 0;
    for (const [s, q] of shares) {
      if (q <= 0) continue;
      const c = today[s] ?? lastPrice.get(s) ?? 0; // no history yet: hold at trade price
      v += q * c;
    }

    const base = vPrev + flow;
    const r = base > EPS ? (v - vPrev - flow + fut) / base : 0;
    value *= 1 + r;
    out.push({ date: day, value });
    vPrev = v;
    for (const s of symbols) {
      const c = today[s];
      if (c != null) prevClose.set(s, c);
    }
  }
  return out;
}

/**
 * A benchmark as growth-of-1 on the given calendar, forward-filled (US markets
 * trade on different days). With `fx`, the closes are converted at each day's
 * rate first — e.g. S&P 500 in rupees.
 */
export function benchmarkSeries(points: PricePoints, calendar: string[], fx?: PricePoints): SeriesPoint[] {
  const px = filler(points);
  const rate = fx ? filler(fx) : () => 1;
  const out: SeriesPoint[] = [];
  let first: number | null = null;
  for (const day of calendar) {
    const c = px(day);
    const r = rate(day);
    if (c == null || r == null) continue;
    const v = c * r;
    first ??= v;
    out.push({ date: day, value: v / first });
  }
  return out;
}

/** Trading days covered by any of the series, sorted. */
export function tradingCalendar(...series: (PricePoints | undefined)[]): string[] {
  const set = new Set<string>();
  for (const s of series) for (const [t] of s ?? []) set.add(istDate(t));
  return [...set].sort();
}

/** The part of a series from `from` on, rebased so it starts at 1. */
export function rebase(series: SeriesPoint[], from: string): SeriesPoint[] {
  const s = series.filter((p) => p.date >= from);
  if (s.length === 0) return [];
  const b = s[0].value;
  return s.map((p) => ({ date: p.date, value: p.value / b }));
}

// ------------------------------------------------------------- statistics

/** India 91-day T-bill ballpark, for the Sharpe ratio. */
export const RISK_FREE = 0.065;

export interface SeriesStats {
  /** Total return over the series, %. */
  totalReturn: number;
  /** Annualised volatility of daily returns, %. */
  volatility: number;
  /** Deepest peak-to-trough fall, % (≤ 0). */
  maxDrawdown: number;
  sharpe: number | null;
}

const dailyReturns = (s: SeriesPoint[]) => s.slice(1).map((p, i) => p.value / s[i].value - 1);

export function seriesStats(s: SeriesPoint[]): SeriesStats | null {
  if (s.length < 2) return null;
  const r = dailyReturns(s);
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, r.length - 1));
  let peak = -Infinity;
  let dd = 0;
  for (const p of s) {
    peak = Math.max(peak, p.value);
    dd = Math.min(dd, p.value / peak - 1);
  }
  const vol = sd * Math.sqrt(252);
  return {
    totalReturn: (s[s.length - 1].value / s[0].value - 1) * 100,
    volatility: vol * 100,
    maxDrawdown: dd * 100,
    sharpe: vol > EPS ? (mean * 252 - RISK_FREE) / vol : null,
  };
}

/**
 * Beta and Jensen's alpha (annualised, %) of a series against a benchmark,
 * from daily returns on the days both have.
 */
export function betaAlpha(series: SeriesPoint[], bench: SeriesPoint[]): { beta: number; alpha: number } | null {
  const b = new Map(bench.map((p) => [p.date, p.value]));
  const pairs: [number, number][] = [];
  for (let i = 1; i < series.length; i++) {
    const b0 = b.get(series[i - 1].date);
    const b1 = b.get(series[i].date);
    if (b0 && b1) pairs.push([series[i].value / series[i - 1].value - 1, b1 / b0 - 1]);
  }
  if (pairs.length < 20) return null;
  const mp = pairs.reduce((a, [p]) => a + p, 0) / pairs.length;
  const mb = pairs.reduce((a, [, q]) => a + q, 0) / pairs.length;
  let cov = 0;
  let varB = 0;
  for (const [p, q] of pairs) {
    cov += (p - mp) * (q - mb);
    varB += (q - mb) ** 2;
  }
  if (varB < EPS) return null;
  const beta = cov / varB;
  const rf = RISK_FREE / 252;
  const alpha = (mp - rf - beta * (mb - rf)) * 252 * 100;
  return { beta, alpha };
}

/** Calendar-month returns, %, keyed YYYY-MM. */
export function monthlyReturns(s: SeriesPoint[]): { month: string; ret: number }[] {
  const out: { month: string; ret: number }[] = [];
  let startVal = s[0]?.value;
  for (let i = 0; i < s.length; i++) {
    const m = s[i].date.slice(0, 7);
    const last = i === s.length - 1 || s[i + 1].date.slice(0, 7) !== m;
    if (last) {
      out.push({ month: m, ret: (s[i].value / startVal - 1) * 100 });
      startVal = s[i].value;
    }
  }
  return out;
}
