import type { Chart, Indicator } from 'klinecharts';

/** Helpers shared by the phone chart's sheets. */

/** A price step about 0.1% of the price, rounded to a tidy number (0.05, 0.5, 5, 50 …). */
export function priceStep(price: number): number {
  if (!(price > 0)) return 1;
  const raw = price * 0.001;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const m = raw / pow;
  return (m < 2 ? 1 : m < 5 ? 2 : 5) * pow;
}

/** "Thu 15 Oct 10:45" in IST for intraday bars, "Thu 15 Oct '26" for daily and longer. */
export function barTime(ms: number, intraday: boolean): string {
  const d = new Date(ms + 330 * 60_000);
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  const date = `${day} ${d.getUTCDate()} ${mon}`;
  if (!intraday) return `${date} '${String(d.getUTCFullYear()).slice(2)}`;
  return `${date} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export interface Active {
  paneId: string;
  ind: Indicator;
}

/** The user's indicators on the chart (not the app's own Heikin Ashi / compare ones). */
export function activeIndicators(chart: Chart | null): Active[] {
  if (!chart) return [];
  const panes = chart.getIndicatorByPaneId() as Map<string, Map<string, Indicator>>;
  const out: Active[] = [];
  panes.forEach((byName, paneId) => byName.forEach((ind, name) => !name.startsWith('ob') && out.push({ paneId, ind })));
  return out;
}
