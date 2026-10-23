import {
  CandleType,
  LineType,
  PolygonType,
  TooltipShowRule,
  YAxisPosition,
  YAxisType,
  type CandleTooltipCustomCallbackData,
  type DeepPartial,
  type Styles,
  type TooltipLegend,
} from 'klinecharts';
import { withAlpha } from './colors';
import { ohlcLegend } from './tvStyle';
import { themeColors, type ChartSettings, type ChartStyle, type ScaleMode } from './chartSettingsStore';

/** The chart Settings (chartSettingsStore.ts) turned into klinecharts styles and host classes. */

const CANDLE_TYPE: Record<ChartStyle, CandleType> = {
  candles: CandleType.CandleSolid,
  hollow: CandleType.CandleUpStroke,
  bars: CandleType.Ohlc,
  area: CandleType.Area,
};

const SCALE_TYPE: Record<ScaleMode, YAxisType> = { normal: YAxisType.Normal, percent: YAxisType.Percentage, log: YAxisType.Log };

const fmtVol = (v: number) =>
  v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(2)}K` : String(Math.round(v));

/**
 * The legend after the status-line choices: title, O H L C, the change and,
 * if asked for, the bar's volume.
 */
export function legendFor(s: ChartSettings, title: string, text: string, data: CandleTooltipCustomCallbackData): TooltipLegend[] {
  const [head, o, h, l, c, change] = ohlcLegend(title, text, data, s.upBody, s.downBody);
  const color = data.current.close >= data.current.open ? s.upBody : s.downBody;
  const out: TooltipLegend[] = [];
  if (s.legendTitle) out.push(head);
  if (s.legendOhlc) out.push(o, h, l, c);
  if (s.legendChange) out.push(change);
  if (s.legendVolume && data.current.volume !== undefined) {
    out.push({ title: { text: 'Vol ', color: text }, value: { text: fmtVol(data.current.volume), color } });
  }
  return out;
}

/**
 * The klinecharts styles for these settings, applied over the TradingView
 * look (tvStyle.ts) and the live tag's last-price line.
 */
export function settingsStyles(s: ChartSettings, theme: 'light' | 'dark', legendTitle: () => string, compact: boolean): DeepPartial<Styles> {
  const t = themeColors(theme);
  const text = theme === 'dark' ? '#D1D4DC' : '#131722';
  // A part switched off takes the colour of the part drawn under / over it, so it disappears.
  const hidden = 'rgba(0,0,0,0)';
  const upBody = s.body ? s.upBody : hidden;
  const downBody = s.body ? s.downBody : hidden;
  const upBorder = s.borders ? s.upBorder : upBody;
  const downBorder = s.borders ? s.downBorder : downBody;
  const cross = s.crosshairColor ?? t.crosshair;
  const crossLine = { color: cross, style: s.crosshairDashed ? LineType.Dashed : LineType.Solid, dashedValue: [4, 4] };
  const tickText = { color: s.scaleTextColor ?? t.scaleText, size: s.scaleTextSize };
  const axisLine = { color: s.scaleLineColor ?? t.scaleLine };
  return {
    grid: {
      horizontal: { show: s.horzGrid, color: s.horzGridColor ?? t.grid },
      vertical: { show: s.vertGrid, color: s.vertGridColor ?? t.grid },
    },
    candle: {
      type: CANDLE_TYPE[s.chartStyle],
      bar: {
        upColor: upBody,
        downColor: downBody,
        noChangeColor: upBody,
        upBorderColor: upBorder,
        downBorderColor: downBorder,
        noChangeBorderColor: upBorder,
        upWickColor: s.wick ? s.upWick : hidden,
        downWickColor: s.wick ? s.downWick : hidden,
        noChangeWickColor: s.wick ? s.upWick : hidden,
      },
      area: {
        lineColor: s.upBorder,
        backgroundColor: [
          { offset: 0, color: withAlpha(s.upBorder, 0.01) },
          { offset: 1, color: withAlpha(s.upBorder, 0.25) },
        ],
      },
      priceMark: {
        high: { show: s.highLowMarks },
        low: { show: s.highLowMarks },
        last: { upColor: s.upBody, downColor: s.downBody, line: { show: s.lastPriceLine } },
      },
      tooltip: {
        // The phone chart only shows the legend while the crosshair is on a candle.
        showRule: compact ? TooltipShowRule.FollowCross : TooltipShowRule.Always,
        custom: (data: CandleTooltipCustomCallbackData) => legendFor(s, legendTitle(), text, data),
      },
    },
    indicator: {
      // Volume bars take the candles' colours, a little lighter, as TradingView's do.
      bars: [
        {
          style: PolygonType.Fill,
          borderStyle: LineType.Solid,
          borderSize: 1,
          borderDashedValue: [2, 2],
          upColor: withAlpha(s.upBody, 0.7),
          downColor: withAlpha(s.downBody, 0.7),
          noChangeColor: withAlpha(s.upBody, 0.7),
        },
      ],
      tooltip: { showRule: s.indicatorLegend ? TooltipShowRule.Always : TooltipShowRule.None, showParams: s.indicatorArgs },
    },
    xAxis: { axisLine, tickText },
    yAxis: {
      type: SCALE_TYPE[s.scaleMode],
      position: s.scalePosition === 'left' ? YAxisPosition.Left : YAxisPosition.Right,
      axisLine,
      tickText,
    },
    separator: { color: s.scaleLineColor ?? (theme === 'dark' ? '#2A2E39' : '#E0E3EB') },
    crosshair: { horizontal: { line: crossLine }, vertical: { line: crossLine } },
  };
}

/**
 * What isn't a klinecharts style: the canvas background, the replay
 * watermark, the live tag and countdown, the scale buttons — set as CSS
 * variables and classes on the chart's host element (see index.css).
 */
export function applyHostSettings(host: HTMLElement, s: ChartSettings) {
  const vars: Record<string, string | null> = {
    '--klinecharts-pro-background-color': s.background,
    '--ob-chart-bg': s.background,
    '--ob-watermark-color': s.watermarkColor,
  };
  for (const [k, v] of Object.entries(vars)) {
    if (v) host.style.setProperty(k, v);
    else host.style.removeProperty(k);
  }
  host.classList.toggle('ob-no-watermark', !s.watermark);
  host.classList.toggle('ob-no-live-tag', !s.lastPriceLabel);
  host.classList.toggle('ob-no-countdown', !s.countdown);
  host.classList.toggle('ob-buttons-hover', s.buttons === 'hover');
  host.classList.toggle('ob-buttons-never', s.buttons === 'never');
}
