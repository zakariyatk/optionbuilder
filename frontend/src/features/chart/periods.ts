import type { Period } from '@klinecharts/pro';

/** The chart's periods, and the Upstox candle timeframe each one loads. */
export const PERIODS: (Period & { tf: string })[] = [
  { multiplier: 1, timespan: 'minute', text: '1m', tf: '1m' },
  { multiplier: 3, timespan: 'minute', text: '3m', tf: '3m' },
  { multiplier: 5, timespan: 'minute', text: '5m', tf: '5m' },
  { multiplier: 15, timespan: 'minute', text: '15m', tf: '15m' },
  { multiplier: 30, timespan: 'minute', text: '30m', tf: '30m' },
  { multiplier: 1, timespan: 'hour', text: '1H', tf: '1h' },
  { multiplier: 4, timespan: 'hour', text: '4H', tf: '4h' },
  { multiplier: 1, timespan: 'day', text: 'D', tf: '1D' },
  { multiplier: 1, timespan: 'week', text: 'W', tf: '1W' },
  { multiplier: 1, timespan: 'month', text: 'M', tf: '1M' },
];
