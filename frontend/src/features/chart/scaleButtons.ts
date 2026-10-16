import { DomPosition, YAxisType, type Chart } from 'klinecharts';
import { innerChart } from './liveTag';

/**
 * TradingView's "A" and "L" at the foot of the price axis.
 * A — Auto (fits data to screen): dragging the price axis takes manual
 *     control of its range; A gives it back. Lit while auto is on.
 * L — Logarithmic price scale; remembered in this browser.
 */

const CANDLE_PANE = 'candle_pane';
const LOG_KEY = 'option-builder-chart-log';

const readLog = () => {
  try {
    return localStorage.getItem(LOG_KEY) === '1';
  } catch {
    return false;
  }
};

/** klinecharts keeps the price axis' auto flag internal; read it where it lives, assuming auto if that ever moves. */
function isAuto(chart: Chart): boolean {
  const pane = (chart as unknown as { _candlePane?: { getAxisComponent?: () => { getAutoCalcTickFlag?: () => boolean } } })._candlePane;
  return pane?.getAxisComponent?.().getAutoCalcTickFlag?.() ?? true;
}

export function installScaleButtons(container: HTMLElement) {
  let chart: Chart | null = null;
  const getChart = () => (chart ??= innerChart(container));
  let log = readLog();

  const group = document.createElement('div');
  group.className = 'ob-scale';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Price scale');
  const button = (label: string, title: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-label', title);
    group.append(b);
    return b;
  };
  const auto = button('A', 'Auto (fits data to screen)');
  const logBtn = button('L', 'Logarithmic');
  group.hidden = true;
  container.append(group);

  // Setting the axis type also hands the range back to auto-fit.
  const applyType = () => getChart()?.setStyles({ yAxis: { type: log ? YAxisType.Log : YAxisType.Normal } });

  const refresh = () => {
    const c = getChart();
    const axis = c?.getDom(CANDLE_PANE, DomPosition.YAxis);
    if (!c || !axis) {
      group.hidden = true;
      return;
    }
    const a = axis.getBoundingClientRect();
    const host = container.getBoundingClientRect();
    group.hidden = a.width === 0;
    group.style.left = `${a.left - host.left + (a.width - group.offsetWidth) / 2}px`;
    group.style.top = `${a.bottom - host.top - group.offsetHeight - 8}px`;
    auto.setAttribute('aria-pressed', String(isAuto(c)));
    logBtn.setAttribute('aria-pressed', String(log));
  };

  auto.addEventListener('click', () => {
    applyType();
    requestAnimationFrame(refresh);
  });
  logBtn.addEventListener('click', () => {
    log = !log;
    try {
      localStorage.setItem(LOG_KEY, log ? '1' : '0');
    } catch {
      /* not remembered, still applied */
    }
    applyType();
    requestAnimationFrame(refresh);
  });

  // Auto turns off when the axis is dragged or scrolled; check after any such gesture, and keep the buttons on the axis as panes resize.
  const later = () => requestAnimationFrame(refresh);
  container.addEventListener('mouseup', later);
  container.addEventListener('touchend', later);
  container.addEventListener('wheel', later, { passive: true });
  container.addEventListener('dblclick', later);
  const resize = new ResizeObserver(later);
  resize.observe(container);
  // The inner chart appears a moment after Pro mounts; apply the remembered scale once it's there.
  let tries = 0;
  const boot = window.setInterval(() => {
    if (getChart()) {
      if (log) applyType();
      refresh();
    }
    if (chart || ++tries > 50) window.clearInterval(boot);
  }, 100);
  const tick = window.setInterval(refresh, 1000);

  return {
    /** Re-apply the scale after something reset the chart's styles (a theme change). */
    reapply: () => {
      if (log) applyType();
      later();
    },
    dispose: () => {
      window.clearInterval(boot);
      window.clearInterval(tick);
      resize.disconnect();
      container.removeEventListener('mouseup', later);
      container.removeEventListener('touchend', later);
      container.removeEventListener('wheel', later);
      container.removeEventListener('dblclick', later);
      group.remove();
    },
  };
}
