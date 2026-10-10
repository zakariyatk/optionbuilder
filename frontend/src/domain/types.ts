export type LegType = 'CE' | 'PE' | 'FUT' | 'EQ';
export type LegAction = 'BUY' | 'SELL';

export interface Leg {
  id: string;
  action: LegAction;
  type: LegType;
  /** Ignored for FUT and EQ. */
  strike: number;
  /** Option premium, or entry price for FUT / EQ. */
  premium: number;
  lots: number;
  /** Units per lot. A stock leg uses lots = 1 and lotSize = share count. */
  lotSize: number;
  /** Upstox instrument key, present when the leg came from the live chain. Needed for broker margin. */
  instrumentKey?: string | null;
  /** Implied volatility in percent (e.g. 14.2), from the chain. */
  iv?: number | null;
  /** YYYY-MM-DD */
  expiry?: string | null;
}

export type NewLeg = Omit<Leg, 'id'>;

export const isLinear = (type: LegType) => type === 'FUT' || type === 'EQ';

export interface StrategyMetrics {
  /** null = unlimited */
  maxProfit: number | null;
  /** null = unlimited; otherwise ≤ 0 */
  maxLoss: number | null;
  breakevens: number[];
  /** + credit received, − debit paid (options only) */
  netPremium: number;
  riskRewardRatio: number | null;
  marginEstimate: number;
  isDefinedRisk: boolean;
  equityOutlay: number;
  premiumYield: number | null;
}

export interface Greeks {
  delta: number;
  gamma: number;
  /** Per calendar day, in rupees for the position. */
  theta: number;
  /** Per 1 vol point, in rupees for the position. */
  vega: number;
}
