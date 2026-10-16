import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  Activity,
  AlarmClockPlus,
  Camera,
  ChartCandlestick,
  ChevronDown,
  Globe,
  Layers,
  Maximize,
  Minimize,
  MoreHorizontal,
  PencilLine,
  Plus,
  Rewind,
  Search,
  Settings,
} from 'lucide-react';
import { api } from '../../api/client';
import type { SymbolInfo } from '../../api/types';
import { BottomSheet } from '../../components/BottomSheet';
import { useAsync } from '../../hooks/useAsync';
import { PHONE_QUERY, useMediaQuery } from '../../hooks/useMediaQuery';
import { num } from '../../lib/format';
import { displaySymbol, isUs } from '../../lib/markets';
import { useChartLayout } from '../../store/chartLayout';
import { CELL_NAMES, chartCount, gridStyle, layoutById } from './layouts';
import { LayoutMenu } from './LayoutMenu';
import { PERIODS } from './periods';
import { ProChart, type ProChartActions, type ProTool } from './ProChart';
import { useReplayState, type ReplayController } from './replay';
import { ReplayBar } from './ReplayBar';
import { Watchlist } from './Watchlist';

/** The theme actually applied to the page: the explicit choice on <html>, else the OS preference. */
function usePageTheme(): 'light' | 'dark' {
  const read = (): 'light' | 'dark' => {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'light' || attr === 'dark') return attr;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const update = () => setTheme(read());
    // The app may have applied the stored theme after the first render read it.
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener('change', update);
    return () => {
      observer.disconnect();
      mq?.removeEventListener('change', update);
    };
  }, []);
  return theme;
}

/** Analyse → Chart: a TradingView-style chart on Upstox data, with a watchlist alongside. */
export function ChartPage({
  symbol,
  symbolInfo,
  brokerConnected,
  onOpenBuilder,
}: {
  /** The builder's underlying — the chart opens on it. */
  symbol: string;
  symbolInfo: SymbolInfo[];
  brokerConnected: boolean;
  onOpenBuilder: (symbol: string) => void;
}) {
  const theme = usePageTheme();
  const phone = useMediaQuery(PHONE_QUERY);
  // The charts have their own symbols, so browsing the watchlist never touches the strategy being built.
  const { layoutId, symbols: chartSymbols, periods: chartPeriods, active, setLayout, setActive, setSymbol, setPeriod } = useChartLayout();
  // The first chart opens on the builder's underlying, as the single chart always did.
  useEffect(() => useChartLayout.getState().setSymbol(symbol, 0), [symbol]);
  // Each chart's bar-replay controls; the toolbar and replay bar drive the selected chart's.
  const [replays, setReplays] = useState<(ReplayController | null)[]>([]);
  const activeReplay = replays[active] ?? null;
  const replayOn = useReplayState(activeReplay).mode !== 'off';
  const registerReplay = useCallback(
    (i: number) => (r: ReplayController | null) =>
      setReplays((prev) => {
        const next = [...prev];
        next[i] = r;
        return next;
      }),
    [],
  );
  // Each chart's imperative handle; the toolbar drives the selected chart's.
  const actions = useRef<RefObject<ProChartActions | null>[]>([]);
  const actionsFor = (i: number) => (actions.current[i] ??= { current: null });
  const panel = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === panel.current && panel.current !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  if (phone) {
    return (
      <PhoneChart
        symbol={chartSymbols[0]}
        onSymbol={(s) => setSymbol(s, 0)}
        symbolInfo={symbolInfo}
        theme={theme}
        brokerConnected={brokerConnected}
        onOpenBuilder={onOpenBuilder}
      />
    );
  }

  const panelHeight = 'max(520px, calc(100dvh - 7rem))';
  const layout = layoutById(layoutId);
  const count = chartCount(layout);
  const act = () => actionsFor(active).current;
  const tf = chartPeriods[active] ?? '15m';
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void panel.current?.requestFullscreen();
  };
  return (
    <div className="ob-tv grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div
        ref={panel}
        className="ob-tv-panel flex flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-card)]"
        style={{ height: fullscreen ? '100vh' : panelHeight }}
      >
        {/* TradingView's top toolbar, for the selected chart. Above the charts (their labels use z-index) so its menus open over them. */}
        <div role="toolbar" aria-label="Chart" className="relative z-40 flex h-[38px] shrink-0 items-center gap-0.5 overflow-x-auto border-b border-[var(--border)] px-1">
          <TvButton label="Symbol search" onClick={() => act()?.openSymbolSearch()}>
            <Search size={16} strokeWidth={1.75} aria-hidden="true" />
            <span className="font-semibold">{displaySymbol(chartSymbols[active])}</span>
          </TvButton>
          <TvSep />
          {PERIODS.map((p) => (
            <TvButton key={p.tf} label={`Interval ${p.text}`} active={p.tf === tf} onClick={() => setPeriod(p.tf)} narrow>
              {p.text}
            </TvButton>
          ))}
          <TvSep />
          <TvButton label="Indicators" onClick={() => act()?.openTool('Indicator')}>
            <ChartCandlestick size={17} strokeWidth={1.6} aria-hidden="true" />
            Indicators
          </TvButton>
          <TvSep />
          <LayoutMenu layoutId={layout.id} onChange={setLayout} />
          <TvSep />
          <TvButton label="Create alert" onClick={() => act()?.addAlert()}>
            <AlarmClockPlus size={17} strokeWidth={1.6} aria-hidden="true" />
            Alert
          </TvButton>
          <TvButton label="Bar replay" active={replayOn} disabled={!activeReplay} onClick={() => (replayOn ? activeReplay?.exit() : activeReplay?.selectBar())}>
            <Rewind size={17} strokeWidth={1.6} aria-hidden="true" />
            Replay
          </TvButton>
          <span className="flex-1" />
          <TvButton label="Timezone" onClick={() => act()?.openTool('Timezone')} icon>
            <Globe size={17} strokeWidth={1.6} aria-hidden="true" />
          </TvButton>
          <TvButton label="Chart settings" onClick={() => act()?.openTool('Setting')} icon>
            <Settings size={17} strokeWidth={1.6} aria-hidden="true" />
          </TvButton>
          <TvButton label="Take a snapshot" onClick={() => act()?.openTool('Screenshot')} icon>
            <Camera size={17} strokeWidth={1.6} aria-hidden="true" />
          </TvButton>
          <TvButton label={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={toggleFullscreen} icon>
            {fullscreen ? <Minimize size={17} strokeWidth={1.6} aria-hidden="true" /> : <Maximize size={17} strokeWidth={1.6} aria-hidden="true" />}
          </TvButton>
        </div>
        <div className="grid min-h-0 flex-1 gap-px bg-[var(--border)]" style={gridStyle(layout)}>
          {CELL_NAMES.slice(0, count).map((area, i) => (
            <div
              key={i}
              data-chart-active={String(i === active)}
              onPointerDownCapture={() => setActive(i)}
              onFocusCapture={() => setActive(i)}
              className="relative min-h-0 min-w-0 bg-[var(--surface-card)]"
              style={{ gridArea: area }}
            >
              <ProChart
                symbol={chartSymbols[i]}
                symbolInfo={symbolInfo}
                theme={theme}
                brokerConnected={brokerConnected}
                externalToolbar
                period={chartPeriods[i]}
                actionsRef={actionsFor(i)}
                onSymbolChange={(s) => setSymbol(s, i)}
                onReplay={registerReplay(i)}
              />
              {count > 1 && i === active && <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-20 border-2 border-[var(--series-blue)]" />}
            </div>
          ))}
        </div>
        {activeReplay && <ReplayBar replay={activeReplay} />}
      </div>
      <div className="flex min-h-[420px] flex-col lg:min-h-0" style={{ height: panelHeight }}>
        <Watchlist symbolInfo={symbolInfo} selected={chartSymbols[active]} onSelect={(s) => setSymbol(s)} onOpenBuilder={onOpenBuilder} />
      </div>
    </div>
  );
}

/** A TradingView toolbar button: 14px text, 30px tall, subtle hover and a filled active state. */
function TvButton({
  label,
  onClick,
  active,
  disabled,
  narrow,
  icon,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  narrow?: boolean;
  icon?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={icon ? label : undefined}
      aria-pressed={active}
      className={`flex h-[30px] shrink-0 items-center justify-center gap-1.5 rounded text-[14px] leading-none whitespace-nowrap disabled:opacity-40 ${
        icon ? 'w-[30px]' : narrow ? 'min-w-[30px] px-1.5' : 'px-2'
      } ${
        active
          ? 'bg-[color-mix(in_srgb,var(--text-primary)_12%,transparent)] text-[var(--text-primary)]'
          : 'text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--text-primary)_8%,transparent)]'
      }`}
    >
      {children}
    </button>
  );
}

const TvSep = () => <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-[var(--border-strong)]" />;

const QUOTE_POLL_MS = 15_000;
const changeColor = (v: number) => (v > 0 ? 'var(--good-text)' : v < 0 ? 'var(--critical)' : 'var(--text-secondary)');

function ToolbarButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${
        active ? 'bg-[color-mix(in_srgb,var(--series-blue)_16%,transparent)] text-[var(--series-blue)]' : 'text-[var(--text-primary)]'
      }`}
    >
      {children}
    </button>
  );
}

function SheetItem({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium hover:bg-[var(--surface-sunken)]">
      <span className="text-[var(--text-secondary)]">{icon}</span>
      {label}
    </button>
  );
}

/**
 * Phone layout, modelled on mobile TradingView: quote header, full-bleed chart,
 * and a bottom toolbar (symbol · interval · indicators · drawing · more). The
 * chart's own desktop period bar and drawing rail are hidden and driven from here.
 */
function PhoneChart({
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
  const actions = useRef<ProChartActions | null>(null);
  const [tf, setTf] = useState('15m');
  const [drawing, setDrawing] = useState(false);
  const [sheet, setSheet] = useState<'watchlist' | 'interval' | 'more' | null>(null);
  const close = useCallback(() => setSheet(null), []);

  // US symbols chart from Yahoo, so they don't need the broker.
  const canChart = brokerConnected || isUs(symbol);
  const quoteState = useAsync(() => api.watch([symbol]), [symbol], { pollMs: QUOTE_POLL_MS, enabled: canChart });
  const q = quoteState.data?.quotes.find((x) => x.symbol === symbol);
  const quote = q && !('error' in q) ? q : null;
  const chg = quote ? quote.price - quote.previousClose : null;
  const pct = quote && quote.previousClose ? (chg! / quote.previousClose) * 100 : null;
  const label = symbolInfo.find((s) => s.symbol === symbol)?.label ?? displaySymbol(symbol);
  const period = PERIODS.find((p) => p.tf === tf);

  const tool = (t: ProTool) => {
    setSheet(null);
    actions.current?.openTool(t);
  };

  return (
    <div
      className="flex flex-col bg-[var(--surface-card)]"
      style={{
        // Full-bleed: cancel <main>'s gutters and fill the screen between the header and the tab bar.
        margin: 'calc(-1 * 1rem) calc(-1 * max(var(--gutter), env(safe-area-inset-right))) calc(-1 * 1.25rem) calc(-1 * max(var(--gutter), env(safe-area-inset-left)))',
        height: 'calc(100dvh - 3.5rem - 1px - env(safe-area-inset-top) - var(--tabbar-h))',
        minHeight: 360,
      }}
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border)] px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold">{label}</div>
          <div className="text-[11px] text-[var(--text-muted)]">
            {displaySymbol(symbol)} · {isUs(symbol) ? 'US' : 'NSE'} · {period?.text ?? tf}
          </div>
        </div>
        <div className="shrink-0 text-right tabular">
          <div className="text-base font-semibold">{quote ? num(quote.price) : '—'}</div>
          {chg !== null && (
            <div className="text-xs" style={{ color: changeColor(chg) }}>
              {chg > 0 ? '+' : ''}
              {num(chg)} ({pct !== null ? `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%` : '—'})
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <ProChart symbol={symbol} symbolInfo={symbolInfo} theme={theme} brokerConnected={brokerConnected} compact actionsRef={actions} />
      </div>

      <div className="flex h-14 shrink-0 items-center gap-1 border-t border-[var(--border)] px-2">
        <button
          type="button"
          onClick={() => setSheet('watchlist')}
          aria-label="Watchlist and symbol"
          className="flex h-11 min-w-0 items-center gap-1 rounded-lg px-2 text-sm font-semibold"
        >
          <span className="truncate">{displaySymbol(symbol)}</span>
          <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-[var(--text-muted)]" />
        </button>
        <button
          type="button"
          onClick={() => setSheet('interval')}
          aria-label={`Interval ${period?.text ?? tf}`}
          disabled={!canChart}
          className="flex h-11 min-w-11 items-center justify-center rounded-lg px-2 text-sm font-semibold disabled:opacity-40"
        >
          {period?.text ?? tf}
        </button>
        <span className="flex-1" />
        {canChart && (
          <>
            <ToolbarButton label="Indicators" onClick={() => tool('Indicator')}>
              <Plus size={22} strokeWidth={1.75} aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton label="Drawing tools" active={drawing} onClick={() => {
                actions.current?.toggleDrawing();
                setDrawing((d) => !d);
              }}>
              <PencilLine size={22} strokeWidth={1.75} aria-hidden="true" />
            </ToolbarButton>
          </>
        )}
        <ToolbarButton label="More" onClick={() => setSheet('more')}>
          <MoreHorizontal size={22} strokeWidth={1.75} aria-hidden="true" />
        </ToolbarButton>
      </div>

      <BottomSheet open={sheet === 'watchlist'} onClose={close} title="Watchlist" className="h-[80dvh]">
        <div className="flex h-full flex-col">
          <Watchlist
            symbolInfo={symbolInfo}
            selected={symbol}
            onSelect={(s) => {
              onSymbol(s);
              setSheet(null);
            }}
            onOpenBuilder={onOpenBuilder}
          />
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === 'interval'} onClose={close} title="Interval">
        <div className="grid grid-cols-4 gap-2 p-2">
          {PERIODS.map((p) => (
            <button
              key={p.tf}
              type="button"
              aria-pressed={p.tf === tf}
              onClick={() => {
                setTf(p.tf);
                actions.current?.setPeriod(p.tf);
                setSheet(null);
              }}
              className={`h-12 rounded-lg border text-sm font-semibold ${
                p.tf === tf ? 'border-[var(--series-blue)] bg-[color-mix(in_srgb,var(--series-blue)_14%,transparent)] text-[var(--series-blue)]' : 'border-[var(--border)]'
              }`}
            >
              {p.text}
            </button>
          ))}
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === 'more'} onClose={close} title="Chart">
        {canChart && (
          <>
            <SheetItem icon={<Activity size={20} aria-hidden="true" />} label="Indicators" onClick={() => tool('Indicator')} />
            <SheetItem icon={<Globe size={20} aria-hidden="true" />} label="Timezone" onClick={() => tool('Timezone')} />
            <SheetItem icon={<Settings size={20} aria-hidden="true" />} label="Chart settings" onClick={() => tool('Setting')} />
            <SheetItem icon={<Camera size={20} aria-hidden="true" />} label="Screenshot" onClick={() => tool('Screenshot')} />
            <SheetItem icon={<Maximize size={20} aria-hidden="true" />} label="Full screen" onClick={() => tool('Full Screen')} />
          </>
        )}
        {!isUs(symbol) && (
          <SheetItem
            icon={<Layers size={20} aria-hidden="true" />}
            label={`Build strategy on ${symbol}`}
            onClick={() => {
              setSheet(null);
              onOpenBuilder(symbol);
            }}
          />
        )}
      </BottomSheet>
    </div>
  );
}
