import { Bot, ChevronDown, Cpu, RefreshCw, Server, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from '../../api/client';
import type { AiStatus, SymbolInfo } from '../../api/types';
import { Button, Card, CardHeader, Notice } from '../../components/ui';
import { usePageTheme } from '../../hooks/usePageTheme';
import { num } from '../../lib/format';
import { displaySymbol, marketLabel, pricePrecision, symbolCurrency } from '../../lib/markets';
import { nameOf } from '../../lib/symbolNames';
import { SymbolSearch } from '../chart/SymbolSearch';
import { TV_DOWN, TV_UP } from '../chart/tvStyle';
import { AiChart, type Mark } from './AiChart';
import { buildBrief, type AiResult, type AiSource } from './aiBrief';
import { analyse, localHelperUp } from './aiClient';
import { computeLevels, type Action, type Bar, type Levels, type Zone } from './levels';
import { brokerName } from '../../lib/broker';

const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1D'] as const;
type Tf = (typeof TIMEFRAMES)[number];

const LAYERS = ['sr', 'ob', 'fvg', 'bos', 'plan'] as const;
type Layer = (typeof LAYERS)[number];
const LAYER_LABELS: Record<Layer, string> = { sr: 'Support / resistance', ob: 'Order blocks', fvg: 'Fair value gaps', bos: 'Structure (BOS)', plan: 'Entry, SL, targets' };

const COLORS = {
  support: TV_UP,
  resistance: TV_DOWN,
  obBull: '#00897B',
  obBear: '#F57C00',
  fvgBull: '#2962FF',
  fvgBear: '#9C27B0',
  bos: '#787B86',
  entry: '#2962FF',
  stop: TV_DOWN,
  target: TV_UP,
};

/** Bars the levels are computed from (and the chart shows). */
const MAX_BARS = 400;
const REFRESH_MS = 60_000;
const STORE_KEY = 'option-builder-ai-trade';

interface Saved {
  symbol: string;
  tf: Tf;
  source: AiSource;
  layers: Layer[];
  /** Draw Claude's plan rather than the app's, once there is one. */
  showClaude: boolean;
}

function loadSaved(fallbackSymbol: string): Saved {
  const base: Saved = { symbol: fallbackSymbol, tf: '15m', source: 'server', layers: [...LAYERS], showClaude: true };
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Partial<Saved>;
    return {
      symbol: typeof s.symbol === 'string' && s.symbol ? s.symbol : base.symbol,
      tf: TIMEFRAMES.includes(s.tf as Tf) ? (s.tf as Tf) : base.tf,
      source: s.source === 'local' ? 'local' : 'server',
      layers: Array.isArray(s.layers) ? s.layers.filter((l): l is Layer => LAYERS.includes(l as Layer)) : base.layers,
      showClaude: s.showClaude !== false,
    };
  } catch {
    return base;
  }
}

const zoneMark = (z: Zone, label: string, color: string): Mark => ({ type: 'zone', from: z.from, top: z.top, bottom: z.bottom, color, label });

function levelMarks(l: Levels, layers: Set<Layer>, dp: number): Mark[] {
  const out: Mark[] = [];
  if (layers.has('sr')) {
    l.supports.forEach((z) => out.push(zoneMark(z, `S ${num(z.bottom, dp)}–${num(z.top, dp)}`, COLORS.support)));
    l.resistances.forEach((z) => out.push(zoneMark(z, `R ${num(z.bottom, dp)}–${num(z.top, dp)}`, COLORS.resistance)));
  }
  if (layers.has('ob')) l.orderBlocks.forEach((z) => out.push(zoneMark(z, z.side === 'bull' ? 'Bull OB' : 'Bear OB', z.side === 'bull' ? COLORS.obBull : COLORS.obBear)));
  if (layers.has('fvg')) l.fvgs.forEach((z) => out.push(zoneMark(z, z.side === 'bull' ? 'Bull FVG' : 'Bear FVG', z.side === 'bull' ? COLORS.fvgBull : COLORS.fvgBear)));
  if (layers.has('bos')) l.breaks.slice(-4).forEach((b) => out.push({ type: 'segment', from: b.from, to: b.time, price: b.price, color: COLORS.bos, label: b.side === 'bull' ? 'BOS ↑' : 'BOS ↓' }));
  return out;
}

interface PlanView {
  action: Action;
  entry: number | null;
  stop: number | null;
  targets: number[];
}

function planMarks(p: PlanView, who: string, dp: number): Mark[] {
  if (p.action === 'WAIT' || p.entry == null) return [];
  const out: Mark[] = [{ type: 'line', price: p.entry, color: COLORS.entry, label: `${who} ${p.action} ${num(p.entry, dp)}` }];
  if (p.stop != null) out.push({ type: 'line', price: p.stop, color: COLORS.stop, label: `SL ${num(p.stop, dp)}`, dashed: true });
  p.targets.forEach((t, i) => out.push({ type: 'line', price: t, color: COLORS.target, label: `T${i + 1} ${num(t, dp)}`, dashed: true }));
  return out;
}

const ACTION_STYLE: Record<Action, string> = {
  BUY: 'bg-[var(--good-fill,rgba(8,153,129,0.15))] text-[#089981]',
  SELL: 'bg-[var(--critical-fill,rgba(242,54,69,0.15))] text-[#F23645]',
  WAIT: 'bg-[var(--surface-raised)] text-[var(--text-secondary)]',
};

function ActionBadge({ action }: { action: Action }) {
  return <span className={`rounded px-2 py-0.5 text-sm font-semibold tracking-wide ${ACTION_STYLE[action]}`}>{action}</span>;
}

function Row({ label, children, color }: { label: string; children: ReactNode; color?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-[13px]">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="tabular font-medium" style={color ? { color } : undefined}>
        {children}
      </span>
    </div>
  );
}

function PlanRows({ p, rr, dp }: { p: PlanView; rr: number | null; dp: number }) {
  if (p.action === 'WAIT' || p.entry == null) return null;
  return (
    <div className="mt-2 border-t border-[var(--gridline)] pt-2">
      <Row label="Entry" color={COLORS.entry}>
        {num(p.entry, dp)}
      </Row>
      {p.stop != null && (
        <Row label="Stop loss" color={COLORS.stop}>
          {num(p.stop, dp)} <span className="text-[var(--text-muted)]">({num(Math.abs(p.entry - p.stop), dp)})</span>
        </Row>
      )}
      {p.targets.map((t, i) => (
        <Row key={i} label={`Target ${i + 1}`} color={COLORS.target}>
          {num(t, dp)}
        </Row>
      ))}
      {rr != null && <Row label="Risk : reward">1 : {rr.toFixed(2)}</Row>}
    </div>
  );
}

function ZoneList({ title, zones, color, dp }: { title: string; zones: Zone[]; color: (z: Zone) => string; dp: number }) {
  if (zones.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{title}</div>
      {zones.map((z, i) => (
        <div key={i} className="flex items-center justify-between py-0.5 text-[13px] tabular">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color(z) }} />
            {z.kind === 'support' || z.kind === 'resistance' ? (z.kind === 'support' ? 'Support' : 'Resistance') : z.side === 'bull' ? 'Bullish' : 'Bearish'}
            {z.touches ? <span className="text-[var(--text-muted)]">×{z.touches}</span> : null}
          </span>
          <span>
            {num(z.bottom, dp)} – {num(z.top, dp)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Trade → AI Trade: levels on the chart, a rule-based plan, and Claude's read of it. */
export function AiTradePage({ symbol: appSymbol, symbolInfo, brokerConnected }: { symbol: string; symbolInfo: SymbolInfo[]; brokerConnected: boolean }) {
  const theme = usePageTheme();
  const [saved, setSaved] = useState(() => loadSaved(appSymbol));
  const { symbol, tf, source, showClaude } = saved;
  const layers = useMemo(() => new Set(saved.layers), [saved.layers]);
  const update = useCallback((patch: Partial<Saved>) => {
    setSaved((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(next));
      } catch {
        /* private mode: settings just won't persist */
      }
      return next;
    });
  }, []);

  const [searching, setSearching] = useState(false);
  const [bars, setBars] = useState<Bar[]>([]);
  const [loadError, setLoadError] = useState<{ message: string; broker: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [ai, setAi] = useState<AiResult | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [helperUp, setHelperUp] = useState<boolean | null>(null);

  const dp = pricePrecision(symbol);
  const name = nameOf(symbol) ?? symbolInfo.find((s) => s.symbol === symbol)?.label ?? displaySymbol(symbol);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const res = await api.candles(symbol, tf);
        const next = res.candles.slice(-MAX_BARS).map(([t, open, high, low, close, volume]) => ({ time: t * 1000, open, high, low, close, volume }));
        setBars(next);
        setLoadError(null);
      } catch (e) {
        setLoadError({ message: e instanceof Error ? e.message : 'Could not load candles', broker: e instanceof ApiError && e.needsBrokerLogin });
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [symbol, tf],
  );

  // A new symbol or timeframe: fresh candles, and the old Claude answer no longer applies.
  useEffect(() => {
    setBars([]);
    setAi(null);
    setAiError(null);
    void load();
    const id = window.setInterval(() => document.visibilityState === 'visible' && void load(true), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (source === 'server') {
      api.aiStatus().then(setStatus, () => setStatus(null));
    } else {
      setHelperUp(null);
      void localHelperUp().then(setHelperUp);
    }
  }, [source]);

  const levels = useMemo(() => computeLevels(bars), [bars]);

  const claudePlan = useMemo<PlanView | null>(
    () => (ai ? { action: ai.signal.action, entry: ai.signal.entry, stop: ai.signal.stop_loss, targets: ai.signal.targets } : null),
    [ai],
  );
  const marks = useMemo(() => {
    if (!levels) return [];
    const out = levelMarks(levels, layers, dp);
    if (layers.has('plan')) {
      if (claudePlan && showClaude) out.push(...planMarks(claudePlan, 'Claude', dp));
      else out.push(...planMarks(levels.plan, 'App', dp));
    }
    return out;
  }, [levels, layers, dp, claudePlan, showClaude]);

  const runClaude = async () => {
    if (!levels) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const brief = buildBrief({ symbol, name, exchange: marketLabel(symbol), currency: symbolCurrency(symbol), tf, bars, levels, precision: dp });
      const res = await analyse(source, { symbol, tf, brief });
      setAi(res);
      if (source === 'server') api.aiStatus().then(setStatus, () => undefined);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Analysis failed');
    } finally {
      setAiBusy(false);
    }
  };

  const toggleLayer = (l: Layer) => update({ layers: layers.has(l) ? saved.layers.filter((x) => x !== l) : [...saved.layers, l] });
  const plan = levels?.plan;
  const sig = ai?.signal;

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-1 flex items-center gap-1.5 text-base font-semibold">
          <Sparkles size={18} className="text-[var(--accent)]" aria-hidden="true" /> AI Trade
        </h1>
        <Button onClick={() => setSearching(true)} aria-label="Change symbol">
          <span className="font-semibold">{displaySymbol(symbol)}</span>
          <span className="hidden max-w-[12rem] truncate text-[var(--text-muted)] sm:inline">{name}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </Button>
        <div className="flex overflow-hidden rounded border border-[var(--border)]" role="group" aria-label="Timeframe">
          {TIMEFRAMES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => update({ tf: t })}
              aria-pressed={tf === t}
              className={`px-2.5 py-1 text-xs pointer-coarse:min-h-11 ${tf === t ? 'bg-[var(--surface-raised)] font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
            >
              {t}
            </button>
          ))}
        </div>
        <Button variant="ghost" onClick={() => void load()} disabled={loading} aria-label="Reload candles" title="Reload candles">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
        </Button>
        <div className="ml-auto flex flex-wrap gap-1">
          {LAYERS.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => toggleLayer(l)}
              aria-pressed={layers.has(l)}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] pointer-coarse:min-h-9 ${layers.has(l) ? 'border-[var(--border-strong)] text-[var(--text-primary)]' : 'border-[var(--border)] text-[var(--text-muted)] line-through'}`}
            >
              {LAYER_LABELS[l]}
            </button>
          ))}
        </div>
      </div>

      {loadError && (
        <Notice tone={loadError.broker ? 'warning' : 'critical'}>
          {loadError.broker || (!brokerConnected && loadError.message.includes('NOT_AUTHENTICATED'))
            ? `Connect ${brokerName()} to chart Indian symbols here. Global markets (gold, crypto, US) work without it.`
            : `Candles: ${loadError.message}`}
        </Notice>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="relative h-[440px] overflow-hidden p-0 md:h-[600px]">
          {bars.length > 0 ? (
            <AiChart bars={bars} marks={marks} precision={dp} theme={theme} title={`${displaySymbol(symbol)} · ${tf} · ${marketLabel(symbol)}`} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">{loading ? 'Loading candles…' : 'No candles'}</div>
          )}
        </Card>

        <div className="flex flex-col gap-3">
          {/* Claude */}
          <Card>
            <CardHeader title="Claude's read">
              <div className="flex overflow-hidden rounded border border-[var(--border)] text-[11px]" role="group" aria-label="Claude via">
                {(['server', 'local'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => update({ source: s })}
                    aria-pressed={source === s}
                    title={s === 'server' ? 'The site server, with its Claude API key' : 'This PC, with your ant CLI login (run the ai-helper)'}
                    className={`flex items-center gap-1 px-2 py-0.5 pointer-coarse:min-h-9 ${source === s ? 'bg-[var(--surface-raised)] font-semibold' : 'text-[var(--text-secondary)]'}`}
                  >
                    {s === 'server' ? <Server size={12} aria-hidden="true" /> : <Cpu size={12} aria-hidden="true" />}
                    {s === 'server' ? 'Server' : 'This PC'}
                  </button>
                ))}
              </div>
            </CardHeader>
            <div className="px-3 pb-3">
              <Button variant="primary" className="w-full" onClick={() => void runClaude()} disabled={!levels || aiBusy}>
                <Bot size={15} aria-hidden="true" />
                {aiBusy ? 'Claude is reading the chart…' : sig ? 'Analyse again' : 'Analyse with Claude'}
              </Button>
              <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
                {source === 'server'
                  ? status
                    ? status.server
                      ? `Server · ${status.model}${status.limit ? ` · ${status.used}/${status.limit} today` : ''}`
                      : 'The server has no Claude API key. Switch to This PC, or add one to the server config.'
                    : 'Server · Claude API key'
                  : helperUp === false
                    ? 'Helper not found on this PC. Run "npm start" in the ai-helper folder.'
                    : helperUp
                      ? 'This PC · ant CLI login · helper running'
                      : 'This PC · checking the helper…'}
                {aiBusy && ' · usually 20–60 seconds'}
              </p>
              {aiError && (
                <div className="mt-2">
                  <Notice tone="critical">{aiError}</Notice>
                </div>
              )}

              {sig && (
                <div className="mt-3">
                  <div className="flex items-center justify-between">
                    <ActionBadge action={sig.action} />
                    <span className="text-[12px] text-[var(--text-muted)]">
                      {sig.bias} · confidence {Math.round(sig.confidence)}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-[var(--surface-raised)]">
                    <div className="h-full rounded bg-[var(--accent)]" style={{ width: `${Math.max(0, Math.min(100, sig.confidence))}%` }} />
                  </div>
                  <p className="mt-2 text-[13px] font-medium">{sig.summary}</p>
                  {claudePlan && <PlanRows p={claudePlan} rr={sig.risk_reward} dp={dp} />}
                  <div className="mt-2 space-y-1.5 border-t border-[var(--gridline)] pt-2 text-[12.5px] leading-relaxed">
                    <p>
                      <span className="text-[var(--text-muted)]">Structure: </span>
                      {sig.trend}
                    </p>
                    <p>{sig.reasoning}</p>
                    <p>
                      <span className="text-[var(--text-muted)]">{sig.action === 'WAIT' ? 'Trade if: ' : 'Trigger: '}</span>
                      {sig.trigger}
                    </p>
                    <p>
                      <span className="text-[var(--text-muted)]">Invalidation: </span>
                      {sig.invalidation}
                    </p>
                  </div>
                  {sig.key_levels.length > 0 && (
                    <div className="mt-2 border-t border-[var(--gridline)] pt-2">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Claude's key levels</div>
                      {sig.key_levels.map((k, i) => (
                        <div key={i} className="flex justify-between gap-2 py-0.5 text-[12.5px]">
                          <span className="min-w-0 truncate" title={k.note}>
                            <span className="capitalize">{k.kind.replace(/_/g, ' ')}</span>
                            <span className="text-[var(--text-muted)]"> · {k.note}</span>
                          </span>
                          <span className="shrink-0 tabular">{k.low === k.high ? num(k.low, dp) : `${num(k.low, dp)} – ${num(k.high, dp)}`}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <label className="mt-2 flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                    <input type="checkbox" checked={showClaude} onChange={(e) => update({ showClaude: e.target.checked })} />
                    Draw Claude's plan on the chart (else the app's)
                  </label>
                  <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                    {ai.model} · {ai.source === 'server' ? 'server' : 'this PC'} · {new Date(ai.at).toLocaleTimeString('en-IN')}
                    {ai.cached ? ' · from cache' : ''}
                  </p>
                </div>
              )}
            </div>
          </Card>

          {/* App's own read */}
          <Card>
            <CardHeader title="App signal (rules)">{plan && <ActionBadge action={plan.action} />}</CardHeader>
            <div className="px-3 pb-3">
              {levels && plan ? (
                <>
                  <Row label="Trend">{levels.trend === 'up' ? 'Up' : levels.trend === 'down' ? 'Down' : 'Range'}</Row>
                  <Row label="ATR (14)">{num(levels.atr, dp)}</Row>
                  <p className="mt-1 text-[12.5px] text-[var(--text-secondary)]">{plan.reason}</p>
                  <PlanRows p={plan} rr={plan.rr} dp={dp} />
                  <ZoneList title="Resistance" zones={levels.resistances} color={() => COLORS.resistance} dp={dp} />
                  <ZoneList title="Support" zones={levels.supports} color={() => COLORS.support} dp={dp} />
                  <ZoneList title="Order blocks" zones={levels.orderBlocks} color={(z) => (z.side === 'bull' ? COLORS.obBull : COLORS.obBear)} dp={dp} />
                  <ZoneList title="Fair value gaps" zones={levels.fvgs} color={(z) => (z.side === 'bull' ? COLORS.fvgBull : COLORS.fvgBear)} dp={dp} />
                </>
              ) : (
                <p className="text-[13px] text-[var(--text-muted)]">{bars.length ? 'Not enough candles yet.' : 'Waiting for candles…'}</p>
              )}
            </div>
          </Card>

          <p className="text-[10.5px] leading-relaxed text-[var(--text-muted)]">
            Levels and signals are automated chart analysis for learning, not investment advice. Check them yourself and size every trade so the stop loss is a loss you can take.
          </p>
        </div>
      </div>

      {searching && (
        <SymbolSearch
          symbolInfo={symbolInfo}
          title="AI Trade symbol"
          onPick={(s) => {
            update({ symbol: s });
            setSearching(false);
          }}
          onClose={() => setSearching(false)}
        />
      )}
    </div>
  );
}
