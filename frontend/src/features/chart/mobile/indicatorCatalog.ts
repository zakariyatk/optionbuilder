/**
 * klinecharts' built-in indicators as the phone chart offers them: a plain
 * name, whether it sits on the price chart or in its own pane below, and
 * names for its settings.
 */

export interface IndicatorInfo {
  name: string;
  title: string;
  group: 'Trend' | 'Momentum' | 'Volume' | 'Volatility';
  /** Drawn over the candles (else in a pane of its own). */
  overlay: boolean;
  /** Labels for calcParams, in order; extra params get "Value n". */
  params: string[];
  /** Params that are a list of lengths (one line each), like MA 5 / 10 / 30 / 60. */
  lines?: boolean;
}

export const INDICATORS: IndicatorInfo[] = [
  { name: 'MA', title: 'Moving Average', group: 'Trend', overlay: true, params: [], lines: true },
  { name: 'EMA', title: 'Exponential Moving Average', group: 'Trend', overlay: true, params: [], lines: true },
  { name: 'SMA', title: 'Smoothed Moving Average', group: 'Trend', overlay: true, params: ['Length', 'Weight'] },
  { name: 'BOLL', title: 'Bollinger Bands', group: 'Volatility', overlay: true, params: ['Length', 'StdDev'] },
  { name: 'SAR', title: 'Parabolic SAR', group: 'Trend', overlay: true, params: ['Start', 'Increment', 'Maximum'] },
  { name: 'BBI', title: 'Bull and Bear Index', group: 'Trend', overlay: true, params: [], lines: true },
  { name: 'AVP', title: 'Average Price (VWAP)', group: 'Volume', overlay: true, params: [] },
  { name: 'VOL', title: 'Volume', group: 'Volume', overlay: false, params: [], lines: true },
  { name: 'MACD', title: 'MACD', group: 'Momentum', overlay: false, params: ['Fast length', 'Slow length', 'Signal length'] },
  { name: 'RSI', title: 'Relative Strength Index', group: 'Momentum', overlay: false, params: [], lines: true },
  { name: 'KDJ', title: 'Stochastic (KDJ)', group: 'Momentum', overlay: false, params: ['%K length', '%K smoothing', '%D smoothing'] },
  { name: 'CCI', title: 'Commodity Channel Index', group: 'Momentum', overlay: false, params: ['Length'] },
  { name: 'DMI', title: 'Directional Movement (ADX)', group: 'Trend', overlay: false, params: ['DI length', 'ADX smoothing'] },
  { name: 'WR', title: 'Williams %R', group: 'Momentum', overlay: false, params: [], lines: true },
  { name: 'ROC', title: 'Rate of Change', group: 'Momentum', overlay: false, params: ['Length', 'Signal length'] },
  { name: 'MTM', title: 'Momentum', group: 'Momentum', overlay: false, params: ['Length', 'Signal length'] },
  { name: 'AO', title: 'Awesome Oscillator', group: 'Momentum', overlay: false, params: ['Fast length', 'Slow length'] },
  { name: 'TRIX', title: 'TRIX', group: 'Momentum', overlay: false, params: ['Length', 'Signal length'] },
  { name: 'BIAS', title: 'Bias', group: 'Momentum', overlay: false, params: [], lines: true },
  { name: 'PSY', title: 'Psychological Line', group: 'Momentum', overlay: false, params: ['Length', 'Signal length'] },
  { name: 'OBV', title: 'On Balance Volume', group: 'Volume', overlay: false, params: ['Signal length'] },
  { name: 'PVT', title: 'Price Volume Trend', group: 'Volume', overlay: false, params: [] },
  { name: 'VR', title: 'Volume Ratio', group: 'Volume', overlay: false, params: ['Length', 'Signal length'] },
  { name: 'EMV', title: 'Ease of Movement', group: 'Volume', overlay: false, params: ['Length', 'Signal length'] },
  { name: 'BRAR', title: 'Sentiment (BRAR)', group: 'Momentum', overlay: false, params: ['Length'] },
  { name: 'CR', title: 'Energy (CR)', group: 'Momentum', overlay: false, params: [], lines: true },
  { name: 'DMA', title: 'Different of Moving Average', group: 'Trend', overlay: false, params: ['Fast length', 'Slow length', 'Signal length'] },
];

export const indicatorInfo = (name: string) => INDICATORS.find((i) => i.name === name);

/** Label for setting `i` of an indicator. */
export function paramLabel(info: IndicatorInfo | undefined, i: number): string {
  if (info?.lines) return `Line ${i + 1} length`;
  return info?.params[i] ?? `Value ${i + 1}`;
}

/** A settings field's typed text as a number for calcParams, or null when it isn't one. */
export function parseParam(text: string, integer: boolean): number | null {
  const v = Number(text.trim());
  if (!text.trim() || !Number.isFinite(v) || v <= 0) return null;
  return integer ? Math.round(v) : v;
}
