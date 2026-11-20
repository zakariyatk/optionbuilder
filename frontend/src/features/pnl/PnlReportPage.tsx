import { useState } from 'react';
import { Download, ExternalLink, RefreshCw } from 'lucide-react';
import { api, ZERODHA_LOGIN_URL } from '../../api/client';
import type { AuthStatus, ZerodhaFunds, ZerodhaPnl } from '../../api/types';
import { Button, Card, CardHeader, Notice, Skeleton, Stat, type Tone } from '../../components/ui';
import { pnlBySegment, positionSegment, SEGMENTS, topMovers, type Segment, type SegmentPnl } from '../../domain/pnl';
import { useAsync } from '../../hooks/useAsync';
import { inr, num, signedInr, signedPct } from '../../lib/format';
import { Segmented } from '../builder/parts';
import { DivergingBars, FundsMeter, TipLine } from './charts';

/** P&L refreshes this often while the tab is visible. */
const PNL_POLL_MS = 15_000;

type View = 'all' | Segment;

const th = 'whitespace-nowrap bg-[var(--surface-sunken)] px-3 py-2 text-right text-[10px] font-normal uppercase tracking-[0.08em] text-[var(--text-muted)]';
const thLeft = th.replace('text-right', 'text-left');
const td = 'whitespace-nowrap px-3 py-2.5 text-right tabular';
const tdLeft = 'whitespace-nowrap px-3 py-2.5 text-left';

const tone = (v: number): Tone | undefined => (v > 0 ? 'good' : v < 0 ? 'critical' : undefined);
const pnlColor = (v: number) => (v > 0 ? 'var(--good-text)' : v < 0 ? 'var(--critical)' : 'var(--text-secondary)');
const labelOf = (s: Segment) => SEGMENTS.find((x) => x.id === s)!.label;

function Pnl({ value }: { value: number }) {
  return <span style={{ color: pnlColor(value) }}>{signedInr(value)}</span>;
}

/** Realised / unrealised / today, the breakdown every tooltip on this page shows. */
function Breakdown({ title, realised, unrealised, today }: { title: string; realised: number; unrealised: number; today: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="mb-0.5 font-semibold">{title}</div>
      <TipLine name="Realised" value={realised} />
      <TipLine name="Unrealised" value={unrealised} />
      <TipLine name="Today" value={today} />
    </div>
  );
}

/**
 * P&L Report: live profit and loss straight from the Zerodha account, split
 * into Equity, F&O and Commodity — an overview of all three, then a section
 * per segment with its figures, its biggest movers, funds and every row.
 */
export function PnlReportPage({ broker }: { broker: AuthStatus | null }) {
  const z = broker?.zerodha;
  const connected = !!z?.authenticated;
  const state = useAsync(() => api.zerodhaPnl(), [connected], { pollMs: PNL_POLL_MS, enabled: connected });
  const [view, setView] = useState<View>('all');

  if (broker && !z?.configured) {
    return (
      <Card className="px-4 py-10 text-center text-sm text-[var(--text-secondary)]">
        The P&amp;L report reads your Zerodha account. Add <code>kite_api_key</code> and <code>kite_api_secret</code> to the server config to turn it on.
      </Card>
    );
  }

  const loginExpired = state.error !== null && state.error.includes('ZERODHA_NOT_AUTHENTICATED');
  if (!connected || loginExpired) {
    return (
      <Card className="flex flex-col items-center gap-3 px-4 py-10 text-center text-sm text-[var(--text-secondary)]">
        <p>{loginExpired ? 'Your Zerodha login has expired (they end at 6:00 AM daily).' : 'Connect Zerodha to see your live P&L.'}</p>
        <a
          href={ZERODHA_LOGIN_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-[var(--series-blue)] px-4 py-2 font-medium text-white"
        >
          Connect Zerodha
          <ExternalLink size={16} aria-hidden="true" />
        </a>
        <p className="text-xs text-[var(--text-muted)]">Opens in a new tab. Come back here when it says connected.</p>
      </Card>
    );
  }

  const data = state.data;
  const segs = data ? pnlBySegment(data) : null;
  const shown = view === 'all' ? SEGMENTS.map((s) => s.id) : [view];

  return (
    <div className="flex flex-col gap-4">
      {state.error && <Notice tone="critical">P&amp;L: {state.error}</Notice>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented<View>
          label="Segment"
          value={view}
          onChange={setView}
          options={[{ id: 'all', label: 'All' }, ...SEGMENTS.map((s) => ({ id: s.id, label: s.label, title: s.note }))]}
        />
        <div className="flex gap-2">
          <Button onClick={state.reload} disabled={state.loading} aria-label="Refresh P&L">
            <RefreshCw size={14} aria-hidden="true" className={state.loading ? 'animate-spin' : ''} />
            Refresh
          </Button>
          <Button onClick={() => data && downloadCsv(data)} disabled={!data}>
            <Download size={14} aria-hidden="true" />
            CSV
          </Button>
        </div>
      </div>
      <p className="-mt-2 text-xs text-[var(--text-muted)]">
        Live from your Zerodha account{z?.token?.user_name ? ` (${z.token.user_name})` : ''}
        {data ? ` · updated ${new Date(data.at).toLocaleTimeString('en-IN')}` : ''}
      </p>

      {!data || !segs ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <>
          {view === 'all' && <Overview segs={segs} onPick={setView} />}
          {shown.map((s) => (
            <SegmentSection key={s} seg={segs[s]} data={data} funds={fundsFor(data, s)} />
          ))}
          <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
            Realised P&amp;L is booked on quantity closed today; unrealised is on what is still open — for holdings, against your average buy price.
            &ldquo;Today&rdquo; is the move since yesterday&apos;s close (M2M for positions, day change for holdings). Currency derivatives sit under
            F&amp;O. Older statements (tax P&amp;L, past financial years) are only in Zerodha Console — Kite Connect has no API for them.
          </p>
        </>
      )}
    </div>
  );
}

/** Zerodha keeps funds in two segments: equity (which also pays for F&O) and commodity. */
function fundsFor(data: ZerodhaPnl, s: Segment): { funds: ZerodhaFunds; note?: string } | null {
  const f = s === 'commodity' ? data.funds?.commodity : data.funds?.equity;
  if (!f) return null;
  return { funds: f, note: s === 'commodity' ? undefined : 'Zerodha’s equity funds — shared by equity and F&O.' };
}

function Overview({ segs, onPick }: { segs: Record<Segment, SegmentPnl>; onPick: (s: Segment) => void }) {
  const all = SEGMENTS.map((s) => segs[s.id]);
  const total = all.reduce((a, s) => a + s.total, 0);
  const realised = all.reduce((a, s) => a + s.realised, 0);
  const unrealised = all.reduce((a, s) => a + s.unrealised, 0);
  const today = all.reduce((a, s) => a + s.today, 0);

  return (
    <Card>
      <CardHeader title="Overview" />
      <div className="grid gap-5 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <div className="flex flex-col gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Total P&amp;L · all segments</div>
            <div className="tabular text-4xl font-semibold leading-tight sm:text-5xl" style={{ color: pnlColor(total) }}>
              {signedInr(total)}
            </div>
            <div className="mt-1 text-xs text-[var(--text-secondary)]">
              Today <Pnl value={today} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Realised" value={signedInr(realised)} tone={tone(realised)} />
            <Stat label="Unrealised" value={signedInr(unrealised)} tone={tone(unrealised)} />
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold">P&amp;L by segment</div>
          <DivergingBars
            label="P&L by segment"
            rows={all.map((s) => ({
              key: s.segment,
              label: labelOf(s.segment),
              value: s.total,
              description: `${labelOf(s.segment)}: ${signedInr(s.total)}, realised ${signedInr(s.realised)}, unrealised ${signedInr(s.unrealised)}, today ${signedInr(s.today)}`,
              detail: <Breakdown title={labelOf(s.segment)} realised={s.realised} unrealised={s.unrealised} today={s.today} />,
            }))}
          />
          <div className="mt-4 grid grid-cols-3 gap-2">
            {all.map((s) => (
              <button
                key={s.segment}
                type="button"
                onClick={() => onPick(s.segment)}
                className="rounded-md border border-[var(--border)] px-3 py-2 text-left hover:border-[var(--border-strong)] hover:bg-[var(--surface-sunken)]"
                title={`Show only ${labelOf(s.segment)}`}
              >
                <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{labelOf(s.segment)} today</div>
                <div className="tabular truncate text-sm font-semibold" style={{ color: pnlColor(s.today) }}>
                  {signedInr(s.today)}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function SegmentSection({ seg, data, funds }: { seg: SegmentPnl; data: ZerodhaPnl; funds: { funds: ZerodhaFunds; note?: string } | null }) {
  const meta = SEGMENTS.find((s) => s.id === seg.segment)!;
  const positions = data.positions.filter((p) => positionSegment(p) === seg.segment);
  const holdings = seg.segment === 'equity' ? data.holdings : [];
  const emptySeg = positions.length === 0 && holdings.length === 0;
  const winners = seg.items.filter((i) => i.pnl > 0);
  const losers = seg.items.filter((i) => i.pnl < 0);

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-baseline gap-2">
            {meta.label}
            <span className="text-xs font-normal text-[var(--text-muted)]">{meta.note}</span>
          </span>
        }
      >
        <span className="tabular text-sm font-semibold">
          <Pnl value={seg.total} />
        </span>
      </CardHeader>

      {emptySeg ? (
        <div className="flex flex-col gap-4 p-4">
          <p className="text-center text-sm text-[var(--text-muted)]">No {meta.label} positions{seg.segment === 'equity' ? ' or holdings' : ''} today.</p>
          {funds && (
            <div className="mx-auto w-full max-w-sm">
              <FundsMeter used={funds.funds.used} available={funds.funds.available} note={funds.note} />
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4 p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Total P&L" value={signedInr(seg.total)} tone={tone(seg.total)} size="lg" />
            <Stat label="Realised" value={signedInr(seg.realised)} tone={tone(seg.realised)} size="lg" hint={`${seg.closedPositions} closed today`} />
            <Stat
              label="Unrealised"
              value={signedInr(seg.unrealised)}
              tone={tone(seg.unrealised)}
              size="lg"
              hint={`${seg.openPositions} open${seg.holdings ? ` · ${seg.holdings} holdings` : ''}`}
            />
            <Stat label="Today" value={signedInr(seg.today)} tone={tone(seg.today)} size="lg" hint="Since yesterday’s close" />
          </div>

          <div className="grid gap-5 md:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            <div>
              <div className="mb-2 text-xs font-semibold">P&amp;L by instrument</div>
              <DivergingBars
                label={`${meta.label} P&L by instrument`}
                rows={topMovers(seg.items).map((r) => {
                  const sum = (f: 'realised' | 'unrealised' | 'today') => r.items.reduce((a, i) => a + i[f], 0);
                  const one = r.items.length === 1 ? r.items[0] : null;
                  return {
                    key: r.key,
                    label: (
                      <span title={r.label}>
                        {r.label}
                        {one?.kind === 'holding' && <span className="ml-1 text-[10px] text-[var(--text-muted)]">hold</span>}
                        {one && one.kind === 'position' && !one.open && <span className="ml-1 text-[10px] text-[var(--text-muted)]">closed</span>}
                      </span>
                    ),
                    value: r.value,
                    labelChars: r.label.length + (one?.kind === 'holding' ? 5 : one && !one.open ? 7 : 0),
                    description: `${r.label}: ${signedInr(r.value)}`,
                    detail: <Breakdown title={r.label} realised={sum('realised')} unrealised={sum('unrealised')} today={sum('today')} />,
                  };
                })}
              />
            </div>

            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <Stat label={`Winners · ${winners.length}`} value={signedInr(winners.reduce((a, i) => a + i.pnl, 0))} tone="good" />
                <Stat label={`Losers · ${losers.length}`} value={signedInr(losers.reduce((a, i) => a + i.pnl, 0))} tone={losers.length ? 'critical' : undefined} />
              </div>
              {seg.segment === 'equity' && seg.holdings > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Invested" value={inr(seg.invested)} />
                  <Stat
                    label="Current value"
                    value={inr(seg.current)}
                    hint={seg.invested > 0 ? `${signedPct(((seg.current - seg.invested) / seg.invested) * 100)} on holdings` : undefined}
                  />
                </div>
              )}
              {funds && <FundsMeter used={funds.funds.used} available={funds.funds.available} note={funds.note} />}
            </div>
          </div>

          <Rows positions={positions} holdings={holdings} />
        </div>
      )}
    </Card>
  );
}

/** Every row of a segment: a table on wide screens, a compact list on phones. */
function Rows({ positions, holdings }: { positions: ZerodhaPnl['positions']; holdings: ZerodhaPnl['holdings'] }) {
  type Row = { key: string; symbol: string; exchange: string; kind: string; qty: string; avg: number; ltp: number; realised: number; unrealised: number; today: number; pnl: number; muted: boolean };
  const rows: Row[] = [
    ...positions.map((p) => ({
      key: `p:${p.exchange}:${p.symbol}:${p.product}`,
      symbol: p.symbol,
      exchange: p.exchange,
      kind: p.product,
      qty: p.quantity === 0 ? 'Closed' : String(p.quantity),
      avg: p.average,
      ltp: p.last,
      realised: p.realised,
      unrealised: p.unrealised,
      today: p.m2m,
      pnl: p.pnl,
      muted: p.quantity === 0,
    })),
    ...holdings.map((h) => ({
      key: `h:${h.exchange}:${h.symbol}`,
      symbol: h.symbol,
      exchange: h.exchange,
      kind: 'Holding',
      qty: String(h.quantity),
      avg: h.average,
      ltp: h.last,
      realised: 0,
      unrealised: h.pnl,
      today: h.dayChange,
      pnl: h.pnl,
      muted: false,
    })),
  ];

  return (
    <div className="-mx-4 -mb-4 border-t border-[var(--border)]">
      <ul className="md:hidden">
        {rows.map((r) => (
          <li key={r.key} className={`flex items-start justify-between gap-3 border-t border-[var(--border)] px-4 py-2.5 first:border-t-0 ${r.muted ? 'opacity-70' : ''}`}>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{r.symbol}</div>
              <div className="text-[11px] text-[var(--text-muted)]">
                {r.kind} · {r.qty === 'Closed' ? 'Closed' : `Qty ${r.qty}`} · Avg {num(r.avg)} · LTP {num(r.ltp)}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="tabular text-sm font-semibold">
                <Pnl value={r.pnl} />
              </div>
              <div className="tabular text-[11px] text-[var(--text-muted)]">Today {signedInr(r.today)}</div>
            </div>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr>
              <th className={thLeft} scope="col">Instrument</th>
              <th className={thLeft} scope="col">Type</th>
              <th className={th} scope="col">Qty</th>
              <th className={th} scope="col">Avg</th>
              <th className={th} scope="col">LTP</th>
              <th className={th} scope="col">Realised</th>
              <th className={th} scope="col">Unrealised</th>
              <th className={th} scope="col">Today</th>
              <th className={th} scope="col">P&amp;L</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={`border-t border-[var(--border)] ${r.muted ? 'text-[var(--text-muted)]' : ''}`}>
                <td className={tdLeft}>
                  <span className="font-medium">{r.symbol}</span> <span className="text-[10px] text-[var(--text-muted)]">{r.exchange}</span>
                </td>
                <td className={tdLeft}>{r.kind}</td>
                <td className={td}>{r.qty}</td>
                <td className={td}>{num(r.avg)}</td>
                <td className={td}>{num(r.ltp)}</td>
                <td className={td}>
                  <Pnl value={r.realised} />
                </td>
                <td className={td}>
                  <Pnl value={r.unrealised} />
                </td>
                <td className={td}>
                  <Pnl value={r.today} />
                </td>
                <td className={`${td} font-semibold`}>
                  <Pnl value={r.pnl} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Every row of every segment as one CSV, for a spreadsheet or the accountant. */
function downloadCsv(data: ZerodhaPnl): void {
  const cell = (v: string | number) => (typeof v === 'number' ? String(v) : `"${v.replace(/"/g, '""')}"`);
  const lines: (string | number)[][] = [
    ['Segment', 'Type', 'Instrument', 'Exchange', 'Product', 'Quantity', 'Average', 'LTP', 'Invested', 'Current', 'Realised', 'Unrealised', 'Today', 'P&L'],
    ...data.positions.map((p) => [labelOf(positionSegment(p)), 'Position', p.symbol, p.exchange, p.product, p.quantity, p.average, p.last, '', '', p.realised, p.unrealised, p.m2m, p.pnl]),
    ...data.holdings.map((h) => ['Equity', 'Holding', h.symbol, h.exchange, 'CNC', h.quantity, h.average, h.last, h.invested, h.current, 0, h.pnl, h.dayChange, h.pnl]),
  ];
  const blob = new Blob([lines.map((row) => row.map(cell).join(',')).join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `zerodha-pnl-${new Date(data.at).toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

