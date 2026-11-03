import { RISK_FREE_RATE } from './blackScholes';

/** Inputs to Black-Scholes that differ by market. */
export interface PricingModel {
  /** Continuously compounded risk-free rate, decimal. */
  rate: number;
  /** Continuous dividend yield of the underlying, decimal. */
  dividendYield: number;
}

/** NSE: India T-bill rate, no dividend adjustment — the builder's existing model. */
export const NSE_MODEL: PricingModel = { rate: RISK_FREE_RATE, dividendYield: 0 };

/** US 3-month T-bill ballpark. */
export const US_RISK_FREE_RATE = 0.0405;

/** US listed options: one contract is 100 shares. */
export const US_CONTRACT_SIZE = 100;

/** Broker-style per-contract commission used for the US estimate. */
export const US_COMMISSION_PER_CONTRACT = 0.65;

export const usModel = (dividendYield: number): PricingModel => ({ rate: US_RISK_FREE_RATE, dividendYield });

/** Listed US strike spacing by price band (the common $0.5 / $1 / $2.5 / $5 grid). */
export function usStrikeStep(price: number): number {
  return price < 25 ? 0.5 : price < 100 ? 1 : price < 250 ? 2.5 : 5;
}
