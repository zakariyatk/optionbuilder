import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ChartStyle } from '../chartSettingsStore';
import { MAX_COMPARE } from '../compare';

/**
 * The phone chart's choices. Interval, chart type and compared symbols are
 * kept per symbol, so NIFTY can stay on 5m candles while gold stays on a
 * daily line; drawings are per symbol too (chartMemory.ts). Kept in this browser.
 */

export type Magnet = 'off' | 'weak' | 'strong';

export interface SymbolPrefs {
  tf?: string;
  style?: ChartStyle;
  compare?: string[];
}

const DEFAULT_TF = '15m';
const MAX_SYMBOLS = 200;

interface MobilePrefsState {
  bySymbol: Record<string, SymbolPrefs>;
  /** Drawing points snap to the bar's open / high / low / close. */
  magnet: Magnet;
  /** A drawing tool stays picked after one drawing, for drawing several. */
  keepDrawing: boolean;
  /** Symbols picked recently, newest first, for the search sheet. */
  recent: string[];
  set: (symbol: string, patch: SymbolPrefs) => void;
  addCompare: (symbol: string, other: string) => void;
  removeCompare: (symbol: string, other: string) => void;
  setMagnet: (m: Magnet) => void;
  setKeepDrawing: (on: boolean) => void;
  touch: (symbol: string) => void;
}

/** The interval / chart type / compare list for `symbol`, with defaults filled in. */
export function prefsFor(state: Pick<MobilePrefsState, 'bySymbol'>, symbol: string, fallbackStyle: ChartStyle) {
  const p = state.bySymbol[symbol] ?? {};
  return { tf: p.tf ?? DEFAULT_TF, style: p.style ?? fallbackStyle, compare: p.compare ?? [] };
}

/** Keeps the most recently changed symbols when the map grows too big. */
const trim = (by: Record<string, SymbolPrefs>, keep: string) => {
  const keys = Object.keys(by);
  if (keys.length <= MAX_SYMBOLS) return by;
  const next = { ...by };
  for (const k of keys.slice(0, keys.length - MAX_SYMBOLS)) if (k !== keep) delete next[k];
  return next;
};

export const useMobilePrefs = create<MobilePrefsState>()(
  persist(
    (set) => ({
      bySymbol: {},
      magnet: 'off',
      keepDrawing: false,
      recent: [],
      set: (symbol, patch) =>
        set((s) => {
          // Re-inserted, so the symbol counts as the most recently used when trimming.
          const { [symbol]: prev, ...rest } = s.bySymbol;
          return { bySymbol: trim({ ...rest, [symbol]: { ...prev, ...patch } }, symbol) };
        }),
      addCompare: (symbol, other) =>
        set((s) => {
          const cur = s.bySymbol[symbol]?.compare ?? [];
          if (other === symbol || cur.includes(other) || cur.length >= MAX_COMPARE) return s;
          return { bySymbol: { ...s.bySymbol, [symbol]: { ...s.bySymbol[symbol], compare: [...cur, other] } } };
        }),
      removeCompare: (symbol, other) =>
        set((s) => ({
          bySymbol: { ...s.bySymbol, [symbol]: { ...s.bySymbol[symbol], compare: (s.bySymbol[symbol]?.compare ?? []).filter((c) => c !== other) } },
        })),
      setMagnet: (magnet) => set({ magnet }),
      setKeepDrawing: (keepDrawing) => set({ keepDrawing }),
      touch: (symbol) => set((s) => ({ recent: [symbol, ...s.recent.filter((r) => r !== symbol)].slice(0, 12) })),
    }),
    { name: 'option-builder-mobile-chart', version: 1, storage: createJSONStorage(() => localStorage) },
  ),
);
