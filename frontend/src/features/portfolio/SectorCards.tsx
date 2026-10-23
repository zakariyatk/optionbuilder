import { useState } from 'react';
import { displaySymbol } from '../../lib/markets';

export interface SectorHolding {
  symbol: string;
  us: boolean;
  /** Market value in rupees. */
  value: number;
  /** Cost basis and unrealised P&L in rupees, for the sector's return. */
  invested: number;
  pnl: number;
}

interface Sector {
  name: string;
  value: number;
  share: number;
  ret: number | null;
  holdings: SectorHolding[];
  color: string;
}

/** Shown when a holding's sector is unknown or still loading. */
const UNKNOWN = 'Other';
/** Asset classes rather than company sectors: one card for both markets (Indian and US gold ETFs together). */
const SHARED = new Set([UNKNOWN, 'Commodities', 'Debt']);

const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
const retColor = (v: number) => (v > 0 ? 'var(--good-text)' : v < 0 ? 'var(--critical)' : 'var(--text-secondary)');

/**
 * One card per sector: its share of the shown holdings, value, return and
 * top stocks; clicking a card lists all of its stocks. With both markets
 * shown, US sectors are tagged "US ·" so Indian IT and US Technology stay apart.
 */
export function SectorCards({
  holdings,
  sectors,
  bothMarkets,
  colors,
  otherColor,
  formatValue,
}: {
  holdings: SectorHolding[];
  /** symbol → sector; undefined while loading. */
  sectors: Record<string, string | null> | undefined;
  bothMarkets: boolean;
  colors: string[];
  otherColor: string;
  formatValue: (v: number) => string;
}) {
  const [open, setOpen] = useState<string | null>(null);

  const total = holdings.reduce((s, h) => s + h.value, 0);
  const groups = new Map<string, SectorHolding[]>();
  for (const h of holdings) {
    const base = sectors?.[h.symbol] || UNKNOWN;
    const name = bothMarkets && h.us && !SHARED.has(base) ? `US · ${base}` : base;
    groups.set(name, [...(groups.get(name) ?? []), h]);
  }
  const list: Sector[] = [...groups.entries()]
    .map(([name, hs]) => {
      const value = hs.reduce((s, h) => s + h.value, 0);
      const invested = hs.reduce((s, h) => s + h.invested, 0);
      const pnl = hs.reduce((s, h) => s + h.pnl, 0);
      return {
        name,
        value,
        share: total ? (value / total) * 100 : 0,
        ret: invested > 0 ? (pnl / invested) * 100 : null,
        holdings: [...hs].sort((a, b) => b.value - a.value),
        color: '',
      };
    })
    // Largest first; "Other" always last.
    .sort((a, b) => Number(a.name === UNKNOWN) - Number(b.name === UNKNOWN) || b.value - a.value);
  let c = 0;
  for (const s of list) s.color = s.name === UNKNOWN ? otherColor : colors[c++ % colors.length];

  if (!holdings.length) return null;
  const largest = list.find((s) => s.name !== UNKNOWN) ?? list[0];

  return (
    <div>
      <div className="mb-2 text-[11px] text-[var(--text-muted)] tabular">
        {sectors === undefined
          ? 'Looking up sectors…'
          : `${list.length} sector${list.length === 1 ? '' : 's'} · ${holdings.length} stock${holdings.length === 1 ? '' : 's'} · ${formatValue(total)} · largest ${largest.name} ${largest.share.toFixed(0)}%`}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
        {list.map((s) => {
          const isOpen = open === s.name;
          const chips = isOpen ? s.holdings : s.holdings.slice(0, 2);
          return (
            <button
              key={s.name}
              type="button"
              onClick={() => setOpen(isOpen ? null : s.name)}
              aria-expanded={isOpen}
              className={`flex min-w-0 flex-col gap-1 rounded-lg border bg-[var(--surface-card)] px-3 py-2.5 text-left hover:border-[var(--text-muted)] ${isOpen ? 'col-span-full sm:col-span-2' : ''}`}
              style={{ borderColor: isOpen ? s.color : 'var(--border)' }}
            >
              <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                <span className="h-2.5 w-2.5 flex-none rounded-sm" style={{ background: s.color }} />
                <span className="truncate">{s.name}</span>
              </span>
              <span className="text-xl font-semibold tabular">{s.share.toFixed(1)}%</span>
              <span className="text-[11px] text-[var(--text-secondary)] tabular">
                {formatValue(s.value)}
                {s.ret !== null && (
                  <>
                    {' · '}
                    <span style={{ color: retColor(s.ret) }}>{pct(s.ret)}</span>
                  </>
                )}
              </span>
              <span className="my-0.5 h-1 overflow-hidden rounded-full bg-[var(--border)]">
                <span className="block h-full rounded-full" style={{ width: `${s.share}%`, background: s.color }} />
              </span>
              {isOpen ? (
                <span className="mt-1 flex flex-col gap-0.5">
                  {chips.map((h) => {
                    const ret = h.invested > 0 ? (h.pnl / h.invested) * 100 : null;
                    return (
                      <span key={h.symbol} className="flex justify-between gap-2 text-[11px] tabular">
                        <span className="truncate text-[var(--text-primary)]">{displaySymbol(h.symbol)}</span>
                        <span className="text-[var(--text-secondary)]">
                          {s.value ? ((h.value / s.value) * 100).toFixed(0) : 0}% · {formatValue(h.value)}
                          {ret !== null && (
                            <>
                              {' · '}
                              <span style={{ color: retColor(ret) }}>{pct(ret)}</span>
                            </>
                          )}
                        </span>
                      </span>
                    );
                  })}
                </span>
              ) : (
                <span className="flex flex-wrap gap-1">
                  {chips.map((h) => (
                    <span key={h.symbol} className="rounded bg-[var(--surface-sunken)] px-1.5 py-px text-[10px] text-[var(--text-secondary)]">
                      {displaySymbol(h.symbol)}
                    </span>
                  ))}
                  {s.holdings.length > 2 && <span className="text-[10px] text-[var(--text-muted)]">+{s.holdings.length - 2}</span>}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
