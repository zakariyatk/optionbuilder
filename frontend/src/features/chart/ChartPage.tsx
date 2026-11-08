import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  AlarmClockPlus,
  Camera,
  ChartCandlestick,
  ChevronDown,
  Globe,
  Maximize,
  Minimize,
  Rewind,
  Search,
  Settings,
} from 'lucide-react';
import type { SymbolInfo } from '../../api/types';
import { PHONE_QUERY, useMediaQuery } from '../../hooks/useMediaQuery';
import { displaySymbol } from '../../lib/markets';
import { useChartLayout } from '../../store/chartLayout';
import { ChartSettingsDialog } from './ChartSettingsDialog';
import { CELL_NAMES, chartCount, gridStyle, layoutById } from './layouts';
import { LayoutMenu } from './LayoutMenu';
import { PERIODS } from './periods';
import { ProChart, type ProChartActions } from './ProChart';
import { useReplayState, type ReplayController } from './replay';
import { ReplayBar } from './ReplayBar';
import { SymbolSearch } from './SymbolSearch';
import { Watchlist } from './Watchlist';
import { MobileChart, PHONE_LANDSCAPE_QUERY } from './mobile/MobileChart';

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
  // Phones, upright or on their side (a phone on its side is wider than the phone breakpoint).
  const phone = useMediaQuery(PHONE_QUERY);
  const phoneLandscape = useMediaQuery(PHONE_LANDSCAPE_QUERY);
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
  /** The TradingView-style symbol search dialog. */
  const [searching, setSearching] = useState(false);
  /** The chart Settings dialog. */
  const [configuring, setConfiguring] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === panel.current && panel.current !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  if (phone || phoneLandscape) {
    return (
      <MobileChart
        symbol={chartSymbols[0]}
        onSymbol={(s) => setSymbol(s, 0)}
        symbolInfo={symbolInfo}
        theme={theme}
        brokerConnected={brokerConnected}
        onOpenBuilder={onOpenBuilder}
      />
    );
  }

  // Fills the window under the header (less <main>'s padding), so the page itself never scrolls.
  const panelHeight = 'max(420px, calc(100dvh - var(--header-h) - 1px - env(safe-area-inset-top) - 1.5rem))';
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
        {/* Fits its width (labels give way to icons when narrow) instead of scrolling. */}
        <div role="toolbar" aria-label="Chart" className="relative z-40 flex h-[38px] shrink-0 items-center gap-0.5 overflow-hidden border-b border-[var(--border)] px-1">
          <TvButton label="Symbol search" onClick={() => setSearching(true)}>
            <Search size={16} strokeWidth={1.75} aria-hidden="true" />
            <span className="font-semibold">{displaySymbol(chartSymbols[active])}</span>
          </TvButton>
          <TvSep />
          {/* The everyday intervals stay one click away; the rest live in the dropdown. A pick from it shows here too. */}
          {PERIODS.filter((p) => QUICK_PERIODS.includes(p.tf) || p.tf === tf).map((p) => (
            <TvButton key={p.tf} label={`Interval ${p.text}`} active={p.tf === tf} onClick={() => setPeriod(p.tf)} narrow>
              {p.text}
            </TvButton>
          ))}
          <IntervalMenu value={tf} onChange={setPeriod} />
          <TvSep />
          <TvButton label="Indicators" onClick={() => act()?.openTool('Indicator')}>
            <ChartCandlestick size={17} strokeWidth={1.6} aria-hidden="true" />
            <span className="max-xl:hidden">Indicators</span>
          </TvButton>
          <TvSep />
          <LayoutMenu layoutId={layout.id} onChange={setLayout} />
          <TvSep />
          <TvButton label="Create alert" onClick={() => act()?.addAlert()}>
            <AlarmClockPlus size={17} strokeWidth={1.6} aria-hidden="true" />
            <span className="max-xl:hidden">Alert</span>
          </TvButton>
          <TvButton label="Bar replay" active={replayOn} disabled={!activeReplay} onClick={() => (replayOn ? activeReplay?.exit() : activeReplay?.selectBar())}>
            <Rewind size={17} strokeWidth={1.6} aria-hidden="true" />
            <span className="max-xl:hidden">Replay</span>
          </TvButton>
          <span className="flex-1" />
          <TvButton label="Timezone" onClick={() => act()?.openTool('Timezone')} icon>
            <Globe size={17} strokeWidth={1.6} aria-hidden="true" />
          </TvButton>
          <TvButton label="Chart settings" onClick={() => setConfiguring(true)} icon>
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
        {searching && <SymbolSearch symbolInfo={symbolInfo} onPick={(s) => setSymbol(s)} onClose={() => setSearching(false)} />}
        {configuring && <ChartSettingsDialog theme={theme} onClose={() => setConfiguring(false)} />}
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

/** Intervals shown as toolbar buttons; every interval is in the dropdown. */
const QUICK_PERIODS = ['15m', '1D', '1W'];
const PERIOD_GROUPS: { label: string; timespans: string[] }[] = [
  { label: 'Minutes', timespans: ['minute'] },
  { label: 'Hours', timespans: ['hour'] },
  { label: 'Days', timespans: ['day', 'week', 'month'] },
];
const periodName = (p: (typeof PERIODS)[number]) => {
  const unit = { minute: 'minute', hour: 'hour', day: 'day', week: 'week', month: 'month' }[p.timespan as string] ?? p.timespan;
  return `${p.multiplier} ${unit}${p.multiplier === 1 ? '' : 's'}`;
};

/** TradingView's interval dropdown: every interval, grouped, with the selected one ticked. */
function IntervalMenu({ value, onChange }: { value: string; onChange: (tf: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="More intervals"
        title="More intervals"
        className={`flex h-[30px] w-[22px] items-center justify-center rounded text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--text-primary)_8%,transparent)] ${
          open ? 'bg-[color-mix(in_srgb,var(--text-primary)_12%,transparent)]' : ''
        }`}
      >
        <ChevronDown size={15} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" aria-label="Intervals" className="fixed z-50 mt-1 min-w-[170px] rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] py-1 shadow-xl">
          {PERIOD_GROUPS.map((g, gi) => (
            <div key={g.label} className={gi > 0 ? 'mt-1 border-t border-[var(--border)] pt-1' : ''}>
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">{g.label}</div>
              {PERIODS.filter((p) => g.timespans.includes(p.timespan as string)).map((p) => {
                const selected = p.tf === value;
                return (
                  <button
                    key={p.tf}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => {
                      onChange(p.tf);
                      setOpen(false);
                    }}
                    className={`flex h-8 w-full items-center justify-between gap-4 px-3 text-left text-[13px] hover:bg-[color-mix(in_srgb,var(--text-primary)_8%,transparent)] ${
                      selected ? 'text-[var(--series-blue)]' : 'text-[var(--text-primary)]'
                    }`}
                  >
                    {periodName(p)}
                    <span className="text-[11px] text-[var(--text-muted)]">{p.text}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
