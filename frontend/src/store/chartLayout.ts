import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { chartCount, layoutById, MAX_CHARTS } from '../features/chart/layouts';

/** Symbols the extra charts start on before you pick your own. */
const DEFAULT_SYMBOLS = ['NIFTY', 'BANKNIFTY', 'RELIANCE', 'HDFCBANK'];
const DEFAULT_PERIOD = '15m';

interface ChartLayoutState {
  layoutId: string;
  /** One symbol per chart slot, always MAX_CHARTS long; slots past the layout's count are kept for when it grows again. */
  symbols: string[];
  /** One timeframe per chart slot (see features/chart/periods.ts). */
  periods: string[];
  /** The chart the watchlist and keyboard shortcuts act on. */
  active: number;

  setLayout: (id: string) => void;
  setActive: (index: number) => void;
  /** Sets the symbol of chart `index` (the active one by default). */
  setSymbol: (symbol: string, index?: number) => void;
  /** Sets the timeframe of chart `index` (the active one by default). */
  setPeriod: (tf: string, index?: number) => void;
}

const clampActive = (active: number, layoutId: string) => Math.min(active, chartCount(layoutById(layoutId)) - 1);

/** The Chart page's multi-chart layout, kept in this browser. */
export const useChartLayout = create<ChartLayoutState>()(
  persist(
    (set) => ({
      layoutId: '1',
      symbols: DEFAULT_SYMBOLS,
      periods: DEFAULT_SYMBOLS.map(() => DEFAULT_PERIOD),
      active: 0,

      setLayout: (id) => {
        const layoutId = layoutById(id).id;
        set((s) => ({ layoutId, active: clampActive(s.active, layoutId) }));
      },
      setActive: (index) => set((s) => ({ active: Math.max(0, clampActive(index, s.layoutId)) })),
      setSymbol: (symbol, index) =>
        set((s) => {
          const i = index ?? s.active;
          if (i < 0 || i >= MAX_CHARTS || s.symbols[i] === symbol) return s;
          const symbols = [...s.symbols];
          symbols[i] = symbol;
          return { symbols };
        }),
      setPeriod: (tf, index) =>
        set((s) => {
          const i = index ?? s.active;
          if (i < 0 || i >= MAX_CHARTS || s.periods[i] === tf) return s;
          const periods = [...s.periods];
          periods[i] = tf;
          return { periods };
        }),
    }),
    {
      name: 'option-builder-chart-layout',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ChartLayoutState>;
        const layoutId = layoutById(p.layoutId ?? current.layoutId).id;
        const symbols = DEFAULT_SYMBOLS.map((d, i) => (typeof p.symbols?.[i] === 'string' && p.symbols[i] ? p.symbols[i] : d));
        const periods = DEFAULT_SYMBOLS.map((_, i) => (typeof p.periods?.[i] === 'string' && p.periods[i] ? p.periods[i] : DEFAULT_PERIOD));
        return { ...current, layoutId, symbols, periods, active: clampActive(Math.max(0, p.active ?? 0), layoutId) };
      },
    },
  ),
);
