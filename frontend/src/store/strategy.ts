import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Leg, NewLeg } from '../domain/types';

export interface SavedStrategy {
  id: string;
  name: string;
  symbol: string;
  legs: Leg[];
  savedAt: number;
}

interface StrategyState {
  symbol: string;
  lotSize: number;
  legs: Leg[];
  saved: SavedStrategy[];

  setSymbol: (symbol: string, lotSize: number) => void;
  addLeg: (leg: NewLeg) => void;
  addLegs: (legs: NewLeg[]) => void;
  replaceLegs: (legs: NewLeg[]) => void;
  updateLeg: (id: string, patch: Partial<Leg>) => void;
  removeLeg: (id: string) => void;
  toggleLegAction: (id: string) => void;
  clearLegs: () => void;

  saveStrategy: (name: string) => void;
  loadStrategy: (id: string) => void;
  deleteStrategy: (id: string) => void;
}

const newId = () => crypto.randomUUID();
const withIds = (legs: NewLeg[]): Leg[] => legs.map((l) => ({ ...l, id: newId() }));

/**
 * The working strategy and the user's saved strategies. Persisted to
 * localStorage so a reload — or the daily Upstox reconnect — doesn't wipe the
 * position being built.
 */
export const useStrategy = create<StrategyState>()(
  persist(
    (set, get) => ({
      symbol: 'NIFTY',
      lotSize: 65,
      legs: [],
      saved: [],

      // Strikes and premiums don't carry across underlyings, so switching clears the legs.
      setSymbol: (symbol, lotSize) =>
        set((s) => (s.symbol === symbol ? { lotSize } : { symbol, lotSize, legs: [] })),
      addLeg: (leg) => set((s) => ({ legs: [...s.legs, { ...leg, id: newId() }] })),
      addLegs: (legs) => set((s) => ({ legs: [...s.legs, ...withIds(legs)] })),
      replaceLegs: (legs) => set({ legs: withIds(legs) }),
      updateLeg: (id, patch) => set((s) => ({ legs: s.legs.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),
      removeLeg: (id) => set((s) => ({ legs: s.legs.filter((l) => l.id !== id) })),
      toggleLegAction: (id) =>
        set((s) => ({
          legs: s.legs.map((l) => (l.id === id ? { ...l, action: l.action === 'BUY' ? 'SELL' : 'BUY' } : l)),
        })),
      clearLegs: () => set({ legs: [] }),

      saveStrategy: (name) => {
        const { symbol, legs, saved } = get();
        if (legs.length === 0) return;
        const entry: SavedStrategy = { id: newId(), name: name.trim() || 'Untitled', symbol, legs, savedAt: Date.now() };
        set({ saved: [entry, ...saved].slice(0, 50) });
      },
      loadStrategy: (id) => {
        const entry = get().saved.find((s) => s.id === id);
        if (!entry) return;
        set({ symbol: entry.symbol, legs: withIds(entry.legs) });
      },
      deleteStrategy: (id) => set((s) => ({ saved: s.saved.filter((x) => x.id !== id) })),
    }),
    {
      name: 'option-builder-strategy',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ symbol, lotSize, legs, saved }) => ({ symbol, lotSize, legs, saved }),
    },
  ),
);
