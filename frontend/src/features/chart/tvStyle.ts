import { LineType, type CandleTooltipCustomCallbackData, type DeepPartial, type KLineData, type Styles, type TooltipLegend } from 'klinecharts';

/**
 * TradingView's chart look: its font, candle colours, 12px axis text, faint
 * grid, grey dashed crosshair, and the "O H L C  change (%)" legend coloured
 * by the candle. Re-apply after a theme change (Pro's setTheme resets styles).
 */

/** TradingView's UI font stack (Trebuchet MS on Windows). */
export const TV_FONT = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";
export const TV_UP = '#089981';
export const TV_DOWN = '#F23645';

const fmt = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "O22,972.75 H22,973.60 L22,936.40 C22,965.75 −8.05 (−0.04%)", after a "NIFTY 50 · 15m · NSE" title. */
export function ohlcLegend(title: string, text: string, data: { prev: KLineData | null; current: KLineData }): TooltipLegend[] {
  const { prev, current: c } = data;
  const color = c.close >= c.open ? TV_UP : TV_DOWN;
  const base = prev?.close ?? c.open;
  const change = c.close - base;
  const pct = base ? (change / base) * 100 : 0;
  const sign = change > 0 ? '+' : change < 0 ? '−' : '';
  const v = (label: string, value: number): TooltipLegend => ({ title: { text: label, color: text }, value: { text: fmt(value), color } });
  return [
    { title: { text: '', color: text }, value: { text: title, color: text } },
    v('O', c.open),
    v('H', c.high),
    v('L', c.low),
    v('C', c.close),
    { title: { text: '', color }, value: { text: `${sign}${fmt(Math.abs(change))} (${sign}${Math.abs(pct).toFixed(2)}%)`, color } },
  ];
}

export function tvChartStyles(theme: 'light' | 'dark', legendTitle: () => string): DeepPartial<Styles> {
  const dark = theme === 'dark';
  const text = dark ? '#D1D4DC' : '#131722';
  const axisText = dark ? '#B2B5BE' : '#131722';
  const grid = dark ? 'rgba(242, 242, 242, 0.06)' : 'rgba(42, 46, 57, 0.06)';
  const crossLine = dark ? '#9598A1' : '#9598A1';
  const crossLabel = dark ? '#363A45' : '#131722';
  const textStyle = { family: TV_FONT, size: 12 };
  const crossText = { ...textStyle, color: '#FFFFFF', backgroundColor: crossLabel, borderColor: crossLabel, borderRadius: 2, paddingLeft: 6, paddingRight: 6, paddingTop: 4, paddingBottom: 4 };
  const crossDirection = { line: { style: LineType.Dashed, dashedValue: [4, 4], size: 1, color: crossLine }, text: crossText };

  return {
    grid: { horizontal: { color: grid, style: LineType.Solid }, vertical: { color: grid, style: LineType.Solid } },
    candle: {
      bar: {
        upColor: TV_UP,
        downColor: TV_DOWN,
        noChangeColor: TV_UP,
        upBorderColor: TV_UP,
        downBorderColor: TV_DOWN,
        noChangeBorderColor: TV_UP,
        upWickColor: TV_UP,
        downWickColor: TV_DOWN,
        noChangeWickColor: TV_UP,
      },
      priceMark: {
        high: { color: axisText, textFamily: TV_FONT, textSize: 11 },
        low: { color: axisText, textFamily: TV_FONT, textSize: 11 },
      },
      tooltip: {
        custom: (data: CandleTooltipCustomCallbackData) => ohlcLegend(legendTitle(), text, data),
        text: { ...textStyle, size: 13, color: text, marginLeft: 6, marginRight: 0, marginTop: 6, marginBottom: 2 },
      },
    },
    indicator: {
      tooltip: { text: { ...textStyle, color: axisText, marginTop: 4 } },
      lastValueMark: { text: { family: TV_FONT, size: 11 } },
    },
    xAxis: {
      axisLine: { color: grid },
      tickLine: { show: false },
      tickText: { ...textStyle, color: axisText },
    },
    yAxis: {
      axisLine: { color: grid },
      tickLine: { show: false },
      tickText: { ...textStyle, color: axisText },
    },
    separator: { color: dark ? '#2A2E39' : '#E0E3EB' },
    crosshair: { horizontal: crossDirection, vertical: crossDirection },
  };
}
