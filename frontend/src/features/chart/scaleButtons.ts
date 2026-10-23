import { DomPosition, YAxisType, type Chart } from 'klinecharts';
import { effectiveSettings, useChartSettings } from './chartSettingsStore';
import { innerChart } from './liveTag';

/**
 * TradingView's "A" and "L" at the foot of the price axis.
 * A — Auto (fits data to screen): dragging the price axis takes manual
 *     control of its range; A gives it back. Lit while auto is on.
 * L — Logarithmic price scale; the chart Settings' scale mode (saved there).
 */

const CANDLE_PANE = 'candle_pane';
const scaleMode = () => effectiveSettings(useChartSettings.getState()).scaleMode;
const SCALE_TYPE = { normal: YAxisType.Normal, percent: YAxisType.Percentage, log: YAxisType.Log } as const;

/** klinecharts keeps the price axis' auto flag internal; read it where it lives, assuming auto if that ever moves. */
function isAuto(chart: Chart): boolean {
  const pane = (chart as unknown as { _candlePane?: { getAxisComponent?: () => { getAutoCalcTickFlag?: () => boolean } } })._candlePane;
  return pane?.getAxisComponent?.().getAutoCalcTickFlag?.() ?? true;
}

export function installScaleButtons(container: HTMLElement) {
  let chart: Chart | null = null;
  const getChart = () => (chart ??= innerChart(container));

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
  const applyType = () => getChart()?.setStyles({ yAxis: { type: SCALE_TYPE[scaleMode()] } });

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
    logBtn.setAttribute('aria-pressed', String(scaleMode() === 'log'));
  };

  auto.addEventListener('click', () => {
    applyType();
    requestAnimationFrame(refresh);
  });
  logBtn.addEventListener('click', () => {
    // Saved straight away; every chart picks it up through its settings.
    useChartSettings.getState().set({ scaleMode: scaleMode() === 'log' ? 'normal' : 'log' });
    applyType();
    logBtn.setAttribute('aria-pressed', String(scaleMode() === 'log'));
    requestAnimationFrame(refresh);
  });

  // "On price scale hover" (the default): shown only while the pointer is over the price axis, or on the buttons.
  const onMove = (e: PointerEvent) => {
    const axis = getChart()?.getDom(CANDLE_PANE, DomPosition.YAxis)?.getBoundingClientRect();
    const near =
      group.contains(e.target as Node) ||
      (!!axis && e.clientX >= axis.left && e.clientX <= axis.right && e.clientY >= axis.top && e.clientY <= axis.bottom);
    group.classList.toggle('is-near', near);
  };
  const onLeave = () => group.classList.remove('is-near');
  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerleave', onLeave);

  // Auto turns off when the axis is dragged or scrolled; check after any such gesture, and keep the buttons on the axis as panes resize.
  const later = () => requestAnimationFrame(refresh);
  container.addEventListener('mouseup', later);
  container.addEventListener('touchend', later);
  container.addEventListener('wheel', later, { passive: true });
  container.addEventListener('dblclick', later);
  const resize = new ResizeObserver(later);
  resize.observe(container);
  // The inner chart appears a moment after Pro mounts; place the buttons once it's there.
  let tries = 0;
  const boot = window.setInterval(() => {
    if (getChart()) refresh();
    if (chart || ++tries > 50) window.clearInterval(boot);
  }, 100);
  const tick = window.setInterval(refresh, 1000);

  return {
    /** The chart's styles were set again (theme or settings): show the scale mode they carry. */
    reapply: later,
    dispose: () => {
      window.clearInterval(boot);
      window.clearInterval(tick);
      resize.disconnect();
      container.removeEventListener('mouseup', later);
      container.removeEventListener('touchend', later);
      container.removeEventListener('wheel', later);
      container.removeEventListener('dblclick', later);
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerleave', onLeave);
      group.remove();
    },
  };
}
