import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { api, errorMessage } from '../../api/client';
import type { FutureContract, PortfolioTxn, SymbolInfo } from '../../api/types';
import { Button, inputClass } from '../../components/ui';
import { formatExpiry } from '../../domain/dates';
import { istDate, validateTxn } from '../../domain/portfolio';
import { inr } from '../../lib/format';

export interface TxnDraft {
  kind: 'STOCK' | 'FUT';
  side: 'BUY' | 'SELL';
  symbol?: string;
  expiry?: string;
  qty?: number;
}

const field = `${inputClass} h-9 w-full text-sm`;
const today = () => istDate(Math.floor(Date.now() / 1000));

function Toggle<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; label: string; tone?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-md border border-[var(--border)] p-0.5">
      {options.map((o) => {
        const on = o.v === value;
        return (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.v)}
            className="min-h-8 flex-1 rounded px-3 text-xs font-semibold transition-colors"
            style={{ background: on ? (o.tone ? `color-mix(in srgb, ${o.tone} 16%, transparent)` : 'var(--surface-sunken)') : undefined, color: on ? (o.tone ?? 'var(--text-primary)') : 'var(--text-muted)' }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Modal form for one buy or sell. Validates against the portfolio before saving. */
export function TransactionDialog({
  initial,
  existing,
  symbols,
  livePrice,
  onSave,
  onClose,
}: {
  initial: TxnDraft;
  existing: PortfolioTxn[];
  symbols: SymbolInfo[];
  livePrice: (symbol: string) => number | null;
  onSave: (txn: PortfolioTxn) => Promise<void>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState(initial.kind);
  const [side, setSide] = useState(initial.side);
  const [symbol, setSymbol] = useState(initial.symbol ?? '');
  const [date, setDate] = useState(today);
  const [qty, setQty] = useState(initial.qty ? String(initial.qty) : '');
  const [price, setPrice] = useState('');
  const [fees, setFees] = useState('');
  const [note, setNote] = useState('');
  const [contracts, setContracts] = useState<FutureContract[] | null>(null);
  const [contractError, setContractError] = useState<string | null>(null);
  const [expiry, setExpiry] = useState(initial.expiry ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const sym = symbol.trim().toUpperCase();
  const contract = contracts?.find((c) => c.expiry === expiry) ?? null;
  // An existing position (e.g. "Exit") keeps its own expiry and lot size even if the contract has expired.
  const existingFut = existing.find((t) => t.kind === 'FUT' && t.symbol === sym && t.expiry === expiry);
  const lotSize = contract?.lotSize ?? existingFut?.lotSize ?? 0;

  useEffect(() => {
    box.current?.querySelector<HTMLElement>('input, button')?.focus();
  }, []);

  // Futures need a contract list for the symbol.
  useEffect(() => {
    if (kind !== 'FUT' || !/^[A-Z0-9&_-]{1,20}$/.test(sym)) {
      setContracts(null);
      return;
    }
    let cancelled = false;
    setContractError(null);
    const t = window.setTimeout(() => {
      api
        .futures(sym)
        .then((r) => {
          if (cancelled) return;
          setContracts(r.contracts);
          setExpiry((e) => (e && (r.contracts.some((c) => c.expiry === e) || initial.expiry === e) ? e : (r.contracts[0]?.expiry ?? '')));
        })
        .catch((e) => !cancelled && setContractError(errorMessage(e)));
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [kind, sym, initial.expiry]);

  const ltp = sym ? livePrice(sym) : null;
  const total = (Number(qty) || 0) * (kind === 'FUT' ? lotSize : 1) * (Number(price) || 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const txn: PortfolioTxn = {
      id: crypto.randomUUID(),
      kind,
      side,
      symbol: sym,
      date,
      qty: Number(qty),
      price: Number(price),
      fees: fees === '' ? 0 : Number(fees),
      ...(kind === 'FUT' ? { expiry, lotSize, instrumentKey: contract?.instrumentKey ?? existingFut?.instrumentKey ?? null } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    if (date > today()) return setError('The date can’t be in the future.');
    const problem = validateTxn(existing, txn);
    if (problem) return setError(problem);
    setSaving(true);
    try {
      await onSave(txn);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose} onKeyDown={onKeyDown}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="txn-title"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full overflow-auto rounded-t-xl border border-[var(--border-strong)] bg-[var(--surface-raised)] p-4 shadow-2xl sm:max-w-md sm:rounded-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="txn-title" className="text-base font-semibold">
            Add transaction
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
          <div className="grid grid-cols-2 gap-2">
            <Toggle label="Side" value={side} onChange={setSide} options={[{ v: 'BUY', label: 'Buy', tone: 'var(--good-text)' }, { v: 'SELL', label: 'Sell', tone: 'var(--critical)' }]} />
            <Toggle label="Instrument" value={kind} onChange={(k) => { setKind(k); setError(null); }} options={[{ v: 'STOCK', label: 'Stock' }, { v: 'FUT', label: 'Future' }]} />
          </div>

          <label className="text-[11px] text-[var(--text-secondary)]">
            {kind === 'FUT' ? 'Underlying' : 'Symbol (NSE)'}
            <input
              className={field}
              value={symbol}
              onChange={(e) => { setSymbol(e.target.value.toUpperCase()); setError(null); }}
              list="portfolio-symbols"
              placeholder={kind === 'FUT' ? 'NIFTY' : 'HDFCBANK'}
              autoCapitalize="characters"
              spellCheck={false}
              required
            />
            <datalist id="portfolio-symbols">
              {symbols.map((s) => (
                <option key={s.symbol} value={s.symbol}>
                  {s.label}
                </option>
              ))}
            </datalist>
          </label>

          {kind === 'FUT' && (
            <label className="text-[11px] text-[var(--text-secondary)]">
              Contract
              <select className={field} value={expiry} onChange={(e) => setExpiry(e.target.value)} disabled={!contracts && !existingFut}>
                {initial.expiry && existingFut && !contracts?.some((c) => c.expiry === initial.expiry) && (
                  <option value={initial.expiry}>{formatExpiry(initial.expiry)} (held)</option>
                )}
                {(contracts ?? []).map((c) => (
                  <option key={c.expiry} value={c.expiry}>
                    {formatExpiry(c.expiry)} · lot {c.lotSize}
                  </option>
                ))}
                {!contracts?.length && !existingFut && <option value="">{contractError ? 'Couldn’t load contracts' : sym ? 'No futures for this symbol' : 'Enter an underlying'}</option>}
              </select>
              {contractError && <span className="text-[var(--critical)]">{contractError}</span>}
            </label>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-[var(--text-secondary)]">
              {kind === 'FUT' ? `Lots${lotSize ? ` (× ${lotSize})` : ''}` : 'Quantity'}
              <input className={field} type="number" inputMode="numeric" min={1} step={1} value={qty} onChange={(e) => { setQty(e.target.value); setError(null); }} required />
            </label>
            <label className="text-[11px] text-[var(--text-secondary)]">
              Date
              <input className={field} type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} required />
            </label>
            <label className="text-[11px] text-[var(--text-secondary)]">
              <span className="flex items-center justify-between">
                Price
                {ltp !== null && (
                  <button type="button" className="text-[var(--series-blue)] hover:underline" onClick={() => setPrice(String(ltp))}>
                    Use {kind === 'FUT' ? 'spot' : 'LTP'} {ltp.toLocaleString('en-IN')}
                  </button>
                )}
              </span>
              <input className={field} type="number" inputMode="decimal" min={0} step="0.05" value={price} onChange={(e) => { setPrice(e.target.value); setError(null); }} required />
            </label>
            <label className="text-[11px] text-[var(--text-secondary)]">
              Fees and taxes (optional)
              <input className={field} type="number" inputMode="decimal" min={0} step="0.01" value={fees} onChange={(e) => setFees(e.target.value)} placeholder="0" />
            </label>
          </div>

          <label className="text-[11px] text-[var(--text-secondary)]">
            Note (optional)
            <input className={field} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Bought on results dip" />
          </label>

          {error && (
            <div role="alert" className="rounded px-3 py-2 text-xs" style={{ background: 'var(--critical-fill)', color: 'var(--critical)' }}>
              {error}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-xs text-[var(--text-muted)] tabular">{total > 0 ? `${kind === 'FUT' ? 'Notional' : 'Total'} ${inr(total)}` : ''}</span>
            <div className="flex gap-2">
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={saving} className="min-w-20">
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
