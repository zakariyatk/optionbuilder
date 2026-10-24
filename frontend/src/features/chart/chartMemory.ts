import type { Chart, Indicator, Overlay, OverlayCreate, Point } from 'klinecharts';

/**
 * What the chart remembers between visits, as TradingView does:
 * - the indicators you added (none to start with), with their settings;
 * - your drawings, per symbol, on every interval. They are saved the moment one is drawn,
 *   moved, locked, hidden or removed, and come back whenever that symbol is opened.
 * Both live in this browser's storage.
 */

const INDICATORS_KEY = 'ob-chart-indicators';
const DRAWINGS_KEY = 'ob-chart-drawings';
const CANDLE_PANE = 'candle_pane';
/** KLineChart Pro's group for drawings (its lock / hide / remove-all buttons act on it); the app's own tools use it too. */
const DRAWING_GROUP = 'drawing_tools';
/** klinecharts' `currentStep` once an overlay is fully drawn. */
const DRAWN = -1;

interface SavedIndicators {
  main: string[];
  sub: string[];
  /** calcParams by indicator name, where changed in the indicator's settings. */
  params: Record<string, unknown[]>;
}
interface SavedDrawing {
  name: string;
  /** Bar times (ms; extrapolated for points right of the last bar) and prices. */
  points: { timestamp: number; value: number }[];
  lock?: boolean;
  visible?: boolean;
  mode?: string;
  extendData?: unknown;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the chart still works, it just won't remember.
  }
}

/** Indicators to open the chart with. */
export function savedIndicators(): { main: string[]; sub: string[] } {
  const s = read<SavedIndicators>(INDICATORS_KEY);
  return { main: s?.main ?? [], sub: s?.sub ?? [] };
}

type Store = {
  getDataList: () => { timestamp: number }[];
  getOverlayStore: () => { getInstances: (paneId?: string) => Overlay[] };
};

/**
 * Starts remembering `chart`'s indicators and drawings. Call `restore(ticker, interval)` each time a
 * symbol's history has loaded to put that symbol's drawings on it. Returns a cleanup.
 */
export function installChartMemory(chart: Chart): { restore: (ticker: string, interval: string) => void; dispose: () => void } {
  const store = (chart as unknown as { getChartStore: () => Store }).getChartStore();
  const params = read<SavedIndicators>(INDICATORS_KEY)?.params ?? {};

  // ---- Indicators ----
  const saveIndicators = () => {
    const panes = chart.getIndicatorByPaneId() as Map<string, Map<string, Indicator>>;
    const saved: SavedIndicators = { main: [], sub: [], params };
    panes.forEach((byName, paneId) =>
      byName.forEach((ind, name) => {
        (paneId === CANDLE_PANE ? saved.main : saved.sub).push(name);
        params[name] = ind.calcParams;
      }),
    );
    write(INDICATORS_KEY, saved);
  };
  // Settings changed on an earlier visit, for the indicators Pro has just created.
  for (const [name, calcParams] of Object.entries(params)) chart.overrideIndicator({ name, calcParams });

  // ---- Drawings ----
  /** The symbol whose drawings are on the chart now (null until the first restore). */
  let shownFor: string | null = null;
  /** The symbol and interval last restored: a later load of the same (scrolling back) leaves the drawings be. */
  let shownKey = '';
  let restoring = false;
  let pending = 0;

  const barMs = () => {
    const data = store.getDataList();
    return data.length > 1 ? data[data.length - 1].timestamp - data[data.length - 2].timestamp : 0;
  };
  const drawings = () => store.getOverlayStore().getInstances().filter((o) => o.groupId === DRAWING_GROUP);

  const saveDrawings = () => {
    pending = 0;
    if (!shownFor || restoring) return;
    const data = store.getDataList();
    if (!data.length) return;
    const last = data.length - 1;
    const step = barMs();
    const toSaved = (p: Partial<Point>) => {
      const timestamp = p.timestamp ?? (p.dataIndex != null ? data[last].timestamp + (p.dataIndex - last) * step : null);
      return timestamp != null && p.value != null ? { timestamp, value: p.value } : null;
    };
    const list: SavedDrawing[] = drawings()
      .filter((o) => o.currentStep === DRAWN)
      .map((o) => ({
        name: o.name,
        points: o.points.map(toSaved).filter((p): p is SavedDrawing['points'][number] => !!p),
        lock: o.lock,
        visible: o.visible,
        mode: o.mode,
        extendData: o.extendData,
      }));
    const all = read<Record<string, SavedDrawing[]>>(DRAWINGS_KEY) ?? {};
    if (list.length) all[shownFor] = list;
    else delete all[shownFor];
    write(DRAWINGS_KEY, all);
  };
  const schedule = () => {
    if (restoring || pending) return;
    pending = window.setTimeout(saveDrawings, 0);
  };

  /** Every change to a drawing saves: drawn, dragged, removed (by key, the bin or remove-all), locked / hidden. */
  const withSave = (o: OverlayCreate): OverlayCreate => {
    if (o.groupId !== DRAWING_GROUP) return o;
    const chain =
      <A extends unknown[]>(fn: ((...a: A) => boolean) | null | undefined) =>
      (...a: A) => {
        schedule();
        return fn?.(...a) ?? false;
      };
    return { ...o, onDrawEnd: chain(o.onDrawEnd), onPressedMoveEnd: chain(o.onPressedMoveEnd), onRemoved: chain(o.onRemoved) };
  };

  const restore = (ticker: string, interval: string) => {
    if (`${ticker}|${interval}` === shownKey) return;
    shownKey = `${ticker}|${interval}`;
    // Changes not yet written belong to the drawings on screen now.
    if (pending) {
      window.clearTimeout(pending);
      saveDrawings();
    }
    restoring = true;
    try {
      chart.removeOverlay({ groupId: DRAWING_GROUP });
      const saved = read<Record<string, SavedDrawing[]>>(DRAWINGS_KEY)?.[ticker] ?? [];
      const data = store.getDataList();
      const last = data.length - 1;
      const step = barMs();
      for (const d of saved) {
        const points = d.points.map(({ timestamp, value }): Partial<Point> =>
          // Past the last bar there is no bar to pin to: count bars forward instead.
          last >= 0 && step > 0 && timestamp > data[last].timestamp
            ? { dataIndex: last + Math.round((timestamp - data[last].timestamp) / step), value }
            : { timestamp, value },
        );
        chart.createOverlay({ name: d.name, groupId: DRAWING_GROUP, points, lock: d.lock, visible: d.visible, mode: d.mode as OverlayCreate['mode'], extendData: d.extendData });
      }
    } finally {
      restoring = false;
      shownFor = ticker;
    }
  };

  // klinecharts has no change events for these; wrap the calls Pro and the app make on this chart.
  const original = {
    createIndicator: chart.createIndicator,
    removeIndicator: chart.removeIndicator,
    overrideIndicator: chart.overrideIndicator,
    createOverlay: chart.createOverlay,
    removeOverlay: chart.removeOverlay,
    overrideOverlay: chart.overrideOverlay,
  };
  const c = chart as unknown as Record<keyof typeof original, (...a: unknown[]) => unknown>;
  c.createIndicator = (value, ...rest) => {
    const v = typeof value === 'string' ? { name: value } : (value as { name: string; calcParams?: unknown[] });
    const calcParams = v.calcParams ?? params[v.name];
    const id = original.createIndicator.call(chart, calcParams ? { ...v, calcParams } : v, ...(rest as []));
    saveIndicators();
    return id;
  };
  c.removeIndicator = (...a) => {
    original.removeIndicator.apply(chart, a as Parameters<Chart['removeIndicator']>);
    saveIndicators();
  };
  c.overrideIndicator = (...a) => {
    original.overrideIndicator.apply(chart, a as Parameters<Chart['overrideIndicator']>);
    // Applied asynchronously by klinecharts.
    window.setTimeout(saveIndicators, 0);
  };
  c.createOverlay = (value, paneId) => {
    const v = Array.isArray(value) ? value.map((o) => (typeof o === 'string' ? o : withSave(o))) : typeof value === 'string' ? value : withSave(value as OverlayCreate);
    return original.createOverlay.call(chart, v as OverlayCreate, paneId as string | undefined);
  };
  c.removeOverlay = (...a) => {
    original.removeOverlay.apply(chart, a as Parameters<Chart['removeOverlay']>);
    schedule();
  };
  c.overrideOverlay = (...a) => {
    original.overrideOverlay.apply(chart, a as Parameters<Chart['overrideOverlay']>);
    schedule();
  };

  return {
    restore,
    dispose: () => {
      // Anything changed in the last moment is kept.
      if (pending) {
        window.clearTimeout(pending);
        saveDrawings();
      }
      shownFor = null;
      Object.assign(chart, original);
    },
  };
}
