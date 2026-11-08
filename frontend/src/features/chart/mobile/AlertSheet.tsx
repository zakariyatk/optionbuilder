import { useState } from 'react';
import { BellRing, Minus, Plus, X } from 'lucide-react';
import { num } from '../../../lib/format';
import { displaySymbol } from '../../../lib/markets';
import { activeAlerts, useAlerts } from '../../../store/alerts';
import { armAlertSound } from '../../alerts/alertSignals';
import { priceStep } from './mobileChartUtils';
import { Sheet } from './Sheet';


/**
 * Price alerts for the symbol on the chart: set one at a price (it starts at
 * the last price; nudge it with − / +), and the ones waiting, to delete. An
 * alert fires when the price crosses its level, from either side.
 */
export function AlertSheet({
  open,
  onClose,
  symbol,
  last,
  precision,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  symbol: string;
  last: number | null;
  precision: number;
  /** The alerts changed: redraw their lines on the chart. */
  onChanged: () => void;
}) {
  const alerts = useAlerts((s) => s.alerts);
  const waiting = activeAlerts(alerts, symbol).sort((a, b) => b.price - a.price);
  return (
    <Sheet open={open} onClose={onClose} title={`Alerts · ${displaySymbol(symbol)}`}>
      {/* Remounted each time the sheet opens, so the price starts at the latest. */}
      {open && <NewAlert symbol={symbol} last={last} precision={precision} onChanged={onChanged} />}
      <h3 className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Waiting ({waiting.length})</h3>
      {waiting.length === 0 && <p className="px-4 pb-4 text-sm text-[var(--text-muted)]">No alerts on {displaySymbol(symbol)} yet.</p>}
      {waiting.map((a) => {
        const dist = last ? ((a.price - last) / last) * 100 : null;
        return (
          <div key={a.id} className="flex min-h-12 items-center gap-3 pl-4 pr-1">
            <BellRing size={18} className="shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium tabular">Crossing {num(a.price, precision)}</div>
              {dist !== null && (
                <div className="text-[11px] text-[var(--text-muted)] tabular">
                  {Math.abs(dist).toFixed(2)}% {dist >= 0 ? 'above' : 'below'} last price
                </div>
              )}
            </div>
            <button
              type="button"
              aria-label={`Delete alert at ${num(a.price, precision)}`}
              onClick={() => {
                useAlerts.getState().remove(a.id);
                onChanged();
              }}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-[var(--text-secondary)] active:bg-[var(--surface-sunken)]"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </Sheet>
  );
}

function NewAlert({ symbol, last, precision, onChanged }: { symbol: string; last: number | null; precision: number; onChanged: () => void }) {
  const [text, setText] = useState(() => (last ? last.toFixed(precision) : ''));
  const [done, setDone] = useState('');
  const price = Number(text);
  const valid = text.trim() !== '' && Number.isFinite(price) && price > 0;
  const step = priceStep(last ?? price);
  const nudge = (dir: 1 | -1) => {
    const base = valid ? price : (last ?? 0);
    const next = Math.max(step, Math.round((base + dir * step) / step) * step);
    setText(next.toFixed(precision));
    setDone('');
  };
  const create = () => {
    if (!valid) return;
    armAlertSound();
    useAlerts.getState().add(symbol, price, last);
    onChanged();
    setDone(`Alert set at ${num(price, precision)}`);
  };
  return (
    <form
      className="px-4 pt-1"
      onSubmit={(e) => {
        e.preventDefault();
        create();
      }}
    >
      <label htmlFor="ob-alert-price" className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        Price crosses
      </label>
      <div className="mt-1 flex items-center gap-2">
        <button type="button" aria-label="Lower price" onClick={() => nudge(-1)} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-[var(--border-strong)] active:bg-[var(--surface-sunken)]">
          <Minus size={18} aria-hidden="true" />
        </button>
        <input
          id="ob-alert-price"
          inputMode="decimal"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setDone('');
          }}
          aria-invalid={!valid}
          className="h-12 min-w-0 flex-1 rounded-lg border border-[var(--border-strong)] bg-transparent px-3 text-center text-lg font-semibold tabular outline-none focus:border-[var(--series-blue)]"
        />
        <button type="button" aria-label="Raise price" onClick={() => nudge(1)} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-[var(--border-strong)] active:bg-[var(--surface-sunken)]">
          <Plus size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="mt-1 flex h-5 items-center text-[11px] text-[var(--text-muted)] tabular">
        {done ? (
          <span className="text-[var(--good-text)]">{done}</span>
        ) : last && valid ? (
          `${(((price - last) / last) * 100).toFixed(2)}% from last ${num(last, precision)}`
        ) : (
          'Step ' + num(step, precision)
        )}
      </div>
      <button type="submit" disabled={!valid} className="mt-1 h-12 w-full rounded-lg bg-[var(--series-blue)] text-sm font-semibold text-white disabled:opacity-40">
        Create alert
      </button>
      <p className="mt-2 text-[11px] text-[var(--text-muted)]">Drag an alert's line on the chart to move it.</p>
    </form>
  );
}
