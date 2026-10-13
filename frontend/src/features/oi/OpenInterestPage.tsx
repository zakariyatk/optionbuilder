import { useEffect, useMemo, useState } from 'react';
import { api, UPSTOX_LOGIN_URL } from '../../api/client';
import type { SpotQuote } from '../../api/types';
import { Card } from '../../components/ui';
import { daysToExpiry, formatExpiry } from '../../domain/dates';
import { fullDayFromChain, isWeekly, mergeWindows, pcr, strikesAround, windowFromHistory } from '../../domain/oi';
import { useAsync } from '../../hooks/useAsync';
import { compactIndian, num } from '../../lib/format';
import { OiChart } from './OiChart';

const POLL_MS = 60_000;
const MAX_EXPIRIES = 6;
const AROUND = [5, 10, 15, 20, 25] as const;
const PRESETS = [
  { label: 'Last 5 mins', minutes: 5 },
  { label: 'Last 10 mins', minutes: 10 },
  { label: 'Last 15 mins', minutes: 15 },
  { label: 'Last 30 mins', minutes: 30 },
  { label: 'Last 1 Hr', minutes: 60 },
  { label: 'Last 2 Hrs', minutes: 120 },
  { label: 'Last 3 Hrs', minutes: 180 },
  { label: 'Full Day', minutes: null },
] as const;

type Tab = 'change' | 'oi';
/** A preset follows the latest minute as the history refreshes; `custom` holds the slider position. */
type Window = { preset: number | null } | { custom: [number, number] };

const istTime = (t: number) => new Date(t * 1000).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const istDay = (t: number) => new Date(t * 1000).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
const signedCr = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${compactIndian(Math.abs(v), 2)}`;

export function OpenInterestPage({ symbol, spot, brokerConnected }: { symbol: string; spot: SpotQuote | null; brokerConnected: boolean }) {
  const [tab, setTab] = useState<Tab>('change');
  const [showOi, setShowOi] = useState(false);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [around, setAround] = useState<number | 'all' | null>(10);
  const [range, setRange] = useState<{ min: number; max: number } | null>(null);
  const [win, setWin] = useState<Window>({ preset: null });

  // The nearest chain gives the expiry list.
  const base = useAsync(() => api.optionChain(symbol), [symbol], { pollMs: POLL_MS, enabled: brokerConnected });
  const expiries = useMemo(() => (base.data?.expiryDates ?? []).slice(0, MAX_EXPIRIES), [base.data]);
  const selected = picked ?? (base.data?.expiry ? [base.data.expiry] : []);
  useEffect(() => {
    setPicked(null);
    setRange(null);
    setAround(10);
  }, [symbol]);

  const chains = useAsync(() => Promise.all(selected.map((e) => api.optionChain(symbol, e))), [symbol, selected.join(',')], {
    pollMs: POLL_MS,
    enabled: brokerConnected && selected.length > 0,
  });

  const spotNow = spot?.price ?? base.data?.underlyingValue ?? null;
  const strikes = useMemo(() => [...new Set((chains.data ?? []).flatMap((c) => c.rows.map((r) => r.strike)))].sort((a, b) => a - b), [chains.data]);
  const step = strikes.length > 1 ? Math.min(...strikes.slice(1).map((s, i) => s - strikes[i]).filter((d) => d > 0)) : 50;

  // Strike range: N around ATM, everything, or a custom min / max.
  const bounds = useMemo(() => {
    if (!strikes.length) return null;
    if (around === 'all') return { min: strikes[0], max: strikes[strikes.length - 1] };
    if (around !== null && spotNow) return strikesAround(strikes, spotNow, around);
    return range;
  }, [strikes, around, spotNow, range]);
  const min = bounds?.min ?? 0;
  const max = bounds?.max ?? 0;

  const history = useAsync(() => Promise.all(selected.map((e) => api.oiIntraday(symbol, e, min, max))), [symbol, selected.join(','), min, max], {
    pollMs: POLL_MS,
    enabled: brokerConnected && selected.length > 0 && max > min,
  });
  const times = useMemo(() => history.data?.[0]?.times ?? [], [history.data]);
  const last = times.length - 1;

  const [startIdx, endIdx] = useMemo((): [number, number] => {
    if (last < 0) return [0, 0];
    if ('custom' in win) return [Math.min(win.custom[0], last), Math.min(win.custom[1], last)];
    if (win.preset === null) return [0, last];
    const from = times[last] - win.preset * 60;
    const i = times.findIndex((t) => t >= from);
    return [Math.max(0, i), last];
  }, [win, times, last]);
  const fullDay = startIdx === 0 && endIdx === last;

  // Full day comes straight from the chain (always available); other windows need the history.
  const rows = useMemo(() => {
    const inRange = (r: { strike: number }) => r.strike >= min && r.strike <= max;
    if (fullDay || !history.data) return mergeWindows((chains.data ?? []).map((c) => fullDayFromChain(c.rows))).filter(inRange);
    return mergeWindows(history.data.map((h) => windowFromHistory(h, startIdx, endIdx))).filter(inRange);
  }, [fullDay, history.data, chains.data, startIdx, endIdx, min, max]);

  const callChg = rows.reduce((s, r) => s + r.call.end - r.call.start, 0);
  const putChg = rows.reduce((s, r) => s + r.put.end - r.put.start, 0);
  const spotSeries = history.data?.[0]?.spot ?? [];
  const spotAt = (i: number) => {
    for (let k = i; k >= 0; k--) if (spotSeries[k] != null) return spotSeries[k];
    return null;
  };
  const ratio = pcr((chains.data ?? []).flatMap((c) => c.rows));
  const vix = useAsync(() => api.watch(['INDIAVIX']), [], { pollMs: POLL_MS });
  const vixQuote = vix.data?.quotes[0];
  const vixOk = vixQuote && !('error' in vixQuote) ? vixQuote : null;

  const chartMode = tab === 'oi' ? 'oi' : showOi ? 'showOi' : 'change';
  const day = times.length ? istDay(times[last]) : istDay(Date.now() / 1000);

  const toggleExpiry = (e: string) => {
    const next = selected.includes(e) ? selected.filter((x) => x !== e) : [...selected, e];
    if (next.length) setPicked(next);
  };
  const setCustomRange = (patch: Partial<{ min: number; max: number }>) => {
    const cur = bounds ?? { min, max };
    const next = { ...cur, ...patch };
    if (next.max > next.min) {
      setAround(null);
      setRange(next);
    }
  };

  if (!brokerConnected) {
    return (
      <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center text-sm text-[var(--text-muted)]">
        Open interest comes from your Upstox option chain.
        <a href={UPSTOX_LOGIN_URL} target="_blank" rel="noreferrer" className="rounded-md bg-[var(--series-blue)] px-4 py-2 font-medium text-white">
          Connect Upstox →
        </a>
      </Card>
    );
  }

  const pill = (active: boolean) =>
    `rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
      active ? 'border-[var(--series-blue)] text-[var(--series-blue)]' : 'border-[var(--border)] text-[var(--text-primary)] hover:border-[var(--border-strong)]'
    }`;
  const stepper = 'flex h-8 w-8 items-center justify-center text-base hover:bg-[var(--surface-sunken)]';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)]">
        <div className="flex" role="tablist" aria-label="Open interest views">
          {(
            [
              ['change', 'OI Change'],
              ['oi', 'Open Interest'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`relative px-4 py-2.5 text-sm font-medium ${
                tab === id
                  ? 'text-[var(--series-blue)] after:absolute after:inset-x-3 after:bottom-0 after:h-[3px] after:rounded-t after:bg-[var(--series-blue)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4 pb-1 text-sm tabular">
          {vixOk && (
            <span>
              INDIAVIX {num(vixOk.price)}{' '}
              <span style={{ color: vixOk.price >= vixOk.previousClose ? 'var(--good-text)' : 'var(--critical)' }}>
                {vixOk.price - vixOk.previousClose >= 0 ? '+' : ''}
                {num(vixOk.price - vixOk.previousClose)}
              </span>
            </span>
          )}
          <span title="Put-call ratio of open interest across the selected expiries">
            PCR <b>{ratio !== null ? ratio.toFixed(2) : '—'}</b>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Card className="p-4">
            <div className="flex items-center justify-between rounded-md border border-[var(--border)] px-3 py-2 text-sm">
              <span className="font-medium">{symbol}</span>
              <span className="tabular">
                {spotNow ? num(spotNow) : '—'}
                {spot && spot.previousClose > 0 && (
                  <span className="ml-1.5 text-xs" style={{ color: spot.price >= spot.previousClose ? 'var(--good-text)' : 'var(--critical)' }}>
                    {(((spot.price - spot.previousClose) / spot.previousClose) * 100).toFixed(2)}%
                  </span>
                )}
              </span>
            </div>
            <div className="mt-2 text-xs text-[var(--text-muted)]">Change the underlying from Strategy Builder.</div>

            <div className="mt-4 text-sm text-[var(--text-secondary)]">Expiries included</div>
            <div className="mt-2 flex flex-col gap-1.5">
              {expiries.map((e) => {
                const dte = daysToExpiry(e);
                return (
                  <label key={e} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" checked={selected.includes(e)} onChange={() => toggleExpiry(e)} className="h-4 w-4 accent-[var(--series-blue)]" />
                    {formatExpiry(e)} <span className="text-[var(--text-muted)]">({dte === 0 ? 'today' : `${dte} day${dte === 1 ? '' : 's'}`})</span>
                    {isWeekly(e, base.data?.expiryDates ?? []) && (
                      <span className="rounded-full bg-[var(--surface-sunken)] px-1.5 text-[10px] font-semibold text-[var(--series-blue)]">W</span>
                    )}
                  </label>
                );
              })}
              {expiries.length === 0 && <span className="text-xs text-[var(--text-muted)]">{base.error ?? 'Loading expiries…'}</span>}
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--text-secondary)]">Strike range</span>
              <button type="button" onClick={() => setAround(10)} className="text-sm font-medium text-[var(--series-blue)] hover:underline">
                ↺ Reset
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {(
                [
                  ['Min', 'min'],
                  ['Max', 'max'],
                ] as const
              ).map(([label, key]) => (
                <div key={key}>
                  <div className="mb-1 text-xs text-[var(--text-muted)]">{label}</div>
                  <div className="flex items-center overflow-hidden rounded-md border border-[var(--border)]">
                    <button type="button" className={stepper} aria-label={`Lower ${label}`} onClick={() => setCustomRange({ [key]: (key === 'min' ? min : max) - step })}>
                      −
                    </button>
                    <span className="flex-1 text-center text-sm tabular">{bounds ? (key === 'min' ? min : max) : '—'}</span>
                    <button type="button" className={stepper} aria-label={`Raise ${label}`} onClick={() => setCustomRange({ [key]: (key === 'min' ? min : max) + step })}>
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 text-sm text-[var(--text-secondary)]">Strikes above and below ATM</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={pill(around === 'all')} onClick={() => setAround('all')}>
                Show All
              </button>
              {AROUND.map((a) => (
                <button key={a} type="button" className={pill(around === a)} onClick={() => setAround(a)}>
                  {a}
                </button>
              ))}
            </div>
          </Card>
        </div>

        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">
              {tab === 'change' ? 'OI Change' : 'Open Interest'} on {day}
            </h2>
            {tab === 'change' && (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <span className="relative inline-flex h-5 w-9 items-center">
                  <input type="checkbox" className="peer sr-only" checked={showOi} onChange={(e) => setShowOi(e.target.checked)} />
                  <span className="absolute inset-0 rounded-full bg-[var(--border-strong)] transition-colors peer-checked:bg-[var(--series-blue)]" />
                  <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
                </span>
                Show OI
              </label>
            )}
          </div>

          <div className="mt-2">
            {chains.data ? (
              <OiChart rows={rows} mode={chartMode} spot={spotNow} symbol={symbol} />
            ) : (
              <div className="flex h-72 items-center justify-center text-sm text-[var(--text-muted)]">{chains.error ?? 'Loading open interest…'}</div>
            )}
          </div>

          <div className="mt-4 flex items-center gap-3 text-sm tabular">
            <span className="w-20 text-right text-[var(--text-secondary)]">{times.length ? istTime(times[startIdx]) : '9:15 am'}</span>
            <div className="ob-dual relative h-6 flex-1">
              <input
                type="range"
                className="ob-range absolute inset-0 w-full"
                min={0}
                max={Math.max(last, 0)}
                value={startIdx}
                disabled={last <= 0}
                aria-label="Window start"
                onChange={(e) => setWin({ custom: [Math.min(Number(e.target.value), endIdx - 1), endIdx] })}
              />
              <input
                type="range"
                className="ob-range absolute inset-0 w-full"
                min={0}
                max={Math.max(last, 0)}
                value={endIdx}
                disabled={last <= 0}
                aria-label="Window end"
                onChange={(e) => setWin({ custom: [startIdx, Math.max(Number(e.target.value), startIdx + 1)] })}
              />
            </div>
            <span className="w-20 text-[var(--text-secondary)]">{times.length ? istTime(times[endIdx]) : '—'}</span>
          </div>
          {history.loading && !history.data && <div className="mt-1 text-center text-xs text-[var(--text-muted)]">Loading intraday OI history…</div>}
          {history.error && !history.data && <div className="mt-1 text-center text-xs text-[var(--warning)]">Intraday history unavailable: {history.error}</div>}

          <div className="mt-3 flex flex-wrap gap-2">
            {PRESETS.map((p) => {
              const active = !('custom' in win) && win.preset === p.minutes;
              return (
                <button key={p.label} type="button" disabled={p.minutes !== null && last <= 0} onClick={() => setWin({ preset: p.minutes })} className={`${pill(active)} disabled:opacity-40`}>
                  {p.label}
                </button>
              );
            })}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 border-t border-[var(--border)] pt-4 text-sm tabular sm:grid-cols-[auto_1fr_1fr] sm:items-center">
            <span className="rounded-md bg-[var(--surface-sunken)] px-3 py-2 font-medium">Change on {day}</span>
            <div className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1">
              <span className="text-[var(--text-secondary)]">Call OI change</span>
              <b style={{ color: callChg >= 0 ? 'var(--good-text)' : 'var(--critical)' }}>{signedCr(callChg)}</b>
              <span className="text-[var(--text-secondary)]">Put OI change</span>
              <b style={{ color: putChg >= 0 ? 'var(--good-text)' : 'var(--critical)' }}>{signedCr(putChg)}</b>
            </div>
            <div className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1">
              <span className="text-[var(--text-secondary)]">{symbol} at {times.length ? istTime(times[startIdx]) : 'open'}</span>
              <b>{spotAt(startIdx) !== null ? num(spotAt(startIdx)) : '—'}</b>
              <span className="text-[var(--text-secondary)]">{symbol} at {times.length ? istTime(times[endIdx]) : 'now'}</span>
              <b>{spotAt(endIdx) !== null ? num(spotAt(endIdx)) : spotNow ? num(spotNow) : '—'}</b>
            </div>
          </div>
          {chains.updatedAt && (
            <div className="mt-3 text-xs text-[var(--text-muted)]">OI last refreshed {new Date(chains.updatedAt).toLocaleTimeString('en-IN')}</div>
          )}
        </Card>
      </div>
    </div>
  );
}
