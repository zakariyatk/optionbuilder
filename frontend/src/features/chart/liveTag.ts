import { ActionType, DomPosition, init, LineType, type Chart, type DeepPartial, type Styles } from 'klinecharts';
import type { Period } from '@klinecharts/pro';
import { candleCloseMs, fmtLeft } from '../../lib/nse';
import { TV_DOWN, TV_UP } from './tvStyle';

const UP = TV_UP;
const DOWN = TV_DOWN;
const CANDLE_PANE = 'candle_pane';

/** Dotted last-price line; its axis label is replaced by the live tag. Re-apply after a theme change. */
export const LIVE_TAG_STYLES: DeepPartial<Styles> = {
  candle: {
    priceMark: {
      last: { upColor: UP, downColor: DOWN, line: { show: true, style: LineType.Dashed, dashedValue: [2, 3], size: 1 }, text: { show: false } },
    },
  },
};

/**
 * The klinecharts instance KLineChart Pro created inside `host`. Pro keeps it
 * private, but klinecharts' init() hands back the existing chart when the
 * element's id matches the chart id it was registered under.
 */
/**
 * With several charts on the page only the active one answers keyboard
 * shortcuts; its cell carries data-chart-active="true". A chart outside any
 * cell (one chart, phones) always is.
 */
export const isActiveChart = (host: HTMLElement) => host.closest('[data-chart-active]')?.getAttribute('data-chart-active') !== 'false';

export function innerChart(host: HTMLElement): Chart | null {
  const el = host.querySelector<HTMLElement>('[k-line-chart-id]');
  if (!el) return null;
  if (!el.id) el.id = el.getAttribute('k-line-chart-id') ?? '';
  return init(el);
}

const fmtPrice = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * TradingView-style last-price tag on the price axis: the live price on a
 * green / red badge (by the forming candle's direction) with the time left in
 * that candle underneath, on a dotted line across the chart. Replaces the
 * chart's own last-price label.
 */
export function attachLiveTag(host: HTMLElement, chart: Chart, getPeriod: () => Period): { refresh: () => void; dispose: () => void } {
  chart.setStyles(LIVE_TAG_STYLES);

  const tag = document.createElement('div');
  tag.className = 'ob-live-tag';
  tag.setAttribute('aria-hidden', 'true');
  const price = document.createElement('div');
  const left = document.createElement('div');
  left.className = 'ob-live-tag-time';
  tag.append(price, left);
  host.appendChild(tag);

  const update = () => {
    const data = chart.getDataList();
    const last = data[data.length - 1];
    const axis = chart.getDom(CANDLE_PANE, DomPosition.YAxis);
    const pane = chart.getDom(CANDLE_PANE, DomPosition.Main);
    if (!last || !axis || !pane) {
      tag.style.display = 'none';
      return;
    }
    const y = (chart.convertToPixel({ value: last.close }, { paneId: CANDLE_PANE }) as { y?: number }).y;
    const hostBox = host.getBoundingClientRect();
    const axisBox = axis.getBoundingClientRect();
    const paneBox = pane.getBoundingClientRect();
    if (y === undefined || y < 0 || y > paneBox.height || axisBox.width === 0) {
      tag.style.display = 'none';
      return;
    }
    price.textContent = fmtPrice(last.close);
    const period = getPeriod();
    const now = Date.now();
    left.textContent = fmtLeft(candleCloseMs(period.timespan, period.multiplier, now) - now);
    tag.style.display = '';
    tag.style.background = last.close >= last.open ? UP : DOWN;
    tag.style.left = `${axisBox.left - hostBox.left}px`;
    tag.style.width = `${axisBox.width}px`;
    tag.style.top = `${paneBox.top - hostBox.top + y - tag.offsetHeight / 2}px`;
  };

  const actions = [ActionType.OnDataReady, ActionType.OnZoom, ActionType.OnScroll, ActionType.OnVisibleRangeChange, ActionType.OnPaneDrag];
  const onAction = () => requestAnimationFrame(update);
  actions.forEach((a) => chart.subscribeAction(a, onAction));
  const timer = window.setInterval(update, 1000);
  const resize = new ResizeObserver(onAction);
  resize.observe(host);
  update();

  return {
    refresh: onAction,
    dispose: () => {
      window.clearInterval(timer);
      resize.disconnect();
      actions.forEach((a) => chart.unsubscribeAction(a, onAction));
      tag.remove();
    },
  };
}
