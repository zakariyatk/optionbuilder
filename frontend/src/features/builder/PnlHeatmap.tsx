import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { heatmapDates, heatmapGrid, heatmapPrices } from '../../domain/analysis';
import type { Leg } from '../../domain/types';
import { useMarket } from './market';

const ROWS = 24;
const STEPS = [0.25, 0.5, 1, 2, 4];

const colDay = (ms: number) => new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'numeric', timeZone: 'Asia/Kolkata' });
const longDay = (ms: number) => new Date(ms).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

/** P&L for a grid of underlying prices (rows) and dates up to expiry (columns). */
export function PnlHeatmap({
  legs,
  symbol,
  spot,
  fallbackIv,
  nowMs,
  expiryMs,
  capital,
}: {
  /** Legs already calibrated to the market and IV-scaled. */
  legs: Leg[];
  symbol: string;
  spot: number | null;
  fallbackIv: number | null;
  nowMs: number;
  expiryMs: number | null;
  /** When set, cells read as % of this capital. */
  capital: number | null;
}) {
  const mk = useMarket();
  const signedInr = mk.signedMoney;
  const axisIndian = mk.axis;
  const [stepIndex, setStepIndex] = useState(2);
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const base = spot ?? 0;
  const step = Math.max(mk.strikeStep(symbol, base || 100) * STEPS[stepIndex], 0.05);
  const model = mk.model;

  const { prices, dates, grid, peak } = useMemo(() => {
    const p = base > 0 ? heatmapPrices(base, step, ROWS) : [];
    const d = expiryMs !== null ? heatmapDates(nowMs, expiryMs, 12) : [nowMs];
    const g = heatmapGrid(legs, p, d, fallbackIv, expiryMs, model);
    return { prices: p, dates: d, grid: g, peak: Math.max(1e-9, ...g.flat().map(Math.abs)) };
  }, [legs, base, step, nowMs, expiryMs, fallbackIv, model]);

  if (!base) return <div className="px-3 py-16 text-center text-sm text-[var(--text-muted)]">The heatmap needs a spot price.</div>;

  const show = (v: number) => (capital ? `${v >= 0 ? '+' : ''}${((v / capital) * 100).toFixed(1)}%` : signedInr(v));
  const spotRow = prices.reduce((best, p, i) => (Math.abs(p - base) < Math.abs(prices[best] - base) ? i : best), 0);
  const cellColor = (v: number) => {
    const share = Math.round(Math.min(Math.abs(v) / peak, 1) ** 0.7 * 85) + 6;
    return `color-mix(in srgb, ${v >= 0 ? 'var(--good)' : 'var(--critical)'} ${share}%, transparent)`;
  };

  const downloadCsv = () => {
    const header = ['Price', ...dates.map((d) => new Date(d).toISOString().slice(0, 10))].join(',');
    const lines = prices.map((p, r) => [p, ...grid[r].map((v) => v.toFixed(2))].join(','));
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${mk.display(symbol)}-pnl-heatmap.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hovered = hover ? { price: prices[hover.r], date: dates[hover.c], value: grid[hover.r][hover.c] } : null;

  return (
    <div className="px-3 pb-2 pt-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-separate border-spacing-[2px] text-[11px] tabular" onMouseLeave={() => setHover(null)}>
          <thead>
            <tr className="text-[var(--text-muted)]">
              <th className="w-16 text-right font-medium">Price</th>
              {dates.map((d, i) => (
                <th key={d} className="font-medium">
                  {i === 0 ? 'Now' : colDay(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {prices.map((p, r) => (
              <tr key={p}>
                <td className={`pr-1 text-right ${r === spotRow ? 'font-bold text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
                  {r === spotRow && '● '}
                  {mk.price(p)}
                </td>
                {grid[r].map((v, c) => (
                  <td
                    key={c}
                    onMouseEnter={() => setHover({ r, c })}
                    onClick={() => setHover({ r, c })}
                    title={`${mk.price(p)} on ${longDay(dates[c])}: ${show(v)}`}
                    className={`h-4 min-w-6 rounded-[2px] ${r === spotRow ? 'outline outline-1 outline-[var(--border-strong)]' : ''} ${
                      hover?.r === r && hover?.c === c ? 'outline outline-2 outline-[var(--text-primary)]' : ''
                    }`}
                    style={{ background: cellColor(v) }}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <span className="flex items-center gap-1.5 tabular text-[var(--text-muted)]">
          <span style={{ color: 'var(--critical)' }}>−{capital ? `${((peak / capital) * 100).toFixed(0)}%` : axisIndian(peak)}</span>
          <span className="inline-block h-2.5 w-24 rounded-sm" style={{ background: 'linear-gradient(90deg, var(--critical), transparent, var(--good))' }} />
          <span style={{ color: 'var(--good-text)' }}>+{capital ? `${((peak / capital) * 100).toFixed(0)}%` : axisIndian(peak)}</span>
        </span>
        <span className="min-w-[14rem] flex-1 text-[var(--text-secondary)]">
          {hovered ? (
            <>
              {mk.price(hovered.price)} on {longDay(hovered.date)}:{' '}
              <span className="font-semibold" style={{ color: hovered.value >= 0 ? 'var(--good-text)' : 'var(--critical)' }}>
                {show(hovered.value)}
              </span>
            </>
          ) : (
            'Hover a cell for its P&L'
          )}
        </span>
        <label className="flex items-center gap-2">
          <span className="text-[var(--text-muted)]">Rows</span>
          <input type="range" className="ob-range w-24" min={0} max={STEPS.length - 1} step={1} value={stepIndex} onChange={(e) => setStepIndex(Number(e.target.value))} />
          <span className="w-16 tabular text-[var(--text-muted)]">{mk.price(step)}/row</span>
        </label>
        <button
          type="button"
          onClick={downloadCsv}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1 hover:border-[var(--border-strong)]"
        >
          <Download size={14} aria-hidden="true" />
          CSV
        </button>
      </div>
    </div>
  );
}
