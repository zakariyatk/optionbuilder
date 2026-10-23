/** Response shapes of the PHP backend in /api. Kept in one place so a backend change is a one-file diff here. */

export interface Session {
  authRequired: boolean;
  loggedIn: boolean;
  /** Set when Supabase sign-in is configured; the login gate then offers email code / Google. */
  supabase?: SupabaseConfig | null;
  /** False once Supabase sign-in has replaced the password. */
  passwordLogin?: boolean;
}

export interface SupabaseConfig {
  url: string;
  /** Publishable (anon) key — public by design. */
  key: string;
  /** The Google provider is enabled in the Supabase project. */
  google: boolean;
}

export interface SymbolInfo {
  symbol: string;
  label: string;
  lotSize: number;
}

export interface SymbolsResponse {
  indices: SymbolInfo[];
  all: SymbolInfo[];
}

export interface SpotQuote {
  symbol: string;
  ticker: string;
  price: number;
  previousClose: number;
  currency: string;
  marketTime: number;
}

/** A watchlist row: a spot quote, or a marker that the symbol couldn't be quoted. */
export type WatchQuote = SpotQuote | { symbol: string; error: true };

export interface ChainSide {
  instrumentKey: string | null;
  ltp: number;
  change: number;
  oi: number;
  oiChange: number;
  volume: number;
  iv: number;
  delta: number | null;
  theta: number | null;
  bid: number;
  ask: number;
}

export interface ChainRow {
  strike: number;
  call: ChainSide | null;
  put: ChainSide | null;
}

export interface OptionChain {
  source: 'upstox';
  symbol: string;
  lotSize: number;
  underlyingValue: number | null;
  timestamp: string;
  expiryDates: string[];
  expiry: string | null;
  rows: ChainRow[];
}

export interface AuthStatus {
  configured: boolean;
  /** Today's Upstox login is active (needed for broker margin). */
  authenticated: boolean;
  /** Live quotes, candles and chains are available — via the login or the analytics token. */
  marketData?: boolean;
  /** The server has a 1-year Upstox analytics token. */
  analytics?: boolean;
  token:{ user_name: string | null; issued_at: number; expires_at: number } | null;
  loginUrl: string | null;
}

export interface BrokerMargin {
  required_margin?: number;
  final_margin?: number;
}

export interface OiPeak {
  strike: number;
  oi: number;
  ltp: number;
  oiChange: number;
}

export interface OiBar {
  strike: number;
  callOi: number;
  putOi: number;
  callOiChange: number;
  putOiChange: number;
}

export interface MaxOiSummary {
  expiry: string;
  spot: number | null;
  maxCallOi: OiPeak | null;
  maxPutOi: OiPeak | null;
  totalCallOi: number;
  totalPutOi: number;
  pcr: number | null;
  distribution: OiBar[];
}

export interface MaxOiReport {
  symbol: string;
  currentMonthly: MaxOiSummary | null;
  december: MaxOiSummary | null;
}

export interface FiiDiiRow {
  category: string;
  date: string;
  buy: number;
  sell: number;
  net: number;
}

export interface GlobalItem {
  name: string;
  symbol: string;
  inverseForIndia?: boolean;
  ok: boolean;
  price: number | null;
  changePct: number;
}

export interface GlobalMarkets {
  groups: { group: string; equity: boolean; items: GlobalItem[] }[];
  sentiment: {
    label: string;
    equityAvg: number | null;
    drivers: string[];
    caveats: string[];
  };
  asOf: string;
}

export interface NewsItem {
  title: string;
  link: string;
  source: string;
  published: string | null;
  point?: string;
  tag?: string;
  figures?: string[];
}

export interface Quotes {
  /** Last traded price per Upstox instrument key. */
  quotes: Record<string, number>;
  at: number;
}

export interface DraftLeg {
  action: 'BUY' | 'SELL';
  type: 'CE' | 'PE' | 'FUT' | 'EQ';
  strike: number;
  /** Entry price. */
  premium: number;
  lots: number;
  lotSize: number;
  instrumentKey: string | null;
  iv: number | null;
  expiry: string | null;
}

/** One fill recorded against a draft: the opening legs, and every later add or exit. */
export interface DraftTrade {
  at: number;
  action: 'BUY' | 'SELL';
  type: DraftLeg['type'];
  strike: number;
  expiry: string | null;
  lots: number;
  lotSize: number;
  price: number;
  /** P&L booked by this trade (when it reduced or closed a leg). */
  realized: number;
}

export interface Draft {
  id: string;
  name: string;
  symbol: string;
  legs: DraftLeg[];
  entrySpot: number | null;
  createdAt: number;
  closedAt: number | null;
  /** One exit price per leg, recorded when the draft is closed. */
  exitPremiums: number[] | null;
  exitSpot: number | null;
  /** P&L already booked by exits and reductions. Absent on drafts saved before adjustments existed. */
  realized?: number;
  trades?: DraftTrade[];
}

export type NewDraft = Pick<Draft, 'name' | 'symbol' | 'legs' | 'entrySpot'>;

export interface PortfolioTxn {
  id: string;
  kind: 'STOCK' | 'FUT';
  side: 'BUY' | 'SELL';
  symbol: string;
  /** YYYY-MM-DD */
  date: string;
  /** Shares for a stock, lots for a future. */
  qty: number;
  price: number;
  fees: number;
  /** US stocks only: rupees per dollar on the transaction date. Price and fees are in dollars. */
  fx?: number;
  /** Futures only. */
  lotSize?: number;
  expiry?: string;
  instrumentKey?: string | null;
  note?: string;
}

export interface Portfolio {
  id: string;
  name: string;
  createdAt: number;
  transactions: PortfolioTxn[];
}

export interface HistorySeries {
  currency: string;
  /** [unix seconds, close] oldest first. */
  points: [number, number][];
}

export interface FutureContract {
  expiry: string;
  instrumentKey: string;
  lotSize: number;
}

/** A US stock or ETF from /api/search. `symbol` is the app's key, e.g. "US:AAPL". */
export interface UsSearchResult {
  symbol: string;
  ticker: string;
  name: string;
  exchange: string;
  type: 'EQUITY' | 'ETF';
}
