import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { api, errorMessage } from '../../api/client';
import type { FutureContract, PortfolioTxn, SymbolInfo, UsSearchResult } from '../../api/types';
import { Button, inputClass } from '../../components/ui';
import { formatExpiry } from '../../domain/dates';
import { istDate, validateTxn } from '../../domain/portfolio';
import { inr } from '../../lib/format';
import { US_PREFIX, displaySymbol, isUs } from '../../lib/markets';
import { rememberName } from '../../lib/symbolNames';

const usd = (v: number) => `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

export interface TxnDraft {
  kind: 'STOCK' | 'FUT';
  side: 'BUY' | 'SELL';
  symbol?: string;
  expiry?: string;
  qty?: number;
  /** Set when editing: the transaction being changed (kept under the same id). */
  edit?: PortfolioTxn;
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

/**
 * Modal form for one buy or sell, new or edited. Validates against the rest of
 * the portfolio before saving; `existing` must exclude the transaction being edited.
 */
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
  const e0 = initial.edit;
  const [kind, setKind] = useState(e0?.kind ?? initial.kind);
  const [side, setSide] = useState(e0?.side ?? initial.side);
  const startSymbol = e0?.symbol ?? initial.symbol ?? '';
  const [market, setMarket] = useState<'IN' | 'US'>(isUs(startSymbol) ? 'US' : 'IN');
  /** What's typed: the ticker without the US: prefix (or a company name while searching). */
  const [symbol, setSymbol] = useState(displaySymbol(startSymbol));
  const [usResults, setUsResults] = useState<UsSearchResult[]>([]);
  const [usPicked, setUsPicked] = useState<UsSearchResult | null>(null);
  const [fx, setFx] = useState(e0?.fx ? String(e0.fx) : '');
  const [fxTouched, setFxTouched] = useState(!!e0?.fx);
  /** The rate is locked to the market close until it's double-clicked. */
  const [fxEditing, setFxEditing] = useState(false);
  const fxInput = useRef<HTMLInputElement>(null);
  const unlockFx = () => {
    setFxEditing(true);
    requestAnimationFrame(() => fxInput.current?.select());
  };
  const [fxSeries, setFxSeries] = useState<[number, number][] | null>(null);
  const [date, setDate] = useState(() => e0?.date ?? today());
  const [qty, setQty] = useState(e0 ? String(e0.qty) : initial.qty ? String(initial.qty) : '');
  const [price, setPrice] = useState(e0 ? String(e0.price) : '');
  const [fees, setFees] = useState(e0?.fees ? String(e0.fees) : '');
  const [note, setNote] = useState(e0?.note ?? '');
  const [contracts, setContracts] = useState<FutureContract[] | null>(null);
  const [contractError, setContractError] = useState<string | null>(null);
  /** A contract already held (Exit) or being edited — kept selectable even after it expires. */
  const heldExpiry = e0?.expiry ?? initial.expiry;
  const [expiry, setExpiry] = useState(heldExpiry ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const us = market === 'US' && kind === 'STOCK';
  const ticker = symbol.trim().toUpperCase();
  const sym = us ? US_PREFIX + ticker : ticker;
  const contract = contracts?.find((c) => c.expiry === expiry) ?? null;
  // An existing position (e.g. "Exit") keeps its own expiry and lot size even if the contract has expired.
  const existingFut = [...existing, ...(e0 ? [e0] : [])].find((t) => t.kind === 'FUT' && t.symbol === sym && t.expiry === expiry);
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
          setExpiry((e) => (e && (r.contracts.some((c) => c.expiry === e) || heldExpiry === e) ? e : (r.contracts[0]?.expiry ?? '')));
        })
        .catch((e) => !cancelled && setContractError(errorMessage(e)));
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [kind, sym, heldExpiry]);

  // Stocks: suggest matches (NSE or US, stocks and ETFs) as a symbol or company name is typed.
  useEffect(() => {
    if (kind !== 'STOCK' || ticker.length < 1 || usPicked) {
      setUsResults([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      const search = us ? api.searchUs : api.searchIndia;
      search(symbol.trim())
        .then((r) => !cancelled && setUsResults(r.results))
        .catch(() => !cancelled && setUsResults([]));
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [us, kind, ticker, symbol, usPicked]);

  // US: the USD/INR close on the transaction date, filled in until the user types their own.
  useEffect(() => {
    if (!us || fxSeries) return;
    let cancelled = false;
    api
      .history(['USDINR'], 'max')
      .then((r) => !cancelled && setFxSeries(r.series.USDINR?.points ?? []))
      .catch(() => !cancelled && setFxSeries([]));
    return () => {
      cancelled = true;
    };
  }, [us, fxSeries]);
  const fxOnDate = useMemo(() => {
    if (!fxSeries?.length) return null;
    let v: number | null = null;
    for (const [t, c] of fxSeries) {
      if (istDate(t) > date) break;
      v = c;
    }
    return v;
  }, [fxSeries, date]);
  useEffect(() => {
    if (us && !fxTouched && fxOnDate) setFx(fxOnDate.toFixed(4));
  }, [us, fxTouched, fxOnDate]);

  const ltp = sym ? livePrice(sym) : null;
  const total = (Number(qty) || 0) * (kind === 'FUT' ? lotSize : 1) * (Number(price) || 0);
  const totalLabel =
    total <= 0 ? '' : us ? `Total ${usd(total)}${Number(fx) > 0 ? ` ≈ ${inr(total * Number(fx))}` : ''}` : `${kind === 'FUT' ? 'Notional' : 'Total'} ${inr(total)}`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const txn: PortfolioTxn = {
      id: e0?.id ?? crypto.randomUUID(),
      kind,
      side,
      symbol: sym,
      date,
      qty: Number(qty),
      price: Number(price),
      fees: fees === '' ? 0 : Number(fees),
      ...(us ? { fx: Number(fx) } : {}),
      ...(kind === 'FUT' ? { expiry, lotSize, instrumentKey: contract?.instrumentKey ?? existingFut?.instrumentKey ?? null } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    if (date > today()) return setError('The date can’t be in the future.');
    // Typed a company name without picking it: there's no symbol yet.
    if (!/^[A-Z0-9&_.-]{1,20}$/.test(ticker)) return setError(kind === 'STOCK' ? 'Pick a stock from the suggestions, or type its exact symbol.' : 'Enter a symbol.');
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
            {e0 ? 'Edit transaction' : 'Add transaction'}
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
          {kind === 'STOCK' && (
            <Toggle
              label="Market"
              value={market}
              onChange={(m) => {
                setMarket(m);
                setSymbol('');
                setUsPicked(null);
                setError(null);
              }}
              options={[{ v: 'IN', label: 'India (NSE)' }, { v: 'US', label: 'US (NASDAQ / NYSE)' }]}
            />
          )}

          <label className="relative text-[11px] text-[var(--text-secondary)]">
            {kind === 'FUT' ? 'Underlying' : us ? 'Ticker or company (US)' : 'Symbol (NSE)'}
            <input
              className={field}
              value={symbol}
              onChange={(e) => {
                // Stocks can be searched by company name, so keep what's typed; futures take a symbol.
                setSymbol(kind === 'STOCK' ? e.target.value : e.target.value.toUpperCase());
                setUsPicked(null);
                setError(null);
              }}
              list={kind === 'FUT' ? 'portfolio-symbols' : undefined}
              placeholder={kind === 'FUT' ? 'NIFTY' : us ? 'AAPL or Apple' : 'HDFCBANK, Tata Motors or NIFTYBEES'}
              autoCapitalize="characters"
              spellCheck={false}
              required
            />
            {kind === 'STOCK' && usPicked && (
              <span className="mt-0.5 block text-[var(--text-muted)]">
                {usPicked.name} · {usPicked.exchange}
                {usPicked.type === 'ETF' ? ' · ETF' : ''}
              </span>
            )}
            {kind === 'STOCK' && usResults.length > 0 && (
              <ul aria-label={us ? 'Matching US stocks' : 'Matching NSE stocks and ETFs'} className="absolute inset-x-0 top-full z-10 mt-1 max-h-60 overflow-auto rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] py-1 shadow-xl">
                {usResults.map((r) => (
                  <li key={r.symbol}>
                    <button
                      type="button"
                      onClick={() => {
                        setSymbol(displaySymbol(r.symbol));
                        setUsPicked(r);
                        rememberName(r.symbol, r.name);
                        setUsResults([]);
                      }}
                      className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-xs hover:bg-[var(--surface-sunken)]"
                    >
                      <span className="w-16 shrink-0 font-semibold text-[var(--text-primary)]">{displaySymbol(r.symbol)}</span>
                      <span className="flex-1 truncate">{r.name}</span>
                      <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
                        {r.exchange}
                        {r.type === 'ETF' ? ' · ETF' : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
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
                {heldExpiry && existingFut && !contracts?.some((c) => c.expiry === heldExpiry) && (
                  <option value={heldExpiry}>{formatExpiry(heldExpiry)} (held)</option>
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
              {kind === 'FUT' ? `Lots${lotSize ? ` (× ${lotSize})` : ''}` : us ? 'Quantity (fractions OK)' : 'Quantity'}
              <input
                className={field}
                type="number"
                inputMode={us ? 'decimal' : 'numeric'}
                min={us ? 0.000001 : 1}
                step={us ? 'any' : 1}
                placeholder={us ? '0.5' : undefined}
                value={qty}
                onChange={(e) => { setQty(e.target.value); setError(null); }}
                required
              />
            </label>
            <label className="text-[11px] text-[var(--text-secondary)]">
              Date
              <input
                className={field}
                type="date"
                value={date}
                max={today()}
                onChange={(e) => {
                  setDate(e.target.value);
                  // A new date means that day's market rate, even if the old one was changed by hand.
                  setFxTouched(false);
                  setFxEditing(false);
                }}
                required
              />
            </label>
            <label className="text-[11px] text-[var(--text-secondary)]">
              <span className="flex items-center justify-between">
                {us ? 'Price ($)' : 'Price'}
                {ltp !== null && (
                  <button type="button" className="text-[var(--series-blue)] hover:underline" onClick={() => setPrice(String(ltp))}>
                    Use {kind === 'FUT' ? 'spot' : 'LTP'} {ltp.toLocaleString('en-IN')}
                  </button>
                )}
              </span>
              <input className={field} type="number" inputMode="decimal" min={0} step="0.05" value={price} onChange={(e) => { setPrice(e.target.value); setError(null); }} required />
            </label>
            <label className="text-[11px] text-[var(--text-secondary)]">
              {us ? 'Fees ($, optional)' : 'Fees and taxes (optional)'}
              <input className={field} type="number" inputMode="decimal" min={0} step="0.01" value={fees} onChange={(e) => setFees(e.target.value)} placeholder="0" />
            </label>
          </div>

          {us && (
            <label className="text-[11px] text-[var(--text-secondary)]">
              <span className="flex items-center justify-between">
                USD/INR on that date
                {fxTouched && fxOnDate && (
                  <button type="button" className="text-[var(--series-blue)] hover:underline" onClick={() => { setFxTouched(false); setFxEditing(false); setFx(fxOnDate.toFixed(4)); }}>
                    Use {fxOnDate.toFixed(2)} (market close)
                  </button>
                )}
              </span>
              {(() => {
                // Locked while it shows the market close; editable once double-clicked, or when there's no market rate to show.
                const locked = !fxEditing && !fxTouched && (fxSeries === null || fxOnDate !== null);
                return (
                  <>
                    <input
                      ref={fxInput}
                      className={`${field} ${locked ? 'cursor-pointer bg-[var(--surface-sunken)] text-[var(--text-secondary)]' : ''}`}
                      type="number"
                      inputMode="decimal"
                      min={10}
                      step="0.0001"
                      value={fx}
                      readOnly={locked}
                      aria-readonly={locked}
                      title={locked ? 'Double-click (or press Enter) to change the rate' : undefined}
                      onDoubleClick={() => locked && unlockFx()}
                      onKeyDown={(e) => {
                        if (locked && e.key === 'Enter') {
                          e.preventDefault();
                          unlockFx();
                        }
                      }}
                      onChange={(e) => {
                        setFx(e.target.value);
                        setFxTouched(true);
                        setError(null);
                      }}
                      placeholder={fxSeries === null ? 'Loading…' : '88.50'}
                      required
                    />
                    <span className="text-[var(--text-muted)]">
                      {locked
                        ? fxOnDate
                          ? `Market close for ${formatExpiry(date)} · double-click to change`
                          : 'Loading the market rate…'
                        : fxTouched
                          ? 'Your rate — e.g. what your bank or broker charged.'
                          : fxOnDate
                            ? 'Type the rate you were charged.'
                            : 'No market rate for this date — enter the rupees per dollar you paid.'}
                    </span>
                  </>
                );
              })()}
            </label>
          )}

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
            <span className="text-xs text-[var(--text-muted)] tabular">{totalLabel}</span>
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
