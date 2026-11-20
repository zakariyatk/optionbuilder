import { useRef, useState } from 'react';
import { FileUp, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../../api/client';
import type { PnlHistory } from '../../api/types';
import { Button, Card, CardHeader, Notice, Skeleton, Stat, type Tone } from '../../components/ui';
import { cumulativeSeries, defaultPeriod, groupByPeriod, maxDrawdown, netDaily, periodLabel, PERIODS, SEGMENTS, summarizeHistory, symbolItems, topMovers, type HistoryDay, type Period, type Segment } from '../../domain/pnl';
import { useAsync } from '../../hooks/useAsync';
import { confirmDialog } from '../../lib/dialog';
import { inr, signedInr } from '../../lib/format';
import { Segmented } from '../builder/parts';
import { CalendarHeatmap, ColumnBars, DivergingBars, LineArea, TipLine } from './charts';

type View = 'all' | Segment;

const tone = (v: number): Tone | undefined => (v > 0 ? 'good' : v < 0 ? 'critical' : undefined);
const pnlColor = (v: number) => (v > 0 ? 'var(--good-text)' : v < 0 ? 'var(--critical)' : 'var(--text-secondary)');
const labelOf = (s: Segment) => SEGMENTS.find((x) => x.id === s)!.label;
const fmtDate = (d: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { ...opts, timeZone: 'UTC' });

/** Chart bars for the chosen period, each with its per-segment breakdown. */
function chartRows(daily: HistoryDay[], period: Period, segs: Segment[]) {
  const detail = (d: Pick<HistoryDay, Segment | 'total'>) => (
    <div className="flex flex-col gap-0.5">
      {segs.map((s) => (
        <TipLine key={s} name={labelOf(s)} value={d[s]} />
      ))}
      {segs.length > 1 && <TipLine name="Total" value={d.total} />}
    </div>
  );
  const groups = groupByPeriod(daily, period);
  return {
    groups,
    rows: groups.map((g) => ({ key: g.date, label: periodLabel(g.date, period), value: g.total, detail: detail(g) })),
  };
}

/**
 * P&L for any date range: realised P&L from the days this app saved, Console
 * tradebooks (exact days) and Console P&L statements (per contract, placed on
 * its expiry), split by segment, with the upload panel that feeds it.
 */
export function PnlHistoryView({ from, to, rangeLabel, view, onPick }: { from: string; to: string; rangeLabel: string; view: View; onPick: (s: Segment) => void }) {
  const state = useAsync(() => api.pnlHistory(), []);
  // Day / week / month / year; until picked, whatever suits the range.
  const [picked, setPicked] = useState<Period | null>(null);
  const [kind, setKind] = useState<ChartKind>('bars');
  // Net of charges and taxes by default; gross is realised P&L alone.
  const [basis, setBasis] = useState<'net' | 'gross'>('net');
  const h = state.data;
  const segs: Segment[] = view === 'all' ? SEGMENTS.map((s) => s.id) : [view];

  if (!h) {
    return state.error ? <Notice tone="critical">P&amp;L history: {state.error}</Notice> : <Skeleton className="h-64" />;
  }

  const res = rangeSummary(h, from, to, segs);
  const { sum, undatedIn, undatedOut } = res;
  // The segment cards always show all three, whatever the filter.
  const allRes = view === 'all' ? res : rangeSummary(h, from, to, SEGMENTS.map((x) => x.id));
  const all = allRes.sum;
  // Charges and taxes: per day where known, plus an undated equity statement's whole charges.
  const undatedCharges = (list: PnlHistory['statements'], x?: Segment) => list.filter((st) => !x || st.segment === x).reduce((a, st) => a + st.charges - st.other, 0);
  const charges = Math.round((segs.reduce((a, x) => a + sum.charges[x], 0) + undatedCharges(undatedIn)) * 100) / 100;
  const segCharges = (x: Segment) => all.charges[x] + undatedCharges(allRes.undatedIn, x);
  const net = Math.round((sum.total - charges) * 100) / 100;
  const period = picked ?? defaultPeriod(from, to);
  const meta = PERIODS.find((x) => x.id === period)!;
  const chart = chartRows(basis === 'net' ? netDaily(sum) : sum.daily, period, segs);
  // Profit / loss counts and best / worst follow the chart's period.
  const unit = meta.noun;
  const periods = chart.groups.filter((m) => m.total !== 0);
  const best = periods.reduce<HistoryDay | null>((a, d) => (d.total > 0 && (!a || d.total > a.total) ? d : a), null);
  const worst = periods.reduce<HistoryDay | null>((a, d) => (d.total < 0 && (!a || d.total < a.total) ? d : a), null);
  const when = (d: HistoryDay) => periodLabel(d.date, period, true);
  const empty = sum.daily.every((d) => d.total === 0) && sum.total === 0;

  // Instruments across the chosen segments: winners, losers, win rate, profit factor.
  const instruments = Object.entries(Object.assign({}, ...segs.map((x) => sum.segments[x].symbols)) as Record<string, number>)
    .filter(([, v]) => v !== 0)
    .sort((a, b) => b[1] - a[1]);
  const winners = instruments.filter(([, v]) => v > 0);
  const losers = instruments.filter(([, v]) => v < 0).reverse();
  const grossWin = winners.reduce((a, [, v]) => a + v, 0);
  const grossLoss = -losers.reduce((a, [, v]) => a + v, 0);
  const dd = maxDrawdown(cumulativeSeries(chart.groups));
  const segValue = (x: Segment) => all.segments[x].realised - (basis === 'net' ? segCharges(x) : 0);
  const segTotals = SEGMENTS.map((x) => ({ ...x, v: segValue(x.id) })).filter((x) => x.v !== 0);
  const lead = [...segTotals].sort((a, b) => b.v - a.v)[0];
  const lag = [...segTotals].sort((a, b) => a.v - b.v)[0];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[1.25fr_1fr_1fr_1fr]">
        <HeroCard
          label={`${basis === 'net' ? 'Net P&L after charges & taxes' : 'Realised P&L (gross)'} · ${view === 'all' ? 'all segments' : labelOf(view)} · ${rangeLabel}`}
          value={basis === 'net' ? net : sum.total}
          sub={`${basis === 'net' ? `Realised ${signedInr(sum.total)}` : `Net ${signedInr(net)}`} · charges & taxes ${inr(charges)}${
            sum.unpricedDays ? ` · charges unknown for ${sum.unpricedDays} day${sum.unpricedDays === 1 ? '' : 's'}` : ''
          }`}
          spark={cumulativeSeries(chart.groups).map((p) => p.cum)}
        />
        {SEGMENTS.map((x) => {
          // An undated equity statement this range only partly covers: show it whole, labelled.
          const whole = x.id === 'equity' && all.segments.equity.realised === 0 ? allRes.undatedOut.find((st) => st.segment === 'equity') : undefined;
          const segDaily = basis === 'net' ? netDaily(all) : all.daily;
          return (
            <SegmentCard
              key={x.id}
              seg={x.id}
              data={all.segments[x.id]}
              value={whole ? whole.realised - (basis === 'net' ? whole.charges - whole.other : 0) : segValue(x.id)}
              note={
                whole
                  ? `Whole statement ${fmtDate(whole.from)} – ${fmtDate(whole.to)} · no dates`
                  : basis === 'net' && segCharges(x.id) > 0
                    ? `After ${inr(segCharges(x.id))} charges & taxes`
                    : undefined
              }
              count={whole ? whole.symbols : undefined}
              bars={groupByPeriod(segDaily.map((d) => ({ ...d, total: d[x.id] })), period === 'day' ? 'week' : period).map((g) => g.total).slice(-18)}
              dated={all.daily.some((d) => d[x.id] !== 0)}
              selected={view === x.id}
              onPick={() => onPick(x.id)}
            />
          );
        })}
      </div>

      {sum.missingWeekdays > 0 && !empty && (
        <Notice tone="info">
          {sum.missingWeekdays} weekday{sum.missingWeekdays === 1 ? ' has' : 's have'} no record in this range (market holidays count too). Upload a Console tradebook
          covering them below to fill the gaps.
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]">
        <div className={`${softCard} min-w-0`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">
              {CHART_KINDS.find((k) => k.id === kind)!.title(meta.adjective)}
              <span className="ml-1.5 text-xs font-normal text-[var(--text-muted)]">{basis === 'net' ? 'net of charges' : 'gross'}</span>
            </h2>
            <div className="flex flex-wrap gap-2">
              <Segmented<'net' | 'gross'>
                label="Net or gross"
                size="xs"
                value={basis}
                onChange={setBasis}
                options={[
                  { id: 'net', label: 'Net', title: 'After charges and taxes' },
                  { id: 'gross', label: 'Gross', title: 'Realised P&L before charges' },
                ]}
              />
              <Segmented<ChartKind> label="Chart" size="xs" value={kind} onChange={setKind} options={CHART_KINDS.map((k) => ({ id: k.id, label: k.label, title: k.hint }))} />
              {kind !== 'calendar' && (
                <Segmented<Period> label="Group P&L by" size="xs" value={period} onChange={setPicked} options={PERIODS.map((x) => ({ id: x.id, label: x.id[0].toUpperCase(), title: x.label }))} />
              )}
            </div>
          </div>
          <p className="mb-3 mt-1 text-xs text-[var(--text-muted)]">{CHART_KINDS.find((k) => k.id === kind)!.hint}</p>
          {!chart.rows.some((r) => r.value !== 0) ? (
            <p className="py-10 text-center text-sm text-[var(--text-muted)]">No dated P&amp;L in this range.</p>
          ) : kind === 'bars' ? (
            <ColumnBars rows={chart.rows} label={`${meta.adjective} realised P&L`} height={220} />
          ) : kind === 'calendar' ? (
            <CalendarHeatmap
              label="Daily realised P&L calendar"
              days={Object.fromEntries(sum.daily.map((d) => [d.date, d.total]))}
              from={sum.daily.length && sum.daily[0].date > from ? sum.daily[0].date : from}
              to={to}
            />
          ) : (
            <CumulativeView groups={chart.groups} period={period} drawdown={kind === 'drawdown'} />
          )}

          {instruments.length > 0 && <Movers winners={winners} losers={losers} />}
        </div>

        <div className={softCard}>
          <h2 className="text-base font-semibold">Insights</h2>
          <ul className="mt-1">
            <Insight
              name="Win rate"
              sub={instruments.length ? `${winners.length} of ${instruments.length} instruments in profit` : 'No closed trades in this range'}
              value={instruments.length ? `${Math.round((winners.length / instruments.length) * 100)}%` : '—'}
            />
            <Insight name="Profit factor" sub="Gross profit for every ₹1 of loss" value={grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : grossWin > 0 ? 'No losses' : '—'} />
            <Insight name={`Best ${unit}`} sub={best ? when(best) : `No profitable ${unit}`} value={best ? signedInr(best.total) : '—'} v={best?.total} />
            <Insight name={`Worst ${unit}`} sub={worst ? when(worst) : `No losing ${unit}`} value={worst ? signedInr(worst.total) : '—'} v={worst?.total} />
            <Insight
              name={`Profit / loss ${unit}s`}
              sub={`Out of ${periods.length} ${unit}${periods.length === 1 ? '' : 's'} with P&L`}
              value={`${periods.filter((d) => d.total > 0).length} / ${periods.filter((d) => d.total < 0).length}`}
            />
            <Insight
              name="Max drawdown"
              sub={dd ? (dd.recoveredDate ? `Made back ${periodLabel(dd.recoveredDate, period, true)}` : 'Not made back yet') : 'Never below a previous high'}
              value={dd ? signedInr(dd.amount) : '—'}
              v={dd?.amount}
            />
            <Insight
              name="Charges & taxes"
              sub={
                sum.unpricedDays
                  ? `Not known for ${sum.unpricedDays} tradebook day${sum.unpricedDays === 1 ? '' : 's'}`
                  : sum.total > 0
                    ? `${Math.round((charges / sum.total) * 100)}% of realised profit`
                    : 'Brokerage, STT, GST, stamp duty, fees'
              }
              value={inr(charges)}
            />
            <Insight name="Net after charges" sub={`Realised ${signedInr(sum.total)}`} value={signedInr(net)} v={net} />
          </ul>
          {view === 'all' && lead && lag && lead.id !== lag.id && (
            <p className="mt-4 rounded-xl bg-[var(--surface-sunken)] px-3.5 py-3 text-xs text-[var(--text-secondary)]">
              {lead.label} led the period with {signedInr(lead.v)}
              {lag.v < 0 ? `, while ${lag.label} lost ${signedInr(lag.v)}` : `; ${lag.label} added the least (${signedInr(lag.v)})`}.
            </p>
          )}
        </div>
      </div>

      {undatedIn.length > 0 && (
        <Notice tone="info">
          Equity P&amp;L of {signedInr(undatedIn.reduce((a, x) => a + x.realised, 0))} comes from a P&amp;L statement with no trade dates: it&apos;s in the totals but not in the
          charts. Upload an equity Tradebook (CSV) to see it by date.
        </Notice>
      )}

      {undatedOut.map((st) => (
        <WholeStatement key={`${st.segment}:${st.from}:${st.to}`} st={st} />
      ))}

      <Sources h={h} onChange={state.reload} />
    </div>
  );
}

/** Rounded card used across this page (design B). */
const softCard = 'rounded-[20px] border border-[var(--border)] bg-[var(--surface-card)] p-5';

/** Identity colour per segment — icon tiles only; figures stay in text colours. */
const SEG_STYLE: Record<Segment, { icon: string; tint: string; noun: string }> = {
  commodity: { icon: '◆', tint: '#d9a93b', noun: 'contracts' },
  fo: { icon: 'ƒ', tint: '#7c8cf8', noun: 'contracts' },
  equity: { icon: '▲', tint: '#3fb6d4', noun: 'stocks' },
};

/** Realised P&L for a range and set of segments, undated equity statements folded in when the range covers them. */
function rangeSummary(h: PnlHistory, from: string, to: string, segs: Segment[]) {
  const covered: [string, string][] = [
    ...h.statements.filter((x) => segs.includes(x.segment)).map((x): [string, string] => [x.from, x.to]),
    ...segs.flatMap((x) => (h.coverage[x] ? [h.coverage[x]!] : [])),
  ];
  const sum = summarizeHistory(h.days, from, to, segs, covered);
  const undatedIn = h.statements.filter((x) => x.undated && segs.includes(x.segment) && x.from >= from && x.to <= to);
  const undatedOut = h.statements.filter((x) => x.undated && segs.includes(x.segment) && !(x.from >= from && x.to <= to) && x.from <= to && x.to >= from);
  for (const st of undatedIn) {
    const seg = sum.segments[st.segment];
    for (const [sym, v] of Object.entries(st.undated!)) seg.symbols[sym] = Math.round(((seg.symbols[sym] ?? 0) + v) * 100) / 100;
    seg.realised = Math.round((seg.realised + st.realised) * 100) / 100;
    sum.total = Math.round((sum.total + st.realised) * 100) / 100;
  }
  return { sum, undatedIn, undatedOut };
}

function HeroCard({ label, value, sub, spark }: { label: string; value: number; sub: string; spark: number[] }) {
  const hue = value >= 0 ? 'var(--good)' : 'var(--critical)';
  return (
    <div
      className="flex min-w-0 flex-col rounded-[22px] border p-5"
      style={{
        background: `linear-gradient(140deg, color-mix(in srgb, ${hue} 26%, var(--surface-card)) 0%, color-mix(in srgb, ${hue} 10%, var(--surface-card)) 45%, var(--surface-card) 100%)`,
        borderColor: `color-mix(in srgb, ${hue} 30%, var(--border))`,
      }}
    >
      <div className="text-xs text-[var(--text-secondary)]">{label}</div>
      <div className="tabular mt-1 text-4xl font-bold tracking-tight sm:text-[2.6rem]" style={{ color: value === 0 ? 'var(--text-primary)' : value > 0 ? 'var(--good-text)' : 'var(--critical)' }}>
        {signedInr(value)}
      </div>
      <div className="mt-1 text-xs text-[var(--text-secondary)]">{sub}</div>
      <div className="mt-auto pt-4">{spark.length > 1 && <Sparkline values={spark} color={hue} />}</div>
    </div>
  );
}

/** A small running-total line with a soft area, no axes. */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const W = 400;
  const H = 56;
  const hi = Math.max(0, ...values);
  const lo = Math.min(0, ...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * W).toFixed(1)},${(((hi - v) / span) * H).toFixed(1)}`).join(' ');
  const zero = ((hi / span) * H).toFixed(1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-14 w-full" aria-hidden="true">
      <path d={`${pts} L${W},${zero} L0,${zero} Z`} fill={color} opacity={0.18} />
      <path d={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Small profit / loss columns, no axes. */
function MiniBars({ values }: { values: number[] }) {
  const W = 300;
  const H = 52;
  const hi = Math.max(0, ...values);
  const lo = Math.min(0, ...values);
  const span = hi - lo || 1;
  const z = (hi / span) * H;
  const bw = (W - 3 * (values.length - 1)) / values.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[52px] w-full" aria-hidden="true">
      <line x1={0} x2={W} y1={z} y2={z} stroke="var(--border-strong)" vectorEffect="non-scaling-stroke" />
      {values.map((v, i) => {
        const bh = (Math.abs(v) / span) * H;
        return bh > 0 ? (
          <rect key={i} x={i * (bw + 3)} y={v > 0 ? z - bh : z} width={bw} height={Math.max(bh, 1)} rx={Math.min(2, bw / 2)} fill={v > 0 ? 'var(--good)' : 'var(--critical)'} />
        ) : null;
      })}
    </svg>
  );
}

function SegmentCard({
  seg,
  data,
  value,
  note,
  count: countIn,
  bars,
  dated,
  selected,
  onPick,
}: {
  seg: Segment;
  data: { realised: number; symbols: Record<string, number> };
  /** Shown P&L (net or gross). */
  value: number;
  note?: string;
  count?: number;
  bars: number[];
  dated: boolean;
  selected: boolean;
  onPick: () => void;
}) {
  const st = SEG_STYLE[seg];
  const count = countIn ?? Object.values(data.symbols).filter((v) => v !== 0).length;
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      title={`Show only ${labelOf(seg)}`}
      className="flex min-w-0 flex-col rounded-[20px] border border-[var(--border)] bg-[var(--surface-card)] p-5 text-left transition-colors hover:border-[var(--border-strong)]"
      style={{ borderColor: selected ? st.tint : undefined, boxShadow: selected ? `0 0 0 1px ${st.tint}` : undefined }}
    >
      <span className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-[10px] text-base font-bold" style={{ background: `color-mix(in srgb, ${st.tint} 16%, transparent)`, color: st.tint }} aria-hidden="true">
          {st.icon}
        </span>
        <span>
          <span className="block text-sm font-semibold">{labelOf(seg)}</span>
          <span className="block text-[11px] text-[var(--text-muted)]">
            {count} {st.noun}
          </span>
        </span>
      </span>
      <span className="tabular mt-3 text-2xl font-bold" style={{ color: pnlColor(value) }}>
        {signedInr(value)}
      </span>
      <span className="text-[11px] text-[var(--text-muted)]">
        {note ?? (dated ? `Last ${bars.length} periods` : count ? 'No dated history (statement only)' : 'No P&L in this range')}
      </span>
      <span className="mt-2 block">
        {dated ? (
          <MiniBars values={bars} />
        ) : (
          <span className="block h-[52px] rounded-[10px]" style={{ background: 'repeating-linear-gradient(135deg, var(--surface-sunken) 0 6px, transparent 6px 12px)' }} />
        )}
      </span>
    </button>
  );
}

function Insight({ name, sub, value, v }: { name: string; sub: string; value: string; v?: number }) {
  return (
    <li className="flex items-center justify-between gap-3 border-t border-[var(--border)] py-3 first:border-t-0">
      <span className="min-w-0">
        <span className="block text-sm">{name}</span>
        <span className="block text-[11px] text-[var(--text-muted)]">{sub}</span>
      </span>
      <span className="tabular shrink-0 text-sm font-semibold" style={{ color: v === undefined ? 'var(--text-primary)' : pnlColor(v) }}>
        {value}
      </span>
    </li>
  );
}

/** Top winners and losers with bars to scale; the rest one click away. */
function Movers({ winners, losers }: { winners: [string, number][]; losers: [string, number][] }) {
  const [open, setOpen] = useState(false);
  const n = open ? Infinity : 5;
  const max = Math.max(...[...winners, ...losers].map(([, v]) => Math.abs(v)), 1);
  const list = (title: string, rows: [string, number][]) => (
    <div className="min-w-0">
      <div className="mb-1 text-sm font-semibold">
        {title} <span className="font-normal text-[var(--text-muted)]">· {rows.length}</span>
      </div>
      {rows.length === 0 && <p className="py-2 text-xs text-[var(--text-muted)]">None</p>}
      {rows.slice(0, n).map(([k, v]) => (
        <div key={k} className="py-2">
          <div className="flex justify-between gap-2 text-[13px]">
            <span className="truncate">{k}</span>
            <span className="tabular shrink-0" style={{ color: pnlColor(v) }}>
              {signedInr(v)}
            </span>
          </div>
          <div className="mt-1.5 h-[5px] rounded-full bg-[var(--surface-sunken)]">
            <div className="h-[5px] rounded-full" style={{ width: `${Math.max(2, (Math.abs(v) / max) * 100)}%`, background: v > 0 ? 'var(--good)' : 'var(--critical)' }} />
          </div>
        </div>
      ))}
    </div>
  );
  return (
    <div className="mt-6">
      <div className="grid gap-6 sm:grid-cols-2">
        {list('Top winners', winners)}
        {list('Top losers', losers)}
      </div>
      {(winners.length > 5 || losers.length > 5) && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-3 text-xs font-medium text-[var(--series-blue)] hover:underline">
          {open ? 'Show top 5' : `Show all ${winners.length + losers.length} instruments`}
        </button>
      )}
    </div>
  );
}

type ChartKind = 'bars' | 'cumulative' | 'calendar' | 'drawdown';

const CHART_KINDS: { id: ChartKind; label: string; title: (adjective: string) => string; hint: string }[] = [
  { id: 'bars', label: 'Bars', title: (a) => `${a} P&L`, hint: 'Each bar is one period: green above the line is profit, red below is loss.' },
  { id: 'cumulative', label: 'Cumulative', title: () => 'Cumulative P&L', hint: 'Your running total: how profit or loss built up over the range.' },
  { id: 'calendar', label: 'Calendar', title: () => 'P&L calendar', hint: 'Every trading day in a calendar: deeper green for bigger profit, deeper red for bigger loss.' },
  { id: 'drawdown', label: 'Drawdown', title: () => 'Drawdown', hint: 'How far the running total fell below its previous high, and when it was made back.' },
];

/** Running total, or its fall from the high, with the figures that go with it. */
function CumulativeView({ groups, period, drawdown }: { groups: HistoryDay[]; period: Period; drawdown: boolean }) {
  const pts = cumulativeSeries(groups);
  const dd = maxDrawdown(pts);
  const last = pts[pts.length - 1];
  const high = pts.reduce((a, p) => (p.cum > a.cum ? p : a), pts[0]);
  const low = pts.reduce((a, p) => (p.cum < a.cum ? p : a), pts[0]);
  const label = (d: string) => periodLabel(d, period, true);
  const current = last ? last.drawdown : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {drawdown ? (
          <>
            <Stat label="Max drawdown" value={dd ? signedInr(dd.amount) : '—'} tone={dd ? 'critical' : undefined} hint={dd ? `Low on ${label(dd.troughDate)}` : 'Never below a high'} />
            <Stat label="From the high of" value={dd?.peakDate ? label(dd.peakDate) : dd ? 'Start of range' : '—'} />
            <Stat label="Made back" value={dd ? (dd.recoveredDate ? label(dd.recoveredDate) : 'Not yet') : '—'} tone={dd && !dd.recoveredDate ? 'warning' : undefined} />
            <Stat label="Now below high" value={current < 0 ? signedInr(current) : 'At a high'} tone={current < 0 ? 'critical' : 'good'} />
          </>
        ) : (
          <>
            <Stat label="Total" value={signedInr(last?.cum ?? 0)} tone={tone(last?.cum ?? 0)} />
            <Stat label="Highest" value={high ? signedInr(high.cum) : '—'} hint={high ? label(high.date) : undefined} />
            <Stat label="Lowest" value={low ? signedInr(low.cum) : '—'} hint={low ? label(low.date) : undefined} />
            <Stat label="Max drawdown" value={dd ? signedInr(dd.amount) : '—'} tone={dd ? 'critical' : undefined} />
          </>
        )}
      </div>
      <LineArea
        label={drawdown ? 'Drawdown' : 'Cumulative P&L'}
        tone={drawdown ? 'loss' : 'accent'}
        points={pts.map((p) => ({
          key: p.date,
          label: periodLabel(p.date, period),
          value: drawdown ? p.drawdown : p.cum,
          detail: (
            <div className="flex flex-col gap-0.5">
              <div className="text-[var(--text-muted)]">{label(p.date)}</div>
              <TipLine name="This period" value={p.value} />
              <TipLine name="Running total" value={p.cum} />
              {drawdown && <TipLine name="Below high" value={p.drawdown} />}
            </div>
          ),
        }))}
      />
    </div>
  );
}

/**
 * An equity statement the range only partly covers. It has no trade dates, so
 * it can't be cut to the range: shown whole, apart from the range's totals.
 */
function WholeStatement({ st }: { st: PnlHistory['statements'][number] }) {
  const items = symbolItems(st.undated ?? {}).filter((i) => i.pnl !== 0);
  const winners = items.filter((i) => i.pnl > 0);
  const losers = items.filter((i) => i.pnl < 0);
  const net = st.realised - st.charges + st.other;
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-baseline gap-2">
            {labelOf(st.segment)} · whole statement
            <span className="text-xs font-normal text-[var(--text-muted)]">
              {fmtDate(st.from)} – {fmtDate(st.to)} · not split by date, not in this range&apos;s total
            </span>
          </span>
        }
      >
        <span className="tabular text-sm font-semibold" style={{ color: pnlColor(st.realised) }}>
          {signedInr(st.realised)}
        </span>
      </CardHeader>
      <div className="flex flex-col gap-4 p-4">
        <p className="text-xs text-[var(--text-secondary)]">
          Console&apos;s equity P&amp;L statement lists each stock&apos;s P&amp;L for the whole period with no trade dates, so it can&apos;t be cut to{' '}
          your selected range. To see equity for a year or a month, download the equity P&amp;L statement from Console for
          just that period (Reports → P&amp;L → Equity → date range) and upload it, or upload the equity Tradebook (CSV) for exact days.
        </p>
        <div className="grid gap-5 md:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <div>
            <div className="mb-2 text-xs font-semibold">P&amp;L by instrument</div>
            <DivergingBars
              label={`${labelOf(st.segment)} statement P&L by instrument`}
              rows={topMovers(items, 10).map((r) => ({ key: r.key, label: r.label, value: r.value, detail: r.items.length > 1 ? <div>{r.items.length} instruments</div> : undefined }))}
            />
          </div>
          <div className="grid h-fit grid-cols-2 gap-3">
            <Stat label="Realised" value={signedInr(st.realised)} tone={tone(st.realised)} size="lg" />
            <Stat label="Net after charges" value={signedInr(net)} tone={tone(net)} size="lg" hint={`Charges & other debits ${inr(st.charges - st.other)}`} />
            <Stat label={`Winners · ${winners.length}`} value={signedInr(winners.reduce((a, i) => a + i.pnl, 0))} tone="good" />
            <Stat label={`Losers · ${losers.length}`} value={signedInr(losers.reduce((a, i) => a + i.pnl, 0))} tone={losers.length ? 'critical' : undefined} />
          </div>
        </div>
      </div>
    </Card>
  );
}

/** Where the history comes from, and the upload that adds to it. */
function Sources({ h, onChange }: { h: PnlHistory; onChange: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'info' | 'critical'; text: string } | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setMsg(null);
    try {
      const isXlsx = /\.xlsx$/i.test(file.name);
      const body = isXlsx ? { xlsx: await toBase64(file) } : { csv: await file.text() };
      const res = await api.uploadTradebook(file.name, body);
      if (res.kind === 'statement') {
        const s = res.statements.map((x) => `${labelOf(x.segment)} ${fmtDate(x.from)} – ${fmtDate(x.to)}: ${x.symbols} instruments, ${signedInr(x.realised)}, charges ${inr(x.charges)}`);
        setMsg({ tone: 'info', text: `P&L statement imported — ${s.join('; ')}.` });
      } else {
        setMsg({
          tone: 'info',
          text: `Tradebook imported — ${res.imported} new trade${res.imported === 1 ? '' : 's'}${res.duplicates ? `, ${res.duplicates} already there` : ''}, ${fmtDate(res.from)} – ${fmtDate(res.to)}.`,
        });
      }
      onChange();
    } catch (e) {
      setMsg({ tone: 'critical', text: errorMessage(e) });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const clear = async () => {
    const ok = await confirmDialog({
      title: 'Remove uploaded data?',
      message: 'Every uploaded tradebook and P&L statement is removed. Days the app saved itself are kept.',
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    await api.clearTradebooks();
    setMsg(null);
    onChange();
  };

  const unmatched = Object.entries(h.unmatched);
  const expired = Object.keys(h.expired);
  const mults = Object.entries(h.multipliers);
  const hasUploads = h.uploads.length > 0 || h.statements.length > 0;

  return (
    <Card>
      <CardHeader title="Data sources">
        <input
          ref={input}
          type="file"
          accept=".csv,.xlsx"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        <Button onClick={() => input.current?.click()} disabled={busy}>
          <FileUp size={14} aria-hidden="true" />
          {busy ? 'Uploading…' : 'Upload from Console'}
        </Button>
        {hasUploads && (
          <Button variant="ghost" onClick={clear} aria-label="Remove uploaded data">
            <Trash2 size={14} aria-hidden="true" />
          </Button>
        )}
      </CardHeader>
      <div className="flex flex-col gap-3 p-4 text-xs text-[var(--text-secondary)]">
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <p>
          <strong className="text-[var(--text-primary)]">Saved by the app:</strong>{' '}
          {h.autoSince ? `${h.autoDays} day${h.autoDays === 1 ? '' : 's'} since ${fmtDate(h.autoSince)}.` : 'nothing yet.'} Each day is saved when this page loads, so open it
          once after the market closes (after 11:30 PM for commodity).
        </p>
        <div>
          <strong className="text-[var(--text-primary)]">Uploaded from Zerodha Console:</strong>
          {!hasUploads && <span> nothing yet.</span>}
          <ul className="mt-1 flex flex-col gap-1">
            {h.statements.map((s) => (
              <li key={`s:${s.segment}:${s.from}:${s.to}`}>
                P&amp;L statement · {labelOf(s.segment)} · {fmtDate(s.from)} – {fmtDate(s.to)} · {s.symbols} instruments · <span style={{ color: pnlColor(s.realised) }}>{signedInr(s.realised)}</span>{' '}
                · charges {inr(s.charges)}
              </li>
            ))}
            {h.uploads.map((u) => (
              <li key={`${u.at}:${u.name}`}>
                Tradebook · {u.segments.map(labelOf).join(', ')} · {fmtDate(u.from)} – {fmtDate(u.to)} · {u.trades} trades
              </li>
            ))}
          </ul>
        </div>
        <details className="rounded-md bg-[var(--surface-sunken)] px-3 py-2">
          <summary className="cursor-pointer font-medium text-[var(--text-primary)]">Which file to upload</summary>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-4">
            <li>
              <strong>Tradebook</strong> (Console → Reports → Tradebook → segment and dates → CSV): every trade with its date, so P&amp;L lands on the exact day. Upload one per
              segment; repeats and overlaps are fine.
            </li>
            <li>
              <strong>P&amp;L statement</strong> (Console → Reports → P&amp;L → download .xlsx): totals per contract with charges. It has no trade dates, so each futures /
              options contract is placed on its expiry month and anything else on the statement&apos;s last day.
            </li>
            <li>For a day covered by both, the tradebook wins, then the statement, then what the app saved.</li>
          </ul>
        </details>
        {unmatched.length > 0 && (
          <Notice tone="warning">
            Sales with no purchase in the uploaded tradebooks (bought earlier — upload an older tradebook to include them): {unmatched.map(([s, q]) => `${s} ×${q}`).join(', ')}.
          </Notice>
        )}
        {expired.length > 0 && (
          <Notice tone="info">
            Options held to expiry were settled at ₹0 (expired worthless): {expired.join(', ')}. If one expired in the money, its P&amp;L here is off by its settlement value.
          </Notice>
        )}
        {mults.length > 0 && <p className="text-[var(--text-muted)]">Lot multipliers used for commodity / currency trades: {mults.map(([u, m]) => `${u} ×${m}`).join(', ')}.</p>}
      </div>
    </Card>
  );
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
