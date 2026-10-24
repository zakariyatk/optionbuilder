import { YAxisType, type Chart } from 'klinecharts';

/**
 * TradingView's price axis density: a label roughly every 40px of pane height, where klinecharts
 * aims for about 8 labels whatever the height.
 * Linear: one tidy 1 / 2 / 2.5 / 5 step for the whole axis (850, 800, 750 …).
 * Log: klinecharts would use one price step too, which on a log scale bunches labels at the top
 * and leaves the bottom bare; instead each label gets a tidy step sized for its own price
 * (… 300, 350, 400, 500, 600 …), so they sit about 40px apart all the way down.
 */

const PX_PER_TICK = 40;
const STEPS = [1, 2, 2.5, 5, 10];

interface Tick {
  text: string;
  coord: number;
  value: string;
}
interface YAxisInternals {
  getType: () => YAxisType;
  getRange: () => { from: number; to: number };
  getParent: () => { getYAxisWidget: () => { getBounding: () => { height: number } } | null };
  _calcTickInterval: (range: number) => [number, number];
  _calcTicks: () => Tick[];
}

/** A tidy step at least `raw` wide, and the decimals it needs. */
function niceStep(raw: number): [number, number] {
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  const s = STEPS.find((x) => x * base >= raw) ?? 10;
  const decimals = Math.max(0, -exp + (s === 2.5 ? 1 : s === 10 ? -1 : 0));
  return [s * base, decimals];
}

/** Log-scale labels: walk up the axis 40px at a time, rounding each spot to a step that suits its price. */
function logTicks(from: number, to: number, height: number): Tick[] {
  const per = ((to - from) * PX_PER_TICK) / height;
  const ticks: Tick[] = [];
  let last = -Infinity;
  for (let l = from; l <= to + per; l += per) {
    const v = 10 ** l;
    const [step, decimals] = niceStep(v * (10 ** per - 1));
    const rounded = Math.round(v / step) * step;
    if (rounded <= last || rounded <= 0) continue;
    last = rounded;
    const text = rounded.toFixed(decimals);
    ticks.push({ text, coord: 0, value: text });
  }
  return ticks;
}

export function installPriceTicks(chart: Chart): void {
  const pane = (chart as unknown as { _candlePane?: { getAxisComponent?: () => YAxisInternals } })._candlePane;
  const axis = pane?.getAxisComponent?.();
  if (!axis) return;
  const height = () => axis.getParent().getYAxisWidget()?.getBounding().height ?? 0;

  const interval = axis._calcTickInterval.bind(axis);
  axis._calcTickInterval = (range) => {
    if (!(range > 0) || height() < PX_PER_TICK * 3) return interval(range);
    return niceStep(range / (height() / PX_PER_TICK));
  };

  const ticks = axis._calcTicks.bind(axis);
  axis._calcTicks = () => {
    const { from, to } = axis.getRange();
    if (axis.getType() !== YAxisType.Log || !(to > from) || height() < PX_PER_TICK * 3) return ticks();
    return logTicks(from, to, height());
  };
}
