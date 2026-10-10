import { isLinear, type Leg, type LegType } from '../domain/types';
import { Button, Card, CardHeader, inputClass } from './ui';

const TYPE_LABEL: Record<LegType, string> = { CE: 'CE', PE: 'PE', FUT: 'FUT', EQ: 'Stock' };

/** Numeric input that ignores blank/NaN edits instead of writing 0 into a leg mid-typing. */
function NumberField({
  value,
  onChange,
  min,
  step,
  width,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  step?: number | string;
  width: string;
  label: string;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      aria-label={label}
      title={label}
      value={value}
      min={min}
      step={step}
      onChange={(e) => {
        const v = e.target.valueAsNumber;
        if (Number.isFinite(v)) onChange(min !== undefined ? Math.max(min, v) : v);
      }}
      className={`${inputClass} ${width}`}
    />
  );
}

export function LegsTable({
  legs,
  onUpdate,
  onRemove,
  onToggleAction,
  onAddBlank,
  onAddEquity,
  onClear,
}: {
  legs: Leg[];
  onUpdate: (id: string, patch: Partial<Leg>) => void;
  onRemove: (id: string) => void;
  onToggleAction: (id: string) => void;
  onAddBlank: () => void;
  onAddEquity: () => void;
  onClear: () => void;
}) {
  return (
    <Card>
      <CardHeader title={`Strategy legs${legs.length ? ` (${legs.length})` : ''}`}>
        <Button onClick={onAddBlank}>+ Option leg</Button>
        <Button onClick={onAddEquity} title="Add a cash-equity holding — the stock leg of a covered call">
          + Stock leg
        </Button>
        {legs.length > 0 && (
          <Button variant="danger" onClick={onClear}>
            Clear all
          </Button>
        )}
      </CardHeader>

      {legs.length === 0 ? (
        <div className="px-3 py-6 text-center text-sm text-[var(--text-muted)]">
          Click B / S in the option chain, pick a template, or add a leg to start building a strategy.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-xs">
            <thead>
              <tr className="text-[var(--text-muted)]">
                <th className="px-2 py-1.5 text-left font-medium">Side</th>
                <th className="px-2 py-1.5 text-left font-medium">Type</th>
                <th className="px-2 py-1.5 text-left font-medium">Strike</th>
                <th className="px-2 py-1.5 text-left font-medium">Premium / Price</th>
                <th className="px-2 py-1.5 text-left font-medium">Lots</th>
                <th className="px-2 py-1.5 text-left font-medium">Qty</th>
                <th className="px-2 py-1.5 text-left font-medium">IV</th>
                <th className="px-2 py-1.5">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {legs.map((leg) => (
                <tr key={leg.id} className="border-t border-[var(--gridline)] tabular">
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => onToggleAction(leg.id)}
                      title="Click to flip buy / sell"
                      className="w-11 rounded px-2 py-0.5 text-[10px] font-semibold"
                      style={{
                        background: leg.action === 'BUY' ? 'var(--good-fill)' : 'var(--critical-fill)',
                        color: leg.action === 'BUY' ? 'var(--good-text)' : 'var(--critical)',
                      }}
                    >
                      {leg.action}
                    </button>
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      aria-label="Instrument type"
                      value={leg.type}
                      onChange={(e) => onUpdate(leg.id, { type: e.target.value as LegType })}
                      className={inputClass}
                    >
                      {(Object.keys(TYPE_LABEL) as LegType[]).map((t) => (
                        <option key={t} value={t}>
                          {TYPE_LABEL[t]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    {isLinear(leg.type) ? (
                      <span className="text-[var(--text-muted)]">—</span>
                    ) : (
                      <NumberField label="Strike" value={leg.strike} onChange={(strike) => onUpdate(leg.id, { strike })} width="w-20" />
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <NumberField label="Premium" value={leg.premium} min={0} step="0.05" onChange={(premium) => onUpdate(leg.id, { premium })} width="w-20" />
                  </td>
                  {leg.type === 'EQ' ? (
                    <>
                      <td className="px-2 py-1.5 text-[var(--text-muted)]">—</td>
                      <td className="px-2 py-1.5">
                        <NumberField
                          label="Number of shares"
                          value={leg.lots * leg.lotSize}
                          min={1}
                          onChange={(shares) => onUpdate(leg.id, { lots: 1, lotSize: Math.round(shares) })}
                          width="w-20"
                        />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-2 py-1.5">
                        <NumberField label="Lots" value={leg.lots} min={1} onChange={(lots) => onUpdate(leg.id, { lots: Math.round(lots) })} width="w-14" />
                      </td>
                      <td className="px-2 py-1.5 text-[var(--text-muted)]">{(leg.lots * leg.lotSize).toLocaleString('en-IN')}</td>
                    </>
                  )}
                  <td className="px-2 py-1.5 text-[var(--text-muted)]">{leg.iv ? `${leg.iv.toFixed(1)}%` : '—'}</td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => onRemove(leg.id)}
                      className="rounded px-1.5 text-[var(--critical)] hover:bg-[var(--critical-fill)]"
                      title="Remove leg"
                      aria-label="Remove leg"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
