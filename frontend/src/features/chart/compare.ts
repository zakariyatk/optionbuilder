import { registerIndicator, type Chart, type IndicatorTemplate } from 'klinecharts';

/**
 * Compare symbols: other symbols' closes drawn over the chart as lines,
 * rebased so every line starts level with the chart's own close at the first
 * bar on screen, with the price axis in percent, as TradingView compares.
 * Each compared symbol is one indicator on the candle pane (obCompare0…).
 */

export const MAX_COMPARE = 3;
export const COMPARE_COLORS = ['#F7A21B', '#2962FF', '#E040FB'];
const CANDLE_PANE = 'candle_pane';
const nameOf = (slot: number) => `obCompare${slot}`;
export const isCompareIndicator = (name: string) => /^obCompare\d$/.test(name);

/** A compared symbol's closes: [time ms, close], oldest first. */
export type Closes = [number, number][];

/**
 * The compared symbol's close for each of the chart's bars: its latest close
 * at or before the end of that bar (`span` ms long), or null if it has none yet.
 */
export function alignCloses(times: number[], closes: Closes, span: number): (number | null)[] {
  const out: (number | null)[] = [];
  let j = -1;
  for (const t of times) {
    while (j + 1 < closes.length && closes[j + 1][0] < t + span) j++;
    out.push(j >= 0 ? closes[j][1] : null);
  }
  return out;
}

/** `aligned` scaled so that at bar `base` (or the first bar after it with a value) it equals `mainBase`'s close there. */
export function rebase(aligned: (number | null)[], mainCloses: number[], base: number): (number | null)[] {
  let b = Math.max(0, base);
  while (b < aligned.length && aligned[b] == null) b++;
  const from = aligned[b];
  const to = mainCloses[b];
  if (from == null || !from || to == null) return aligned.map(() => null);
  return aligned.map((v) => (v == null ? null : (to * v) / from));
}

/** The bar length on this chart: the commonest gap between the last bars (a day for daily bars, and so on). */
export function barSpan(times: number[]): number {
  const gaps = new Map<number, number>();
  for (let i = Math.max(1, times.length - 50); i < times.length; i++) {
    const g = times[i] - times[i - 1];
    gaps.set(g, (gaps.get(g) ?? 0) + 1);
  }
  let best = 60_000;
  let count = 0;
  gaps.forEach((n, g) => {
    if (n > count) {
      best = g;
      count = n;
    }
  });
  return best;
}

interface CompareData {
  label: string;
  color: string;
  closes: Closes;
  /** Bar index the lines are rebased on: the first one on screen. */
  base: number;
}

type Value = { value: number | null; pct: number | null };

function template(slot: number): IndicatorTemplate<Value> {
  return {
    name: nameOf(slot),
    shortName: 'Compare',
    precision: 2,
    figures: [{ key: 'value', type: 'line', styles: (_d, ind) => ({ color: (ind.extendData as CompareData | undefined)?.color ?? COMPARE_COLORS[slot] }) }],
    calc: (list, ind) => {
      const data = ind.extendData as CompareData | undefined;
      if (!data?.closes.length || !list.length) return list.map(() => ({ value: null, pct: null }));
      const times = list.map((d) => d.timestamp);
      const aligned = alignCloses(times, data.closes, barSpan(times));
      const values = rebase(aligned, list.map((d) => d.close), data.base);
      const start = values.find((v, i) => i >= data.base && v != null) ?? null;
      return values.map((v) => ({ value: v, pct: v != null && start ? ((v - start) / start) * 100 : null }));
    },
    createTooltipDataSource: ({ indicator, crosshair }) => {
      const data = indicator.extendData as CompareData | undefined;
      const r = indicator.result[crosshair.dataIndex ?? indicator.result.length - 1];
      const pct = r?.pct;
      return {
        name: data?.label ?? '',
        calcParamsText: '',
        icons: [],
        values: [{ title: '', value: { text: pct == null ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`, color: data?.color ?? COMPARE_COLORS[slot] } }],
      };
    },
  };
}

/** The first bar actually on screen (`from` also counts bars kept just off the left edge). */
const firstOnScreen = (chart: Chart) => {
  const r = chart.getVisibleRange();
  return Math.max(0, Math.round(r.realFrom ?? r.from));
};

let registered = false;
const register = () => {
  if (registered) return;
  registered = true;
  for (let i = 0; i < MAX_COMPARE; i++) registerIndicator(template(i));
};

export interface CompareSeries {
  label: string;
  closes: Closes;
}

/**
 * Shows `series` (one per slot, null for an empty slot) over `chart`. Returns
 * a function that rebases the lines on the first bar on screen: call it when
 * the chart scrolls or zooms.
 */
export function syncCompare(chart: Chart, series: (CompareSeries | null)[]) {
  register();
  const base = () => firstOnScreen(chart);
  for (let slot = 0; slot < MAX_COMPARE; slot++) {
    const s = series[slot];
    const name = nameOf(slot);
    const has = !!chart.getIndicatorByPaneId(CANDLE_PANE, name);
    if (!s) {
      if (has) chart.removeIndicator(CANDLE_PANE, name);
      continue;
    }
    const extendData: CompareData = { label: s.label, color: COMPARE_COLORS[slot], closes: s.closes, base: base() };
    if (has) chart.overrideIndicator({ name, extendData }, CANDLE_PANE);
    else chart.createIndicator({ name, extendData }, true, { id: CANDLE_PANE });
  }
}

/** Rebases the compare lines on the first bar now on screen. */
export function rebaseCompare(chart: Chart) {
  const from = firstOnScreen(chart);
  for (let slot = 0; slot < MAX_COMPARE; slot++) {
    const ind = chart.getIndicatorByPaneId(CANDLE_PANE, nameOf(slot)) as { extendData?: CompareData } | null;
    const data = ind?.extendData;
    if (data && data.base !== from) chart.overrideIndicator({ name: nameOf(slot), extendData: { ...data, base: from } }, CANDLE_PANE);
  }
}
