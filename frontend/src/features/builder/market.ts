import { createContext, useContext } from 'react';
import { strikeStep as nseStrikeStep } from '../../domain/chain';
import { NSE_MODEL, usModel, usStrikeStep, type PricingModel } from '../../domain/pricing';
import { axisIndian, inr } from '../../lib/format';
import { displaySymbol } from '../../lib/markets';
import { NSE_SESSION, US_SESSION, type Session } from '../../lib/nse';

/**
 * Everything the builder's panels need to know about the market they price:
 * currency formatting, the Black-Scholes inputs, strike spacing, the trading
 * session and the words for a contract. India keeps the existing Upstox /
 * NSE model; the US uses 100-share contracts, a US rate and dividend yield.
 */
export interface MarketView {
  id: 'IN' | 'US';
  currencySymbol: '₹' | '$';
  model: PricingModel;
  session: Session;
  /** What one `lots` unit is called. */
  unit: { one: string; many: string };
  money: (v: number) => string;
  signedMoney: (v: number) => string;
  /** Axis-sized money: 1.2k, 3.4L (India) / 1.2k, 3.4M (US). */
  axis: (v: number) => string;
  /** An underlying price or strike. */
  price: (v: number) => string;
  strikeStep: (symbol: string, spot: number) => number;
  display: (symbol: string) => string;
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** Minus sign and the currency mark in the order traders write them: −₹3,351, +$207.00. */
const signed = (fmt: (v: number) => string) => (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v))}`;

function axisUs(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  return v.toFixed(0);
}

export const INDIA_VIEW: MarketView = {
  id: 'IN',
  currencySymbol: '₹',
  model: NSE_MODEL,
  session: NSE_SESSION,
  unit: { one: 'lot', many: 'lots' },
  money: inr,
  signedMoney: signed(inr),
  axis: axisIndian,
  price: (v) => v.toLocaleString('en-IN', { maximumFractionDigits: v >= 1000 ? 0 : 2 }),
  strikeStep: nseStrikeStep,
  display: (s) => s,
};

export function usView(dividendYield: number): MarketView {
  return {
    id: 'US',
    currencySymbol: '$',
    model: usModel(dividendYield),
    session: US_SESSION,
    unit: { one: 'contract', many: 'contracts' },
    money: (v) => (Math.abs(v) >= 10_000 ? usdWhole : usd).format(v),
    signedMoney: signed((v) => (v >= 10_000 ? usdWhole : usd).format(v)),
    axis: axisUs,
    price: (v) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    strikeStep: (_symbol, spot) => usStrikeStep(spot),
    display: displaySymbol,
  };
}

export const MarketContext = createContext<MarketView>(INDIA_VIEW);

export const useMarket = () => useContext(MarketContext);
