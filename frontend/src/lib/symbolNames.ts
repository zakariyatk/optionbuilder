/**
 * Company names of symbols picked from search, remembered in this browser so
 * watchlists and tables can label symbols that aren't in the app's built-in
 * list (e.g. BSE → "BSE Limited", US:AAPL → "Apple Inc.").
 */
const KEY = 'option-builder-symbol-names';
const MAX = 500;

let names: Record<string, string> | null = null;

function load(): Record<string, string> {
  if (names) return names;
  try {
    names = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>;
  } catch {
    names = {};
  }
  return names;
}

export function rememberName(symbol: string, name: string): void {
  if (!name || name === symbol) return;
  const all = load();
  if (all[symbol] === name) return;
  all[symbol] = name;
  const keys = Object.keys(all);
  if (keys.length > MAX) for (const k of keys.slice(0, keys.length - MAX)) delete all[k];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* private mode — names just won't survive a reload */
  }
}

export const nameOf = (symbol: string): string | undefined => load()[symbol];
