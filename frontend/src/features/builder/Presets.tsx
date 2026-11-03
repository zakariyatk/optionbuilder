import { useId, useMemo } from 'react';
import { CalendarDays, ChevronDown, Table2 } from 'lucide-react';
import { daysToExpiry, formatExpiry } from '../../domain/dates';
import { TEMPLATE_VIEWS, TEMPLATES, templateSketch, type StrategyTemplate } from '../../domain/templates';
import { Chip } from './parts';

/** Expiry picker and one-tap strategy presets, grouped by market view. */
export function PresetBar({
  expiryDates,
  expiry,
  onExpiryChange,
  activeTemplate,
  canBuild,
  onTemplate,
}: {
  expiryDates: string[];
  expiry: string | null;
  onExpiryChange: (e: string) => void;
  activeTemplate: string | null;
  canBuild: boolean;
  onTemplate: (t: StrategyTemplate) => void;
}) {
  const dte = expiry ? daysToExpiry(expiry) : null;
  return (
    <div className="flex items-center gap-2">
      <label className="relative flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-card)] px-2.5 py-1.5 text-xs font-medium hover:border-[var(--border-strong)]">
        <CalendarDays size={14} aria-hidden="true" className="text-[var(--text-muted)]" />
        <span className="tabular">
          {expiry ? formatExpiry(expiry) : 'Expiry'}
          {dte !== null && <span className="text-[var(--text-muted)]"> · {dte}d</span>}
        </span>
        <ChevronDown size={14} aria-hidden="true" className="text-[var(--text-muted)]" />
        <select
          aria-label="Expiry"
          className="absolute inset-0 cursor-pointer opacity-0"
          value={expiry ?? ''}
          disabled={expiryDates.length === 0}
          onChange={(e) => onExpiryChange(e.target.value)}
        >
          {expiryDates.length === 0 && <option value="">No expiry data</option>}
          {expiryDates.map((e) => {
            const d = daysToExpiry(e);
            return (
              <option key={e} value={e}>
                {formatExpiry(e)}
                {d !== null ? ` · ${d}d` : ''}
              </option>
            );
          })}
        </select>
      </label>

      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-0.5 [scrollbar-width:thin]">
        {TEMPLATE_VIEWS.map((view) => (
          <div key={view} className="flex shrink-0 items-center gap-1.5">
            <span className="pl-1.5 text-[11px] text-[var(--text-muted)]">{view}</span>
            {TEMPLATES.filter((t) => t.view === view).map((t) => (
              <Chip key={t.id} active={activeTemplate === t.id} disabled={!canBuild} title={t.description} onClick={() => onTemplate(t)}>
                {t.name}
              </Chip>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A template's payoff outline: green above break-even, red below. */
function Sketch({ template }: { template: StrategyTemplate }) {
  const id = useId();
  const { d, zeroY } = useMemo(() => {
    const { points, zero } = templateSketch(template);
    const y = (v: number) => 32 - v * 28;
    return { d: points.map((p, i) => `${i ? 'L' : 'M'}${(p.x * 100).toFixed(1)} ${y(p.y).toFixed(1)}`).join(' '), zeroY: y(zero) };
  }, [template]);
  return (
    <svg viewBox="0 0 100 36" className="h-9 w-full" aria-hidden="true">
      <defs>
        <clipPath id={`${id}-up`}>
          <rect x="0" y="0" width="100" height={zeroY} />
        </clipPath>
        <clipPath id={`${id}-down`}>
          <rect x="0" y={zeroY} width="100" height={36 - zeroY} />
        </clipPath>
      </defs>
      <line x1="0" x2="100" y1={zeroY} y2={zeroY} stroke="var(--baseline)" strokeWidth="1" />
      <path d={d} fill="none" stroke="var(--good)" strokeWidth="2" clipPath={`url(#${id}-up)`} />
      <path d={d} fill="none" stroke="var(--critical)" strokeWidth="2" clipPath={`url(#${id}-down)`} />
    </svg>
  );
}

const GALLERY = ['long-call', 'long-put', 'bull-call', 'bear-put', 'iron-condor', 'long-straddle'];

/** What the chart area shows before there are any legs. */
export function StrategyGallery({ canBuild, onTemplate, onOpenChain }: { canBuild: boolean; onTemplate: (t: StrategyTemplate) => void; onOpenChain: () => void }) {
  return (
    <div className="flex min-h-[340px] flex-col items-center justify-center gap-5 rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-10">
      <div className="text-center">
        <div className="text-base font-semibold">Pick a strategy or open the chain</div>
        <div className="mt-1 text-xs text-[var(--text-muted)]">Presets are built around the at-the-money strike of the selected expiry.</div>
      </div>
      <div className="grid w-full max-w-3xl grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {GALLERY.map((id) => {
          const t = TEMPLATES.find((x) => x.id === id)!;
          return (
            <button
              key={t.id}
              type="button"
              disabled={!canBuild}
              onClick={() => onTemplate(t)}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-2.5 text-left transition-colors hover:border-[var(--series-blue)] disabled:opacity-40"
            >
              <Sketch template={t} />
              <div className="mt-1.5 text-xs font-semibold">{t.name}</div>
              <div className="text-[11px] text-[var(--text-muted)]">{t.view}</div>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onOpenChain}
        className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-text)] hover:opacity-90"
      >
        <Table2 size={16} aria-hidden="true" />
        Open chain
      </button>
    </div>
  );
}
