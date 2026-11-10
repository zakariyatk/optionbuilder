/**
 * US symbols travel through the app as "US:<ticker>" (e.g. US:AAPL) so they
 * never collide with an NSE symbol; the backend maps them to Yahoo tickers.
 */
export const US_PREFIX = 'US:';

export const isUs = (symbol: string) => symbol.startsWith(US_PREFIX);

/** The ticker as traders write it: US:AAPL → AAPL; NSE symbols unchanged. */
export const displaySymbol = (symbol: string) => (isUs(symbol) ? symbol.slice(US_PREFIX.length) : symbol);

/**
 * Global markets — gold, crypto, US and world indices, oil, forex — charted
 * from Yahoo like US stocks, so they need no broker login. They ride the
 * "US:" prefix for that; the backend maps each to its Yahoo ticker
 * (OB_GLOBAL_TICKERS in api/lib/us.php — keep the two lists in step).
 * Yahoo has no spot metals or energy, so XAGUSD, USOIL and NATGAS chart
 * front-month futures (COMEX / NYMEX), a little off spot. Gold (XAUUSD) is
 * the exception: the browser charts it live from Binance (lib/binance.ts).
 */
export type GlobalCategory = 'Commodity' | 'Crypto' | 'Index' | 'ETF' | 'Volatility' | 'Forex';

/** Which trading hours a global symbol keeps (sessions live in lib/nse.ts). */
export type GlobalHours = 'US' | '24x5' | '24x7' | 'XETRA' | 'TSE';

export interface GlobalSymbol {
  symbol: string;
  /** Market name, e.g. "Gold". */
  name: string;
  /** Longer description for search and the legend. */
  description: string;
  category: GlobalCategory;
  exchange: string;
  currency: string;
  hours: GlobalHours;
  /** Decimals on the price axis. */
  precision: number;
}

const g = (
  ticker: string,
  name: string,
  description: string,
  category: GlobalCategory,
  exchange: string,
  hours: GlobalHours,
  currency = 'USD',
  precision = 2,
): GlobalSymbol => ({ symbol: US_PREFIX + ticker, name, description, category, exchange, currency, hours, precision });

export const GLOBAL_SYMBOLS: GlobalSymbol[] = [
  // Live from Binance (lib/binance.ts): PAX Gold, one token per troy ounce, trading round the clock.
  g('XAUUSD', 'Gold', 'Gold / US Dollar (live, PAXG on Binance)', 'Commodity', 'Binance', '24x7'),
  g('BTCUSD', 'Bitcoin', 'Bitcoin / US Dollar', 'Crypto', 'Crypto', '24x7'),
  g('ETHUSD', 'Ethereum', 'Ethereum / US Dollar', 'Crypto', 'Crypto', '24x7'),
  g('NDX', 'Nasdaq 100', 'Nasdaq 100 Index', 'Index', 'NASDAQ', 'US'),
  g('QQQ', 'QQQ', 'Invesco QQQ Trust', 'ETF', 'NASDAQ', 'US'),
  g('SPX', 'S&P 500', 'S&P 500 Index', 'Index', 'S&P', 'US'),
  g('SPY', 'SPY', 'SPDR S&P 500 ETF Trust', 'ETF', 'NYSE Arca', 'US'),
  g('DJI', 'Dow Jones', 'Dow Jones Industrial Average', 'Index', 'DJ', 'US'),
  g('RUT', 'Russell 2000', 'Russell 2000 Index', 'Index', 'Russell', 'US'),
  g('VIX', 'VIX', 'CBOE Volatility Index', 'Volatility', 'CBOE', 'US'),
  g('XAGUSD', 'Silver', 'Silver / US Dollar (COMEX futures)', 'Commodity', 'COMEX', '24x5', 'USD', 3),
  g('USOIL', 'Crude Oil', 'WTI Crude Oil (NYMEX futures)', 'Commodity', 'NYMEX', '24x5'),
  g('EURUSD', 'EUR/USD', 'Euro / US Dollar', 'Forex', 'FX', '24x5', 'USD', 5),
  g('GBPUSD', 'GBP/USD', 'British Pound / US Dollar', 'Forex', 'FX', '24x5', 'USD', 5),
  g('USDJPY', 'USD/JPY', 'US Dollar / Japanese Yen', 'Forex', 'FX', '24x5', 'JPY', 3),
  g('GER40', 'DAX 40', 'DAX 40 Index (Germany)', 'Index', 'XETRA', 'XETRA', 'EUR'),
  g('JP225', 'Nikkei 225', 'Nikkei 225 Index (Japan)', 'Index', 'TSE', 'TSE', 'JPY'),
  g('NATGAS', 'Natural Gas', 'Natural Gas (NYMEX futures)', 'Commodity', 'NYMEX', '24x5', 'USD', 3),
];

const GLOBAL_BY_SYMBOL = new Map(GLOBAL_SYMBOLS.map((s) => [s.symbol, s]));

export const globalSymbol = (symbol: string): GlobalSymbol | undefined => GLOBAL_BY_SYMBOL.get(symbol);

/** Global symbols matching a search: ticker, name, description or category ("crypto", "forex"). */
export function searchGlobal(query: string): GlobalSymbol[] {
  const q = query.trim().toUpperCase();
  if (!q) return GLOBAL_SYMBOLS;
  return GLOBAL_SYMBOLS.filter(
    (s) =>
      displaySymbol(s.symbol).includes(q) ||
      s.name.toUpperCase().includes(q) ||
      s.description.toUpperCase().includes(q) ||
      (q.length >= 3 && s.category.toUpperCase().startsWith(q)),
  );
}

/** Decimals a symbol's price is shown with (5 for EUR/USD, 2 for most). */
export const pricePrecision = (symbol: string): number => globalSymbol(symbol)?.precision ?? 2;

/** Currency a symbol is quoted in. */
export const symbolCurrency = (symbol: string): string => globalSymbol(symbol)?.currency ?? (isUs(symbol) ? 'USD' : 'INR');

/** Where a symbol trades, for badges and the chart legend: NSE, US, COMEX, FX, Crypto… */
export const marketLabel = (symbol: string): string => globalSymbol(symbol)?.exchange ?? (isUs(symbol) ? 'US' : 'NSE');
