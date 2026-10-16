import { DomPosition, registerOverlay, type Chart, type Overlay, type OverlayFigure, type OverlayTemplate } from 'klinecharts';
import { activeAlerts, useAlerts } from '../../store/alerts';
import { armAlertSound } from '../alerts/alertSignals';
import { effectiveSettings, useChartSettings } from './chartSettingsStore';
import { innerChart, isActiveChart } from './liveTag';

/**
 * TradingView-style price alerts on the chart: a dashed line at the level
 * with a "NIFTY Crossing 22,994.45" tag and a delete button, dragged up or
 * down to move it. The alerts store is the source of truth; the chart only
 * mirrors the current symbol's waiting alerts. Ways to add one: the "+" by
 * the price axis (with "Draw horizontal line" beside it), Alt + A, or the
 * bell in the drawing bar (click the chart to place it — works on touch).
 */

const NAME = 'obPriceAlert';
/** Separate from Pro's drawing group, so "remove all drawings" leaves alerts alone. */
const GROUP = 'ob_price_alerts';
const DRAWING_GROUP = 'drawing_tools';
const CANDLE_PANE = 'candle_pane';
const overlayId = (alertId: string) => `ob-alert-${alertId}`;
/** klinecharts' `currentStep` once an overlay is fully drawn. */
const DRAW_FINISHED = -1;

const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
/** The chart Settings' alert choices (line colour, price-scale label, lines shown). */
const alertLook = () => effectiveSettings(useChartSettings.getState());
const fmt = (v: number) => v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface AlertData {
  alertId: string;
  symbol: string;
}

/** Overlays removed by the mirror itself (symbol switch, fired alert) — not a user deleting the alert. */
const quietRemovals = new Set<string>();

const alertLine: OverlayTemplate = {
  name: NAME,
  totalStep: 2,
  needDefaultPointFigure: false,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ coordinates, bounding, overlay }) => {
    const p = coordinates[0];
    const value = overlay.points[0]?.value;
    if (!p || value === undefined) return [];
    const { symbol } = overlay.extendData as AlertData;
    const line = alertLook().alertColor ?? css('--text-secondary', '#cfcfcf');
    const text = `${symbol} Crossing ${fmt(value)}`;
    // Arial 12px is ~6.6px a character; good enough to sit the delete button after the tag.
    const x = Math.round(bounding.width * 0.22);
    const tagWidth = text.length * 6.6 + 14;
    const box = {
      color: css('--text-primary', '#ffffff'),
      backgroundColor: css('--surface-raised', '#141414'),
      borderColor: line,
      borderSize: 1,
      borderRadius: 3,
      paddingLeft: 7,
      paddingRight: 7,
      paddingTop: 4,
      paddingBottom: 4,
      size: 12,
    };
    const figures: OverlayFigure[] = [
      { type: 'line', attrs: { coordinates: [{ x: 0, y: p.y }, { x: bounding.width, y: p.y }] }, styles: { style: 'dashed', dashedValue: [5, 4], color: line, size: 1 } },
      { type: 'text', key: 'tag', attrs: { x, y: p.y, text, baseline: 'middle' }, styles: box },
      { type: 'text', key: 'delete', attrs: { x: x + tagWidth + 4, y: p.y, text: '✕', baseline: 'middle' }, styles: { ...box, paddingLeft: 6, paddingRight: 6 } },
    ];
    return figures;
  },
  createYAxisFigures: ({ coordinates, overlay }) => {
    const p = coordinates[0];
    const value = overlay.points[0]?.value;
    const look = alertLook();
    if (!p || value === undefined || !look.alertAxisLabel) return [];
    return [
      {
        type: 'text',
        attrs: { x: 0, y: p.y, text: fmt(value), baseline: 'middle' },
        styles: {
          color: css('--surface-page', '#050505'),
          backgroundColor: look.alertColor ?? css('--text-secondary', '#cfcfcf'),
          borderRadius: 2,
          paddingLeft: 4,
          paddingRight: 4,
          paddingTop: 3,
          paddingBottom: 3,
          size: 11,
        },
      },
    ];
  },
  onPressedMoveEnd: ({ overlay }) => {
    const { alertId } = overlay.extendData as AlertData;
    const value = overlay.points[0]?.value;
    if (value !== undefined) useAlerts.getState().move(alertId, value, lastPriceOf.get(overlay.id)?.() ?? null);
    return false;
  },
  onClick: ({ overlay, figureKey }) => {
    if (figureKey === 'delete') useAlerts.getState().remove((overlay.extendData as AlertData).alertId);
    return false;
  },
  onRemoved: ({ overlay }) => {
    if (quietRemovals.delete(overlay.id)) return false;
    // The Delete key (or anything else) removed the line: the alert goes too.
    const data = overlay.extendData as AlertData | undefined;
    if (data && overlay.currentStep === DRAW_FINISHED) useAlerts.getState().remove(data.alertId);
    return false;
  },
};

/** Each alert overlay's way to read its chart's last price (for picking the side after a drag). */
const lastPriceOf = new Map<string, () => number | null>();

let registered = false;

const BELL =
  '<path d="M16 7a6 6 0 0 0-6 6v4l-2 3h16l-2-3v-4a6 6 0 0 0-6-6Z" fill="none" stroke-width="1.5"/><path d="M14 23a2 2 0 0 0 4 0" fill="none" stroke-width="1.5"/>';
const PLUS = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10 6v8M6 10h8" stroke="currentColor" stroke-width="1.4"/></svg>';

/**
 * Wires alerts into the Pro chart inside `container`. `symbol()` is the
 * chart's current ticker. Returns `sync` (call when data or the symbol
 * changes) and `dispose`.
 */
export function installPriceAlerts(container: HTMLElement, symbol: () => string) {
  if (!registered) {
    registered = true;
    registerOverlay(alertLine);
  }

  let chart: Chart | null = null;
  const getChart = () => (chart ??= innerChart(container));
  const lastPrice = () => getChart()?.getDataList().at(-1)?.close ?? null;
  const shown = new Set<string>();

  const pointAt = (c: Chart, value: number) => {
    const data = c.getDataList();
    const last = data.at(-1);
    return last ? { timestamp: last.timestamp, value } : { dataIndex: 0, value };
  };

  const sync = () => {
    const c = getChart();
    if (!c || c.getDataList().length === 0) return;
    // Alert lines switched off in the chart Settings: the alerts still watch, the chart just doesn't draw them.
    const want = alertLook().alertLines ? activeAlerts(useAlerts.getState().alerts, symbol()) : [];
    const ids = new Set(want.map((a) => overlayId(a.id)));
    for (const id of [...shown]) {
      if (ids.has(id)) continue;
      shown.delete(id);
      lastPriceOf.delete(id);
      if (c.getOverlayById(id)) {
        quietRemovals.add(id);
        c.removeOverlay(id);
      }
    }
    for (const a of want) {
      const id = overlayId(a.id);
      const existing = c.getOverlayById(id);
      if (!existing) {
        c.createOverlay({ id, name: NAME, groupId: GROUP, points: [pointAt(c, a.price)], extendData: { alertId: a.id, symbol: a.symbol } satisfies AlertData });
      } else if (existing.currentStep === DRAW_FINISHED && existing.points[0]?.value !== a.price) {
        c.overrideOverlay({ id, points: [pointAt(c, a.price)] });
      }
      shown.add(id);
      lastPriceOf.set(id, lastPrice);
    }
  };

  const addAlert = (price: number) => {
    armAlertSound();
    useAlerts.getState().add(symbol(), price, lastPrice());
  };

  const drawHorizontalLine = (price: number) => {
    const c = getChart();
    if (c) c.createOverlay({ name: 'horizontalStraightLine', groupId: DRAWING_GROUP, points: [pointAt(c, price)] });
  };

  /** Bell tool: the next click on the chart sets the level. */
  const placeAlert = () => {
    const c = getChart();
    if (!c) return;
    armAlertSound();
    const alertId = crypto.randomUUID();
    const sym = symbol();
    c.createOverlay({
      id: overlayId(alertId),
      name: NAME,
      groupId: GROUP,
      extendData: { alertId, symbol: sym } satisfies AlertData,
      onDrawEnd: ({ overlay }: { overlay: Overlay }) => {
        const value = overlay.points[0]?.value;
        if (value !== undefined) useAlerts.getState().add(sym, value, lastPrice(), alertId);
        bellIcon()?.classList.remove('selected');
        return false;
      },
    });
    bellIcon()?.classList.add('selected');
  };

  // ------------------------------------------------ "+" by the price axis
  const plus = document.createElement('button');
  plus.type = 'button';
  plus.className = 'ob-alert-plus';
  plus.innerHTML = PLUS;
  plus.setAttribute('aria-label', 'Add alert or line at this price');
  plus.title = 'Add alert or line at this price';
  plus.hidden = true;
  const menu = document.createElement('div');
  menu.className = 'ob-alert-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  container.append(plus, menu);

  let cursorPrice: number | null = null;
  let menuPrice: number | null = null;
  let hideTimer = 0;

  const priceAtClientY = (clientY: number): number | null => {
    const c = getChart();
    const main = c?.getDom(CANDLE_PANE, DomPosition.Main);
    if (!c || !main) return null;
    const r = main.getBoundingClientRect();
    if (clientY < r.top || clientY > r.bottom) return null;
    const res = c.convertFromPixel([{ y: clientY - r.top }], { paneId: CANDLE_PANE });
    const value = (Array.isArray(res) ? res[0] : res)?.value;
    return value !== undefined && Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  };

  const onMove = (e: MouseEvent) => {
    const c = getChart();
    const axis = c?.getDom(CANDLE_PANE, DomPosition.YAxis);
    const price = priceAtClientY(e.clientY);
    if (!axis || price === null || !menu.hidden) {
      if (menu.hidden) cursorPrice = price;
      return;
    }
    cursorPrice = price;
    const a = axis.getBoundingClientRect();
    const host = container.getBoundingClientRect();
    window.clearTimeout(hideTimer);
    plus.hidden = false;
    plus.style.left = `${a.left - host.left - 24}px`;
    plus.style.top = `${e.clientY - host.top - 11}px`;
  };
  const onLeave = () => {
    hideTimer = window.setTimeout(() => {
      if (!plus.matches(':hover') && menu.hidden) {
        plus.hidden = true;
        cursorPrice = null;
      }
    }, 400);
  };

  const closeMenu = () => {
    menu.hidden = true;
    plus.hidden = true;
  };
  const item = (label: string, keys: string, run: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.innerHTML = `<span></span><kbd>${keys}</kbd>`;
    b.firstElementChild!.textContent = label;
    b.addEventListener('click', () => {
      run();
      closeMenu();
    });
    return b;
  };
  const openMenu = () => {
    if (cursorPrice === null) return;
    menuPrice = cursorPrice;
    const p = menuPrice;
    menu.replaceChildren(
      item(`Add alert on ${symbol()} at ${fmt(p)}`, 'Alt + A', () => addAlert(p)),
      item(`Draw horizontal line at ${fmt(p)}`, 'Alt + H', () => drawHorizontalLine(p)),
    );
    menu.hidden = false;
    const host = container.getBoundingClientRect();
    const b = plus.getBoundingClientRect();
    const w = menu.offsetWidth;
    menu.style.left = `${Math.max(8, b.right - host.left - w)}px`;
    menu.style.top = `${b.bottom - host.top + 6}px`;
    (menu.firstElementChild as HTMLElement | null)?.focus();
  };
  plus.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.hidden) openMenu();
    else closeMenu();
  });
  const onDocDown = (e: MouseEvent) => {
    if (!menu.hidden && !menu.contains(e.target as Node) && e.target !== plus && !plus.contains(e.target as Node)) closeMenu();
  };
  const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  const onKey = (e: KeyboardEvent) => {
    if (!container.isConnected || !isActiveChart(container) || isTyping(e.target)) return;
    if (e.key === 'Escape' && !menu.hidden) closeMenu();
    if (!e.altKey || (e.code !== 'KeyA' && e.code !== 'KeyH')) return;
    const price = cursorPrice ?? lastPrice();
    if (price === null) return;
    e.preventDefault();
    if (e.code === 'KeyA') addAlert(price);
    else drawHorizontalLine(price);
  };

  // ------------------------------------------------ bell in the drawing bar
  const bellIcon = () => container.querySelector('[data-alert-tool] .icon-overlay');
  const mountBell = () => {
    const bar = container.querySelector<HTMLElement>('.klinecharts-pro-drawing-bar');
    if (!bar || bar.querySelector('[data-alert-tool]')) return;
    const item = document.createElement('div');
    item.className = 'item';
    item.tabIndex = 0;
    item.dataset.alertTool = '';
    item.title = 'Add alert (Alt + A)';
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', 'Add price alert');
    item.innerHTML = `<span style="width:32px;height:32px"><svg class="icon-overlay" viewBox="0 0 32 32">${BELL}</svg></span>`;
    item.addEventListener('click', placeAlert);
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        placeAlert();
      }
    });
    // After our own tools, before the magnet / lock / visibility group.
    const anchor = bar.querySelectorAll(':scope > .split-line')[1] ?? null;
    bar.insertBefore(item, anchor);
  };

  const widget = () => container.querySelector<HTMLElement>('.klinecharts-pro-widget');
  let watched: HTMLElement | null = null;
  const bindWidget = () => {
    const w = widget();
    if (!w || w === watched) return;
    watched?.removeEventListener('mousemove', onMove);
    watched?.removeEventListener('mouseleave', onLeave);
    w.addEventListener('mousemove', onMove);
    w.addEventListener('mouseleave', onLeave);
    watched = w;
  };
  const observer = new MutationObserver(() => {
    mountBell();
    bindWidget();
  });
  observer.observe(container, { childList: true, subtree: true });
  mountBell();
  bindWidget();
  plus.addEventListener('mouseleave', onLeave);
  window.addEventListener('keydown', onKey);
  document.addEventListener('mousedown', onDocDown);
  const unsubscribe = useAlerts.subscribe(sync);

  return {
    sync,
    dispose: () => {
      observer.disconnect();
      unsubscribe();
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDocDown);
      watched?.removeEventListener('mousemove', onMove);
      watched?.removeEventListener('mouseleave', onLeave);
      window.clearTimeout(hideTimer);
      plus.remove();
      menu.remove();
      // The chart is torn down without removing its overlays (no onRemoved), so nothing to mark here.
      for (const id of shown) lastPriceOf.delete(id);
      shown.clear();
    },
  };
}
