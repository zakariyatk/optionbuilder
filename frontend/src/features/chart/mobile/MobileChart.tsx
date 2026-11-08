import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Bell,
  Camera,
  ChartArea,
  ChartCandlestick,
  ChartColumnBig,
  ChartLine,
  ChevronDown,
  ChevronsRight,
  Globe,
  GitCompareArrows,
  Layers,
  List,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  PencilLine,
  Plus,
  Rewind,
  RotateCw,
  Settings,
  SquareFunction,
  X,
} from 'lucide-react';
import { ActionType, type Chart } from 'klinecharts';
import { api } from '../../../api/client';
import type { SymbolInfo } from '../../../api/types';
import { useAsync } from '../../../hooks/useAsync';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { num } from '../../../lib/format';
import { displaySymbol, isUs, marketLabel, pricePrecision } from '../../../lib/markets';
import { nameOf } from '../../../lib/symbolNames';
import { ChartSettingsDialog } from '../ChartSettingsDialog';
import { effectiveSettings, useChartSettings, type ChartStyle } from '../chartSettingsStore';
import { COMPARE_COLORS, MAX_COMPARE, rebaseCompare, syncCompare, type Closes, type CompareSeries } from '../compare';
import { PERIODS } from '../periods';
import { ProChart, type ProChartActions, type ProTool } from '../ProChart';
import { useReplayState, type ReplayController } from '../replay';
import { ReplayBar } from '../ReplayBar';
import { SymbolSearch } from '../SymbolSearch';
import { Watchlist } from '../Watchlist';
import { AlertSheet } from './AlertSheet';
import { DrawingBar } from './DrawingBar';
import { IndicatorSheet } from './IndicatorSheet';
import { activeIndicators } from './mobileChartUtils';
import { prefsFor, useMobilePrefs } from './mobilePrefs';
import { Readout } from './Readout';
import { Sheet, SheetRow } from './Sheet';

const QUOTE_POLL_MS = 15_000;
const COMPARE_POLL_MS = 60_000;
const TOAST_MS = 1800;
/** Indicator pane heights, upright and on its side. */
const SUB_PANE_PORTRAIT = 84;
const SUB_PANE_LANDSCAPE = 52;
/** A phone on its side: little height, so the bars stack tighter. */
export const PHONE_LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 520px) and (pointer: coarse)';

const changeColor = (v: number) => (v > 0 ? 'var(--good-text)' : v < 0 ? 'var(--critical)' : 'var(--text-secondary)');

const CHART_TYPES: { v: ChartStyle; label: string; icon: ReactNode }[] = [
  { v: 'candles', label: 'Candles', icon: <ChartCandlestick size={20} aria-hidden="true" /> },
  { v: 'hollow', label: 'Hollow candles', icon: <ChartCandlestick size={20} strokeWidth={1.25} aria-hidden="true" /> },
  { v: 'heikinashi', label: 'Heikin Ashi', icon: <ChartCandlestick size={20} aria-hidden="true" className="opacity-70" /> },
  { v: 'bars', label: 'Bars (OHLC)', icon: <ChartColumnBig size={20} aria-hidden="true" /> },
  { v: 'line', label: 'Line', icon: <ChartLine size={20} aria-hidden="true" /> },
  { v: 'area', label: 'Area', icon: <ChartArea size={20} aria-hidden="true" /> },
];
const typeIcon = (v: ChartStyle) => CHART_TYPES.find((t) => t.v === v)?.icon ?? CHART_TYPES[0].icon;

type SheetId = 'type' | 'indicators' | 'alerts' | 'compare' | 'watchlist' | 'more';

/** A button in the bottom bar: icon over a short label, a full finger wide. */
function BarButton({ label, icon, active, disabled, onClick }: { label: string; icon: ReactNode; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-medium active:bg-[var(--surface-sunken)] disabled:opacity-35 ${
        active ? 'text-[var(--series-blue)]' : 'text-[var(--text-secondary)]'
      }`}
    >
      {icon}
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}

function IconButton({ label, onClick, children, active }: { label: string; onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg active:bg-[var(--surface-sunken)] ${
        active ? 'text-[var(--series-blue)]' : 'text-[var(--text-primary)]'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The phone chart, built for thumbs: quote header, interval strip, the
 * crosshair readout, a full-bleed chart (pinch to zoom, drag to scroll, press
 * and hold for the crosshair) and a bottom bar for the watchlist, indicators,
 * drawing, alerts and compare. Full screen hides the app around it and can
 * turn the phone to landscape. Interval, chart type and compared symbols are
 * remembered per symbol.
 */
export function MobileChart({
  symbol,
  onSymbol,
  symbolInfo,
  theme,
  brokerConnected,
  onOpenBuilder,
}: {
  symbol: string;
  onSymbol: (s: string) => void;
  symbolInfo: SymbolInfo[];
  theme: 'light' | 'dark';
  brokerConnected: boolean;
  onOpenBuilder: (symbol: string) => void;
}) {
  const settings = useChartSettings(effectiveSettings);
  const bySymbol = useMobilePrefs((s) => s.bySymbol);
  const setPrefs = useMobilePrefs((s) => s.set);
  const prefs = prefsFor({ bySymbol }, symbol, settings.chartStyle);
  const landscape = useMediaQuery(PHONE_LANDSCAPE_QUERY);

  const actions = useRef<ProChartActions | null>(null);
  const [chart, setChart] = useState<Chart | null>(null);
  /** Bumped whenever a symbol / interval finishes loading. */
  const [loads, setLoads] = useState(0);
  const [sheet, setSheet] = useState<SheetId | null>(null);
  const [searching, setSearching] = useState<'symbol' | 'compare' | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [full, setFull] = useState(false);
  const [toast, setToast] = useState('');
  const [replay, setReplay] = useState<ReplayController | null>(null);
  const replayOn = useReplayState(replay).mode !== 'off';
  const [behind, setBehind] = useState(false);
  const close = useCallback(() => setSheet(null), []);

  const notify = useCallback((msg: string) => setToast(msg), []);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(''), TOAST_MS);
    return () => window.clearTimeout(t);
  }, [toast]);

  // US symbols, gold, crypto and the other global markets chart from Yahoo, so they don't need the broker.
  const canChart = brokerConnected || isUs(symbol);
  const quoteState = useAsync(() => api.watch([symbol]), [symbol], { pollMs: QUOTE_POLL_MS, enabled: canChart });
  const q = quoteState.data?.quotes.find((x) => x.symbol === symbol);
  const quote = q && !('error' in q) ? q : null;
  const chg = quote ? quote.price - quote.previousClose : null;
  const pct = quote && quote.previousClose ? (chg! / quote.previousClose) * 100 : null;
  const label = symbolInfo.find((s) => s.symbol === symbol)?.label ?? nameOf(symbol) ?? displaySymbol(symbol);
  const precision = pricePrecision(symbol);
  const period = PERIODS.find((p) => p.tf === prefs.tf) ?? PERIODS[3];
  const intraday = period.timespan === 'minute' || period.timespan === 'hour';
  const lastPrice = quote?.price ?? chart?.getDataList().at(-1)?.close ?? null;

  // Compare lines put the price axis in percent, as TradingView's compare does.
  const styleOverride = useMemo(
    () => ({ chartStyle: prefs.style, ...(prefs.compare.length ? { scaleMode: 'percent' as const } : {}) }),
    [prefs.style, prefs.compare.length],
  );

  const onLoaded = useCallback(() => {
    setChart(actions.current?.chart() ?? null);
    setLoads((n) => n + 1);
  }, []);

  // ---- Compare ----
  const compareKey = prefs.compare.join(',');
  const [series, setSeries] = useState<{ key: string; list: (CompareSeries | null)[] }>({ key: '', list: [] });
  useEffect(() => {
    const list = compareKey ? compareKey.split(',') : [];
    const key = `${symbol}|${prefs.tf}|${compareKey}`;
    if (!list.length) {
      setSeries({ key, list: [] });
      return;
    }
    let cancelled = false;
    const load = async () => {
      const got = await Promise.all(
        list.map(async (s): Promise<CompareSeries | null> => {
          try {
            const res = await api.candles(s, prefs.tf);
            const closes: Closes = res.candles.map(([t, , , , c]) => [t * 1000, c]);
            return { label: displaySymbol(s), closes };
          } catch {
            return null;
          }
        }),
      );
      if (!cancelled) setSeries({ key, list: got });
    };
    void load();
    const timer = window.setInterval(() => document.visibilityState === 'visible' && void load(), COMPARE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [symbol, prefs.tf, compareKey]);

  useEffect(() => {
    if (!chart) return;
    // Only the series loaded for what the chart shows now; a stale list (another symbol's) is dropped.
    const current = series.key === `${symbol}|${prefs.tf}|${compareKey}` ? series.list : [];
    syncCompare(chart, current);
  }, [chart, series, loads, symbol, prefs.tf, compareKey]);

  // Lines rebase on the first bar on screen; the "latest" button shows once you scroll back.
  useEffect(() => {
    if (!chart) return;
    let frame = 0;
    const onRange = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        rebaseCompare(chart);
        const { to } = chart.getVisibleRange();
        setBehind(to < chart.getDataList().length - 1);
      });
    };
    chart.subscribeAction(ActionType.OnVisibleRangeChange, onRange);
    return () => {
      chart.unsubscribeAction(ActionType.OnVisibleRangeChange, onRange);
      cancelAnimationFrame(frame);
    };
  }, [chart]);

  // ---- Full screen and orientation ----
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFull(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const enterFull = async () => {
    setFull(true);
    try {
      // The whole page, so the sheets and search (outside the chart) still show over it.
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
    } catch {
      /* iPhone Safari has no full screen API: the chart still fills the window */
    }
  };
  const exitFull = () => {
    setFull(false);
    try {
      screen.orientation?.unlock?.();
    } catch {
      /* not supported */
    }
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  };
  const rotate = async () => {
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    try {
      if (!full) await enterFull();
      await orientation.lock?.(landscape ? 'portrait-primary' : 'landscape');
      if (!orientation.lock) throw new Error('unsupported');
    } catch {
      notify('Turn your phone sideways for landscape');
    }
  };
  // On its side a phone has little height: the chart takes the whole window, and indicator panes get shorter.
  const filled = full || landscape;
  useEffect(() => {
    if (!chart) return;
    const height = landscape ? SUB_PANE_LANDSCAPE : SUB_PANE_PORTRAIT;
    for (const id of new Set(activeIndicators(chart).map((a) => a.paneId))) if (id !== 'candle_pane') chart.setPaneOptions({ id, height });
  }, [chart, landscape, loads, sheet]);
  // The chart resizes with its box; klinecharts only listens to the window.
  useEffect(() => {
    const t = window.setTimeout(() => chart?.resize(), 60);
    return () => window.clearTimeout(t);
  }, [chart, filled, drawing, replayOn]);

  // ---- Actions ----
  const setTf = (tf: string) => setPrefs(symbol, { tf });
  const pickSymbol = (s: string) => {
    useMobilePrefs.getState().touch(s);
    onSymbol(s);
  };
  const tool = (t: ProTool) => {
    setSheet(null);
    actions.current?.openTool(t);
  };
  const toggleDrawing = () => {
    setSheet(null);
    setDrawing((d) => !d);
  };

  const tfStrip = (
    <div className="ob-no-scrollbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" role="radiogroup" aria-label="Interval">
      {PERIODS.map((p) => (
        <button
          key={p.tf}
          type="button"
          role="radio"
          aria-checked={p.tf === prefs.tf}
          disabled={!canChart}
          onClick={() => setTf(p.tf)}
          className={`h-8 min-w-9 shrink-0 rounded-md px-2 text-[13px] font-semibold disabled:opacity-40 ${
            p.tf === prefs.tf ? 'bg-[color-mix(in_srgb,var(--series-blue)_18%,transparent)] text-[var(--series-blue)]' : 'text-[var(--text-secondary)]'
          }`}
        >
          {p.text}
        </button>
      ))}
    </div>
  );

  const symbolButton = (
    <button
      type="button"
      onClick={() => setSearching('symbol')}
      aria-label={`Symbol ${displaySymbol(symbol)}, search`}
      className="flex h-11 min-w-0 shrink items-center gap-1 rounded-lg pr-1 text-left active:bg-[var(--surface-sunken)]"
    >
      <span className="min-w-0">
        <span className="flex items-center gap-1">
          <span className="truncate text-[15px] font-bold">{displaySymbol(symbol)}</span>
          <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-[var(--text-muted)]" />
        </span>
        {!landscape && (
          <span className="block truncate text-[11px] text-[var(--text-muted)]">
            {label} · {marketLabel(symbol)}
          </span>
        )}
      </span>
    </button>
  );

  const priceBlock = (
    <div className="ml-auto shrink-0 text-right tabular">
      <div className="text-[15px] font-semibold leading-tight">{quote ? num(quote.price, precision) : '—'}</div>
      <div className="text-[11px] leading-tight" style={{ color: chg !== null ? changeColor(chg) : undefined }}>
        {chg !== null ? `${chg > 0 ? '+' : ''}${num(chg, precision)} (${pct !== null ? `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%` : '—'})` : ' '}
      </div>
    </div>
  );

  const typeButton = (
    <IconButton label={`Chart type: ${CHART_TYPES.find((t) => t.v === prefs.style)?.label}`} onClick={() => setSheet('type')}>
      {typeIcon(prefs.style)}
    </IconButton>
  );
  const fullButton = (
    <IconButton label={full ? 'Exit full screen' : 'Full screen'} onClick={() => (full ? exitFull() : void enterFull())}>
      {full ? <Minimize2 size={19} aria-hidden="true" /> : <Maximize2 size={19} aria-hidden="true" />}
    </IconButton>
  );

  return (
    <div
      ref={root}
      className={`ob-mobile-chart flex flex-col overflow-hidden bg-[var(--surface-card)] ${filled ? 'fixed inset-0 z-[45]' : ''}`}
      style={
        filled
          ? {
              height: '100dvh',
              paddingTop: 'env(safe-area-inset-top)',
              paddingLeft: 'env(safe-area-inset-left)',
              paddingRight: 'env(safe-area-inset-right)',
              paddingBottom: 'env(safe-area-inset-bottom)',
            }
          : {
              // Full-bleed: cancel <main>'s gutters and fill the screen between the header and the tab bar.
              margin: 'calc(-1 * 1rem) calc(-1 * max(var(--gutter), env(safe-area-inset-right))) calc(-1 * 0.75rem) calc(-1 * max(var(--gutter), env(safe-area-inset-left)))',
              height: 'calc(100dvh - var(--header-h) - 1px - env(safe-area-inset-top) - var(--tabbar-h))',
              minHeight: 320,
            }
      }
    >
      {landscape ? (
        <div className="flex h-11 shrink-0 items-center gap-1 border-b border-[var(--border)] px-2">
          {symbolButton}
          {tfStrip}
          {typeButton}
          {priceBlock}
          <IconButton label="Rotate" onClick={() => void rotate()}>
            <RotateCw size={18} aria-hidden="true" />
          </IconButton>
          {fullButton}
        </div>
      ) : (
        <>
          <div className="flex h-[50px] shrink-0 items-center gap-2 px-3">
            {symbolButton}
            {priceBlock}
          </div>
          <div className="flex h-10 shrink-0 items-center gap-0.5 border-y border-[var(--border)] pl-1.5 pr-0.5">
            {tfStrip}
            <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-[var(--border-strong)]" />
            {typeButton}
            {full && (
              <IconButton label="Rotate to landscape" onClick={() => void rotate()}>
                <RotateCw size={18} aria-hidden="true" />
              </IconButton>
            )}
            {fullButton}
          </div>
        </>
      )}

      {canChart && (
        <div className="flex h-[38px] shrink-0 items-center gap-2 px-3">
          <Readout chart={chart} precision={precision} intraday={intraday} />
          {prefs.compare.length > 0 && (
            <div className="ml-auto flex shrink-0 gap-1">
              {prefs.compare.map((c, i) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setSheet('compare')}
                  className="flex h-6 items-center gap-1 rounded-full border border-[var(--border)] px-2 text-[10px] font-semibold"
                  aria-label={`Compared with ${displaySymbol(c)}`}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: COMPARE_COLORS[i] }} aria-hidden="true" />
                  {displaySymbol(c)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <ProChart
          symbol={symbol}
          symbolInfo={symbolInfo}
          theme={theme}
          brokerConnected={brokerConnected}
          compact
          period={prefs.tf}
          actionsRef={actions}
          styleOverride={styleOverride}
          onLoaded={onLoaded}
          onReplay={setReplay}
        />
        {behind && (
          <button
            type="button"
            onClick={() => chart?.scrollToRealTime(200)}
            aria-label="Go to the latest bar"
            className="absolute right-[4.5rem] bottom-10 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-raised)] shadow-lg"
          >
            <ChevronsRight size={18} aria-hidden="true" />
          </button>
        )}
        {toast && (
          <div role="status" className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center px-6">
            <span className="rounded-full bg-[var(--surface-raised)] px-4 py-2 text-xs font-medium shadow-lg ring-1 ring-[var(--border-strong)]">{toast}</span>
          </div>
        )}
      </div>

      {replay && <ReplayBar replay={replay} />}
      {drawing && canChart && <DrawingBar chart={chart} onClose={() => setDrawing(false)} notify={notify} />}

      <nav aria-label="Chart tools" className={`flex shrink-0 items-stretch gap-0.5 border-t border-[var(--border)] px-1 py-1 ${landscape ? 'h-12' : 'h-[58px]'}`}>
        <BarButton label="Watchlist" icon={<List size={21} aria-hidden="true" />} onClick={() => setSheet('watchlist')} />
        <BarButton label="Indicators" icon={<SquareFunction size={21} aria-hidden="true" />} disabled={!canChart} onClick={() => setSheet('indicators')} />
        <BarButton label="Draw" icon={<PencilLine size={21} aria-hidden="true" />} active={drawing} disabled={!canChart} onClick={toggleDrawing} />
        <BarButton label="Alert" icon={<Bell size={21} aria-hidden="true" />} disabled={!canChart} onClick={() => setSheet('alerts')} />
        <BarButton label="Compare" icon={<GitCompareArrows size={21} aria-hidden="true" />} active={prefs.compare.length > 0} disabled={!canChart} onClick={() => setSheet('compare')} />
        <BarButton label="More" icon={<MoreHorizontal size={21} aria-hidden="true" />} onClick={() => setSheet('more')} />
      </nav>

      {/* ---- Sheets ---- */}
      <Sheet open={sheet === 'type'} onClose={close} title="Chart type">
        <div className="pb-2">
          {CHART_TYPES.map((t) => (
            <SheetRow
              key={t.v}
              icon={t.icon}
              label={t.label}
              active={t.v === prefs.style}
              onClick={() => {
                setPrefs(symbol, { style: t.v });
                setSheet(null);
              }}
            />
          ))}
          <p className="px-4 pt-1 text-[11px] text-[var(--text-muted)]">Remembered for {displaySymbol(symbol)}.</p>
        </div>
      </Sheet>

      <IndicatorSheet open={sheet === 'indicators'} onClose={close} chart={chart} />

      <AlertSheet open={sheet === 'alerts'} onClose={close} symbol={symbol} last={lastPrice} precision={precision} onChanged={() => actions.current?.syncAlerts()} />

      <Sheet open={sheet === 'compare'} onClose={close} title="Compare">
        <div className="pb-3">
          <p className="px-4 pb-2 text-xs text-[var(--text-muted)]">
            Lines start level with {displaySymbol(symbol)} at the left edge of the chart; the price scale shows % change. Up to {MAX_COMPARE}.
          </p>
          {prefs.compare.map((c, i) => (
            <div key={c} className="flex min-h-12 items-center gap-3 pl-4 pr-1">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: COMPARE_COLORS[i] }} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {displaySymbol(c)} <span className="text-xs font-normal text-[var(--text-muted)]">{nameOf(c) ?? marketLabel(c)}</span>
              </span>
              <button
                type="button"
                aria-label={`Stop comparing ${displaySymbol(c)}`}
                onClick={() => useMobilePrefs.getState().removeCompare(symbol, c)}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-[var(--text-secondary)] active:bg-[var(--surface-sunken)]"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
          ))}
          {prefs.compare.length < MAX_COMPARE && (
            <SheetRow
              icon={<Plus size={20} aria-hidden="true" />}
              label="Add symbol"
              onClick={() => {
                setSheet(null);
                setSearching('compare');
              }}
            />
          )}
        </div>
      </Sheet>

      <Sheet open={sheet === 'watchlist'} onClose={close} title="Watchlist" side="right">
        <div className="flex h-full flex-col px-1 pb-2">
          <Watchlist
            symbolInfo={symbolInfo}
            selected={symbol}
            onSelect={(s) => {
              pickSymbol(s);
              setSheet(null);
            }}
            onOpenBuilder={onOpenBuilder}
          />
        </div>
      </Sheet>

      <Sheet open={sheet === 'more'} onClose={close} title="Chart">
        <div className="pb-2">
          {canChart && (
            <>
              <SheetRow icon={<SquareFunction size={20} aria-hidden="true" />} label="Chart type" detail={CHART_TYPES.find((t) => t.v === prefs.style)?.label} onClick={() => setSheet('type')} />
              <SheetRow
                icon={<Rewind size={20} aria-hidden="true" />}
                label={replayOn ? 'Exit bar replay' : 'Bar replay'}
                disabled={!replay}
                onClick={() => {
                  setSheet(null);
                  if (replayOn) replay?.exit();
                  else {
                    replay?.selectBar();
                    notify('Tap a bar to start the replay from');
                  }
                }}
              />
              <SheetRow icon={<Camera size={20} aria-hidden="true" />} label="Snapshot" onClick={() => tool('Screenshot')} />
              <SheetRow icon={<Globe size={20} aria-hidden="true" />} label="Timezone" onClick={() => tool('Timezone')} />
              <SheetRow
                icon={<Settings size={20} aria-hidden="true" />}
                label="Chart settings"
                onClick={() => {
                  setSheet(null);
                  setConfiguring(true);
                }}
              />
            </>
          )}
          <SheetRow icon={full ? <Minimize2 size={20} aria-hidden="true" /> : <Maximize2 size={20} aria-hidden="true" />} label={full ? 'Exit full screen' : 'Full screen'} onClick={() => {
              setSheet(null);
              if (full) exitFull();
              else void enterFull();
            }} />
          <SheetRow icon={<RotateCw size={20} aria-hidden="true" />} label={landscape ? 'Portrait' : 'Landscape'} onClick={() => {
              setSheet(null);
              void rotate();
            }} />
          {!isUs(symbol) && (
            <SheetRow
              icon={<Layers size={20} aria-hidden="true" />}
              label={`Build strategy on ${displaySymbol(symbol)}`}
              onClick={() => {
                setSheet(null);
                exitFull();
                onOpenBuilder(symbol);
              }}
            />
          )}
          <p className="px-4 pt-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
            Pinch to zoom · drag to scroll · press and hold for the crosshair, then slide to read any bar · tap to hide it.
          </p>
        </div>
      </Sheet>

      {searching && (
        <SymbolSearch
          symbolInfo={symbolInfo}
          title={searching === 'compare' ? `Compare with ${displaySymbol(symbol)}` : 'Symbol search'}
          exclude={searching === 'compare' ? [symbol, ...prefs.compare] : []}
          onPick={(s) => {
            if (searching === 'compare') {
              useMobilePrefs.getState().addCompare(symbol, s);
              notify(`Comparing with ${displaySymbol(s)}`);
            } else pickSymbol(s);
          }}
          onClose={() => setSearching(null)}
        />
      )}
      {configuring && <ChartSettingsDialog theme={theme} onClose={() => setConfiguring(false)} />}
    </div>
  );
}
