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

export function mockApi(base: string): Plugin {
  let loggedIn = false;
  /** Draft portfolios live in memory for the life of the dev server. */
  let drafts: Record<string, unknown>[] = [];
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
              const draft = { ...body, id: Math.random().toString(16).slice(2, 18), createdAt: Date.now(), closedAt: null, exitPremiums: null, exitSpot: null };
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
            drafts[i] = d;
            return send({ draft: d });
          });
          return;
        }
        switch (route) {
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
