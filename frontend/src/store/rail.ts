import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { PageId } from '../components/tabs';

/** The right rail's own choices: which pages are pinned to it, and whether the chart's watchlist shows. */
interface RailState {
  pins: PageId[];
  watchlistOpen: boolean;
  togglePin: (page: PageId) => void;
  toggleWatchlist: () => void;
}

export const DEFAULT_PINS: PageId[] = ['builder', 'chart', 'chain', 'oi'];

export const useRail = create<RailState>()(
  persist(
    (set) => ({
      pins: DEFAULT_PINS,
      watchlistOpen: true,
      togglePin: (page) => set((s) => ({ pins: s.pins.includes(page) ? s.pins.filter((p) => p !== page) : [...s.pins, page] })),
      toggleWatchlist: () => set((s) => ({ watchlistOpen: !s.watchlistOpen })),
    }),
    {
      name: 'option-builder-rail',
      version: 1,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
