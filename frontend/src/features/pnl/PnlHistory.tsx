import { useRef, useState } from 'react';
import { FileUp, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../../api/client';
import type { PnlHistory } from '../../api/types';
import { Button, Card, CardHeader, Notice, Skeleton, Stat, type Tone } from '../../components/ui';
import { SEGMENTS, summarizeHistory, symbolItems, topMovers, type HistoryDay, type Segment } from '../../domain/pnl';
import { useAsync } from '../../hooks/useAsync';
import { confirmDialog } from '../../lib/dialog';
import { inr, signedInr } from '../../lib/format';
import { ColumnBars, DivergingBars, TipLine } from './charts';

type View = 'all' | Segment;

const tone = (v: number): Tone | undefined => (v > 0 ? 'good' : v < 0 ? 'critical' : undefined);
const pnlColor = (v: number) => (v > 0 ? 'var(--good-text)' : v < 0 ? 'var(--critical)' : 'var(--text-secondary)');
const labelOf = (s: Segment) => SEGMENTS.find((x) => x.id === s)!.label;
const fmtDate = (d: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { ...opts, timeZone: 'UTC' });

/** Day-by-day bars up to three months; past that, one bar per month stays readable. */
function chartRows(daily: HistoryDay[], from: string, to: string, segs: Segment[]) {
  const long = Date.parse(to) - Date.parse(from) > 92 * 86_400_000;
  const detail = (d: Pick<HistoryDay, Segment | 'total'>) => (
    <div className="flex flex-col gap-0.5">
      {segs.map((s) => (
        <TipLine key={s} name={labelOf(s)} value={d[s]} />
      ))}
      {segs.length > 1 && <TipLine name="Total" value={d.total} />}
    </div>
  );
  if (!long) {
    return {
      monthly: false,
      months: daily,
      rows: daily.map((d) => ({ key: d.date, label: fmtDate(d.date, { day: 'numeric', month: 'short' }), value: d.total, detail: detail(d) })),
    };
  }
  const byMonth = new Map<string, HistoryDay>();
  for (const d of daily) {
    const k = d.date.slice(0, 7);
    const m = byMonth.get(k) ?? { date: `${k}-01`, equity: 0, fo: 0, commodity: 0, total: 0 };
    m.equity += d.equity;
    m.fo += d.fo;
    m.commodity += d.commodity;
    m.total += d.total;
    byMonth.set(k, m);
  }
  // Every month from the first to the last with P&L, empty ones included, so bars sit on a true time scale.
  const keys = [...byMonth.keys()].sort();
  const months: HistoryDay[] = [];
  if (keys.length) {
    let [y, mo] = keys[0].split('-').map(Number);
    const [ly, lm] = keys[keys.length - 1].split('-').map(Number);
    while (y < ly || (y === ly && mo <= lm)) {
      const k = `${y}-${String(mo).padStart(2, '0')}`;
      months.push(byMonth.get(k) ?? { date: `${k}-01`, equity: 0, fo: 0, commodity: 0, total: 0 });
      mo += 1;
      if (mo > 12) [y, mo] = [y + 1, 1];
    }
  }
  return {
    monthly: true,
    months,
    rows: months.map((m) => ({ key: m.date, label: fmtDate(m.date, { month: 'short', year: '2-digit' }), value: Math.round(m.total * 100) / 100, detail: detail(m) })),
  };
}

/**
 * P&L for any date range: realised P&L from the days this app saved, Console
 * tradebooks (exact days) and Console P&L statements (per contract, placed on
 * its expiry), split by segment, with the upload panel that feeds it.
 */
export function PnlHistoryView({ from, to, rangeLabel, view, onPick }: { from: string; to: string; rangeLabel: string; view: View; onPick: (s: Segment) => void }) {
  const state = useAsync(() => api.pnlHistory(), []);
  const h = state.data;
  const segs: Segment[] = view === 'all' ? SEGMENTS.map((s) => s.id) : [view];

  if (!h) {
    return state.error ? <Notice tone="critical">P&amp;L history: {state.error}</Notice> : <Skeleton className="h-64" />;
  }

  const covered: [string, string][] = [
    ...h.statements.filter((s) => segs.includes(s.segment)).map((s): [string, string] => [s.from, s.to]),
    ...segs.flatMap((s) => (h.coverage[s] ? [h.coverage[s]!] : [])),
  ];
  const sum = summarizeHistory(h.days, from, to, segs, covered);
  // Undated equity statements count whole, and only when the range spans their period.
  const undatedIn = h.statements.filter((s) => s.undated && segs.includes(s.segment) && s.from >= from && s.to <= to);
  const undatedOut = h.statements.filter((s) => s.undated && segs.includes(s.segment) && !(s.from >= from && s.to <= to) && s.from <= to && s.to >= from);
  for (const st of undatedIn) {
    const seg = sum.segments[st.segment];
    for (const [sym, v] of Object.entries(st.undated!)) seg.symbols[sym] = Math.round(((seg.symbols[sym] ?? 0) + v) * 100) / 100;
    seg.realised = Math.round((seg.realised + st.realised) * 100) / 100;
    sum.total = Math.round((sum.total + st.realised) * 100) / 100;
  }
  // Charges are only known from statements whose whole period sits in the range.
  const statementsIn = h.statements.filter((s) => segs.includes(s.segment) && s.from >= from && s.to <= to);
  const charges = statementsIn.reduce((a, s) => a + s.charges - s.other, 0);
  const chart = chartRows(sum.daily, from, to, segs);
  // Long ranges read in months: profit / loss counts and best / worst follow the chart.
  const unit = chart.monthly ? 'month' : 'day';
  const periods = chart.months.filter((m) => m.total !== 0);
  const best = periods.reduce<HistoryDay | null>((a, d) => (d.total > 0 && (!a || d.total > a.total) ? d : a), null);
  const worst = periods.reduce<HistoryDay | null>((a, d) => (d.total < 0 && (!a || d.total < a.total) ? d : a), null);
  const when = (d: HistoryDay) => (chart.monthly ? fmtDate(d.date, { month: 'long', year: 'numeric' }) : fmtDate(d.date));
  const empty = sum.daily.every((d) => d.total === 0) && sum.total === 0;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title={`Realised P&L · ${rangeLabel}`}>
          <span className="text-xs text-[var(--text-muted)]">
            {fmtDate(from)} – {fmtDate(to)}
          </span>
        </CardHeader>
        <div className="grid gap-5 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
          <div className="flex flex-col gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                Realised P&amp;L{view === 'all' ? ' · all segments' : ` · ${labelOf(view)}`}
              </div>
              <div className="tabular text-4xl font-semibold leading-tight sm:text-5xl" style={{ color: pnlColor(sum.total) }}>
                {signedInr(sum.total)}
              </div>
              {statementsIn.length > 0 ? (
                <div className="mt-1 text-xs text-[var(--text-secondary)]">
                  Charges &amp; other debits {inr(charges)} · Net <span style={{ color: pnlColor(sum.total - charges) }}>{signedInr(sum.total - charges)}</span>
                </div>
              ) : (
                <div className="mt-1 text-xs text-[var(--text-muted)]">Before charges and taxes</div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Stat label={`Profit ${unit}s`} value={periods.filter((d) => d.total > 0).length} tone={periods.some((d) => d.total > 0) ? 'good' : undefined} />
              <Stat label={`Loss ${unit}s`} value={periods.filter((d) => d.total < 0).length} tone={periods.some((d) => d.total < 0) ? 'critical' : undefined} />
              <Stat label={`Best ${unit}`} value={best ? signedInr(best.total) : '—'} tone={best ? 'good' : undefined} hint={best ? when(best) : undefined} />
              <Stat label={`Worst ${unit}`} value={worst ? signedInr(worst.total) : '—'} tone={worst ? 'critical' : undefined} hint={worst ? when(worst) : undefined} />
            </div>
          </div>
          <div className="flex flex-col gap-4">
            {view === 'all' && (
              <div>
                <div className="mb-2 text-xs font-semibold">P&amp;L by segment</div>
                <DivergingBars
                  label="Realised P&L by segment"
                  rows={SEGMENTS.map((s) => ({
                    key: s.id,
                    label: s.label,
                    value: sum.segments[s.id].realised,
                    detail: (
                      <div className="flex flex-col gap-0.5">
                        <div className="mb-0.5 font-semibold">{s.label}</div>
                        <TipLine name="Realised" value={sum.segments[s.id].realised} />
                        <div className="text-[var(--text-muted)]">{sum.segments[s.id].days} trading days</div>
                      </div>
                    ),
                  }))}
                />
              </div>
            )}
            <div>
              <div className="mb-2 text-xs font-semibold">{chart.monthly ? 'Monthly' : 'Daily'} P&amp;L</div>
              {chart.rows.length ? (
                <ColumnBars rows={chart.rows} label={`${chart.monthly ? 'Monthly' : 'Daily'} realised P&L`} />
              ) : (
                <p className="py-8 text-center text-sm text-[var(--text-muted)]">No P&amp;L recorded in this range.</p>
              )}
            </div>
          </div>
        </div>
      </Card>

      {sum.missingWeekdays > 0 && !empty && (
        <Notice tone="info">
          {sum.missingWeekdays} weekday{sum.missingWeekdays === 1 ? ' has' : 's have'} no record in this range (market holidays count too). Upload a Console tradebook
          covering them below to fill the gaps.
        </Notice>
      )}

      {undatedIn.length > 0 && (
        <Notice tone="info">
          Equity P&amp;L of {signedInr(undatedIn.reduce((a, s) => a + s.realised, 0))} comes from a P&amp;L statement with no trade dates: it&apos;s in the totals but not in the
          monthly chart. Upload an equity Tradebook (CSV) to see it month by month.
        </Notice>
      )}
      {undatedOut.length > 0 && (
        <Notice tone="info">
          Your equity P&amp;L statement ({undatedOut.map((s) => `${fmtDate(s.from)} – ${fmtDate(s.to)}`).join(', ')}) has no trade dates, so it can only be counted when the range
          covers its whole period. Upload an equity Tradebook (CSV) to see equity P&amp;L for any dates.
        </Notice>
      )}

      {segs.map((s) => (
        <SegmentHistory key={s} seg={s} data={sum.segments[s]} onPick={view === 'all' ? () => onPick(s) : undefined} />
      ))}

      <Sources h={h} onChange={state.reload} />
    </div>
  );
}

function SegmentHistory({ seg, data, onPick }: { seg: Segment; data: { realised: number; symbols: Record<string, number>; days: number }; onPick?: () => void }) {
  const meta = SEGMENTS.find((s) => s.id === seg)!;
  const items = symbolItems(data.symbols).filter((i) => i.pnl !== 0);
  const winners = items.filter((i) => i.pnl > 0);
  const losers = items.filter((i) => i.pnl < 0);
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-baseline gap-2">
            {onPick ? (
              <button type="button" onClick={onPick} className="hover:underline" title={`Show only ${meta.label}`}>
                {meta.label}
              </button>
            ) : (
              meta.label
            )}
            <span className="text-xs font-normal text-[var(--text-muted)]">{meta.note}</span>
          </span>
        }
      >
        <span className="tabular text-sm font-semibold" style={{ color: pnlColor(data.realised) }}>
          {signedInr(data.realised)}
        </span>
      </CardHeader>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">No realised {meta.label} P&amp;L in this range.</p>
      ) : (
        <div className="grid gap-5 p-4 md:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <div>
            <div className="mb-2 text-xs font-semibold">P&amp;L by instrument</div>
            <DivergingBars
              label={`${meta.label} realised P&L by instrument`}
              rows={topMovers(items, 10).map((r) => ({
                key: r.key,
                label: r.label,
                value: r.value,
                detail: r.items.length > 1 ? <div>{r.items.length} instruments</div> : undefined,
              }))}
            />
          </div>
          <div className="grid h-fit grid-cols-2 gap-3">
            <Stat label="Realised" value={signedInr(data.realised)} tone={tone(data.realised)} size="lg" />
            <Stat label="Days with P&L" value={data.days || '—'} size="lg" hint={data.days === 0 ? 'Statement has no dates' : undefined} />
            <Stat label={`Winners · ${winners.length}`} value={signedInr(winners.reduce((a, i) => a + i.pnl, 0))} tone="good" />
            <Stat label={`Losers · ${losers.length}`} value={signedInr(losers.reduce((a, i) => a + i.pnl, 0))} tone={losers.length ? 'critical' : undefined} />
          </div>
        </div>
      )}
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
