import { useEffect, useRef } from 'react';
import { ExternalLink } from 'lucide-react';
import { KLineChartPro, type Datafeed, type Period, type SymbolInfo as ProSymbol } from '@klinecharts/pro';
import '@klinecharts/pro/dist/klinecharts-pro.css';
import type { KLineData } from 'klinecharts';
import { api, UPSTOX_LOGIN_URL } from '../../api/client';
import type { SymbolInfo } from '../../api/types';

/** The chart's periods, and the Upstox candle timeframe each one loads. */
const PERIODS: (Period & { tf: string })[] = [
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
const INTRADAY_POLL_MS = 15_000;
const DAILY_POLL_MS = 60_000;

const tfOf = (p: Period) => PERIODS.find((x) => x.multiplier === p.multiplier && x.timespan === p.timespan)?.tf ?? '15m';

const toProSymbol = (s: SymbolInfo | { symbol: string; label?: string }): ProSymbol => ({
  ticker: s.symbol,
  name: 'label' in s && s.label ? s.label : s.symbol,
  shortName: s.symbol,
  exchange: 'NSE',
  market: 'stocks',
  pricePrecision: 2,
  volumePrecision: 0,
  priceCurrency: 'inr',
});

async function loadCandles(symbol: string, period: Period): Promise<KLineData[]> {
  const res = await api.candles(symbol, tfOf(period));
  return res.candles.map(([t, open, high, low, close, volume]) => ({ timestamp: t * 1000, open, high, low, close, volume }));
}

/**
 * Upstox as the chart's datafeed: the whole candle history Upstox gives for a
 * timeframe on first load, then the latest bar re-polled for live updates.
 */
function upstoxDatafeed(symbols: () => SymbolInfo[]): Datafeed {
  const timers = new Map<string, number>();
  const key = (s: ProSymbol, p: Period) => `${s.ticker}|${p.multiplier}${p.timespan}`;
  return {
    async searchSymbols(search = '') {
      const q = search.trim().toUpperCase();
      return symbols()
        .filter((s) => !q || s.symbol.includes(q) || s.label.toUpperCase().includes(q))
        .slice(0, 50)
        .map(toProSymbol);
    },
    async getHistoryKLineData(symbol, period, _from, to) {
      // One request returns everything Upstox has for this timeframe, so scrolling back pages in nothing older.
      const all = await loadCandles(symbol.ticker, period);
      const first = all[0]?.timestamp ?? 0;
      return to < first ? [] : all.filter((c) => c.timestamp <= to);
    },
    subscribe(symbol, period, callback) {
      const k = key(symbol, period);
      window.clearInterval(timers.get(k));
      let last = 0;
      const tick = async () => {
        if (document.visibilityState !== 'visible') return;
        try {
          const bars = await loadCandles(symbol.ticker, period);
          for (const b of bars.slice(-2)) if (b.timestamp >= last) callback(b);
          last = bars[bars.length - 1]?.timestamp ?? last;
        } catch {
          /* keep the chart as is; the next poll retries */
        }
      };
      const intraday = period.timespan === 'minute' || period.timespan === 'hour';
      timers.set(k, window.setInterval(tick, intraday ? INTRADAY_POLL_MS : DAILY_POLL_MS));
    },
    unsubscribe(symbol, period) {
      const k = key(symbol, period);
      window.clearInterval(timers.get(k));
      timers.delete(k);
    },
  };
}

/**
 * TradingView-style chart (KLineChart Pro): drawing toolbar, indicators,
 * periods, timezone, settings and screenshot — fed by the user's Upstox data.
 */
export function ProChart({
  symbol,
  symbolInfo,
  theme,
  brokerConnected,
}: {
  symbol: string;
  symbolInfo: SymbolInfo[];
  theme: 'light' | 'dark';
  brokerConnected: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<KLineChartPro | null>(null);
  const symbolsRef = useRef(symbolInfo);
  symbolsRef.current = symbolInfo;

  // Built once per mount (and on reconnect); symbol and theme changes go through the API.
  useEffect(() => {
    const el = host.current;
    if (!el || !brokerConnected) return;
    el.replaceChildren();
    const info = symbolsRef.current.find((s) => s.symbol === symbol);
    chart.current = new KLineChartPro({
      container: el,
      theme,
      locale: 'en-US',
      // An empty node: no logo watermark behind the candles.
      watermark: document.createElement('span'),
      timezone: 'Asia/Kolkata',
      symbol: toProSymbol(info ?? { symbol }),
      period: PERIODS[3],
      periods: PERIODS,
      mainIndicators: ['MA'],
      subIndicators: ['VOL'],
      datafeed: upstoxDatafeed(() => symbolsRef.current),
    });
    return () => {
      el.replaceChildren();
      chart.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- symbol / theme are applied by the effects below
  }, [brokerConnected]);

  useEffect(() => {
    const c = chart.current;
    if (c && c.getSymbol().ticker !== symbol) {
      c.setSymbol(toProSymbol(symbolsRef.current.find((s) => s.symbol === symbol) ?? { symbol }));
    }
  }, [symbol]);

  useEffect(() => {
    chart.current?.setTheme(theme);
  }, [theme]);

  if (!brokerConnected) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-[var(--text-muted)]">
        Connect Upstox to load the chart from your account.
        <a href={UPSTOX_LOGIN_URL} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-md bg-[var(--series-blue)] px-4 py-2 text-sm font-medium text-white">
          Connect Upstox
          <ExternalLink size={16} aria-hidden="true" />
        </a>
      </div>
    );
  }
  return <div ref={host} className="ob-pro-chart h-full w-full" />;
}
