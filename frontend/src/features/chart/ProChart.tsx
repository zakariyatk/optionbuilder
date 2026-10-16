import { useEffect, useRef, type RefObject } from 'react';
import { ExternalLink } from 'lucide-react';
import { KLineChartPro, type Datafeed, type Period, type SymbolInfo as ProSymbol } from '@klinecharts/pro';
import '@klinecharts/pro/dist/klinecharts-pro.css';
import { TooltipShowRule, type KLineData } from 'klinecharts';
import { api, UPSTOX_LOGIN_URL } from '../../api/client';
import { nseOpen } from '../../lib/nse';
import { attachLiveTag, innerChart, LIVE_TAG_STYLES } from './liveTag';
import { PERIODS, periodMs } from './periods';
import type { SymbolInfo } from '../../api/types';
import { installDrawingTools } from './drawingTools';
import { installPriceAlerts } from './priceAlerts';
import { installScaleButtons } from './scaleButtons';
import { installReplay, type ReplayController } from './replay';
import { useAlerts } from '../../store/alerts';
import { signalAlerts } from '../alerts/alertSignals';

const INTRADAY_POLL_MS = 15_000;
const DAILY_POLL_MS = 60_000;
/** Live quote → forming candle. The server caches quotes for 5s, so this stays cheap. */
const QUOTE_TICK_MS = 2_000;
/** After a failed history load, try the same symbol again this soon. */
const HISTORY_RETRY_MS = 3_000;

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

interface FeedHooks {
  /** A bar reached the chart. */
  onTick: () => void;
  /** The symbol and period the chart is showing now. */
  current: () => { symbol: ProSymbol; period: Period } | null;
  /** Makes the chart load its current symbol / period again. */
  reload: () => void;
  /** The chart finished loading this symbol (it may have been picked in the chart's own search). */
  onLoaded: (ticker: string) => void;
  /** Bar replay owns the chart: live bars must not be painted. */
  paused: () => boolean;
}

/**
 * Upstox as the chart's datafeed: the whole candle history Upstox gives for a
 * timeframe on first load, then the latest bars re-polled, and in between the
 * live quote moves the forming candle (and opens the next one on time) so the
 * chart ticks like TradingView.
 *
 * KLineChart Pro ignores symbol / period changes while a history load is in
 * flight, and if a load throws it never clears that state, so the chart stops
 * following the watchlist for good. So history loads never throw, and once
 * one settles the feed reloads whatever the chart is on now if that isn't
 * what was loaded (or retries a load that failed).
 */
function upstoxDatafeed(symbols: () => SymbolInfo[], hooks: FeedHooks): Datafeed & { dispose: () => void } {
  const subs = new Map<string, { timers: number[]; alive: boolean }>();
  const stop = (k: string) => {
    const sub = subs.get(k);
    if (!sub) return;
    sub.alive = false;
    sub.timers.forEach((t) => window.clearInterval(t));
    subs.delete(k);
  };
  const key = (s: ProSymbol, p: Period) => `${s.ticker}|${p.multiplier}${p.timespan}`;
  const showing = (s: ProSymbol, p: Period) => {
    const c = hooks.current();
    return !c || key(c.symbol, c.period) === key(s, p);
  };
  let disposed = false;
  let retry = 0;
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
      let all: KLineData[] = [];
      let failed = false;
      try {
        all = await loadCandles(symbol.ticker, period);
      } catch {
        failed = true;
      }
      // Pro finishes this load right after we return; then catch up with any change it ignored meanwhile.
      window.setTimeout(() => {
        if (disposed) return;
        window.clearTimeout(retry);
        if (!showing(symbol, period)) hooks.reload();
        else if (failed) retry = window.setTimeout(() => !disposed && showing(symbol, period) && hooks.reload(), HISTORY_RETRY_MS);
        else hooks.onLoaded(symbol.ticker);
      }, 0);
      const first = all[0]?.timestamp ?? 0;
      return to < first ? [] : all.filter((c) => c.timestamp <= to);
    },
    subscribe(symbol, period, callback) {
      // A load that finishes after the chart was torn down still subscribes; don't start polling for a chart that's gone.
      if (disposed) return;
      const k = key(symbol, period);
      stop(k);
      const sub = { timers: [] as number[], alive: true };
      subs.set(k, sub);
      let last = 0;
      /** The forming bar, as last sent to the chart. */
      let bar: KLineData | null = null;
      const send = (b: KLineData) => {
        // A request that was in flight when the chart moved on must not paint the old symbol's bars; nor may live bars land in a replay.
        if (!sub.alive || hooks.paused()) return;
        bar = b;
        callback(b);
        hooks.onTick();
      };
      const tick = async () => {
        if (document.visibilityState !== 'visible') return;
        try {
          const bars = await loadCandles(symbol.ticker, period);
          for (const b of bars.slice(-2)) if (b.timestamp >= last && (!bar || b.timestamp >= bar.timestamp)) send(b);
          last = bars[bars.length - 1]?.timestamp ?? last;
        } catch {
          /* keep the chart as is; the next poll retries */
        }
      };
      const quoteTick = async () => {
        if (!bar || document.visibilityState !== 'visible' || !nseOpen()) return;
        try {
          const q = (await api.watch([symbol.ticker])).quotes[0];
          if (!bar || !q || 'error' in q || !(q.price > 0)) return;
          const price = q.price;
          // The chart's own 2s quote also checks this symbol's alerts, so they fire without waiting for the app-wide monitor.
          signalAlerts(useAlerts.getState().observe(symbol.ticker, price));
          const span = periodMs(period);
          const now = Date.now();
          if (span !== null && now >= bar.timestamp + span) {
            // Open the next bar only when it directly follows this one (not across a session gap; the candle poll brings that).
            if (now < bar.timestamp + 2 * span) send({ timestamp: bar.timestamp + span, open: price, high: price, low: price, close: price, volume: 0 });
            return;
          }
          if (price !== bar.close) send({ ...bar, close: price, high: Math.max(bar.high, price), low: Math.min(bar.low, price) });
        } catch {
          /* next tick retries */
        }
      };
      const intraday = period.timespan === 'minute' || period.timespan === 'hour';
      void tick();
      sub.timers = [window.setInterval(tick, intraday ? INTRADAY_POLL_MS : DAILY_POLL_MS), window.setInterval(quoteTick, QUOTE_TICK_MS)];
    },
    unsubscribe(symbol, period) {
      stop(key(symbol, period));
    },
    /** Pro never unsubscribes when the chart is torn down; stop every poll. */
    dispose() {
      disposed = true;
      window.clearTimeout(retry);
      for (const k of [...subs.keys()]) stop(k);
    },
  };
}

/** Built-in toolbar entries a custom (phone) toolbar can open. */
export type ProTool = 'Indicator' | 'Timezone' | 'Setting' | 'Screenshot' | 'Full Screen';

/** Imperative handle for driving the chart from outside its own toolbar. */
export interface ProChartActions {
  setPeriod: (tf: string) => void;
  /** Opens one of the chart's own dialogs (indicators, settings, …). */
  openTool: (tool: ProTool) => void;
  /** Shows / hides the drawing-tools rail. */
  toggleDrawing: () => void;
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
  compact = false,
  actionsRef,
  onSymbolChange,
  onReplay,
}: {
  symbol: string;
  symbolInfo: SymbolInfo[];
  theme: 'light' | 'dark';
  brokerConnected: boolean;
  /** Phone layout: no built-in period bar or drawing rail; a parent toolbar drives them through `actionsRef`. */
  compact?: boolean;
  actionsRef?: RefObject<ProChartActions | null>;
  /** The chart switched symbol on its own (its search box). */
  onSymbolChange?: (symbol: string) => void;
  /** Hands out this chart's bar-replay controls (null when the chart goes away). */
  onReplay?: (replay: ReplayController | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<KLineChartPro | null>(null);
  const symbolsRef = useRef(symbolInfo);
  symbolsRef.current = symbolInfo;
  const symbolRef = useRef(symbol);
  symbolRef.current = symbol;
  const onSymbolChangeRef = useRef(onSymbolChange);
  onSymbolChangeRef.current = onSymbolChange;
  const onReplayRef = useRef(onReplay);
  onReplayRef.current = onReplay;
  const compactRef = useRef(compact);
  compactRef.current = compact;
  const scaleRef = useRef<ReturnType<typeof installScaleButtons> | null>(null);

  useEffect(() => {
    if (!actionsRef) return;
    actionsRef.current = {
      setPeriod: (tf) => {
        const p = PERIODS.find((x) => x.tf === tf);
        if (p) chart.current?.setPeriod(p);
      },
      openTool: (tool) => {
        const items = host.current?.querySelectorAll<HTMLElement>('.klinecharts-pro-period-bar .item.tools') ?? [];
        [...items].find((el) => el.textContent?.trim() === tool)?.click();
      },
      toggleDrawing: () => {
        // The library listens on the icon itself, not its wrapper.
        host.current?.querySelector('.klinecharts-pro-period-bar .menu-container svg')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      },
    };
    return () => {
      actionsRef.current = null;
    };
  }, [actionsRef]);



  // Built once per mount (and on reconnect); symbol and theme changes go through the API.
  useEffect(() => {
    const el = host.current;
    if (!el || !brokerConnected) return;
    el.replaceChildren();
    const info = symbolsRef.current.find((s) => s.symbol === symbol);
    let replay: ReplayController | null = null;
    const feed = upstoxDatafeed(() => symbolsRef.current, {
      onTick: () => {
        tag?.refresh();
        alerts.sync();
      },
      current: () => (chart.current ? { symbol: chart.current.getSymbol(), period: chart.current.getPeriod() } : null),
      // A fresh symbol object makes Pro run its load again for whatever symbol and period it is on.
      reload: () => {
        const c = chart.current;
        if (c) c.setSymbol({ ...c.getSymbol() });
      },
      onLoaded: (ticker) => {
        // Fresh history (a new symbol or timeframe, or leaving replay) ends any replay.
        replay?.reset();
        if (ticker !== symbolRef.current) onSymbolChangeRef.current?.(ticker);
      },
      paused: () => replay?.holdsChart() ?? false,
    });
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
      // Phones: no drawing rail until asked for, and the OHLC legend only while the crosshair is on a candle (as in mobile TradingView).
      drawingBarVisible: !compactRef.current,
      styles: { candle: { tooltip: { showRule: compactRef.current ? TooltipShowRule.FollowCross : TooltipShowRule.Always } } },
      mainIndicators: ['MA'],
      subIndicators: ['VOL'],
      datafeed: feed,
    });
    const removeTools = installDrawingTools(el);
    const pro = chart.current;
    const alerts = installPriceAlerts(el, () => pro.getSymbol().ticker);
    const scale = installScaleButtons(el);
    replay = installReplay(el, {
      chart: () => innerChart(el),
      reloadLive: () => pro.setSymbol({ ...pro.getSymbol() }),
      periodText: () => pro.getPeriod().text,
    });
    onReplayRef.current?.(replay);
    // Pro only resizes with the window; a chart in a multi-chart layout also changes size when the layout does.
    const resize = new ResizeObserver(() => innerChart(el)?.resize());
    resize.observe(el);
    scaleRef.current = scale;

    // Live price + candle countdown on the price axis, once the inner chart exists.
    let tag: ReturnType<typeof attachLiveTag> | null = null;
    let frame = 0;
    const attach = () => {
      const inner = innerChart(el);
      if (inner) tag = attachLiveTag(el, inner, () => pro.getPeriod());
      else frame = requestAnimationFrame(attach);
    };
    attach();

    return () => {
      feed.dispose();
      removeTools();
      alerts.dispose();
      scale.dispose();
      replay?.dispose();
      onReplayRef.current?.(null);
      resize.disconnect();
      scaleRef.current = null;
      cancelAnimationFrame(frame);
      tag?.dispose();
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
    // A theme swap resets the chart styles, including the live tag's.
    chart.current?.setStyles(LIVE_TAG_STYLES);
    scaleRef.current?.reapply();
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
  return <div ref={host} className={`ob-pro-chart h-full w-full ${compact ? 'ob-pro-compact' : ''}`} />;
}
