import { YAxisType, type Chart } from 'klinecharts';

/**
 * TradingView's price axis density: a label roughly every 40px of pane height, on 1 / 2 / 2.5 / 5
 * steps (850, 800, 750 …), where klinecharts aims for about 8 labels whatever the height.
 * Only the linear scale; the log scale keeps klinecharts' own ticks.
 */

const PX_PER_TICK = 40;
const STEPS = [1, 2, 2.5, 5, 10];

interface YAxisInternals {
  getType: () => YAxisType;
  getParent: () => { getYAxisWidget: () => { getBounding: () => { height: number } } | null };
  _calcTickInterval: (range: number) => [number, number];
}

/** A tidy step at least `raw` wide, and the decimals it needs. */
function niceStep(raw: number): [number, number] {
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  const s = STEPS.find((x) => x * base >= raw) ?? 10;
  const decimals = Math.max(0, -exp + (s === 2.5 ? 1 : s === 10 ? -1 : 0));
  return [s * base, decimals];
}

export function installPriceTicks(chart: Chart): void {
  const pane = (chart as unknown as { _candlePane?: { getAxisComponent?: () => YAxisInternals } })._candlePane;
  const axis = pane?.getAxisComponent?.();
  if (!axis) return;
  const original = axis._calcTickInterval.bind(axis);
  axis._calcTickInterval = (range) => {
    const height = axis.getParent().getYAxisWidget()?.getBounding().height ?? 0;
    if (axis.getType() === YAxisType.Log || !(range > 0) || height < PX_PER_TICK * 3) return original(range);
    return niceStep(range / (height / PX_PER_TICK));
  };
}
