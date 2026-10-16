import type { OiHistory } from '../domain/oi';
import type {
  AuthStatus,
  BrokerMargin,
  BrokerPosition,
  Draft,
  DraftLeg,
  FiiDiiRow,
  FutureContract,
  GlobalMarkets,
  HistorySeries,
  MaxOiReport,
  NewDraft,
  NewsItem,
  OptionChain,
  Portfolio,
  PortfolioTxn,
  Quotes,
  Session,
  SpotQuote,
  SymbolsResponse,
  WatchQuote,
} from './types';

/** App root without the trailing slash, e.g. "/optionbuilder". */
export const APP_BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export const apiUrl = (path: string) => `${APP_BASE}${path}`;
export const assetUrl = (path: string) => `${APP_BASE}/${path.replace(/^\//, '')}`;

/** Opened in a new tab: Upstox's OAuth consent screen, which redirects back to the backend. */
export const UPSTOX_LOGIN_URL = apiUrl('/api/auth/upstox/login');

/** Thrown when the app session is missing or expired — the shell reacts by showing the login gate. */
export class LoginRequiredError extends Error {
  constructor() {
    super('LOGIN_REQUIRED');
    this.name = 'LoginRequiredError';
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly detail: string | undefined;

  constructor(status: number, code?: string, detail?: string) {
    super(code ? (detail ? `${code}: ${detail}` : code) : `Request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }

  /** The broker token is missing or expired — the user needs to reconnect Upstox, not retry. */
  get needsBrokerLogin(): boolean {
    return this.code === 'NOT_AUTHENTICATED' || this.detail === 'NOT_AUTHENTICATED';
  }
}

const loginListeners = new Set<() => void>();

/** Subscribe to "session expired" — fired by any request that comes back LOGIN_REQUIRED. */
export function onLoginRequired(fn: () => void): () => void {
  loginListeners.add(fn);
  return () => loginListeners.delete(fn);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      credentials: 'same-origin',
      ...init,
      headers: {
        Accept: 'application/json',
        // Lets the backend reject cross-site form posts: a plain HTML form cannot set this header.
        'X-Requested-With': 'OptionBuilder',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection.');
  }

  const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };

  if (res.status === 401 && body.error === 'LOGIN_REQUIRED') {
    loginListeners.forEach((fn) => fn());
    throw new LoginRequiredError();
  }
  if (!res.ok) {
    throw new ApiError(res.status, body.error, body.detail);
  }
  return body as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, payload: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(payload) });

export const api = {
  session: () => get<Session>('/api/session'),
  login: (password: string) => post<{ ok: true }>('/api/login', { password }),
  logout: () => post<{ ok: true }>('/api/logout', {}),

  authStatus: () => get<AuthStatus>('/api/auth/status'),
  disconnectBroker: () => post<{ ok: true }>('/api/auth/logout', {}),

  symbols: () => get<SymbolsResponse>('/api/symbols'),
  /** OHLCV candles from Upstox: [unix seconds, open, high, low, close, volume], oldest first. */
  candles: (symbol: string, tf: string) =>
    get<{ symbol: string; tf: string; candles: [number, number, number, number, number, number][] }>(
      `/api/candles?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(tf)}`,
    ),
  /** Per-minute OI per strike for one expiry, for the Open Interest page's time window. */
  oiIntraday: (symbol: string, expiry: string, min: number, max: number) =>
    get<OiHistory>(`/api/oi-intraday?${new URLSearchParams({ symbol, expiry, min: String(min), max: String(max) })}`),
  watch: (symbols: string[]) => get<{ quotes: WatchQuote[] }>(`/api/watch?symbols=${encodeURIComponent(symbols.join(','))}`),
  spot: (symbol: string) => get<SpotQuote>(`/api/spot?symbol=${encodeURIComponent(symbol)}`),
  optionChain: (symbol: string, expiry?: string) => {
    const q = new URLSearchParams({ symbol });
    if (expiry) q.set('expiry', expiry);
    return get<OptionChain>(`/api/option-chain?${q}`);
  },
  margin: (legs: { instrumentKey: string; quantity: number; action: 'BUY' | 'SELL' }[]) =>
    post<BrokerMargin>('/api/margin', { legs }),

  quotes: (keys: string[]) => get<Quotes>(`/api/quotes?keys=${encodeURIComponent(keys.join(','))}`),
  positions: () => get<{ positions: BrokerPosition[]; at: number }>('/api/positions'),

  drafts: () => get<{ drafts: Draft[] }>('/api/drafts'),
  createDraft: (draft: NewDraft) => post<{ draft: Draft }>('/api/drafts', draft),
  renameDraft: (id: string, name: string) => post<{ draft: Draft }>('/api/drafts/update', { id, name }),
  closeDraft: (id: string, exitPremiums: number[], exitSpot: number | null) =>
    post<{ draft: Draft }>('/api/drafts/update', { id, close: { exitPremiums, exitSpot } }),
  /** Saves the netted legs after a fill, with the fill itself for the trade record. */
  adjustDraft: (id: string, legs: DraftLeg[], trade: DraftLeg & { realized: number }, spot: number | null) =>
    post<{ draft: Draft }>('/api/drafts/update', { id, adjust: { legs, trade, spot } }),
  reopenDraft: (id: string) => post<{ draft: Draft }>('/api/drafts/update', { id, reopen: true }),
  deleteDraft: (id: string) => post<{ ok: true }>('/api/drafts/delete', { id }),

  portfolios: () => get<{ portfolios: Portfolio[] }>('/api/portfolios'),
  createPortfolio: (name: string) => post<{ portfolio: Portfolio }>('/api/portfolios', { name }),
  renamePortfolio: (id: string, name: string) => post<{ portfolio: Portfolio }>('/api/portfolios/update', { id, name }),
  /** Saves the whole transaction list — the server keeps no derived state. */
  savePortfolioTxns: (id: string, transactions: PortfolioTxn[]) =>
    post<{ portfolio: Portfolio }>('/api/portfolios/update', { id, transactions }),
  deletePortfolio: (id: string) => post<{ ok: true }>('/api/portfolios/delete', { id }),
  /** Daily closes (Yahoo) for stocks and benchmark keys such as NIFTY, SP500, QQQ, USDINR. */
  history: (symbols: string[], range = '5y') =>
    get<{ series: Record<string, HistorySeries> }>(`/api/history?symbols=${encodeURIComponent(symbols.join(','))}&range=${range}`),
  futures: (symbol: string) =>
    get<{ symbol: string; contracts: FutureContract[] }>(`/api/futures?symbol=${encodeURIComponent(symbol)}`),

  maxOi: (symbol: string) => get<MaxOiReport>(`/api/report/max-oi?symbol=${encodeURIComponent(symbol)}`),
  fiiDii: () => get<{ data: FiiDiiRow[] }>('/api/report/fii-dii'),
  globalMarkets: () => get<GlobalMarkets>('/api/report/global'),
  news: () => get<{ items: NewsItem[] }>('/api/report/news'),
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError && e.needsBrokerLogin) return 'Upstox session expired — reconnect to load live data.';
  if (e instanceof Error) return e.message;
  return String(e);
}
