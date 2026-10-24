import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from 'react';
import { Hand, Maximize2, Minus, Plus, SquareDashed, ZoomIn, ZoomOut } from 'lucide-react';
import type { ChainRow } from '../api/types';
import { strikeOi, type OiMode } from '../domain/chain';
import { parseExpiry } from '../domain/dates';
import { calibrateLegs, expiryCurve, pnlAtExpiry, pnlOnDate, targetDateCurve, type PayoffPoint } from '../domain/payoff';
import { isLinear, type Leg, type StrategyMetrics } from '../domain/types';
import { niceStep, panRange, rangeBetween, zoomRange, type Range } from '../domain/viewport';
import { axisIndian, signedInr, signedPct } from '../lib/format';
import { Card, LegendSwatch } from './ui';

// SVG coordinate space; the element scales to its container. Phones get a
// narrower, taller space so axis labels stay readable instead of shrinking to ~5px.
const LEFT = 56;
const TOP = 20;
/**
 * OI bars grow up from the ₹0 line, the tallest reaching this share of the room above it.
 * With bars on, the fitted P&L range keeps at least OI_ROOM of the plot above ₹0 for them.
 */
const OI_BAND = 0.9;
const OI_ROOM = 0.35;
function geometry(compact: boolean) {
  const W = compact ? 440 : 800;
  const H = compact ? 380 : 410;
  // Room on the right for the open-interest axis.
  const RIGHT = W - 44;
  // Room below the plot for the price axis and the projected-P&L pill.
  const BOTTOM = H - 62;
  return { W, H, RIGHT, BOTTOM, PLOT_W: RIGHT - LEFT, PLOT_H: BOTTOM - TOP };
}

const COMPACT_QUERY = '(max-width: 639px)';
const subscribeCompact = (cb: () => void) => {
  const mq = window.matchMedia?.(COMPACT_QUERY);
  mq?.addEventListener('change', cb);
  return () => mq?.removeEventListener('change', cb);
};
const getCompact = () => window.matchMedia?.(COMPACT_QUERY).matches ?? false;
/** Smallest zoom window, as a fraction of the default range. */
const MIN_SPAN = 0.02;
/** How far past the default range you can pan or zoom out, in default spans per side. */
const OVERSCROLL = 1;
/** A box drag smaller than this (SVG units) is treated as a click, not a zoom. */
const BOX_MIN_X = 6;
const BOX_MIN_Y = 12;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const DATE_STEP = 5 * MINUTE;

/** "Nice" tick values between min and max — steps of 1, 2, 5 × 10ⁿ. */
function ticks(min: number, max: number, count: number): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const r = raw / mag;
  const step = (r > 5 ? 10 : r > 2 ? 5 : r > 1 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

/** Client coordinates → SVG coordinates, accounting for the element being scaled to fit. */
function svgPoint(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } | null {
  const box = svg.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  const { width, height } = svg.viewBox.baseVal;
  const x = ((clientX - box.left) / box.width) * width;
  const y = ((clientY - box.top) / box.height) * height;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

const istDateTime = (ms: number) =>
  new Date(ms).toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
const istDay = (ms: number) => new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

function timeLeft(ms: number): string {
  const d = Math.floor(ms / DAY);
  if (d >= 1) return `${d}D`;
  const h = Math.floor(ms / HOUR);
  return h >= 1 ? `${h}h ${Math.floor((ms % HOUR) / MINUTE)}m` : `${Math.floor(ms / MINUTE)}m`;
}

const istWeekday = (ms: number) =>
  new Date(ms).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

/** Signed whole number with Indian grouping: +1,778 / −442. */
const signedNum = (v: number) => `${v >= 0 ? '+' : '-'}${Math.abs(Math.round(v)).toLocaleString('en-IN')}`;

/** Percent with enough decimals to show small moves: +0.0031%, -1.9%, +12%. */
function pctText(v: number): string {
  const a = Math.abs(v);
  const digits = a === 0 ? 1 : a < 0.01 ? 4 : a < 1 ? 2 : a < 10 ? 1 : 0;
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

const priceText = (v: number) => (v >= 1000 ? Math.round(v).toLocaleString('en-IN') : v.toFixed(2));

/** Bright green / salmon that read on the dark tooltip in either theme. */
const tipColor = (v: number) => (v >= 0 ? '#4ade80' : '#f8977a');

const OI_MODES: { id: OiMode | 'off'; label: string }[] = [
  { id: 'oi', label: 'OI' },
  { id: 'change', label: 'OI chg' },
  { id: 'off', label: 'Off' },
];

const axisLabel = (v: number) => (Math.abs(v) >= 1000 ? axisIndian(v) : v.toFixed(0));

type Gesture =
  | { kind: 'pan'; startX: number; startY: number; x0: Range; y0: Range | null }
  | { kind: 'box'; x0: number; y0: number }
  | { kind: 'target' }
  | { kind: 'pinch'; dist0: number; anchor: number; x0: Range };

export function PayoffChart({
  legs,
  spot,
  metrics,
  fallbackIv,
  oiRows,
  capital,
  symbol,
  marks,
}: {
  legs: Leg[];
  spot: number | null;
  metrics: StrategyMetrics;
  fallbackIv: number | null;
  /** Option chain rows; when present, call / put OI is drawn as bars behind the payoff. */
  oiRows?: ChainRow[] | null;
  /** Capital the projected P&L is quoted against (margin), if known. */
  capital?: number | null;
  /**
   * Current market price per leg (LTP), for calibrating the target-date curve
   * to the market. Missing entries fall back to the leg's own premium.
   */
  marks?: (number | null)[] | null;
  symbol?: string;
}) {
  const compact = useSyncExternalStore(subscribeCompact, getCompact, () => false);
  const { W, H, RIGHT, BOTTOM, PLOT_W, PLOT_H } = geometry(compact);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [xZoom, setXZoom] = useState<Range | null>(null);
  const [yZoom, setYZoom] = useState<Range | null>(null);
  const [mode, setMode] = useState<'pan' | 'zoom'>('pan');
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [gestureKind, setGestureKind] = useState<Gesture['kind'] | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [oiMode, setOiMode] = useState<OiMode | 'off'>('oi');
  /** Underlying price to project to; null follows the live spot. */
  const [targetPrice, setTargetPrice] = useState<number | null>(null);
  /** Date to project to (epoch ms); null means now. */
  const [targetMs, setTargetMs] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [priceDraft, setPriceDraft] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), MINUTE);
    return () => window.clearInterval(t);
  }, []);

  // The target date can't run past the nearest expiry — later legs are valued by Black-Scholes beyond it.
  const expiryMs = useMemo(() => {
    const times = legs.map((l) => (l.expiry ? parseExpiry(l.expiry)?.getTime() : undefined)).filter((t): t is number => t !== undefined);
    return times.length ? Math.min(...times) : null;
  }, [legs]);
  const dateOpen = expiryMs !== null && expiryMs > now;
  const targetTime = expiryMs === null ? now : dateOpen ? clamp(targetMs ?? now, now, expiryMs) : expiryMs;
  const target = useMemo(() => new Date(targetTime), [targetTime]);
  // Option legs re-priced off the market, so "now at spot" reads the real mark-to-market P&L.
  const priced = useMemo(() => calibrateLegs(legs, spot, new Date(now), marks ?? undefined), [legs, spot, now, marks]);

  // Default x-range: every strike and spot, padded generously on both sides.
  const full = useMemo(() => {
    const points = [spot ?? 0, ...legs.filter((l) => !isLinear(l.type)).map((l) => l.strike)].filter((v) => v > 0);
    const xs = points.length ? points : [100];
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    const pad = Math.max(hi - lo, hi * 0.1, 10);
    return { min: Math.max(0, lo - pad * 0.9), max: hi + pad * 0.9 };
  }, [legs, spot]);
  const fullSpan = full.max - full.min;
  const xBounds = useMemo(
    () => ({ min: Math.max(0, full.min - fullSpan * OVERSCROLL), max: full.max + fullSpan * OVERSCROLL }),
    [full, fullSpan],
  );

  // A structural change of the strategy invalidates any zoom window.
  const fullKey = `${full.min.toFixed(2)}:${full.max.toFixed(2)}`;
  const lastFullKey = useRef(fullKey);
  useEffect(() => {
    if (lastFullKey.current !== fullKey) {
      lastFullKey.current = fullKey;
      setXZoom(null);
      setYZoom(null);
    }
  }, [fullKey]);

  const view = xZoom ?? full;
  const xMin = view.min;
  const xMax = view.max;

  const { expirySeries, targetSeries, autoY } = useMemo(() => {
    const exp: PayoffPoint[] = legs.length ? expiryCurve(legs, xMin, xMax, 200) : [];
    const tgt = targetDateCurve(priced, exp.map((p) => p.price), target, fallbackIv);
    const ys = [...exp.map((p) => p.pnl), ...(tgt?.map((p) => p.pnl) ?? [])];
    const range = ys.length ? Math.max(...ys) - Math.min(...ys) : 1;
    const pad = range === 0 ? 1 : range * 0.1;
    return {
      expirySeries: exp,
      targetSeries: tgt,
      autoY: ys.length ? { min: Math.min(...ys, 0) - pad, max: Math.max(...ys, 0) + pad } : { min: -1, max: 1 },
    };
  }, [legs, priced, xMin, xMax, target, fallbackIv]);

  const oi = useMemo(
    () => (oiRows?.length && oiMode !== 'off' ? strikeOi(oiRows, xMin, xMax, oiMode) : null),
    [oiRows, oiMode, xMin, xMax],
  );
  const oiBars = oi && oi.peak > 0 ? oi : null;
  // Room above ₹0 for the OI bars, however far below it the payoff runs.
  const fitY = oiBars && autoY.min < 0 ? { min: autoY.min, max: Math.max(autoY.max, (-autoY.min * OI_ROOM) / (1 - OI_ROOM)) } : autoY;

  const autoSpan = fitY.max - fitY.min || 1;
  const yBounds = { min: fitY.min - autoSpan * 10, max: fitY.max + autoSpan * 10 };
  const yView = yZoom ?? fitY;
  const yMin = yView.min;
  const yMax = yView.max;
  const hasOi = !!oiRows?.some((r) => r.call || r.put);

  const toPrice = (x: number) => xMin + ((x - LEFT) / PLOT_W) * (xMax - xMin);
  const toPnl = (y: number) => yMin + (1 - (y - TOP) / PLOT_H) * (yMax - yMin);
  const px = (price: number) => LEFT + ((price - xMin) / (xMax - xMin || 1)) * PLOT_W;
  const py = (pnl: number) => TOP + (1 - (pnl - yMin) / (yMax - yMin || 1)) * PLOT_H;
  const zeroY = py(0);

  const base = spot ?? (full.min + full.max) / 2;
  const tp = targetPrice ?? base;
  const priceStep = niceStep(base * 0.0025);
  const priceTick = niceStep(base * 0.0001);
  const half = spot ? Math.max(spot - full.min, full.max - spot) : fullSpan / 2;
  const sliderMin = Math.max(0, Math.min(base - half, tp));
  const sliderMax = Math.max(base + half, tp);
  const setTarget = (v: number) => {
    if (Number.isFinite(v) && v > 0) setTargetPrice(Math.round(v / priceTick) * priceTick);
  };

  const zoomX = (factor: number, anchor: number) => {
    const next = zoomRange(view, factor, anchor, xBounds, fullSpan * MIN_SPAN);
    const isDefault = Math.abs(next.min - full.min) < 1e-9 && Math.abs(next.max - full.max) < 1e-9;
    setXZoom(isDefault ? null : next);
  };
  const zoomY = (factor: number, anchor: number) => setYZoom(zoomRange(yView, factor, anchor, yBounds, autoSpan * 1e-3));
  const resetView = () => {
    setXZoom(null);
    setYZoom(null);
  };

  // Wheel must be a non-passive native listener to be able to preventDefault the page scroll.
  // Re-bound every render so the handler always sees the current view.
  const wheel = useRef<(e: WheelEvent) => void>(() => {});
  wheel.current = (e: WheelEvent) => {
    const svg = svgRef.current;
    const p = svg && svgPoint(svg, e.clientX, e.clientY);
    if (!p) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    // Two-finger horizontal swipes on a trackpad pan.
    if (Math.abs(dx) > Math.abs(dy) && !e.ctrlKey) {
      setXZoom(panRange(view, (dx / PLOT_W) * (xMax - xMin), xBounds));
      return;
    }
    const factor = Math.exp(clamp(dy, -200, 200) * 0.002);
    if (e.shiftKey || p.x < LEFT) zoomY(factor, toPnl(clamp(p.y, TOP, BOTTOM)));
    else zoomX(factor, toPrice(clamp(p.x, LEFT, RIGHT)));
  };
  const hasChart = legs.length > 0;
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => wheel.current(e);
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [hasChart]);

  if (!hasChart) {
    return (
      <Card className="flex h-[300px] flex-col items-center justify-center gap-1 text-sm text-[var(--text-muted)] sm:h-[380px]">
        <span>Add legs to see the payoff graph</span>
        <span className="text-xs">Pick a strategy template, or click B / S in the option chain.</span>
      </Card>
    );
  }

  const targetX = px(tp);
  const targetVisible = tp >= xMin && tp <= xMax;

  const startGesture = (g: Gesture) => {
    gesture.current = g;
    setGestureKind(g.kind);
  };
  const endGesture = () => {
    gesture.current = null;
    setGestureKind(null);
    setBox(null);
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const svg = svgRef.current;
    const p = svg && svgPoint(svg, e.clientX, e.clientY);
    if (!svg || !p) return;
    pointers.current.set(e.pointerId, p);
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {
      /* not supported — gestures still work while the pointer stays inside */
    }

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      setBox(null);
      startGesture({ kind: 'pinch', dist0: Math.max(Math.abs(a.x - b.x), 10), anchor: toPrice((a.x + b.x) / 2), x0: view });
      return;
    }
    if (pointers.current.size > 2) return;

    const grab = e.pointerType === 'touch' ? 18 : 8;
    if (targetVisible && Math.abs(p.x - targetX) <= grab && p.y >= TOP && p.y <= H) {
      startGesture({ kind: 'target' });
    } else if (mode === 'zoom' || e.shiftKey) {
      const x = clamp(p.x, LEFT, RIGHT);
      const y = clamp(p.y, TOP, BOTTOM);
      startGesture({ kind: 'box', x0: x, y0: y });
      setBox({ x0: x, y0: y, x1: x, y1: y });
    } else {
      startGesture({ kind: 'pan', startX: p.x, startY: p.y, x0: view, y0: yZoom });
    }
    setHoverX(null);
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    const p = svg && svgPoint(svg, e.clientX, e.clientY);
    if (!p) return;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);
    const g = gesture.current;

    if (!g) {
      setHoverX(clamp(p.x, LEFT, RIGHT));
      return;
    }
    if (g.kind === 'pinch') {
      const pts = [...pointers.current.values()];
      if (pts.length < 2) return;
      const dist = Math.max(Math.abs(pts[0].x - pts[1].x), 10);
      const next = zoomRange(g.x0, g.dist0 / dist, g.anchor, xBounds, fullSpan * MIN_SPAN);
      setXZoom(next);
    } else if (g.kind === 'target') {
      setTarget(toPrice(clamp(p.x, LEFT, RIGHT)));
    } else if (g.kind === 'box') {
      setBox({ x0: g.x0, y0: g.y0, x1: clamp(p.x, LEFT, RIGHT), y1: clamp(p.y, TOP, BOTTOM) });
    } else {
      const xSpan = g.x0.max - g.x0.min;
      setXZoom(panRange(g.x0, -((p.x - g.startX) / PLOT_W) * xSpan, xBounds));
      if (g.y0) {
        const ySpan = g.y0.max - g.y0.min;
        const shift = ((p.y - g.startY) / PLOT_H) * ySpan;
        setYZoom(panRange(g.y0, shift, yBounds));
      }
    }
  };

  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    try {
      if (svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const g = gesture.current;
    if (g?.kind === 'box' && box) {
      if (Math.abs(box.x1 - box.x0) >= BOX_MIN_X) {
        const xr = rangeBetween(toPrice(box.x0), toPrice(box.x1), fullSpan * MIN_SPAN);
        if (xr) setXZoom(xr);
      }
      if (Math.abs(box.y1 - box.y0) >= BOX_MIN_Y) {
        const yr = rangeBetween(toPnl(box.y0), toPnl(box.y1), autoSpan * 1e-3);
        if (yr) setYZoom(yr);
      }
    }
    // Lifting one finger of a pinch ends it; the remaining finger doesn't start a pan mid-gesture.
    if (pointers.current.size === 0 || g?.kind !== 'pinch') endGesture();
  };

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const span = xMax - xMin;
    const keys: Record<string, () => void> = {
      ArrowLeft: () => setXZoom(panRange(view, -span * 0.1, xBounds)),
      ArrowRight: () => setXZoom(panRange(view, span * 0.1, xBounds)),
      ArrowUp: () => zoomY(1 / 1.25, (yMin + yMax) / 2),
      ArrowDown: () => zoomY(1.25, (yMin + yMax) / 2),
      '+': () => zoomX(1 / 1.4, (xMin + xMax) / 2),
      '=': () => zoomX(1 / 1.4, (xMin + xMax) / 2),
      '-': () => zoomX(1.4, (xMin + xMax) / 2),
      '0': resetView,
      Escape: resetView,
    };
    const action = keys[e.key];
    if (action) {
      e.preventDefault();
      action();
    }
  };

  const path = (pts: PayoffPoint[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${px(p.price).toFixed(2)} ${py(p.pnl).toFixed(2)}`).join(' ');
  const expiryPath = path(expirySeries);
  const targetPath = targetSeries ? path(targetSeries) : null;
  const area = expirySeries.length
    ? `${expiryPath} L ${px(expirySeries[expirySeries.length - 1].price).toFixed(2)} ${zeroY} L ${px(expirySeries[0].price).toFixed(2)} ${zeroY} Z`
    : '';

  const xTicks = ticks(xMin, xMax, 8);
  const yTicks = ticks(yMin, yMax, 5);
  const hoverPrice = hoverX === null ? null : toPrice(hoverX);
  const hoverExpiry = hoverPrice !== null ? pnlAtExpiry(legs, hoverPrice) : null;
  const hoverTarget = hoverPrice !== null && targetSeries ? pnlOnDate(priced, hoverPrice, target, fallbackIv) : null;
  // Bars stand on the ₹0 line; zoomed so that little of the plot is left above it, they stand on the bottom instead.
  const oiBase = zeroY > BOTTOM || zeroY - TOP < PLOT_H * 0.2 ? BOTTOM : zeroY;
  const oiY = (v: number) => oiBase - (Math.abs(v) / (oiBars?.peak || 1)) * (oiBase - TOP) * OI_BAND;
  const oiTicks = oiBars ? ticks(0, oiBars.peak, 2).filter((v) => v > 0) : [];
  const oiBarW = oiBars?.step ? Math.min(Math.max((oiBars.step / (xMax - xMin || 1)) * PLOT_W * 0.38, 1), 12) : 6;
  const hoverOi =
    oiBars && hoverPrice !== null
      ? oiBars.bars.reduce<(typeof oiBars.bars)[number] | null>(
          (best, b) => (!best || Math.abs(b.strike - hoverPrice) < Math.abs(best.strike - hoverPrice) ? b : best),
          null,
        )
      : null;
  const tip =
    hoverPrice !== null && hoverExpiry !== null && !gestureKind
      ? (() => {
          const y = clamp(py(hoverTarget ?? hoverExpiry), TOP, BOTTOM);
          return {
            price: hoverPrice,
            atExpiry: hoverExpiry,
            onDate: hoverTarget,
            f: clamp((px(hoverPrice) - LEFT) / PLOT_W, 0, 1),
            top: (y / H) * 100,
            below: y < TOP + PLOT_H * 0.45,
          };
        })()
      : null;
  const capitalPct = (v: number) => (capital && capital > 0 ? ` (${pctText((v / capital) * 100)})` : '');
  const oiLabel = oiMode === 'change' ? 'OI chg' : 'OI';
  const zoomPct = xMax - xMin > 0 ? Math.round((fullSpan / (xMax - xMin)) * 100) : 100;
  const zoomedAny = xZoom !== null || yZoom !== null;

  // Projected P&L at the target price and date; falls back to the expiry payoff when IV is missing.
  const projectedOnDate = pnlOnDate(priced, tp, target, fallbackIv);
  const projectedRaw = projectedOnDate ?? pnlAtExpiry(legs, tp);
  // Sub-rupee model noise would otherwise read as "−₹0".
  const projected = Math.abs(projectedRaw) < 0.5 ? 0 : projectedRaw;
  const projectedColor = projected >= 0 ? 'var(--good)' : 'var(--critical)';
  const projectedPct = capital && capital > 0 ? ` (${signedPct((projected / capital) * 100)})` : '';
  const offSide = tp < xMin ? '◀ ' : tp > xMax ? ' ▶' : '';
  const pillLabel = `Projected ${projected >= 0 ? 'profit' : 'loss'}: ${signedInr(projected)}${projectedPct}`;
  const pillText = offSide === '◀ ' ? `◀ ${pillLabel}` : `${pillLabel}${offSide}`;
  const pillW = pillText.length * 6.3 + 20;
  const pillX = clamp(targetX, LEFT + pillW / 2, RIGHT - pillW / 2);

  const hoverNearTarget = hoverX !== null && targetVisible && Math.abs(hoverX - targetX) <= 8;
  const cursor =
    gestureKind === 'target' || hoverNearTarget
      ? 'ew-resize'
      : gestureKind === 'pan'
        ? 'grabbing'
        : mode === 'zoom'
          ? 'crosshair'
          : 'grab';

  const btn =
    'inline-flex items-center justify-center gap-1 rounded border border-[var(--border)] px-1.5 py-0.5 leading-none text-[var(--text-primary)] hover:border-[var(--border-strong)] disabled:opacity-40 pointer-coarse:min-h-9 pointer-coarse:min-w-9 pointer-coarse:px-2';
  const on = 'border-[var(--border-strong)] bg-[var(--surface-sunken)] font-semibold';
  const stepBtn =
    'flex h-8 w-8 items-center justify-center text-base text-[var(--text-primary)] hover:bg-[var(--surface-sunken)] disabled:opacity-40 pointer-coarse:h-11 pointer-coarse:w-11';
  const linkBtn = 'text-xs font-medium text-[var(--series-blue)] hover:underline disabled:opacity-40 disabled:no-underline';

  const underlying = symbol ?? 'Underlying';
  const movePct = spot ? ((tp - spot) / spot) * 100 : 0;

  return (
    <Card className="p-2">
      <div className="mb-1 flex flex-wrap items-center gap-3 px-1 text-[10px] text-[var(--text-muted)]">
        <LegendSwatch color="var(--text-secondary)" kind="line">
          At expiry
        </LegendSwatch>
        <LegendSwatch color="var(--series-blue)" kind="line">
          On target date
        </LegendSwatch>
        {oiBars && (
          <>
            <LegendSwatch color="var(--critical)">Call {oiLabel}</LegendSwatch>
            <LegendSwatch color="var(--good)">Put {oiLabel}</LegendSwatch>
          </>
        )}
        {hasOi && (
          <span className="flex items-center gap-1" role="group" aria-label="Open-interest bars">
            OI bars
            {OI_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={oiMode === m.id}
                onClick={() => setOiMode(m.id)}
                className={`${btn} ${oiMode === m.id ? on : ''}`}
              >
                {m.label}
              </button>
            ))}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <span className="flex items-center gap-1" role="group" aria-label="Drag mode">
            <button type="button" aria-pressed={mode === 'pan'} onClick={() => setMode('pan')} className={`${btn} ${mode === 'pan' ? on : ''}`} title="Drag to pan">
              <Hand size={14} aria-hidden="true" />
              Pan
            </button>
            <button
              type="button"
              aria-pressed={mode === 'zoom'}
              onClick={() => setMode('zoom')}
              className={`${btn} ${mode === 'zoom' ? on : ''}`}
              title="Drag a box to zoom (or hold Shift while dragging)"
            >
              <SquareDashed size={14} aria-hidden="true" />
              Box zoom
            </button>
          </span>
          <button type="button" onClick={() => zoomX(1 / 1.4, (xMin + xMax) / 2)} className={btn} aria-label="Zoom in" title="Zoom in">
            <ZoomIn size={14} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => zoomX(1.4, (xMin + xMax) / 2)} className={btn} aria-label="Zoom out" title="Zoom out">
            <ZoomOut size={14} aria-hidden="true" />
          </button>
          <button type="button" onClick={resetView} disabled={!zoomedAny} className={btn} title="Fit the whole payoff (double-click the chart)">
            <Maximize2 size={14} aria-hidden="true" />
            Fit
          </button>
          <span className="w-10 text-right tabular" style={{ color: zoomedAny ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
            {zoomPct}%
          </span>
        </span>
      </div>
      <div className="mb-1 hidden px-1 text-[9px] text-[var(--text-muted)] sm:block">
        Drag to pan · {mode === 'zoom' ? 'drag' : 'Shift+drag'} a box to zoom · scroll to zoom price · Shift+scroll (or scroll over the P&amp;L axis) to zoom
        P&amp;L · drag the target line · double-click to fit
      </div>
      {!targetPath && (
        <div className="mb-1 px-1 text-[10px] text-[var(--warning)]">
          Target-date line needs implied volatility and an expiry — add legs from a live option chain to enable it.
        </div>
      )}

      <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none outline-none focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
        style={{ cursor }}
        tabIndex={0}
        role="img"
        aria-label={`Payoff chart. Max profit ${metrics.maxProfit === null ? 'unlimited' : signedInr(metrics.maxProfit)}, max loss ${metrics.maxLoss === null ? 'unlimited' : signedInr(metrics.maxLoss)}. ${pillText}. Arrow keys pan and zoom, plus and minus zoom, 0 fits.`}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={resetView}
        onKeyDown={onKeyDown}
        onPointerLeave={() => {
          if (!gesture.current) setHoverX(null);
        }}
      >
        <defs>
          <clipPath id="clip-profit">
            <rect x={LEFT} y={TOP} width={PLOT_W} height={clamp(zeroY - TOP, 0, PLOT_H)} />
          </clipPath>
          <clipPath id="clip-loss">
            <rect x={LEFT} y={clamp(zeroY, TOP, BOTTOM)} width={PLOT_W} height={clamp(BOTTOM - zeroY, 0, PLOT_H)} />
          </clipPath>
          <clipPath id="clip-plot">
            <rect x={LEFT} y={TOP} width={PLOT_W} height={PLOT_H} />
          </clipPath>
        </defs>

        {yTicks.map((v) => (
          <line key={v} x1={LEFT} x2={RIGHT} y1={py(v)} y2={py(v)} stroke="var(--gridline)" strokeWidth={1} />
        ))}

        {/* Open interest sits behind the payoff, on its own scale (right axis). A hollow bar is OI shed. */}
        {oiBars && (
          <g clipPath="url(#clip-plot)" pointerEvents="none">
            {oiBars.bars.map((b) => {
              const cx = px(b.strike);
              const bar = (v: number, x: number, color: string) =>
                v === 0 ? null : (
                  <rect
                    x={x}
                    y={oiY(v)}
                    width={oiBarW}
                    height={oiBase - oiY(v)}
                    fill={v > 0 ? color : 'none'}
                    stroke={v > 0 ? 'none' : color}
                    strokeWidth={1}
                    opacity={hoverOi?.strike === b.strike ? 0.6 : 0.3}
                  />
                );
              return (
                <g key={b.strike}>
                  {bar(b.call, cx - oiBarW - 0.5, 'var(--critical)')}
                  {bar(b.put, cx + 0.5, 'var(--good)')}
                </g>
              );
            })}
          </g>
        )}

        <g clipPath="url(#clip-plot)">
          <path d={area} fill="var(--good-fill)" clipPath="url(#clip-profit)" />
          <path d={area} fill="var(--critical-fill)" clipPath="url(#clip-loss)" />
          <line x1={LEFT} x2={RIGHT} y1={zeroY} y2={zeroY} stroke="var(--baseline)" strokeWidth={1.5} />

          {metrics.maxProfit !== null && (
            <line x1={LEFT} x2={RIGHT} y1={py(metrics.maxProfit)} y2={py(metrics.maxProfit)} stroke="var(--good)" strokeDasharray="4 4" />
          )}
          {metrics.maxLoss !== null && (
            <line x1={LEFT} x2={RIGHT} y1={py(metrics.maxLoss)} y2={py(metrics.maxLoss)} stroke="var(--critical)" strokeDasharray="4 4" />
          )}

          {metrics.breakevens
            .filter((b) => b >= xMin && b <= xMax)
            .map((b) => (
              <g key={b}>
                <line x1={px(b)} x2={px(b)} y1={TOP} y2={BOTTOM} stroke="var(--text-muted)" strokeDasharray="2 3" />
                <circle cx={px(b)} cy={zeroY} r={3.5} fill="var(--surface-card)" stroke="var(--text-secondary)" strokeWidth={1.5} />
              </g>
            ))}

          {spot !== null && spot >= xMin && spot <= xMax && (
            <line x1={px(spot)} x2={px(spot)} y1={TOP} y2={BOTTOM} stroke="var(--series-violet)" strokeWidth={1.5} strokeDasharray="5 3" />
          )}

          <path d={expiryPath} fill="none" stroke="var(--text-secondary)" strokeWidth={2} strokeLinejoin="round" />
          {targetPath && <path d={targetPath} fill="none" stroke="var(--series-blue)" strokeWidth={2} strokeLinejoin="round" />}
        </g>

        {spot !== null && spot >= xMin && spot <= xMax && (
          <text x={px(spot)} y={14} textAnchor="middle" fontSize={10} fill="var(--series-violet)">
            Spot {spot.toLocaleString('en-IN')}
          </text>
        )}

        {xTicks.map((v) => (
          <text key={v} x={px(v)} y={BOTTOM + 16} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
            {v.toLocaleString('en-IN')}
          </text>
        ))}
        {yTicks.map((v) => (
          <text key={v} x={LEFT - 8} y={py(v) + 3} textAnchor="end" fontSize={10} fill="var(--text-muted)">
            {axisLabel(v)}
          </text>
        ))}

        {oiTicks.map((v) => (
          <text key={`oi-${v}`} x={RIGHT + 6} y={oiY(v) + 3} textAnchor="start" fontSize={9} fill="var(--text-muted)">
            {axisIndian(v)}
          </text>
        ))}

        {/* Target: a draggable line with the projected P&L pill under the price axis. */}
        {targetVisible && (
          <g>
            <line x1={targetX} x2={targetX} y1={TOP} y2={BOTTOM + 24} stroke={projectedColor} strokeWidth={1.5} />
            <rect x={targetX - 4} y={TOP} width={8} height={16} rx={3} fill={projectedColor} />
            <circle cx={targetX} cy={py(projected)} r={4.5} fill={projectedColor} stroke="var(--surface-card)" strokeWidth={1.5} pointerEvents="none" />
          </g>
        )}
        {/* Off-screen targets keep their pill, pinned to the edge they lie beyond. */}
        <g pointerEvents="none">
          <rect x={pillX - pillW / 2} y={BOTTOM + 24} width={pillW} height={22} rx={4} fill={projectedColor} />
          <text x={pillX} y={BOTTOM + 39} textAnchor="middle" fontSize={11} fontWeight={600} fill="#fff">
            {pillText}
          </text>
        </g>

        {box && (
          <rect
            x={Math.min(box.x0, box.x1)}
            y={Math.min(box.y0, box.y1)}
            width={Math.abs(box.x1 - box.x0)}
            height={Math.abs(box.y1 - box.y0)}
            fill="var(--series-blue)"
            fillOpacity={0.12}
            stroke="var(--series-blue)"
            strokeDasharray="4 3"
            pointerEvents="none"
          />
        )}

        {hoverPrice !== null && hoverExpiry !== null && !gestureKind && (
          <g pointerEvents="none" clipPath="url(#clip-plot)">
            <line x1={px(hoverPrice)} x2={px(hoverPrice)} y1={TOP} y2={BOTTOM} stroke="var(--text-secondary)" strokeDasharray="4 3" />
            <circle cx={px(hoverPrice)} cy={py(hoverExpiry)} r={3.5} fill={hoverExpiry >= 0 ? 'var(--good)' : 'var(--critical)'} />
            {hoverTarget !== null && (
              <circle
                cx={px(hoverPrice)}
                cy={py(hoverTarget)}
                r={6}
                fill={hoverTarget >= 0 ? 'var(--good)' : 'var(--critical)'}
                stroke="#fff"
                strokeWidth={2.5}
              />
            )}
          </g>
        )}
      </svg>

        {tip && (
          <div
            className="pointer-events-none absolute z-10 w-max min-w-[13rem] max-w-[19rem] rounded-xl px-4 py-3 text-sm tabular shadow-xl"
            style={{
              left: `${tip.f * 100}%`,
              top: `${tip.top}%`,
              transform: `translate(${-tip.f * 100}%, ${tip.below ? '16px' : 'calc(-100% - 16px)'})`,
              background: 'rgba(40, 40, 42, 0.95)',
              color: '#fff',
            }}
          >
            <span
              aria-hidden="true"
              className={`absolute h-3 w-3 rotate-45 ${tip.below ? '-top-1.5' : '-bottom-1.5'}`}
              style={{ left: `clamp(12px, ${tip.f * 100}%, calc(100% - 12px))`, marginLeft: -6, background: 'rgba(40, 40, 42, 0.95)' }}
            />
            <div className="text-center text-[13px] text-[#a1a1aa]">When price is at</div>
            <div className="text-center">
              <span className="text-lg font-bold">{priceText(tip.price)}</span>
              {spot !== null && (
                <span className="ml-1.5" style={{ color: tipColor(tip.price - spot) }}>
                  {pctText(((tip.price - spot) / spot) * 100)} ({signedNum(tip.price - spot)})
                </span>
              )}
            </div>
            <div className="my-2 border-t border-white/20" />
            <div className="text-[13px] text-[#a1a1aa]">Expected P&amp;L on</div>
            {tip.onDate !== null && (
              <div className="mt-1 flex items-baseline justify-between gap-4">
                <span>{istWeekday(targetTime)}</span>
                <span style={{ color: tipColor(tip.onDate) }}>
                  {signedNum(tip.onDate)}
                  {capitalPct(tip.onDate)}
                </span>
              </div>
            )}
            <div className="mt-1 flex items-baseline justify-between gap-4">
              <span>Expiry date</span>
              <span style={{ color: tipColor(tip.atExpiry) }}>
                {signedNum(tip.atExpiry)}
                {capitalPct(tip.atExpiry)}
              </span>
            </div>
            {hoverOi && (
              <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-white/20 pt-2 text-xs text-[#a1a1aa]">
                <span>
                  {hoverOi.strike.toLocaleString('en-IN')} {oiLabel}
                </span>
                <span>
                  <span className="text-[#f8977a]">C {axisIndian(hoverOi.call)}</span> · <span className="text-[#4ade80]">P {axisIndian(hoverOi.put)}</span>
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-6 border-t border-[var(--border)] px-1 pt-3 pb-1 md:grid-cols-2">
        {/* Target price — header, slider and scale share rows with the date block, so both bars line up. */}
        <div className="row-span-3 grid grid-rows-subgrid gap-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm text-[var(--text-primary)]">{underlying} Target</div>
              <button type="button" className={linkBtn} disabled={targetPrice === null} onClick={() => setTargetPrice(null)}>
                Reset
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-16 text-right text-sm tabular" style={{ color: movePct > 0 ? 'var(--good-text)' : movePct < 0 ? 'var(--critical)' : 'var(--text-secondary)' }}>
                {signedPct(movePct, 1)}
              </span>
              <div className="flex items-center overflow-hidden rounded-md border border-[var(--border)]">
                <button type="button" className={stepBtn} aria-label={`Lower target by ${priceStep}`} onClick={() => setTarget(tp - priceStep)}>
                  <Minus size={16} aria-hidden="true" />
                </button>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={`${underlying} target price`}
                  value={priceDraft ?? tp.toFixed(2)}
                  onFocus={(e) => {
                    setPriceDraft(tp.toFixed(2));
                    e.target.select();
                  }}
                  onChange={(e) => setPriceDraft(e.target.value)}
                  onBlur={() => {
                    if (priceDraft !== null) setTarget(Number(priceDraft));
                    setPriceDraft(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') {
                      setPriceDraft(null);
                      e.currentTarget.blur();
                    }
                  }}
                  className="h-8 w-24 border-x border-[var(--border)] bg-transparent text-center text-sm tabular text-[var(--text-primary)] outline-none pointer-coarse:h-11"
                />
                <button type="button" className={stepBtn} aria-label={`Raise target by ${priceStep}`} onClick={() => setTarget(tp + priceStep)}>
                  <Plus size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
          <input
            type="range"
            className="ob-range w-full self-center"
            min={sliderMin}
            max={sliderMax}
            step={priceTick}
            value={tp}
            aria-label={`${underlying} target price`}
            onChange={(e) => setTarget(Number(e.target.value))}
          />
          <div className="flex justify-between text-xs text-[var(--text-muted)] tabular">
            <span>{Math.round(sliderMin).toLocaleString('en-IN')}</span>
            {spot !== null && <span>Spot {spot.toLocaleString('en-IN')}</span>}
            <span>{Math.round(sliderMax).toLocaleString('en-IN')}</span>
          </div>
        </div>

        {/* Target date */}
        <div className="row-span-3 grid grid-rows-subgrid gap-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm text-[var(--text-primary)]" title="The blue curve and projected P&L are valued at this date and time">
                Date: {expiryMs === null ? 'no expiry on legs' : `${timeLeft(Math.max(0, expiryMs - targetTime))} to expiry`}
              </div>
              <button type="button" className={linkBtn} disabled={targetMs === null || !dateOpen} onClick={() => setTargetMs(null)}>
                Reset
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={`${stepBtn} rounded-md border border-[var(--border)]`}
                aria-label="One day earlier"
                disabled={!dateOpen || targetTime <= now}
                onClick={() => setTargetMs(Math.max(now, targetTime - DAY))}
              >
                ‹
              </button>
              <span className="min-w-[9.5rem] text-center text-sm tabular text-[var(--text-primary)]">{istDateTime(targetTime)}</span>
              <button
                type="button"
                className={`${stepBtn} rounded-md border border-[var(--border)]`}
                aria-label="One day later"
                disabled={!dateOpen || expiryMs === null || targetTime >= expiryMs}
                onClick={() => expiryMs !== null && setTargetMs(Math.min(expiryMs, targetTime + DAY))}
              >
                ›
              </button>
            </div>
          </div>
          <input
            type="range"
            className="ob-range w-full self-center"
            min={now}
            max={expiryMs ?? now}
            step={DATE_STEP}
            value={targetTime}
            disabled={!dateOpen}
            aria-label="Target date"
            aria-valuetext={istDateTime(targetTime)}
            onChange={(e) => setTargetMs(Number(e.target.value))}
          />
          <div className="flex justify-between text-xs text-[var(--text-muted)] tabular">
            <span>{istDay(now)}</span>
            <span>{expiryMs !== null ? istDay(expiryMs) : '—'}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
