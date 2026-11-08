import { registerIndicator, type Chart, type IndicatorTemplate, type KLineData } from 'klinecharts';

/**
 * Heikin Ashi candles. klinecharts has no such candle type, so an indicator
 * on the candle pane paints them while the real candles underneath are made
 * invisible (chartSettings.ts). The price axis and last-price line keep the
 * real prices, as TradingView's do by default.
 */

export const HEIKIN_ASHI = 'obHeikinAshi';
const CANDLE_PANE = 'candle_pane';

export interface HaBar {
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Heikin Ashi bars for `bars`: close = OHLC average, open = midpoint of the previous HA bar's body. */
export function heikinAshi(bars: Pick<KLineData, 'open' | 'high' | 'low' | 'close'>[]): HaBar[] {
  const out: HaBar[] = [];
  bars.forEach((b, i) => {
    const close = (b.open + b.high + b.low + b.close) / 4;
    const prev = out[i - 1];
    const open = prev ? (prev.open + prev.close) / 2 : (b.open + b.close) / 2;
    out.push({ open, close, high: Math.max(b.high, open, close), low: Math.min(b.low, open, close) });
  });
  return out;
}

interface HaColors {
  up: string;
  down: string;
}

const template: IndicatorTemplate<HaBar> = {
  name: HEIKIN_ASHI,
  shortName: 'Heikin Ashi',
  // Below drawings and alert lines.
  zLevel: -1,
  figures: [
    // Keys only feed the price axis range; the bars themselves are drawn in `draw`.
    { key: 'high', type: 'line', styles: () => ({ color: 'rgba(0,0,0,0)' }) },
    { key: 'low', type: 'line', styles: () => ({ color: 'rgba(0,0,0,0)' }) },
  ],
  calc: (list) => heikinAshi(list),
  createTooltipDataSource: () => ({ name: '', calcParamsText: '', icons: [], values: [] }),
  draw: ({ ctx, indicator, visibleRange, barSpace, xAxis, yAxis }) => {
    const { up, down } = (indicator.extendData ?? { up: '#089981', down: '#F23645' }) as HaColors;
    const half = Math.max(0.5, barSpace.halfGapBar);
    for (let i = Math.max(0, visibleRange.from); i < visibleRange.to; i++) {
      const b = indicator.result[i];
      if (!b) continue;
      const x = xAxis.convertToPixel(i);
      const color = b.close >= b.open ? up : down;
      const top = yAxis.convertToPixel(Math.max(b.open, b.close));
      const bottom = yAxis.convertToPixel(Math.min(b.open, b.close));
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(x) - 0.5, yAxis.convertToPixel(b.high), 1, yAxis.convertToPixel(b.low) - yAxis.convertToPixel(b.high));
      ctx.fillRect(x - half, top, half * 2, Math.max(1, bottom - top));
    }
    return true;
  },
};

let registered = false;

/** Puts the Heikin Ashi candles on `chart` (or takes them off), in the given colours. */
export function syncHeikinAshi(chart: Chart, on: boolean, colors: HaColors) {
  if (!registered) {
    registered = true;
    registerIndicator(template);
  }
  const has = !!chart.getIndicatorByPaneId(CANDLE_PANE, HEIKIN_ASHI);
  if (on && !has) chart.createIndicator({ name: HEIKIN_ASHI, extendData: colors }, true, { id: CANDLE_PANE });
  else if (on) chart.overrideIndicator({ name: HEIKIN_ASHI, extendData: colors }, CANDLE_PANE);
  else if (has) chart.removeIndicator(CANDLE_PANE, HEIKIN_ASHI);
}
