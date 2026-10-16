import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Price alerts, TradingView-style "Crossing": an alert fires the first time
 * the price reaches its level from whichever side it started on, then waits
 * on screen (and in this list) until dismissed.
 */
export interface PriceAlert {
  id: string;
  symbol: string;
  price: number;
  /**
   * Whether the market was above the level when it was set (or last moved).
   * null until a price is known — the first quote decides.
   */
  above: boolean | null;
  createdAt: number;
  /** Set once it has fired. */
  triggeredAt: number | null;
  /** The price that set it off. */
  triggerPrice: number | null;
}

const MAX_ALERTS = 100;

const sideOf = (level: number, last: number | null | undefined): boolean | null =>
  last == null || !Number.isFinite(last) || last === level ? null : last > level;

/** True once `price` has reached the alert's level from the side it started on. */
export function crossed(alert: Pick<PriceAlert, 'price' | 'above'>, price: number): boolean {
  if (alert.above === null) return false;
  return alert.above ? price <= alert.price : price >= alert.price;
}

interface AlertsState {
  alerts: PriceAlert[];
  /** `last` is the current price, which decides the side the alert waits on. Returns the new alert. */
  add: (symbol: string, price: number, last: number | null, id?: string) => PriceAlert;
  move: (id: string, price: number, last: number | null) => void;
  remove: (id: string) => void;
  /**
   * Feeds a live price for a symbol: alerts that haven't picked a side take
   * this one, crossed ones fire. Returns the alerts that just fired.
   */
  observe: (symbol: string, price: number, now?: number) => PriceAlert[];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export const useAlerts = create<AlertsState>()(
  persist(
    (set, get) => ({
      alerts: [],

      add: (symbol, price, last, id = crypto.randomUUID()) => {
        const level = round2(price);
        const alert: PriceAlert = { id, symbol, price: level, above: sideOf(level, last), createdAt: Date.now(), triggeredAt: null, triggerPrice: null };
        set((s) => ({ alerts: [...s.alerts.filter((a) => a.id !== id), alert].slice(-MAX_ALERTS) }));
        return alert;
      },

      move: (id, price, last) =>
        set((s) => ({
          alerts: s.alerts.map((a) => {
            if (a.id !== id || a.triggeredAt !== null) return a;
            const level = round2(price);
            return { ...a, price: level, above: sideOf(level, last) ?? a.above };
          }),
        })),

      remove: (id) => set((s) => ({ alerts: s.alerts.filter((a) => a.id !== id) })),

      observe: (symbol, price, now = Date.now()) => {
        const fired: PriceAlert[] = [];
        const alerts = get().alerts.map((a) => {
          if (a.symbol !== symbol || a.triggeredAt !== null) return a;
          if (a.above === null) {
            const above = sideOf(a.price, price);
            return above === null ? a : { ...a, above };
          }
          if (!crossed(a, price)) return a;
          const done = { ...a, triggeredAt: now, triggerPrice: price };
          fired.push(done);
          return done;
        });
        set({ alerts });
        return fired;
      },
    }),
    { name: 'option-builder-alerts', version: 1, storage: createJSONStorage(() => localStorage) },
  ),
);

/** Alerts still waiting to fire. */
export const activeAlerts = (alerts: PriceAlert[], symbol?: string) =>
  alerts.filter((a) => a.triggeredAt === null && (symbol === undefined || a.symbol === symbol));
