import { dispose, init, registerOverlay, type Chart, type KLineData, type OverlayCreate, type OverlayFigure, type OverlayTemplate } from 'klinecharts';
import { useEffect, useRef } from 'react';
import { withAlpha } from '../chart/colors';
import { TV_FONT, tvChartStyles } from '../chart/tvStyle';
import type { Bar } from './levels';

/** One thing to draw on the AI Trade chart. */
export type Mark =
  /** A price band from `from` to the right edge: support / resistance, FVG, order block. */
  | { type: 'zone'; from: number; top: number; bottom: number; color: string; label: string }
  /** A full-width price line with a tag: entry, stop loss, targets. */
  | { type: 'line'; price: number; color: string; label: string; dashed?: boolean }
  /** A short line from a swing to where it was broken: break of structure. */
  | { type: 'segment'; from: number; to: number; price: number; color: string; label: string };

const GROUP = 'ai_trade';
const ZONE = 'aiTradeZone';
const LINE = 'aiTradeLine';
const SEGMENT = 'aiTradeSegment';

const tag = (color: string, text: string) => ({
  color: '#ffffff',
  backgroundColor: color,
  borderColor: color,
  borderSize: 1,
  borderRadius: 2,
  paddingLeft: 5,
  paddingRight: 5,
  paddingTop: 3,
  paddingBottom: 3,
  size: 11,
  family: TV_FONT,
  text,
});

const zone: OverlayTemplate = {
  name: ZONE,
  totalStep: 3,
  lock: true,
  needDefaultPointFigure: false,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ coordinates, bounding, overlay }) => {
    const [a, b] = coordinates;
    if (!a || !b) return [];
    const { color, label } = overlay.extendData as { color: string; label: string };
    const x = Math.max(0, Math.min(a.x, bounding.width));
    const y = Math.min(a.y, b.y);
    const h = Math.max(1, Math.abs(b.y - a.y));
    const figures: OverlayFigure[] = [
      { type: 'rect', attrs: { x, y, width: bounding.width - x, height: h }, styles: { style: 'stroke_fill', color: withAlpha(color, 0.14), borderColor: withAlpha(color, 0.55), borderSize: 1 }, ignoreEvent: true },
      { type: 'text', attrs: { x: bounding.width - 6, y: y + h / 2, text: label, align: 'right', baseline: 'middle' }, styles: { ...tag(withAlpha(color, 0.85), label) }, ignoreEvent: true },
    ];
    return figures;
  },
};

const line: OverlayTemplate = {
  name: LINE,
  totalStep: 2,
  lock: true,
  needDefaultPointFigure: false,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ coordinates, bounding, overlay }) => {
    const p = coordinates[0];
    if (!p) return [];
    const { color, label, dashed } = overlay.extendData as { color: string; label: string; dashed?: boolean };
    return [
      { type: 'line', attrs: { coordinates: [{ x: 0, y: p.y }, { x: bounding.width, y: p.y }] }, styles: { style: dashed ? 'dashed' : 'solid', dashedValue: [6, 4], color, size: 1.5 }, ignoreEvent: true },
      { type: 'text', attrs: { x: 8, y: p.y, text: label, baseline: 'middle' }, styles: tag(color, label), ignoreEvent: true },
    ];
  },
  createYAxisFigures: ({ coordinates, bounding, overlay, yAxis }) => {
    const p = coordinates[0];
    const value = overlay.points[0]?.value;
    if (!p || value === undefined) return [];
    const { color } = overlay.extendData as { color: string };
    const fromRight = yAxis?.isFromZero() ?? false;
    const text = value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    return [{ type: 'text', attrs: { x: fromRight ? 0 : bounding.width, y: p.y, text, align: fromRight ? 'left' : 'right', baseline: 'middle' }, styles: tag(color, text), ignoreEvent: true }];
  },
};

const segment: OverlayTemplate = {
  name: SEGMENT,
  totalStep: 3,
  lock: true,
  needDefaultPointFigure: false,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ coordinates, overlay }) => {
    const [a, b] = coordinates;
    if (!a || !b) return [];
    const { color, label } = overlay.extendData as { color: string; label: string };
    return [
      { type: 'line', attrs: { coordinates: [a, { x: b.x, y: a.y }] }, styles: { style: 'dashed', dashedValue: [3, 3], color, size: 1 }, ignoreEvent: true },
      { type: 'text', attrs: { x: (a.x + b.x) / 2, y: a.y - 2, text: label, align: 'center', baseline: 'bottom' }, styles: { color, size: 10, family: TV_FONT, backgroundColor: 'transparent', borderSize: 0, paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0 }, ignoreEvent: true },
    ];
  },
};

let registered = false;
function registerOnce() {
  if (registered) return;
  registered = true;
  [zone, line, segment].forEach(registerOverlay);
}

const toKline = (b: Bar): KLineData => ({ timestamp: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });

function toOverlay(m: Mark, lastTime: number): OverlayCreate {
  const base = { groupId: GROUP, lock: true };
  if (m.type === 'zone')
    return { ...base, name: ZONE, extendData: { color: m.color, label: m.label }, points: [{ timestamp: m.from, value: m.top }, { timestamp: lastTime, value: m.bottom }] };
  if (m.type === 'segment')
    return { ...base, name: SEGMENT, extendData: { color: m.color, label: m.label }, points: [{ timestamp: m.from, value: m.price }, { timestamp: m.to, value: m.price }] };
  return { ...base, name: LINE, extendData: { color: m.color, label: m.label, dashed: m.dashed }, points: [{ timestamp: lastTime, value: m.price }] };
}

/** Candles with the AI Trade levels drawn over them. */
export function AiChart({ bars, marks, precision, theme, title }: { bars: Bar[]; marks: Mark[]; precision: number; theme: 'light' | 'dark'; title: string }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<Chart | null>(null);
  const titleRef = useRef(title);
  titleRef.current = title;
  const loadedKey = useRef('');

  useEffect(() => {
    registerOnce();
    const node = el.current;
    if (!node) return;
    chart.current = init(node);
    chart.current?.createIndicator('VOL', false, { height: 70 });
    const ro = new ResizeObserver(() => chart.current?.resize());
    ro.observe(node);
    return () => {
      ro.disconnect();
      dispose(node);
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setStyles(tvChartStyles(theme, () => titleRef.current));
  }, [theme]);

  useEffect(() => {
    chart.current?.setPriceVolumePrecision(precision, 0);
  }, [precision]);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const data = bars.map(toKline);
    // A new symbol or timeframe resets the view; a refresh of the same series keeps where the user scrolled.
    const key = `${title}|${bars[0]?.time ?? ''}`;
    if (key !== loadedKey.current || data.length === 0) {
      c.applyNewData(data);
      loadedKey.current = key;
    } else {
      const known = c.getDataList();
      const lastKnown = known[known.length - 1]?.timestamp ?? 0;
      for (const d of data) if (d.timestamp >= lastKnown) c.updateData(d);
    }
  }, [bars, title]);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    c.removeOverlay({ groupId: GROUP });
    const lastTime = bars[bars.length - 1]?.time;
    if (lastTime === undefined) return;
    c.createOverlay(marks.map((m) => toOverlay(m, lastTime)));
  }, [marks, bars]);

  return <div ref={el} className="h-full w-full" />;
}
