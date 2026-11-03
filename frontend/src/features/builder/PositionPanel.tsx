import { useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Ellipsis, Plus, Repeat, Trash2, X } from 'lucide-react';
import type { ChainRow } from '../../api/types';
import { chainSideFor, shiftLegStrike, sideMid } from '../../domain/analysis';
import { nearestRow } from '../../domain/chain';
import { daysToExpiry, formatExpiry } from '../../domain/dates';
import { isLinear, type Leg, type NewLeg } from '../../domain/types';
import { num } from '../../lib/format';
import { useMarket } from './market';
import { MenuItem, Popover, Stepper } from './parts';

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Price field that keeps a draft while typing and commits on blur / Enter. */
function FillInput({ value, onCommit, label }: { value: number; onCommit: (v: number) => void; label: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      value={draft ?? num(value)}
      onFocus={(e) => {
        setDraft(String(value));
        e.target.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const v = Number(draft?.replace(/,/g, ''));
        if (draft !== null && Number.isFinite(v) && v >= 0) onCommit(Math.round(v * 100) / 100);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
      className="ob-bare-input h-7 w-20 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2 text-right text-xs font-semibold tabular outline-none focus:border-[var(--focus)] pointer-coarse:h-10"
    />
  );
}

function LegRow({
  leg,
  symbol,
  spot,
  rows,
  chainExpiry,
  expiryDates,
  onUpdate,
  onRemove,
  onDuplicate,
}: {
  leg: Leg;
  symbol: string;
  spot: number | null;
  rows: ChainRow[] | null;
  chainExpiry: string | null;
  expiryDates: string[];
  onUpdate: (patch: Partial<Leg>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const mk = useMarket();
  const buy = leg.action === 'BUY';
  const side = chainSideFor(leg, rows, chainExpiry);
  const mid = sideMid(side);
  const option = !isLinear(leg.type);
  const step = mk.strikeStep(symbol, spot ?? (leg.strike || 100));
  const onChain = !!rows?.length && (!leg.expiry || !chainExpiry || leg.expiry === chainExpiry);

  const moveStrike = (dir: 1 | -1) => {
    if (onChain && rows) {
      const next = shiftLegStrike(leg, rows, chainExpiry, dir);
      onUpdate({ strike: next.strike, premium: next.premium, iv: next.iv, instrumentKey: next.instrumentKey, expiry: next.expiry });
    } else {
      onUpdate({ strike: Math.max(step, Math.round((leg.strike + dir * step) / step) * step), instrumentKey: null });
    }
  };
  const flipType = () => {
    const type = leg.type === 'CE' ? 'PE' : 'CE';
    if (onChain && rows) {
      const next = shiftLegStrike({ ...leg, type }, rows, chainExpiry, 0);
      onUpdate({ type, strike: next.strike, premium: next.premium, iv: next.iv, instrumentKey: next.instrumentKey });
    } else {
      onUpdate({ type, instrumentKey: null });
    }
  };
  const expiries = leg.expiry && !expiryDates.includes(leg.expiry) ? [leg.expiry, ...expiryDates] : expiryDates;

  return (
    <li className="flex flex-col gap-1.5 border-t border-[var(--border)] px-3 py-2.5 first:border-t-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onUpdate({ action: buy ? 'SELL' : 'BUY' })}
          title="Flip buy / sell"
          className="h-7 w-12 rounded-md text-xs font-semibold pointer-coarse:h-10"
          style={{ background: buy ? 'var(--good-fill)' : 'var(--critical-fill)', color: buy ? 'var(--good-text)' : 'var(--critical)' }}
        >
          {buy ? 'Buy' : 'Sell'}
        </button>

        {leg.type === 'EQ' ? (
          <Stepper
            label="shares"
            value={leg.lotSize.toLocaleString('en-IN')}
            width="w-12"
            onDec={() => onUpdate({ lots: 1, lotSize: Math.max(1, leg.lotSize - 1) })}
            onInc={() => onUpdate({ lots: 1, lotSize: leg.lotSize + 1 })}
            decDisabled={leg.lotSize <= 1}
          />
        ) : (
          <Stepper label={mk.unit.many} value={leg.lots} onDec={() => onUpdate({ lots: Math.max(1, leg.lots - 1) })} onInc={() => onUpdate({ lots: leg.lots + 1 })} decDisabled={leg.lots <= 1} />
        )}

        {option ? (
          <button
            type="button"
            onClick={flipType}
            title="Switch call / put"
            className="h-7 rounded-md border border-[var(--border)] px-2 text-xs font-semibold hover:border-[var(--border-strong)] pointer-coarse:h-10"
          >
            {leg.type}
          </button>
        ) : (
          <span className="rounded-md bg-[var(--surface-sunken)] px-2 py-1 text-xs font-semibold">{leg.type === 'EQ' ? 'Shares' : 'FUT'}</span>
        )}

        {option && (
          <Stepper
            label="strike"
            width="w-16"
            value={mk.id === 'US' ? String(leg.strike) : leg.strike.toLocaleString('en-IN')}
            decIcon={<ChevronLeft size={14} aria-hidden="true" />}
            incIcon={<ChevronRight size={14} aria-hidden="true" />}
            onDec={() => moveStrike(-1)}
            onInc={() => moveStrike(1)}
          />
        )}

        <div className="ml-auto">
          <Popover label="Leg options" align="right" triggerClass="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)] pointer-coarse:h-10 pointer-coarse:w-10" trigger={<Ellipsis size={16} aria-hidden="true" />}>
            {(close) => (
              <>
                <MenuItem
                  onClick={() => {
                    close();
                    onDuplicate();
                  }}
                >
                  <Copy size={14} aria-hidden="true" />
                  Duplicate
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    close();
                    onUpdate({ action: buy ? 'SELL' : 'BUY' });
                  }}
                >
                  <Repeat size={14} aria-hidden="true" />
                  Flip to {buy ? 'sell' : 'buy'}
                </MenuItem>
                <MenuItem
                  danger
                  onClick={() => {
                    close();
                    onRemove();
                  }}
                >
                  <X size={14} aria-hidden="true" />
                  Remove leg
                </MenuItem>
              </>
            )}
          </Popover>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
        {leg.type !== 'EQ' && expiries.length > 0 ? (
          <select
            aria-label="Leg expiry"
            value={leg.expiry ?? ''}
            onChange={(e) => onUpdate({ expiry: e.target.value || null, instrumentKey: null })}
            className="rounded bg-transparent py-0.5 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {!leg.expiry && <option value="">No expiry</option>}
            {expiries.map((e) => {
              const d = daysToExpiry(e);
              return (
                <option key={e} value={e}>
                  {formatExpiry(e)}
                  {d !== null ? ` · ${d}d` : ''}
                </option>
              );
            })}
          </select>
        ) : (
          leg.type !== 'EQ' && <span>{leg.expiry ? formatExpiry(leg.expiry) : 'No expiry'}</span>
        )}
        {leg.type !== 'EQ' && (
          <span className="tabular">
            {mk.id === 'US' && option ? `${leg.lots * leg.lotSize} shares` : `qty ${(leg.lots * leg.lotSize).toLocaleString('en-IN')}`}
          </span>
        )}
        {leg.iv ? <span className="tabular">IV {leg.iv.toFixed(1)}%</span> : null}
        <span className="ml-auto flex items-center gap-2">
          {mid !== null && (
            <button type="button" className="tabular hover:text-[var(--text-primary)] hover:underline" title="Use the market mid as the fill" onClick={() => onUpdate({ premium: Math.round(mid * 100) / 100 })}>
              mid {num(mid)}
            </button>
          )}
          <span>{leg.type === 'EQ' || leg.type === 'FUT' ? 'price' : 'fill'}</span>
          <FillInput value={leg.premium} label={`${leg.type} ${leg.strike} fill price`} onCommit={(premium) => onUpdate({ premium })} />
        </span>
      </div>
    </li>
  );
}

export function PositionPanel({
  legs,
  symbol,
  spot,
  lotSize,
  rows,
  chainExpiry,
  expiryDates,
  strategyName,
  onUpdate,
  onRemove,
  onAdd,
  onClear,
  onOpenChain,
}: {
  legs: Leg[];
  symbol: string;
  spot: number | null;
  lotSize: number;
  rows: ChainRow[] | null;
  chainExpiry: string | null;
  expiryDates: string[];
  strategyName: string | null;
  onUpdate: (id: string, patch: Partial<Leg>) => void;
  onRemove: (id: string) => void;
  onAdd: (leg: NewLeg) => void;
  onClear: () => void;
  onOpenChain: () => void;
}) {
  const mk = useMarket();
  const options = legs.filter((l) => !isLinear(l.type));
  const multiple = legs.length ? legs.reduce((g, l) => gcd(g, l.lots), legs[0].lots) : 1;

  const shiftAll = (dir: 1 | -1) => {
    if (!rows?.length) return;
    // Refuse a shift that would push any leg off the chain, so the shape stays intact.
    const moved = legs.map((l) => (isLinear(l.type) ? l : shiftLegStrike(l, rows, chainExpiry, dir)));
    const onChain = (l: Leg) => !isLinear(l.type) && (!l.expiry || !chainExpiry || l.expiry === chainExpiry);
    if (moved.some((m, i) => onChain(legs[i]) && m.strike === legs[i].strike)) return;
    moved.forEach((m) => onUpdate(m.id, { strike: m.strike, premium: m.premium, iv: m.iv, instrumentKey: m.instrumentKey, expiry: m.expiry }));
  };
  const setMultiple = (next: number) => {
    if (next < 1) return;
    legs.forEach((l) => onUpdate(l.id, { lots: (l.lots / multiple) * next }));
  };
  const addOption = () => {
    const atm = rows?.length && spot ? nearestRow(rows, spot) : null;
    const step = mk.strikeStep(symbol, spot ?? 100);
    const strike = atm?.strike ?? Math.round((spot ?? 100) / step) * step;
    onAdd({
      action: 'BUY',
      type: 'CE',
      strike,
      premium: Number((sideMid(atm?.call) ?? 0).toFixed(2)),
      lots: 1,
      lotSize,
      instrumentKey: atm?.call?.instrumentKey ?? null,
      iv: atm?.call?.iv ?? null,
      expiry: chainExpiry,
    });
  };
  const addShares = () => onAdd({ action: 'BUY', type: 'EQ', strike: 0, premium: Number((spot ?? 0).toFixed(2)), lots: 1, lotSize });
  const addFuture = () => onAdd({ action: 'BUY', type: 'FUT', strike: 0, premium: Number((spot ?? 0).toFixed(2)), lots: 1, lotSize, expiry: chainExpiry });

  const headBtn =
    'flex h-7 items-center justify-center gap-1 rounded-md px-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)] disabled:opacity-30 pointer-coarse:h-10 pointer-coarse:min-w-10';

  return (
    <section className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface-card)]" aria-label="Position">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        {legs.length === 0 ? (
          <h2 className="text-sm font-semibold">Position</h2>
        ) : (
          <span className="rounded-md bg-[color-mix(in_srgb,var(--series-blue)_12%,transparent)] px-2 py-0.5 text-xs font-medium text-[var(--series-blue)]">
            {strategyName ?? `Custom · ${legs.length} leg${legs.length > 1 ? 's' : ''}`}
          </span>
        )}
        {legs.length > 0 && (
          <div className="ml-auto flex items-center gap-1">
            <button type="button" className={headBtn} onClick={() => shiftAll(-1)} disabled={!rows?.length || options.length === 0} title="Shift every strike one step down" aria-label="Shift strikes down">
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <button type="button" className={headBtn} onClick={() => shiftAll(1)} disabled={!rows?.length || options.length === 0} title="Shift every strike one step up" aria-label="Shift strikes up">
              <ChevronRight size={16} aria-hidden="true" />
            </button>
            <Stepper label="position size" value={`×${multiple}`} onDec={() => setMultiple(multiple - 1)} onInc={() => setMultiple(multiple + 1)} decDisabled={multiple <= 1} />
            <button type="button" className={headBtn} onClick={addOption} title="Add an option leg">
              <Plus size={14} aria-hidden="true" />
              Leg
            </button>
          </div>
        )}
      </div>

      {legs.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-10 text-center text-sm text-[var(--text-muted)]">
          <span>No legs yet. Pick a preset above, or open the chain and tap B / S on a strike.</span>
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" onClick={onOpenChain} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-text)] hover:opacity-90">
              Open chain
            </button>
            <button type="button" onClick={addOption} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]">
              Add a leg by hand
            </button>
          </div>
        </div>
      ) : (
        <ul>
          {legs.map((leg) => (
            <LegRow
              key={leg.id}
              leg={leg}
              symbol={symbol}
              spot={spot}
              rows={rows}
              chainExpiry={chainExpiry}
              expiryDates={expiryDates}
              onUpdate={(patch) => onUpdate(leg.id, patch)}
              onRemove={() => onRemove(leg.id)}
              onDuplicate={() => {
                const copy: NewLeg & { id?: string } = { ...leg };
                delete copy.id;
                onAdd(copy);
              }}
            />
          ))}
        </ul>
      )}

      {legs.length > 0 && (
        <div className="mt-auto flex flex-wrap gap-2 border-t border-[var(--border)] p-3">
          <button type="button" onClick={addOption} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border-strong)] py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] pointer-coarse:py-2.5">
            <Plus size={14} aria-hidden="true" />
            Add leg
          </button>
          <button type="button" onClick={addShares} className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]" title="Add a stock holding — the stock leg of a covered call">
            <Plus size={14} aria-hidden="true" />
            Shares
          </button>
          {mk.id === 'IN' && (
            <button type="button" onClick={addFuture} className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              <Plus size={14} aria-hidden="true" />
              Future
            </button>
          )}
          <button type="button" onClick={onClear} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-[var(--critical)] hover:bg-[var(--critical-fill)]" title="Remove every leg">
            <Trash2 size={14} aria-hidden="true" />
            Clear
          </button>
        </div>
      )}
    </section>
  );
}
