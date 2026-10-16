import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Activity, Camera, ChevronDown, Globe, Layers, Maximize, MoreHorizontal, PencilLine, Plus, Rewind, Settings } from 'lucide-react';
import { api } from '../../api/client';
import type { SymbolInfo } from '../../api/types';
import { BottomSheet } from '../../components/BottomSheet';
import { useAsync } from '../../hooks/useAsync';
import { PHONE_QUERY, useMediaQuery } from '../../hooks/useMediaQuery';
import { num } from '../../lib/format';
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
  const { layoutId, symbols: chartSymbols, active, setLayout, setActive, setSymbol } = useChartLayout();
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
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-card)]" style={{ height: panelHeight }}>
        {/* Above the charts, whose own labels and panels use z-index, so the layout menu opens over them. */}
        <div className="relative z-40 flex items-center gap-2 border-b border-[var(--border)] px-2 py-1">
          <LayoutMenu layoutId={layout.id} onChange={setLayout} />
          <span aria-hidden="true" className="h-5 w-px bg-[var(--border-strong)]" />
          <button
            type="button"
            disabled={!activeReplay}
            aria-pressed={replayOn}
            title="Bar replay"
            onClick={() => (replayOn ? activeReplay?.exit() : activeReplay?.selectBar())}
            className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium disabled:opacity-40 ${
              replayOn ? 'bg-[var(--text-primary)] text-[var(--surface-page)]' : 'text-[var(--text-primary)] hover:bg-[var(--surface-sunken)]'
            }`}
          >
            <Rewind size={16} aria-hidden="true" />
            Replay
          </button>
          {count > 1 && <span className="truncate text-xs text-[var(--text-muted)]">Click a chart to select it; the watchlist changes the selected chart.</span>}
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

  const quoteState = useAsync(() => api.watch([symbol]), [symbol], { pollMs: QUOTE_POLL_MS, enabled: brokerConnected });
  const q = quoteState.data?.quotes.find((x) => x.symbol === symbol);
  const quote = q && !('error' in q) ? q : null;
  const chg = quote ? quote.price - quote.previousClose : null;
  const pct = quote && quote.previousClose ? (chg! / quote.previousClose) * 100 : null;
  const label = symbolInfo.find((s) => s.symbol === symbol)?.label ?? symbol;
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
            {symbol} · NSE · {period?.text ?? tf}
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
          <span className="truncate">{symbol}</span>
          <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-[var(--text-muted)]" />
        </button>
        <button
          type="button"
          onClick={() => setSheet('interval')}
          aria-label={`Interval ${period?.text ?? tf}`}
          disabled={!brokerConnected}
          className="flex h-11 min-w-11 items-center justify-center rounded-lg px-2 text-sm font-semibold disabled:opacity-40"
        >
          {period?.text ?? tf}
        </button>
        <span className="flex-1" />
        {brokerConnected && (
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
        {brokerConnected && (
          <>
            <SheetItem icon={<Activity size={20} aria-hidden="true" />} label="Indicators" onClick={() => tool('Indicator')} />
            <SheetItem icon={<Globe size={20} aria-hidden="true" />} label="Timezone" onClick={() => tool('Timezone')} />
            <SheetItem icon={<Settings size={20} aria-hidden="true" />} label="Chart settings" onClick={() => tool('Setting')} />
            <SheetItem icon={<Camera size={20} aria-hidden="true" />} label="Screenshot" onClick={() => tool('Screenshot')} />
            <SheetItem icon={<Maximize size={20} aria-hidden="true" />} label="Full screen" onClick={() => tool('Full Screen')} />
          </>
        )}
        <SheetItem
          icon={<Layers size={20} aria-hidden="true" />}
          label={`Build strategy on ${symbol}`}
          onClick={() => {
            setSheet(null);
            onOpenBuilder(symbol);
          }}
        />
      </BottomSheet>
    </div>
  );
}
