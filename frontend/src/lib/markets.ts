/**
 * US symbols travel through the app as "US:<ticker>" (e.g. US:AAPL) so they
 * never collide with an NSE symbol; the backend maps them to Yahoo tickers.
 */
export const US_PREFIX = 'US:';

export const isUs = (symbol: string) => symbol.startsWith(US_PREFIX);

/** The ticker as traders write it: US:AAPL → AAPL; NSE symbols unchanged. */
export const displaySymbol = (symbol: string) => (isUs(symbol) ? symbol.slice(US_PREFIX.length) : symbol);

/** Currency a symbol is quoted in. */
export const symbolCurrency = (symbol: string): 'USD' | 'INR' => (isUs(symbol) ? 'USD' : 'INR');
