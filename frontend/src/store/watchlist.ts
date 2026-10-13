import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

const DEFAULT_SYMBOLS = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'RELIANCE', 'HDFCBANK', 'TCS', 'INFY'];
const MAX_SYMBOLS = 30;
const MAX_LISTS = 20;

export interface Watchlist {
  id: string;
  name: string;
  symbols: string[];
}

interface WatchlistState {
  lists: Watchlist[];
  activeId: string;

  /** Symbols of the active list. */
  add: (symbol: string) => void;
  remove: (symbol: string) => void;

  select: (id: string) => void;
  /** Creates "Watchlist N", makes it active and returns its id. */
  create: () => string;
  rename: (id: string, name: string) => void;
  /** The last remaining list can't be deleted. */
  removeList: (id: string) => void;
}

const newId = () => crypto.randomUUID();
const first: Watchlist = { id: 'default', name: 'Watchlist', symbols: DEFAULT_SYMBOLS };

/** "Watchlist 1", "Watchlist 2", … — the lowest number not already used. */
export function nextListName(lists: Watchlist[]): string {
  const used = new Set(lists.map((l) => l.name.trim().toLowerCase()));
  for (let n = 1; ; n++) if (!used.has(`watchlist ${n}`)) return `Watchlist ${n}`;
}

const patchActive = (s: WatchlistState, fn: (symbols: string[]) => string[]) => ({
  lists: s.lists.map((l) => (l.id === s.activeId ? { ...l, symbols: fn(l.symbols) } : l)),
});

/** The Chart page's watchlists, kept in this browser. */
export const useWatchlist = create<WatchlistState>()(
  persist(
    (set, get) => ({
      lists: [first],
      activeId: first.id,

      add: (symbol) =>
        set((s) => patchActive(s, (syms) => (syms.includes(symbol) || syms.length >= MAX_SYMBOLS ? syms : [...syms, symbol]))),
      remove: (symbol) => set((s) => patchActive(s, (syms) => syms.filter((x) => x !== symbol))),

      select: (id) => set((s) => (s.lists.some((l) => l.id === id) ? { activeId: id } : s)),
      create: () => {
        const { lists } = get();
        if (lists.length >= MAX_LISTS) return get().activeId;
        const list: Watchlist = { id: newId(), name: nextListName(lists), symbols: [] };
        set({ lists: [...lists, list], activeId: list.id });
        return list.id;
      },
      rename: (id, name) => {
        const clean = name.trim().replace(/\s+/g, ' ').slice(0, 40);
        if (clean) set((s) => ({ lists: s.lists.map((l) => (l.id === id ? { ...l, name: clean } : l)) }));
      },
      removeList: (id) =>
        set((s) => {
          if (s.lists.length <= 1) return s;
          const lists = s.lists.filter((l) => l.id !== id);
          return { lists, activeId: s.activeId === id ? lists[0].id : s.activeId };
        }),
    }),
    {
      name: 'option-builder-watchlist',
      version: 2,
      storage: createJSONStorage(() => localStorage),
      // v1 kept a single list of symbols: carry it over as the first watchlist.
      migrate: (persisted, version) => {
        if (version < 2) {
          const symbols = (persisted as { symbols?: unknown })?.symbols;
          return { lists: [{ ...first, symbols: Array.isArray(symbols) ? symbols : DEFAULT_SYMBOLS }], activeId: first.id };
        }
        return persisted as WatchlistState;
      },
    },
  ),
);

/** The active list, falling back to the first if the stored id is stale. */
export const activeList = (s: Pick<WatchlistState, 'lists' | 'activeId'>): Watchlist => s.lists.find((l) => l.id === s.activeId) ?? s.lists[0];
