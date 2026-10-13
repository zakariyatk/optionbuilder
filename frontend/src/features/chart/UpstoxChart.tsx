import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type MouseEventParams,
  type SeriesType,
  type UTCTimestamp,
} from 'lightweight-charts';
import { api, UPSTOX_LOGIN_URL } from '../../api/client';
import { bollinger, ema, heikinAshi, rsi, sma, vwap, type Candle, type Series } from '../../domain/indicators';
import { useAsync } from '../../hooks/useAsync';
import { num } from '../../lib/format';

const TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1D', '1W', '1M'] as const;
type Timeframe = (typeof TIMEFRAMES)[number];
const INTRADAY: Timeframe[] = ['1m', '3m', '5m', '15m', '30m', '1h', '4h'];

const STYLES = [
  { id: 'candles', label: 'Candles' },
  { id: 'heikin', label: 'Heikin Ashi' },
  { id: 'bars', label: 'Bars' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
] as const;
type Style = (typeof STYLES)[number]['id'];

const INDICATORS = [
  { id: 'volume', label: 'Volume' },
  { id: 'sma20', label: 'SMA 20' },
  { id: 'ema50', label: 'EMA 50' },
  { id: 'ema200', label: 'EMA 200' },
  { id: 'vwap', label: 'VWAP' },
  { id: 'bb', label: 'Bollinger Bands (20, 2)' },
  { id: 'rsi', label: 'RSI 14' },
] as const;
type Indicator = (typeof INDICATORS)[number]['id'];

/** Chart times are drawn in UTC, so shifting by +05:30 makes the axis read IST. */
const IST = 19800;

const PREFS_KEY = 'option-builder-chart';

interface Prefs {
  tf: Timeframe;
  style: Style;
  indicators: Indicator[];
}

function loadPrefs(): Prefs {
  const fallback: Prefs = { tf: '15m', style: 'candles', indicators: ['volume'] };
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    return {
      tf: TIMEFRAMES.includes(p?.tf as Timeframe) ? (p!.tf as Timeframe) : fallback.tf,
      style: STYLES.some((s) => s.id === p?.style) ? (p!.style as Style) : fallback.style,
      indicators: Array.isArray(p?.indicators) ? p!.indicators.filter((i) => INDICATORS.some((x) => x.id === i)) : fallback.indicators,
    };
  } catch {
    return fallback;
  }
}

function linesFor(symbol: string): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(`${PREFS_KEY}-lines-${symbol}`) ?? '[]');
    return Array.isArray(v) ? v.filter((n) => typeof n === 'number') : [];
  } catch {
    return [];
  }
}

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const toLine = (candles: Candle[], values: Series) =>
  candles.flatMap((c, i) => (values[i] == null ? [] : [{ time: (c.time + IST) as UTCTimestamp, value: values[i] as number }]));

interface Legend {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
}

/**
 * NSE chart from the user's Upstox candles, drawn with TradingView's
 * open-source Lightweight Charts engine.
 */
export function UpstoxChart({ symbol, theme, brokerConnected }: { symbol: string; theme: 'light' | 'dark'; brokerConnected: boolean }) {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [menu, setMenu] = useState<'style' | 'indicators' | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [lines, setLines] = useState<number[]>(() => linesFor(symbol));
  const [legend, setLegend] = useState<Legend | null>(null);

  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const priceLines = useRef<IPriceLine[]>([]);
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;

  const { tf, style, indicators } = prefs;
  const intraday = INTRADAY.includes(tf);
  const data = useAsync(() => api.candles(symbol, tf), [symbol, tf], { pollMs: intraday ? 15_000 : 60_000, enabled: brokerConnected });

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  }, [prefs]);

  useEffect(() => setLines(linesFor(symbol)), [symbol]);
  useEffect(() => {
    try {
      localStorage.setItem(`${PREFS_KEY}-lines-${symbol}`, JSON.stringify(lines));
    } catch {
      /* ignore */
    }
  }, [lines, symbol]);

  const candles = useMemo<Candle[]>(
    () => (data.data?.candles ?? []).map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume })),
    [data.data],
  );
  const hasVolume = candles.some((c) => c.volume > 0);

  // Build the chart: once per symbol / timeframe / look, refilled on every poll.
  const viewKey = `${symbol}|${tf}`;
  const lastView = useRef('');
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (candles.length === 0) {
      // Loading a new symbol / timeframe: don't leave the previous chart standing.
      chartRef.current?.remove();
      chartRef.current = null;
      mainRef.current = null;
      return;
    }

    const keepRange = lastView.current === viewKey ? chartRef.current?.timeScale().getVisibleLogicalRange() : null;
    chartRef.current?.remove();

    const text = cssVar('--text-secondary');
    const grid = cssVar('--gridline');
    const up = cssVar('--good');
    const down = cssVar('--critical');
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: cssVar('--surface-card') },
        textColor: text,
        fontSize: 11,
        attributionLogo: true,
      },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: grid },
      timeScale: { borderColor: grid, timeVisible: intraday, secondsVisible: false, rightOffset: 6 },
      localization: { priceFormatter: (p: number) => p.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
    });
    chartRef.current = chart;

    const bars = style === 'heikin' ? heikinAshi(candles) : candles;
    const ohlc = bars.map((c) => ({ time: (c.time + IST) as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close }));
    let main: ISeriesApi<SeriesType>;
    if (style === 'line') {
      main = chart.addSeries(LineSeries, { color: cssVar('--series-blue'), lineWidth: 2 });
      main.setData(ohlc.map((b) => ({ time: b.time, value: b.close })));
    } else if (style === 'area') {
      const blue = cssVar('--series-blue');
      main = chart.addSeries(AreaSeries, { lineColor: blue, topColor: `${blue}55`, bottomColor: `${blue}05`, lineWidth: 2 });
      main.setData(ohlc.map((b) => ({ time: b.time, value: b.close })));
    } else if (style === 'bars') {
      main = chart.addSeries(BarSeries, { upColor: up, downColor: down });
      main.setData(ohlc);
    } else {
      main = chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down });
      main.setData(ohlc);
    }
    mainRef.current = main;

    const closes = candles.map((c) => c.close);
    const overlay = (values: Series, color: string, width: 1 | 2 = 1, dashed = false) => {
      const s = chart.addSeries(LineSeries, {
        color,
        lineWidth: width,
        lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      s.setData(toLine(candles, values));
    };
    if (indicators.includes('sma20')) overlay(sma(closes, 20), '#f5a623', 2);
    if (indicators.includes('ema50')) overlay(ema(closes, 50), '#9b59b6', 2);
    if (indicators.includes('ema200')) overlay(ema(closes, 200), '#e84393', 2);
    if (indicators.includes('vwap') && intraday && hasVolume) overlay(vwap(candles), '#00b8d9', 2);
    if (indicators.includes('bb')) {
      const b = bollinger(closes, 20, 2);
      overlay(b.upper, '#2a78d6', 1);
      overlay(b.mid, '#2a78d6', 1, true);
      overlay(b.lower, '#2a78d6', 1);
    }
    if (indicators.includes('volume') && hasVolume) {
      const vol = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      vol.setData(candles.map((c) => ({ time: (c.time + IST) as UTCTimestamp, value: c.volume, color: c.close >= c.open ? `${up}66` : `${down}66` })));
    }
    if (indicators.includes('rsi')) {
      const r = chart.addSeries(LineSeries, { color: '#9b59b6', lineWidth: 1, priceLineVisible: false }, 1);
      r.setData(toLine(candles, rsi(closes, 14)));
      r.createPriceLine({ price: 70, color: down, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: '' });
      r.createPriceLine({ price: 30, color: up, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: '' });
      chart.panes()[1]?.setStretchFactor(0.25);
    }

    if (keepRange) chart.timeScale().setVisibleLogicalRange(keepRange);
    else chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - 160), to: candles.length + 6 });
    lastView.current = viewKey;

    const lastLegend = (i: number): Legend => {
      const c = candles[i];
      const prev = candles[i - 1];
      return { open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, change: prev ? c.close - prev.close : 0 };
    };
    setLegend(lastLegend(candles.length - 1));
    const onMove = (p: MouseEventParams) => {
      const i = p.logical === undefined ? -1 : Math.round(p.logical);
      setLegend(lastLegend(i >= 0 && i < candles.length ? i : candles.length - 1));
    };
    const onClick = (p: MouseEventParams) => {
      if (!drawingRef.current || !p.point) return;
      const price = main.coordinateToPrice(p.point.y);
      if (price !== null) {
        setLines((l) => [...l, Math.round(price * 100) / 100]);
        setDrawing(false);
      }
    };
    chart.subscribeCrosshairMove(onMove);
    chart.subscribeClick(onClick);
    priceLines.current = [];
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.unsubscribeClick(onClick);
    };
  }, [candles, style, indicators, theme, intraday, hasVolume, viewKey]);

  // Horizontal lines live on the main series.
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    priceLines.current.forEach((l) => main.removePriceLine(l));
    priceLines.current = lines.map((price) =>
      main.createPriceLine({ price, color: cssVar('--warning'), lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: '' }),
    );
  }, [lines, candles, style, indicators, theme]);

  useEffect(
    () => () => {
      chartRef.current?.remove();
      chartRef.current = null;
    },
    [],
  );

  const screenshot = () => {
    const canvas = chartRef.current?.takeScreenshot();
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `${symbol}-${tf}.png`;
    a.click();
  };

  const toggleIndicator = (id: Indicator) =>
    setPrefs((p) => ({ ...p, indicators: p.indicators.includes(id) ? p.indicators.filter((x) => x !== id) : [...p.indicators, id] }));

  const btn = 'rounded px-2 py-1 text-xs font-medium transition-colors';
  const idle = 'text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]';
  const on = 'bg-[var(--surface-sunken)] text-[var(--series-blue)]';
  const pnl = (v: number) => (v >= 0 ? 'var(--good-text)' : 'var(--critical)');

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--border)] px-2 py-1.5">
        <span className="mr-2 text-sm font-semibold">{symbol}</span>
        <div className="flex items-center" role="group" aria-label="Timeframe">
          {TIMEFRAMES.map((t) => (
            <button key={t} type="button" aria-pressed={tf === t} onClick={() => setPrefs((p) => ({ ...p, tf: t }))} className={`${btn} ${tf === t ? on : idle}`}>
              {t}
            </button>
          ))}
        </div>
        <span className="mx-1 h-5 w-px bg-[var(--border)]" />
        <div className="relative">
          <button type="button" aria-expanded={menu === 'style'} onClick={() => setMenu((m) => (m === 'style' ? null : 'style'))} className={`${btn} ${idle}`}>
            {STYLES.find((s) => s.id === style)?.label} ▾
          </button>
          {menu === 'style' && (
            <div className="absolute left-0 top-full z-20 mt-1 w-40 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] p-1 shadow-xl">
              {STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setPrefs((p) => ({ ...p, style: s.id }));
                    setMenu(null);
                  }}
                  className={`block w-full rounded px-2 py-1.5 text-left text-xs ${style === s.id ? 'text-[var(--series-blue)]' : ''} hover:bg-[var(--surface-sunken)]`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="relative">
          <button type="button" aria-expanded={menu === 'indicators'} onClick={() => setMenu((m) => (m === 'indicators' ? null : 'indicators'))} className={`${btn} ${idle}`}>
            ƒx Indicators{indicators.length ? ` (${indicators.length})` : ''} ▾
          </button>
          {menu === 'indicators' && (
            <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] p-1 shadow-xl">
              {INDICATORS.map((i) => (
                <label key={i.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-[var(--surface-sunken)]">
                  <input type="checkbox" checked={indicators.includes(i.id)} onChange={() => toggleIndicator(i.id)} />
                  {i.label}
                  {i.id === 'vwap' && <span className="text-[10px] text-[var(--text-muted)]">intraday, stocks</span>}
                </label>
              ))}
            </div>
          )}
        </div>
        <span className="mx-1 h-5 w-px bg-[var(--border)]" />
        <button
          type="button"
          aria-pressed={drawing}
          onClick={() => setDrawing((d) => !d)}
          title="Click the chart to place a horizontal line"
          className={`${btn} ${drawing ? on : idle}`}
        >
          ― H-line
        </button>
        {lines.length > 0 && (
          <button type="button" onClick={() => setLines([])} className={`${btn} ${idle}`} title="Remove all horizontal lines">
            Clear lines ({lines.length})
          </button>
        )}
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => chartRef.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - 160), to: candles.length + 6 })}
            className={`${btn} ${idle}`}
            title="Back to the latest bars"
          >
            Reset view
          </button>
          <button type="button" onClick={screenshot} className={`${btn} ${idle}`} title="Download a PNG of the chart">
            📷
          </button>
        </span>
      </div>

      <div className="relative min-h-0 flex-1" onClick={() => setMenu(null)}>
        {legend && candles.length > 0 && (
          <div className="pointer-events-none absolute left-2 top-1.5 z-10 flex flex-wrap gap-x-2 text-[11px] tabular">
            <span className="font-semibold">
              {symbol} · {tf} · NSE
            </span>
            <span>
              O <span style={{ color: pnl(legend.close - legend.open) }}>{num(legend.open)}</span>
            </span>
            <span>
              H <span style={{ color: pnl(legend.close - legend.open) }}>{num(legend.high)}</span>
            </span>
            <span>
              L <span style={{ color: pnl(legend.close - legend.open) }}>{num(legend.low)}</span>
            </span>
            <span>
              C <span style={{ color: pnl(legend.close - legend.open) }}>{num(legend.close)}</span>
            </span>
            <span style={{ color: pnl(legend.change) }}>
              {legend.change >= 0 ? '+' : ''}
              {num(legend.change)} ({legend.close - legend.change ? `${((legend.change / (legend.close - legend.change)) * 100).toFixed(2)}%` : '—'})
            </span>
            {legend.volume > 0 && <span className="text-[var(--text-muted)]">Vol {legend.volume.toLocaleString('en-IN')}</span>}
          </div>
        )}
        <div ref={host} className="h-full w-full" style={{ cursor: drawing ? 'crosshair' : undefined }} />
        {!brokerConnected ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center text-sm text-[var(--text-muted)]">
            Connect Upstox to load the chart from your account.
            <a href={UPSTOX_LOGIN_URL} target="_blank" rel="noreferrer" className="rounded-md bg-[var(--series-blue)] px-4 py-2 text-sm font-medium text-white">
              Connect Upstox →
            </a>
          </div>
        ) : candles.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--text-muted)]">
            {data.error ? `Chart: ${data.error}` : data.loading ? 'Loading candles from Upstox…' : 'No candles for this timeframe.'}
          </div>
        ) : null}
      </div>
    </div>
  );
}
