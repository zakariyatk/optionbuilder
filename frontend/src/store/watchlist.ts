import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

const DEFAULT_WATCHLIST = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'RELIANCE', 'HDFCBANK', 'TCS', 'INFY'];
const MAX_WATCHLIST = 30;

interface WatchlistState {
  symbols: string[];
  add: (symbol: string) => void;
  remove: (symbol: string) => void;
}

/** The Chart page's watchlist, kept in this browser. */
export const useWatchlist = create<WatchlistState>()(
  persist(
    (set) => ({
      symbols: DEFAULT_WATCHLIST,
      add: (symbol) =>
        set((s) => (s.symbols.includes(symbol) || s.symbols.length >= MAX_WATCHLIST ? s : { symbols: [...s.symbols, symbol] })),
      remove: (symbol) => set((s) => ({ symbols: s.symbols.filter((x) => x !== symbol) })),
    }),
    { name: 'option-builder-watchlist', version: 1, storage: createJSONStorage(() => localStorage) },
  ),
);
