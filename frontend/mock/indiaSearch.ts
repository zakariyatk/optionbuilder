import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The mock's copy of /api/search?market=in — the same ranking as
 * ob_india_search() in api/lib/india.php, over a snapshot of the Upstox NSE
 * list ([symbol, display name, upper-case search text, type]).
 */
type Listing = [string, string, string, 'EQUITY' | 'ETF'];

let listings: Listing[] | null = null;
const load = (): Listing[] =>
  (listings ??= JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'nse-listings.json'), 'utf8')) as Listing[]);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function indiaSearch(query: string, limit = 30) {
  const q = query.trim().replace(/\s+/g, ' ').toUpperCase();
  if (!q) return [];
  const words = q.split(' ');
  const wordStart = new RegExp(`(^|[\\s&(-])${escape(q)}`);
  return load()
    .filter(([symbol, , text]) => words.every((w) => `${symbol} ${text}`.includes(w)))
    .map(([symbol, name, text, type]) => {
      const score = symbol === q ? 0 : symbol.startsWith(q) ? 1 : wordStart.test(text) ? 2 : symbol.includes(q) ? 3 : 4;
      return { score, etf: type === 'ETF' ? 1 : 0, symbol, name, type };
    })
    .sort((a, b) => a.score - b.score || a.etf - b.etf || a.symbol.length - b.symbol.length || a.symbol.localeCompare(b.symbol))
    .slice(0, limit)
    .map(({ symbol, name, type }) => ({ symbol, ticker: symbol, name, exchange: 'NSE', type }));
}
