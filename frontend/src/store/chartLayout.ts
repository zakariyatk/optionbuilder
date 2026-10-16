import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { chartCount, layoutById, MAX_CHARTS } from '../features/chart/layouts';

/** Symbols the extra charts start on before you pick your own. */
const DEFAULT_SYMBOLS = ['NIFTY', 'BANKNIFTY', 'RELIANCE', 'HDFCBANK'];

interface ChartLayoutState {
  layoutId: string;
  /** One symbol per chart slot, always MAX_CHARTS long; slots past the layout's count are kept for when it grows again. */
  symbols: string[];
  /** The chart the watchlist and keyboard shortcuts act on. */
  active: number;

  setLayout: (id: string) => void;
  setActive: (index: number) => void;
  /** Sets the symbol of chart `index` (the active one by default). */
  setSymbol: (symbol: string, index?: number) => void;
}

const clampActive = (active: number, layoutId: string) => Math.min(active, chartCount(layoutById(layoutId)) - 1);

/** The Chart page's multi-chart layout, kept in this browser. */
export const useChartLayout = create<ChartLayoutState>()(
  persist(
    (set) => ({
      layoutId: '1',
      symbols: DEFAULT_SYMBOLS,
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
    }),
    {
      name: 'option-builder-chart-layout',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ChartLayoutState>;
        const layoutId = layoutById(p.layoutId ?? current.layoutId).id;
        const symbols = DEFAULT_SYMBOLS.map((d, i) => (typeof p.symbols?.[i] === 'string' && p.symbols[i] ? p.symbols[i] : d));
        return { ...current, layoutId, symbols, active: clampActive(Math.max(0, p.active ?? 0), layoutId) };
      },
    },
  ),
);
