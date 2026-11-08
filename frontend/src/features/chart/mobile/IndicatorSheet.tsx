import { useMemo, useState } from 'react';
import { Check, Eye, EyeOff, Search, SlidersHorizontal, X } from 'lucide-react';
import type { Chart } from 'klinecharts';
import { INDICATORS, indicatorInfo, paramLabel, parseParam } from './indicatorCatalog';
import { activeIndicators, type Active } from './mobileChartUtils';
import { Sheet } from './Sheet';

const CANDLE_PANE = 'candle_pane';
/** Panes under the price chart on a phone; more leaves the candles too little room. */
const MAX_SUB_PANES = 3;
const SUB_PANE_HEIGHT = 84;


/**
 * Indicators, the phone way: what's on the chart at the top (settings, hide,
 * remove), then every indicator to add, searchable and grouped.
 */
export function IndicatorSheet({ open, onClose, chart }: { open: boolean; onClose: () => void; chart: Chart | null }) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [note, setNote] = useState('');
  const bump = () => setVersion((v) => v + 1);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` re-reads the chart after a change
  const active = useMemo(() => activeIndicators(chart), [chart, version, open]);
  const activeNames = new Set(active.map((a) => a.ind.name));
  const q = query.trim().toLowerCase();
  const matches = INDICATORS.filter((i) => !q || i.name.toLowerCase().includes(q) || i.title.toLowerCase().includes(q));

  const add = (name: string) => {
    if (!chart) return;
    const info = indicatorInfo(name);
    setNote('');
    if (info?.overlay) chart.createIndicator(name, true, { id: CANDLE_PANE });
    else {
      const subPanes = new Set(active.filter((a) => a.paneId !== CANDLE_PANE).map((a) => a.paneId));
      if (subPanes.size >= MAX_SUB_PANES) {
        setNote(`Up to ${MAX_SUB_PANES} indicator panes fit on a phone — remove one first.`);
        return;
      }
      chart.createIndicator(name, false, { height: SUB_PANE_HEIGHT });
    }
    bump();
  };
  const remove = (a: Active) => {
    chart?.removeIndicator(a.paneId, a.ind.name);
    if (editing === a.ind.name) setEditing(null);
    bump();
  };
  const toggleVisible = (a: Active) => {
    chart?.overrideIndicator({ name: a.ind.name, visible: !a.ind.visible }, a.paneId);
    window.setTimeout(bump, 0);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Indicators" tall>
      <div className="sticky top-0 z-10 bg-[var(--surface-raised)] px-4 pb-2">
        <label className="flex h-11 items-center gap-2 rounded-lg border border-[var(--border-strong)] px-3 focus-within:border-[var(--series-blue)]">
          <Search size={18} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search indicators"
            aria-label="Search indicators"
            className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="-mr-2 flex h-10 w-10 items-center justify-center text-[var(--text-muted)]">
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </label>
        {note && <p className="mt-2 text-xs text-[var(--critical)]">{note}</p>}
      </div>

      {active.length > 0 && !q && (
        <section aria-label="On the chart" className="pb-2">
          <h3 className="px-4 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">On the chart</h3>
          {active.map((a) => {
            const info = indicatorInfo(a.ind.name);
            const isEditing = editing === a.ind.name;
            return (
              <div key={`${a.paneId}-${a.ind.name}`} className="border-b border-[var(--border)] last:border-b-0">
                <div className="flex min-h-12 items-center gap-1 pl-4 pr-1">
                  <div className={`min-w-0 flex-1 ${a.ind.visible ? '' : 'opacity-50'}`}>
                    <div className="truncate text-sm font-medium">{info?.title ?? a.ind.name}</div>
                    <div className="truncate text-[11px] text-[var(--text-muted)]">
                      {a.ind.shortName}
                      {a.ind.calcParams.length ? ` (${a.ind.calcParams.join(', ')})` : ''}
                    </div>
                  </div>
                  <IconBtn label={`Settings for ${a.ind.shortName}`} active={isEditing} onClick={() => setEditing(isEditing ? null : a.ind.name)}>
                    <SlidersHorizontal size={18} aria-hidden="true" />
                  </IconBtn>
                  <IconBtn label={a.ind.visible ? `Hide ${a.ind.shortName}` : `Show ${a.ind.shortName}`} onClick={() => toggleVisible(a)}>
                    {a.ind.visible ? <Eye size={18} aria-hidden="true" /> : <EyeOff size={18} aria-hidden="true" />}
                  </IconBtn>
                  <IconBtn label={`Remove ${a.ind.shortName}`} onClick={() => remove(a)}>
                    <X size={18} aria-hidden="true" />
                  </IconBtn>
                </div>
                {isEditing && (
                  <ParamsEditor
                    key={a.ind.calcParams.join(',')}
                    active={a}
                    onApply={(calcParams) => {
                      chart?.overrideIndicator({ name: a.ind.name, calcParams }, a.paneId);
                      // klinecharts applies it on the next frame.
                      window.setTimeout(bump, 0);
                      setEditing(null);
                    }}
                  />
                )}
              </div>
            );
          })}
        </section>
      )}

      {(['Trend', 'Momentum', 'Volume', 'Volatility'] as const).map((group) => {
        const list = matches.filter((m) => m.group === group);
        if (!list.length) return null;
        return (
          <section key={group} aria-label={group}>
            <h3 className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{group}</h3>
            {list.map((i) => {
              const on = activeNames.has(i.name);
              return (
                <button
                  key={i.name}
                  type="button"
                  onClick={() => (on ? setEditing(i.name) : add(i.name))}
                  className="flex min-h-12 w-full items-center gap-3 px-4 text-left active:bg-[var(--surface-sunken)]"
                >
                  <span className="w-12 shrink-0 text-xs font-semibold text-[var(--text-secondary)]">{i.name}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{i.title}</span>
                    <span className="block text-[11px] text-[var(--text-muted)]">{i.overlay ? 'On price chart' : 'Own pane'}</span>
                  </span>
                  {on && <Check size={18} className="shrink-0 text-[var(--series-blue)]" aria-label="On the chart" />}
                </button>
              );
            })}
          </section>
        );
      })}
      {matches.length === 0 && <p className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">No indicator matches “{query}”.</p>}
    </Sheet>
  );
}

function IconBtn({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg active:bg-[var(--surface-sunken)] ${
        active ? 'text-[var(--series-blue)]' : 'text-[var(--text-secondary)]'
      }`}
    >
      {children}
    </button>
  );
}

/** Number fields for an indicator's settings. */
function ParamsEditor({ active, onApply }: { active: Active; onApply: (params: number[]) => void }) {
  const info = indicatorInfo(active.ind.name);
  const original = active.ind.calcParams as number[];
  const [values, setValues] = useState(() => original.map(String));
  const parsed = values.map((v, i) => parseParam(v, Number.isInteger(original[i])));
  const valid = parsed.every((p) => p !== null);
  return (
    <form
      className="grid grid-cols-2 gap-2 px-4 pb-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onApply(parsed as number[]);
      }}
    >
      {values.map((v, i) => (
        <label key={i} className="flex min-w-0 flex-col gap-1 text-[11px] text-[var(--text-muted)]">
          {paramLabel(info, i)}
          <input
            inputMode="decimal"
            value={v}
            onChange={(e) => setValues((prev) => prev.map((p, j) => (j === i ? e.target.value : p)))}
            aria-invalid={parsed[i] === null}
            className="h-11 rounded-lg border border-[var(--border-strong)] bg-transparent px-3 text-[16px] text-[var(--text-primary)] outline-none focus:border-[var(--series-blue)] aria-[invalid=true]:border-[var(--critical)]"
          />
        </label>
      ))}
      <div className="col-span-2 flex gap-2 pt-1">
        <button type="button" onClick={() => setValues(original.map(String))} className="h-11 flex-1 rounded-lg border border-[var(--border-strong)] text-sm font-medium">
          Reset
        </button>
        <button type="submit" disabled={!valid} className="h-11 flex-1 rounded-lg bg-[var(--series-blue)] text-sm font-semibold text-white disabled:opacity-40">
          Apply
        </button>
      </div>
    </form>
  );
}
