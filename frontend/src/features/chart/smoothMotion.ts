import type { Chart } from 'klinecharts';

/**
 * TradingView-like motion for the desktop chart. Out of the box klinecharts
 * zooms the whole 10% of a wheel notch in one jump and stops a mouse drag dead
 * on release (only touch gets momentum). Here a wheel sets a target bar width
 * that the chart eases toward over a few frames, anchored at the pointer, and a
 * flicked mouse drag glides on and slows to a stop.
 */

/** Bar width change per wheel notch (klinecharts' own step). */
const NOTCH = 1.1;
/** Share of the remaining zoom covered each 60 fps frame. */
const ZOOM_EASE = 0.28;
/** Glide speed kept per 60 fps frame. */
const FRICTION = 0.92;
/** Slowest glide worth drawing, px per ms. */
const MIN_SPEED = 0.02;
/** Drag samples this old say nothing about the speed at release. */
const SAMPLE_MS = 80;
/** A drag released after holding still this long doesn't glide. */
const IDLE_MS = 60;
/** klinecharts' bar width limits. */
const MIN_BAR = 1;
const MAX_BAR = 50;

interface Widget {
  getName: () => string;
}
interface ChartEvent {
  _findWidgetByEvent: (e: unknown) => { widget: Widget | null };
  _makeWidgetEvent: (e: unknown, w: Widget | null) => { x: number; y: number };
  _startScrollCoordinate: { x: number; y: number } | null;
  _mouseDownWidget: Widget | null;
  mouseWheelVertEvent: (e: unknown, scale: number) => boolean;
  mouseDownEvent: (e: unknown) => boolean;
  pressedMouseMoveEvent: (e: { x: number }) => boolean;
  mouseUpEvent: (e: unknown) => boolean;
}
interface TimeScale {
  getBarSpace: () => { bar: number };
  zoom: (scale: number, at?: { x: number; y?: number }) => void;
  startScroll: () => void;
  scroll: (distance: number) => void;
  getZoomEnabled: () => boolean;
  getScrollEnabled: () => boolean;
}
interface ChartInternals {
  _chartEvent?: ChartEvent;
  getChartStore?: () => { getTimeScaleStore: () => TimeScale };
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function installSmoothMotion(chart: Chart): () => void {
  const c = chart as unknown as ChartInternals;
  const ev = c._chartEvent;
  const ts = c.getChartStore?.().getTimeScaleStore();
  if (!ev || !ts || typeof ev.mouseWheelVertEvent !== 'function') return () => {};

  let frame = 0;
  let last = 0;
  // Zoom: where the bar width is heading, and the x it zooms around.
  let target: number | null = null;
  let anchor = 0;
  // Glide: px per ms, and the drag distance it continues from.
  let speed = 0;
  let samples: { t: number; x: number }[] = [];

  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    target = null;
    speed = 0;
  };

  const step = (now: number) => {
    // Frames at other rates move the same distance per second as at 60 fps.
    const k = Math.min(4, Math.max(0.25, (now - last) / (1000 / 60)));
    // Distance and friction both take the capped step, so a stalled frame neither flings nor stops the glide.
    const dt = k * (1000 / 60);
    last = now;
    let more = false;
    if (target !== null) {
      const bar = ts.getBarSpace().bar;
      const next = Math.abs(target - bar) < 0.01 ? target : bar + (target - bar) * (1 - Math.pow(1 - ZOOM_EASE, k));
      // klinecharts' zoom(scale) sets bar += scale * bar / 10.
      ts.zoom(((next - bar) / bar) * 10, { x: anchor });
      if (next === target || ts.getBarSpace().bar === bar) target = null;
      else more = true;
    }
    if (speed !== 0) {
      ts.startScroll();
      ts.scroll(speed * dt);
      speed *= Math.pow(FRICTION, k);
      if (Math.abs(speed) < MIN_SPEED) speed = 0;
      else more = true;
    }
    frame = more ? requestAnimationFrame(step) : 0;
  };
  const run = () => {
    if (frame) return;
    last = performance.now();
    frame = requestAnimationFrame(step);
  };

  const orig = {
    wheel: ev.mouseWheelVertEvent,
    down: ev.mouseDownEvent,
    move: ev.pressedMouseMoveEvent,
    up: ev.mouseUpEvent,
  };

  ev.mouseWheelVertEvent = function (e, scale) {
    const { widget } = ev._findWidgetByEvent(e);
    if (widget?.getName() !== 'main' || !ts.getZoomEnabled()) return orig.wheel.call(ev, e, scale);
    speed = 0;
    anchor = ev._makeWidgetEvent(e, widget).x;
    const from = target ?? ts.getBarSpace().bar;
    const to = Math.min(MAX_BAR, Math.max(MIN_BAR, from * Math.pow(NOTCH, scale)));
    if (reducedMotion()) {
      const bar = ts.getBarSpace().bar;
      ts.zoom(((to - bar) / bar) * 10, { x: anchor });
      return true;
    }
    target = to;
    run();
    return true;
  };

  ev.mouseDownEvent = function (e) {
    // Grabbing the chart catches it mid-glide or mid-zoom, as TradingView's does.
    stop();
    samples = [];
    return orig.down.call(ev, e);
  };

  ev.pressedMouseMoveEvent = function (e) {
    const consumed = orig.move.call(ev, e);
    // Only a plain pan of the chart (not a drawing being dragged) is tracked for the glide.
    if (!consumed && ev._mouseDownWidget?.getName() === 'main' && ev._startScrollCoordinate) {
      const t = performance.now();
      samples.push({ t, x: e.x });
      while (samples.length > 2 && t - samples[0].t > SAMPLE_MS) samples.shift();
    } else samples = [];
    return consumed;
  };

  ev.mouseUpEvent = function (e) {
    const panned = ev._mouseDownWidget?.getName() === 'main' && ev._startScrollCoordinate !== null;
    const res = orig.up.call(ev, e);
    const now = performance.now();
    const first = samples[0];
    const end = samples[samples.length - 1];
    samples = [];
    if (!panned || !first || !end || end === first || now - end.t > IDLE_MS || reducedMotion() || !ts.getScrollEnabled()) return res;
    const v = (end.x - first.x) / Math.max(1, end.t - first.t);
    if (Math.abs(v) > MIN_SPEED * 5) {
      speed = v;
      run();
    }
    return res;
  };

  return () => {
    stop();
    Object.assign(ev, {
      mouseWheelVertEvent: orig.wheel,
      mouseDownEvent: orig.down,
      pressedMouseMoveEvent: orig.move,
      mouseUpEvent: orig.up,
    });
  };
}
