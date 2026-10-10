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

export function mockApi(base: string): Plugin {
  let loggedIn = false;
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
        switch (route) {
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
