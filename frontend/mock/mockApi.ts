import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Offline backend for `npm run dev:mock`.
 *
 * Serves market data recorded from the real PHP backend so the whole UI can be
 * developed and demoed without PHP, an Upstox login or market hours. Responses
 * mirror the PHP routes in ../api/index.php one-for-one.
 */

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(here, 'fixtures', `${name}.json`), 'utf8'));

const SYMBOLS = {
  indices: [
    { symbol: 'NIFTY', label: 'NIFTY 50', lotSize: 65 },
    { symbol: 'BANKNIFTY', label: 'NIFTY BANK', lotSize: 30 },
    { symbol: 'FINNIFTY', label: 'NIFTY FIN SERVICE', lotSize: 60 },
    { symbol: 'MIDCPNIFTY', label: 'NIFTY MIDCAP SELECT', lotSize: 120 },
  ],
  all: [] as unknown[],
};
SYMBOLS.all = [
  ...SYMBOLS.indices,
  { symbol: 'RELIANCE', label: 'Reliance Industries', lotSize: 500 },
  { symbol: 'TCS', label: 'Tata Consultancy Services', lotSize: 175 },
  { symbol: 'HDFCBANK', label: 'HDFC Bank', lotSize: 550 },
  { symbol: 'INFY', label: 'Infosys', lotSize: 400 },
];

/**
 * The recorded chain's expiries are long past, which would zero every Greek
 * and the target-date curve. Shift them so the nearest is a week out, keeping
 * the spacing between expiries intact.
 */
function freshChain(): unknown {
  const chain = fixture('chain') as { expiryDates: string[]; expiry: string };
  const day = 86_400_000;
  const first = Date.parse(`${chain.expiryDates[0]}T00:00:00Z`);
  const shift = Math.round((Date.now() + 7 * day - first) / day) * day;
  const move = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + shift).toISOString().slice(0, 10);
  return { ...chain, expiryDates: chain.expiryDates.map(move), expiry: move(chain.expiry), timestamp: new Date().toISOString() };
}

interface MockSide {
  instrumentKey: string;
  ltp: number;
}
interface MockRow {
  strike: number;
  call: MockSide | null;
  put: MockSide | null;
}

/** Recorded LTP per instrument key, nudged a little on every call so live views visibly tick. */
function mockQuotes(keys: string[]): Record<string, number> {
  const rows = (fixture('chain') as { rows: MockRow[] }).rows;
  const ltp = new Map<string, number>();
  for (const r of rows) for (const s of [r.call, r.put]) if (s) ltp.set(s.instrumentKey, s.ltp);
  const out: Record<string, number> = {};
  for (const k of keys) {
    const base = ltp.get(k);
    if (base !== undefined) out[k] = Math.max(0.05, Math.round(base * (1 + (Math.random() - 0.5) * 0.06) * 20) / 20);
  }
  return out;
}

function mockPositions() {
  const rows = (fixture('chain') as { rows: MockRow[] }).rows;
  const atm = rows.reduce((b, r) => (Math.abs(r.strike - 24250) < Math.abs(b.strike - 24250) ? r : b), rows[0]);
  const jig = (v: number) => Math.round(v * (1 + (Math.random() - 0.5) * 0.04) * 20) / 20;
  const make = (side: MockSide, symbol: string, quantity: number, avg: number) => {
    const ltp = jig(side.ltp);
    const pnl = Math.round((ltp - avg) * quantity * 100) / 100;
    return {
      instrumentKey: side.instrumentKey,
      symbol,
      exchange: 'NFO',
      product: 'D',
      quantity,
      averagePrice: avg,
      buyPrice: quantity > 0 ? avg : 0,
      sellPrice: quantity < 0 ? avg : 0,
      ltp,
      closePrice: side.ltp,
      pnl,
      realised: 0,
      unrealised: pnl,
    };
  };
  return [
    make(atm.call!, `NIFTY ${atm.strike} CE`, -65, Math.round(atm.call!.ltp * 1.08 * 20) / 20),
    make(atm.put!, `NIFTY ${atm.strike} PE`, -65, Math.round(atm.put!.ltp * 0.95 * 20) / 20),
  ];
}

const TF_SECONDS: Record<string, number> = { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1D': 86400, '1W': 604800, '1M': 2592000 };

/** A deterministic random walk ending near `last`, in NSE session hours for intraday timeframes. */
function mockCandles(symbol: string, tf: string, last: number, hasVolume: boolean): number[][] {
  const step = TF_SECONDS[tf] ?? 900;
  const intraday = step < 86400;
  let seed = [...`${symbol}${tf}`].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const times: number[] = [];
  let t = Math.floor(Date.now() / 1000 / step) * step;
  while (times.length < 400) {
    const ist = new Date((t + 19800) * 1000);
    const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    const weekday = ist.getUTCDay() >= 1 && ist.getUTCDay() <= 5;
    if (!intraday ? weekday || step > 86400 : weekday && mins >= 555 && mins < 930) times.unshift(t);
    t -= step;
  }
  const vol = Math.min(0.02, 0.0015 * Math.sqrt(step / 300));
  const closes: number[] = [last];
  for (let i = 1; i < times.length; i++) closes.unshift(closes[0] * (1 - (rand() - 0.5) * 2 * vol));
  return times.map((time, i) => {
    const close = closes[i];
    const open = i ? closes[i - 1] : close;
    const high = Math.max(open, close) * (1 + rand() * vol * 0.6);
    const low = Math.min(open, close) * (1 - rand() * vol * 0.6);
    const r2 = (v: number) => Math.round(v * 100) / 100;
    return [time, r2(open), r2(high), r2(low), r2(close), hasVolume ? Math.round(50_000 + rand() * 400_000) : 0];
  });
}

const readBody = (req: NodeJS.ReadableStream): Promise<Record<string, unknown>> =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve({});
      }
    });
  });

// ---------------------------------------------------------- portfolio mocks

/** Where each synthetic history ends, its yearly drift and volatility, and currency. */
const HISTORY_SPEC: Record<string, { end: number; mu: number; vol: number; currency?: string }> = {
  NIFTY: { end: 24175.65, mu: 0.11, vol: 0.13 },
  BANKNIFTY: { end: 51234.5, mu: 0.1, vol: 0.17 },
  SENSEX: { end: 79540, mu: 0.11, vol: 0.13 },
  SP500: { end: 6710, mu: 0.13, vol: 0.16, currency: 'USD' },
  QQQ: { end: 598, mu: 0.18, vol: 0.22, currency: 'USD' },
  DOW: { end: 46300, mu: 0.09, vol: 0.15, currency: 'USD' },
  GOLD: { end: 3980, mu: 0.14, vol: 0.15, currency: 'USD' },
  USDINR: { end: 88.7, mu: 0.03, vol: 0.04 },
  HDFCBANK: { end: 1650.25, mu: 0.08, vol: 0.2 },
  INFY: { end: 1520.6, mu: 0.1, vol: 0.24 },
  RELIANCE: { end: 1172.3, mu: 0.07, vol: 0.22 },
  ICICIBANK: { end: 1402.3, mu: 0.2, vol: 0.22 },
  TATAMOTORS: { end: 688.4, mu: 0.12, vol: 0.34 },
  TCS: { end: 3410.8, mu: 0.06, vol: 0.2 },
  'US:AAPL': { end: 342, mu: 0.2, vol: 0.27, currency: 'USD' },
  'US:MSFT': { end: 520, mu: 0.18, vol: 0.24, currency: 'USD' },
  'US:NVDA': { end: 185, mu: 0.45, vol: 0.5, currency: 'USD' },
  'US:VOO': { end: 615, mu: 0.13, vol: 0.16, currency: 'USD' },
};

/** What the mock /api/search knows about. */
const US_LISTINGS = [
  { symbol: 'US:AAPL', ticker: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', type: 'EQUITY' },
  { symbol: 'US:MSFT', ticker: 'MSFT', name: 'Microsoft Corporation', exchange: 'NASDAQ', type: 'EQUITY' },
  { symbol: 'US:NVDA', ticker: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ', type: 'EQUITY' },
  { symbol: 'US:VOO', ticker: 'VOO', name: 'Vanguard S&P 500 ETF', exchange: 'NYSE Arca', type: 'ETF' },
];

function seededRandom(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  let s = h >>> 0 || 1;
  return () => ((s = Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
}

/** Six years of weekday closes, deterministic per symbol, ending at its current mock price. */
function mockHistory(key: string): { currency: string; points: [number, number][] } | null {
  const spec = HISTORY_SPEC[key];
  if (!spec) return null;
  const rand = seededRandom(key);
  const days: number[] = [];
  const end = new Date();
  end.setUTCHours(10, 0, 0, 0);
  for (let d = new Date(end.getTime() - 6 * 365 * 864e5); d < end; d = new Date(d.getTime() + 864e5)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days.push(d.getTime() / 1000);
  }
  let x = 1;
  const raw = days.map(() => {
    const z = (rand() + rand() + rand() + rand() - 2) * 1.7;
    x *= 1 + spec.mu / 252 + (spec.vol / Math.sqrt(252)) * z;
    return x;
  });
  const scale = spec.end / raw[raw.length - 1];
  return { currency: spec.currency ?? 'INR', points: days.map((t, i) => [t, Math.round(raw[i] * scale * 100) / 100]) };
}

/** A sample portfolio so the page has something to show on first run. */
function seedPortfolio(): Record<string, unknown> {
  const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const close = (sym: string, days: number) => {
    const h = mockHistory(sym)!;
    const target = Date.now() / 1000 - days * 86400;
    const p = [...h.points].reverse().find(([t]) => t <= target) ?? h.points[0];
    return Math.round(p[1] * 20) / 20;
  };
  const stock = (symbol: string, side: 'BUY' | 'SELL', days: number, qty: number) => ({
    ...(symbol.startsWith('US:') ? { fx: close('USDINR', days) } : {}),
    id: `seed-${symbol}-${days}`,
    kind: 'STOCK',
    side,
    symbol,
    date: ago(days),
    qty,
    price: close(symbol, days),
    fees: Math.round(qty * close(symbol, days) * 0.001),
  });
  const nextMonthEnd = (() => {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() + 1, 0);
    return d.toISOString().slice(0, 10);
  })();
  return {
    id: 'seed-main',
    name: 'Long-term',
    createdAt: Date.now() - 700 * 864e5,
    transactions: [
      stock('HDFCBANK', 'BUY', 690, 80),
      stock('INFY', 'BUY', 610, 90),
      stock('RELIANCE', 'BUY', 540, 100),
      stock('HDFCBANK', 'BUY', 400, 40),
      stock('ICICIBANK', 'BUY', 360, 65),
      stock('TATAMOTORS', 'BUY', 250, 150),
      stock('INFY', 'SELL', 120, 30),
      stock('RELIANCE', 'BUY', 45, 20),
      stock('US:AAPL', 'BUY', 330, 15),
      stock('US:NVDA', 'BUY', 200, 40),
      { id: 'seed-fut-1', kind: 'FUT', side: 'BUY', symbol: 'NIFTY', date: ago(9), qty: 2, price: close('NIFTY', 9) + 40, fees: 120, lotSize: 65, expiry: nextMonthEnd, instrumentKey: 'NSE_FO|MOCKNIFTYFUT' },
    ],
  };
}

function mockFutures(symbol: string) {
  const lots: Record<string, number> = { NIFTY: 65, BANKNIFTY: 30, FINNIFTY: 60, MIDCPNIFTY: 120, RELIANCE: 500, HDFCBANK: 550, INFY: 400, TCS: 175, ICICIBANK: 700 };
  if (!lots[symbol]) return [];
  return [0, 1, 2].map((m) => {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() + m + 1, 0); // last day of the month as a stand-in expiry
    return { expiry: d.toISOString().slice(0, 10), instrumentKey: `NSE_FO|MOCK${symbol}FUT${m}`, lotSize: lots[symbol] };
  });
}

export function mockApi(base: string): Plugin {
  let loggedIn = false;
  /** Draft portfolios live in memory for the life of the dev server. */
  let drafts: Record<string, unknown>[] = [];
  let portfolios: Record<string, unknown>[] = [seedPortfolio()];
  const prefix = `${base.replace(/\/$/, '')}/api`;

  return {
    name: 'option-builder-mock-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith(prefix)) return next();
        const route = url.pathname.slice(prefix.length) || '/';

        const send = (body: unknown, status = 200) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };

        if (route === '/session') return send({ authRequired: true, loggedIn });
        if (route === '/login' && req.method === 'POST') {
          // Any non-empty password opens the mock — there is nothing to protect.
          loggedIn = true;
          return send({ ok: true });
        }
        if (!loggedIn) return send({ error: 'LOGIN_REQUIRED' }, 401);
        if (route === '/logout') {
          loggedIn = false;
          return send({ ok: true });
        }

        const now = Date.now();
        if (route.startsWith('/drafts') && req.method === 'POST') {
          void readBody(req).then((body) => {
            if (route === '/drafts') {
              const at = Date.now();
              const legs = (body.legs as Record<string, unknown>[]) ?? [];
              const trades = legs.map((l) => ({ at, action: l.action, type: l.type, strike: l.strike, expiry: l.expiry, lots: l.lots, lotSize: l.lotSize, price: l.premium, realized: 0 }));
              const draft = { ...body, id: Math.random().toString(16).slice(2, 18), createdAt: at, closedAt: null, exitPremiums: null, exitSpot: null, realized: 0, trades };
              drafts = [draft, ...drafts];
              return send({ draft }, 201);
            }
            const i = drafts.findIndex((d) => d.id === body.id);
            if (i < 0) return send({ error: 'Draft not found' }, 404);
            if (route === '/drafts/delete') {
              drafts = drafts.filter((d) => d.id !== body.id);
              return send({ ok: true });
            }
            const d = { ...drafts[i] };
            if (typeof body.name === 'string') d.name = body.name.trim() || 'Untitled';
            const close = body.close as { exitPremiums?: number[]; exitSpot?: number | null } | undefined;
            if (close && d.closedAt === null) Object.assign(d, { exitPremiums: close.exitPremiums, exitSpot: close.exitSpot ?? null, closedAt: Date.now() });
            if (body.reopen) Object.assign(d, { exitPremiums: null, exitSpot: null, closedAt: null });
            const adjust = body.adjust as { legs: unknown[]; trade: Record<string, number | string | null>; spot: number | null } | undefined;
            if (adjust && d.closedAt === null) {
              const t = adjust.trade;
              const fill = { at: Date.now(), action: t.action, type: t.type, strike: t.strike, expiry: t.expiry, lots: t.lots, lotSize: t.lotSize, price: t.premium, realized: t.realized };
              Object.assign(d, {
                legs: adjust.legs,
                realized: Math.round((((d.realized as number) ?? 0) + Number(t.realized)) * 100) / 100,
                trades: [...((d.trades as unknown[]) ?? []), fill],
              });
              if (adjust.legs.length === 0) Object.assign(d, { closedAt: Date.now(), exitPremiums: [], exitSpot: adjust.spot });
            }
            drafts[i] = d;
            return send({ draft: d });
          });
          return;
        }
        if (route.startsWith('/portfolios') && req.method === 'POST') {
          void readBody(req).then((body) => {
            if (route === '/portfolios') {
              const portfolio = { id: Math.random().toString(16).slice(2, 18), name: String(body.name ?? '').trim() || 'Untitled', createdAt: Date.now(), transactions: [] };
              portfolios = [...portfolios, portfolio];
              return send({ portfolio }, 201);
            }
            const i = portfolios.findIndex((p) => p.id === body.id);
            if (i < 0) return send({ error: 'Portfolio not found' }, 404);
            if (route === '/portfolios/delete') {
              portfolios = portfolios.filter((p) => p.id !== body.id);
              return send({ ok: true });
            }
            const p = { ...portfolios[i] };
            if (typeof body.name === 'string') p.name = body.name.trim();
            if (Array.isArray(body.transactions)) p.transactions = body.transactions;
            portfolios[i] = p;
            return send({ portfolio: p });
          });
          return;
        }
        switch (route) {
          case '/portfolios':
            return send({ portfolios });
          case '/history': {
            const series: Record<string, unknown> = {};
            for (const k of (url.searchParams.get('symbols') ?? '').split(',')) {
              const h = mockHistory(k);
              if (h) series[k] = h;
            }
            return send({ series });
          }
          case '/search': {
            const q = (url.searchParams.get('q') ?? '').toLowerCase();
            return send({ results: US_LISTINGS.filter((l) => l.ticker.toLowerCase().startsWith(q) || l.name.toLowerCase().includes(q)) });
          }
          case '/futures': {
            const symbol = url.searchParams.get('symbol') ?? '';
            return send({ symbol, contracts: mockFutures(symbol) });
          }
          case '/oi-intraday': {
            const chain = freshChain() as { expiry: string; underlyingValue: number; rows: { strike: number; call: { oi: number; oiChange: number } | null; put: { oi: number; oiChange: number } | null }[] };
            const min = Number(url.searchParams.get('min'));
            const max = Number(url.searchParams.get('max'));
            // Today's session so far (or the whole of it after the close), one point a minute.
            const ist = (t: number) => new Date((t + 19800) * 1000);
            const day = ist(Math.floor(now / 1000));
            const open = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 9, 15) / 1000 - 19800;
            const end = Math.min(Math.floor(now / 60000) * 60, open + 375 * 60 - 60);
            const times: number[] = [];
            for (let t = open; t <= Math.max(end, open + 374 * 60); t += 60) times.push(t);
            const n = times.length;
            const wave = (i: number, k: number) => Math.sin(i / 37 + k) * 0.08;
            const side = (s: { oi: number; oiChange: number } | null, k: number) =>
              s && { prevOi: s.oi - s.oiChange, oi: times.map((_, i) => Math.round(s.oi - s.oiChange + s.oiChange * (i / (n - 1)) * (1 + wave(i, k)))) };
            return send({
              expiry: url.searchParams.get('expiry') ?? chain.expiry,
              times,
              spot: times.map((_, i) => Math.round((chain.underlyingValue - 120 + 120 * (i / (n - 1)) + Math.sin(i / 20) * 25) * 100) / 100),
              rows: chain.rows.filter((r) => r.strike >= min && r.strike <= max).map((r, k) => ({ strike: r.strike, call: side(r.call, k), put: side(r.put, k + 2) })),
            });
          }
          case '/candles': {
            const symbol = url.searchParams.get('symbol') ?? 'NIFTY';
            const tf = url.searchParams.get('tf') ?? '15m';
            const last: Record<string, number> = { NIFTY: 24175.65, BANKNIFTY: 51234.5, FINNIFTY: 23410.2, MIDCPNIFTY: 12890.4, RELIANCE: 1172.3, TCS: 3410.8, HDFCBANK: 1650.25, INFY: 1520.6, ICICIBANK: 1402.3, TATAMOTORS: 688.4, SBIN: 812.5, ITC: 405.2, USDINR: 88.7, 'US:AAPL': 342, 'US:MSFT': 520, 'US:NVDA': 185, 'US:VOO': 615 };
            const isIndex = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'].includes(symbol);
            return send({ symbol, tf, candles: mockCandles(symbol, tf, last[symbol] ?? 1000, !isIndex) });
          }
          case '/watch': {
            const spot = fixture('spot') as { price: number; previousClose: number };
            const bases: Record<string, number> = { INDIAVIX: 14.1, NIFTY: spot.price, BANKNIFTY: 51234.5, FINNIFTY: 23410.2, MIDCPNIFTY: 12890.4, RELIANCE: 1172.3, TCS: 3410.8, HDFCBANK: 1650.25, INFY: 1520.6, ICICIBANK: 1402.3, TATAMOTORS: 688.4, SBIN: 812.5, ITC: 405.2, USDINR: 88.7, 'US:AAPL': 342, 'US:MSFT': 520, 'US:NVDA': 185, 'US:VOO': 615 };
            const quotes = (url.searchParams.get('symbols') ?? '')
              .split(',')
              .filter(Boolean)
              .map((symbol) => {
                const base = bases[symbol];
                if (base === undefined) return { symbol, error: true };
                const price = Math.round(base * (1 + (Math.random() - 0.5) * 0.004) * 100) / 100;
                const previousClose = Math.round(base * (1 + (symbol.length % 5 - 2) * 0.004) * 100) / 100;
                return { symbol, ticker: symbol, price, previousClose, currency: 'INR', marketTime: Math.floor(now / 1000) };
              });
            return send({ quotes });
          }
          case '/drafts':
            return send({ drafts });
          case '/quotes':
            return send({ quotes: mockQuotes((url.searchParams.get('keys') ?? '').split(',')), at: now });
          case '/positions':
            return send({ positions: mockPositions(), at: now });
          case '/auth/status':
            return send({
              configured: true,
              authenticated: true,
              token: { user_name: 'Demo (mock data)', issued_at: now, expires_at: now + 3_600_000 },
              loginUrl: null,
            });
          case '/symbols':
            return send(SYMBOLS);
          case '/spot':
            return send(fixture('spot'));
          case '/option-chain':
            return send(freshChain());
          case '/margin':
            return send({ required_margin: 152340.5, final_margin: 148210.25 });
          case '/report/max-oi':
            return send(fixture('maxoi'));
          case '/report/fii-dii':
            return send({ data: fixture('fiidii') });
          case '/report/global':
            return send(fixture('global'));
          case '/report/news':
            return send({ items: fixture('news') });
          default:
            return send({ error: `Not found: ${route}` }, 404);
        }
      });
    },
  };
}
