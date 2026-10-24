import { FormatDateType, utils, type Chart, type KLineData } from 'klinecharts';

/**
 * TradingView's time axis: labels sit on calendar boundaries and say only what changed —
 * "2024" where a year starts, "Sep" where a month starts, the day number between months,
 * "14:30" within a day. Bigger boundaries win the space: zoomed far out a monthly chart shows
 * years only, zoomed in it fills the gaps with months. The crosshair's date reads "Mon 22 May '23".
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Closest two labels may sit, centre to centre (TradingView keeps roughly this). */
const MIN_GAP = 64;
/** Labels closer than this to the left edge would be cut in half; leave them out. */
const EDGE = 16;
const CACHE_LIMIT = 50_000;

interface Parts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
}
interface Tick {
  text: string;
  coord: number;
  value: number;
}
interface XAxisInternals {
  getRange: () => { from: number; to: number };
  convertToPixel: (index: number) => number;
  optimalTicks: (ticks: unknown[]) => Tick[];
}
interface ChartInternals {
  getXAxisPane?: () => { getAxisComponent: () => XAxisInternals };
  getChartStore?: () => {
    getDataList: () => KLineData[];
    getTimeScaleStore: () => { getDateTimeFormat: () => Intl.DateTimeFormat };
    getCustomApi: () => { formatDate: (f: Intl.DateTimeFormat, t: number, fmt: string, type: FormatDateType) => string };
  };
}

/** How much a boundary between two bars matters, and what its label says (null: not a boundary worth a label). */
function boundary(p: Parts, prev: Parts): { weight: number; text: string } | null {
  if (p.y !== prev.y) return { weight: 100, text: String(p.y) };
  if (p.mo !== prev.mo) return { weight: 90, text: MONTHS[p.mo - 1] };
  if (p.d !== prev.d) return { weight: 70, text: String(p.d) };
  if (p.h === prev.h && p.mi === prev.mi) return null;
  const text = `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
  if (p.mi === 0) return { weight: p.h % 6 === 0 ? 60 : p.h % 3 === 0 ? 55 : 50, text };
  return { weight: p.mi % 30 === 0 ? 40 : p.mi % 15 === 0 ? 30 : p.mi % 5 === 0 ? 20 : 10, text };
}

/** Takes over the inner chart's time axis labels and crosshair date. `intraday` says whether bars carry a time of day. */
export function installTimeAxis(chart: Chart, intraday: () => boolean): void {
  const c = chart as unknown as ChartInternals;
  const axis = c.getXAxisPane?.().getAxisComponent();
  const store = c.getChartStore?.();
  if (!axis || !store) return;

  const cache = new Map<number, Parts>();
  const partsOf = (ts: number): Parts => {
    let p = cache.get(ts);
    if (!p) {
      const [date, time] = utils.formatDate(store.getTimeScaleStore().getDateTimeFormat(), ts, 'YYYY-MM-DD HH:mm').split(' ');
      const [y, mo, d] = date.split('-').map(Number);
      const [h, mi] = time.split(':').map(Number);
      p = { y, mo, d, h, mi };
      if (cache.size > CACHE_LIMIT) cache.clear();
      cache.set(ts, p);
    }
    return p;
  };

  const original = axis.optimalTicks.bind(axis);
  axis.optimalTicks = (ticks) => {
    const data = store.getDataList();
    const { from, to } = axis.getRange();
    const first = Math.max(1, Math.floor(from) - 1);
    const last = Math.min(data.length - 1, Math.ceil(to) + 1);
    const candidates: (Tick & { weight: number })[] = [];
    for (let i = first; i <= last; i++) {
      const b = boundary(partsOf(data[i].timestamp), partsOf(data[i - 1].timestamp));
      if (b) candidates.push({ ...b, coord: axis.convertToPixel(i), value: data[i].timestamp });
    }
    if (!candidates.length) return original(ticks);

    // Biggest boundaries first; each takes its place only if it keeps clear of every label already placed.
    // Once a size of boundary no longer fits in full (years every other year, say), smaller ones stay out.
    candidates.sort((a, b) => b.weight - a.weight || a.coord - b.coord);
    const placed: Tick[] = [];
    let crowded = -1;
    for (const t of candidates) {
      if (crowded > t.weight) break;
      if (t.coord < EDGE) continue;
      let lo = 0;
      let hi = placed.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (placed[mid].coord < t.coord) lo = mid + 1;
        else hi = mid;
      }
      const clearLeft = lo === 0 || t.coord - placed[lo - 1].coord >= MIN_GAP;
      const clearRight = lo === placed.length || placed[lo].coord - t.coord >= MIN_GAP;
      if (clearLeft && clearRight) placed.splice(lo, 0, { text: t.text, coord: t.coord, value: t.value });
      else crowded = t.weight;
    }
    return placed;
  };

  const formatDate = store.getCustomApi().formatDate;
  chart.setCustomApi({
    formatDate: (f, ts, fmt, type) => {
      if (type !== FormatDateType.Crosshair) return formatDate(f, ts, fmt, type);
      const p = partsOf(ts);
      const day = DAYS[new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay()];
      const date = `${day} ${p.d} ${MONTHS[p.mo - 1]} '${String(p.y).slice(2)}`;
      return intraday() ? `${date}  ${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}` : date;
    },
  });
}
