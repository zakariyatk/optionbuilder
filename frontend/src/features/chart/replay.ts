import { useSyncExternalStore } from 'react';
import { DomPosition, type Chart, type KLineData } from 'klinecharts';

/**
 * TradingView's Bar Replay for one chart: pick a past bar, the chart is cut
 * back to it, then bars come back one at a time (stepped or played). While
 * replaying, the live feed leaves the chart alone; leaving replay reloads it
 * live.
 */

export type ReplayMode = 'off' | 'select' | 'ready' | 'playing';

export interface ReplayState {
  mode: ReplayMode;
  /** Index (in the full history) of the last bar shown; null before a bar is picked. */
  index: number | null;
  total: number;
  /** Timestamp of the last bar shown. */
  time: number | null;
  /** Bars per second while playing. */
  speed: number;
  /** All bars have been replayed. */
  atEnd: boolean;
}

export const REPLAY_SPEEDS = [0.5, 1, 2, 3, 5, 10];

const OFF: ReplayState = { mode: 'off', index: null, total: 0, time: null, speed: 1, atEnd: false };
const noSubscription = () => () => {};
const offState = () => OFF;

/** A chart's replay state, or "off" when it has none. */
export function useReplayState(replay: ReplayController | null): ReplayState {
  return useSyncExternalStore(replay?.subscribe ?? noSubscription, replay?.getState ?? offState);
}

export interface ReplayController {
  getState: () => ReplayState;
  subscribe: (fn: () => void) => () => void;
  /** The chart's timeframe, e.g. "15m". */
  periodText: () => string;
  /** Start (or restart) replay by choosing the bar to go back to. */
  selectBar: () => void;
  play: () => void;
  pause: () => void;
  step: () => void;
  setSpeed: (speed: number) => void;
  /** Leave replay and go back to the live chart. */
  exit: () => void;
  /** True while the live feed must not touch the chart. */
  holdsChart: () => boolean;
  /** The chart loaded fresh data on its own (symbol / period change): replay is over. */
  reset: () => void;
  dispose: () => void;
}

const CANDLE_PANE = 'candle_pane';

/** "Thu 15 Oct '26 10:45 AM", in IST like the rest of the app. */
export function replayLabel(ts: number): string {
  const d = new Date(ts);
  const part = (o: Intl.DateTimeFormatOptions) => d.toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', ...o });
  const time = d.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
  return `${part({ weekday: 'short' })} ${part({ day: 'numeric' })} ${part({ month: 'short' })} '${part({ year: '2-digit' })} ${time}`;
}

export function installReplay(
  container: HTMLElement,
  opts: { chart: () => Chart | null; reloadLive: () => void; periodText: () => string },
): ReplayController {
  let state: ReplayState = { mode: 'off', index: null, total: 0, time: null, speed: 1, atEnd: false };
  /** The full history when replay started; replay shows a prefix of it. */
  let bars: KLineData[] = [];
  let timer = 0;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<ReplayState>) => {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn());
    placeWatermark();
  };

  // ------------------------------------------------ "Replay" watermark
  // TradingView marks a chart in replay with a large faint "⏪ Replay" behind the candles.
  const watermark = document.createElement('div');
  watermark.className = 'ob-replay-watermark';
  watermark.setAttribute('aria-hidden', 'true');
  watermark.innerHTML =
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="currentColor"/><path d="M13.6 7.2 8.2 12l5.4 4.8V7.2Z" fill="var(--ob-replay-watermark-cut)"/><rect x="14.4" y="7.2" width="1.8" height="9.6" fill="var(--ob-replay-watermark-cut)"/></svg><span>Replay</span>';
  function placeWatermark() {
    const main = mainDom();
    if (state.mode === 'off' || !main) {
      watermark.remove();
      return;
    }
    // Inside the price pane, before its canvases, so the candles paint over it.
    if (watermark.parentElement !== main) main.prepend(watermark);
    const r = main.getBoundingClientRect();
    watermark.style.fontSize = `${Math.round(Math.max(28, Math.min(r.height * 0.26, r.width * 0.13)))}px`;
  }
  const watermarkResize = new ResizeObserver(() => placeWatermark());
  watermarkResize.observe(container);

  // ------------------------------------------------ "select bar" cursor
  const line = document.createElement('div');
  line.className = 'ob-replay-line';
  const shade = document.createElement('div');
  shade.className = 'ob-replay-shade';
  const tag = document.createElement('div');
  tag.className = 'ob-replay-tag';
  for (const el of [shade, line, tag]) {
    el.hidden = true;
    container.append(el);
  }
  let pressX: number | null = null;

  const mainDom = () => opts.chart()?.getDom(CANDLE_PANE, DomPosition.Main) ?? null;
  const indexAt = (clientX: number): number | null => {
    const c = opts.chart();
    const main = mainDom();
    if (!c || !main) return null;
    const r = main.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right) return null;
    const res = c.convertFromPixel([{ x: clientX - r.left }], { paneId: CANDLE_PANE });
    const i = (Array.isArray(res) ? res[0] : res)?.dataIndex;
    if (i === undefined || !Number.isFinite(i)) return null;
    return Math.max(0, Math.min(bars.length - 1, Math.round(i)));
  };
  const hideCursor = () => {
    line.hidden = shade.hidden = tag.hidden = true;
  };
  const onMove = (e: MouseEvent) => {
    if (state.mode !== 'select') return;
    const c = opts.chart();
    const main = mainDom();
    const i = indexAt(e.clientX);
    if (!c || !main || i === null) return hideCursor();
    const r = main.getBoundingClientRect();
    const host = container.getBoundingClientRect();
    // Snap to the bar's centre, as TradingView does.
    const px = (c.convertToPixel({ dataIndex: i }, { paneId: CANDLE_PANE }) as { x?: number }).x ?? e.clientX - r.left;
    const x = r.left - host.left + px;
    line.style.left = `${x}px`;
    line.style.top = shade.style.top = `${r.top - host.top}px`;
    line.style.height = shade.style.height = `${r.height}px`;
    shade.style.left = `${x}px`;
    shade.style.width = `${Math.max(0, r.right - host.left - x)}px`;
    tag.textContent = `Re: ${replayLabel(bars[i].timestamp)}`;
    tag.style.left = `${x}px`;
    tag.style.top = `${r.bottom - host.top - 26}px`;
    line.hidden = shade.hidden = tag.hidden = false;
  };
  const onDown = (e: MouseEvent) => {
    pressX = state.mode === 'select' ? e.clientX : null;
  };
  // Capture phase: the chart's own click (drawing tools, selection) must not also run.
  const onClick = (e: MouseEvent) => {
    if (state.mode !== 'select') return;
    // A drag scrolls the chart; only a click picks a bar.
    if (pressX !== null && Math.abs(e.clientX - pressX) > 4) return;
    const i = indexAt(e.clientX);
    if (i === null) return;
    e.stopPropagation();
    cutAt(i);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && state.mode === 'select') {
      if (state.index !== null) cutAt(state.index);
      else exit();
    }
  };
  container.addEventListener('mousemove', onMove);
  container.addEventListener('mouseleave', hideCursor);
  container.addEventListener('mousedown', onDown, true);
  container.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKey);

  // ------------------------------------------------ replay itself
  const stopTimer = () => {
    window.clearInterval(timer);
    timer = 0;
  };

  const cutAt = (i: number) => {
    const c = opts.chart();
    if (!c || !bars[i]) return;
    stopTimer();
    hideCursor();
    c.applyNewData(bars.slice(0, i + 1));
    set({ mode: 'ready', index: i, time: bars[i].timestamp, atEnd: i >= bars.length - 1 });
  };

  const selectBar = () => {
    const c = opts.chart();
    if (!c) return;
    stopTimer();
    if (state.mode === 'off') {
      bars = c.getDataList().slice();
      if (bars.length < 2) return;
      set({ total: bars.length, index: null, time: null, atEnd: false });
    } else {
      // Choosing again: show every bar so a later one can be picked too.
      c.applyNewData(bars.slice());
    }
    set({ mode: 'select' });
  };

  const step = () => {
    const c = opts.chart();
    if (!c || state.index === null) return;
    const next = state.index + 1;
    if (next >= bars.length) {
      stopTimer();
      set({ mode: 'ready', atEnd: true });
      return;
    }
    c.updateData(bars[next]);
    set({ index: next, time: bars[next].timestamp, atEnd: next >= bars.length - 1 });
    if (next >= bars.length - 1 && state.mode === 'playing') {
      stopTimer();
      set({ mode: 'ready' });
    }
  };

  const startTimer = () => {
    stopTimer();
    timer = window.setInterval(step, 1000 / state.speed);
  };

  const play = () => {
    if (state.index === null || state.atEnd) return;
    set({ mode: 'playing' });
    startTimer();
  };
  const pause = () => {
    stopTimer();
    if (state.mode === 'playing') set({ mode: 'ready' });
  };
  const setSpeed = (speed: number) => {
    set({ speed });
    if (state.mode === 'playing') startTimer();
  };

  const reset = () => {
    stopTimer();
    hideCursor();
    bars = [];
    if (state.mode !== 'off') set({ mode: 'off', index: null, total: 0, time: null, atEnd: false });
  };
  const exit = () => {
    const wasOn = state.mode !== 'off';
    reset();
    if (wasOn) opts.reloadLive();
  };

  return {
    getState: () => state,
    periodText: opts.periodText,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    selectBar,
    play,
    pause,
    step,
    setSpeed,
    exit,
    holdsChart: () => state.mode !== 'off',
    reset,
    dispose: () => {
      stopTimer();
      container.removeEventListener('mousemove', onMove);
      container.removeEventListener('mouseleave', hideCursor);
      container.removeEventListener('mousedown', onDown, true);
      container.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKey);
      line.remove();
      watermark.remove();
      watermarkResize.disconnect();
      shade.remove();
      tag.remove();
      listeners.clear();
    },
  };
}
