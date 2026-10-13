/** Response shapes of the PHP backend in /api. Kept in one place so a backend change is a one-file diff here. */

export interface Session {
  authRequired: boolean;
  loggedIn: boolean;
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
  authenticated: boolean;
  token: { user_name: string | null; issued_at: number; expires_at: number } | null;
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

export interface BrokerPosition {
  instrumentKey: string;
  symbol: string;
  exchange: string;
  product: string;
  /** Net quantity: positive long, negative short, 0 closed for the day. */
  quantity: number;
  averagePrice: number;
  buyPrice: number;
  sellPrice: number;
  ltp: number;
  closePrice: number;
  pnl: number;
  realised: number;
  unrealised: number;
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
}

export type NewDraft = Pick<Draft, 'name' | 'symbol' | 'legs' | 'entrySpot'>;
