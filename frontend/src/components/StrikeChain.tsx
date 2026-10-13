import { Fragment, useEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import type { ChainRow, ChainSide } from '../api/types';
import { bsGreeks } from '../domain/blackScholes';
import { describeFlags, detectUnusual } from '../domain/chain';
import { yearsToExpiry } from '../domain/dates';
import { positionsByStrike, type StrikePosition } from '../domain/positions';
import type { Leg, LegAction } from '../domain/types';
import { compactIndian, num } from '../lib/format';
import { LegendSwatch } from './ui';
import type { AddLegFn } from './OptionChainTable';

type View = 'ltp' | 'oi' | 'greeks';
type Side = 'CE' | 'PE';

const VIEWS: { id: View; label: string }[] = [
  { id: 'ltp', label: 'LTP' },
  { id: 'oi', label: 'OI' },
  { id: 'greeks', label: 'Greeks' },
];

/** Column headings per view: [outer, inner] for each side. */
const HEADINGS: Record<View, [string, string]> = {
  ltp: ['Delta', 'LTP'],
  oi: ['OI chg', 'OI'],
  greeks: ['Vega', 'Theta'],
};

const MAX_LOTS = 20;
const BUY = 'var(--series-blue)';
const SELL = 'var(--critical)';

interface SideGreeks {
  delta: number | null;
  theta: number | null;
  vega: number | null;
}

/** Upstox's own delta / theta when present, else Black-Scholes from the strike's IV. */
function sideGreeks(type: Side, side: ChainSide | null, spot: number | null, strike: number, years: number): SideGreeks {
  if (!side) return { delta: null, theta: null, vega: null };
  const model = spot && side.iv > 0 && years > 0 ? bsGreeks(type, spot, strike, years, side.iv / 100) : null;
  return {
    delta: side.delta ?? model?.delta ?? null,
    theta: side.theta ?? model?.theta ?? null,
    vega: model?.vega ?? null,
  };
}

function PositionBadge({ position, onRemove }: { position: StrikePosition; onRemove: () => void }) {
  const buy = position.action === 'BUY';
  const verb = buy ? 'Bought' : 'Sold';
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      title={`${verb} ${position.quantity} — click to remove`}
      aria-label={`${verb} ${position.quantity}, remove`}
      className="group/badge flex items-center gap-1 tabular text-[11px] text-[var(--text-secondary)]"
    >
      {position.quantity}
      <span
        className="inline-flex h-4 w-4 items-center justify-center rounded-[3px] text-[9px] font-bold text-white"
        style={{ background: buy ? BUY : SELL }}
      >
        <span className="group-hover/badge:hidden">{buy ? 'B' : 'S'}</span>
        <span className="hidden group-hover/badge:inline">×</span>
      </span>
    </button>
  );
}

export function StrikeChain({
  rows,
  spot,
  symbol,
  lotSize,
  expiry,
  legs,
  maxHeight = 640,
  onAddLeg,
  onRemoveLegs,
  onClear,
}: {
  rows: ChainRow[];
  spot: number | null;
  symbol: string;
  lotSize: number;
  expiry: string | null;
  legs: Leg[];
  maxHeight?: number;
  onAddLeg: AddLegFn;
  onRemoveLegs: (ids: string[]) => void;
  onClear: () => void;
}) {
  const [view, setView] = useState<View>('ltp');
  /** The strike side showing Buy / Sell controls — follows the mouse, or a tap on touch screens. */
  const [active, setActive] = useState<{ strike: number; side: Side } | null>(null);
  const pinned = useRef(false);
  const [lots, setLots] = useState<Record<string, number>>({});

  const positions = useMemo(() => positionsByStrike(legs, expiry), [legs, expiry]);
  const legCount = useMemo(() => [...positions.values()].reduce((n, list) => n + list.reduce((m, p) => m + p.ids.length, 0), 0), [positions]);
  const unusual = useMemo(() => detectUnusual(rows), [rows]);
  const maxOi = useMemo(() => Math.max(1, ...rows.flatMap((r) => [r.call?.oi ?? 0, r.put?.oi ?? 0])), [rows]);
  const greeks = useMemo(() => {
    const years = expiry ? yearsToExpiry(new Date(), expiry) : 0;
    return new Map(
      rows.map((r) => [r.strike, { CE: sideGreeks('CE', r.call, spot, r.strike, years), PE: sideGreeks('PE', r.put, spot, r.strike, years) }]),
    );
  }, [rows, spot, expiry]);

  // Index of the first strike above spot — the spot marker row goes just before it.
  const spotIndex = useMemo(() => (spot === null ? -1 : rows.findIndex((r) => r.strike >= spot)), [rows, spot]);

  // Centre on spot once per symbol / expiry, not on every poll.
  const scrollRef = useRef<HTMLDivElement>(null);
  const spotRef = useRef<HTMLTableRowElement>(null);
  const centredFor = useRef('');
  useEffect(() => {
    const key = `${symbol}|${expiry}`;
    const box = scrollRef.current;
    const row = spotRef.current;
    if (centredFor.current === key || !box || !row) return;
    box.scrollTop = row.offsetTop - box.clientHeight / 2;
    centredFor.current = key;
  }, [symbol, expiry, spotIndex]);

  const [outerLabel, innerLabel] = HEADINGS[view];

  const cells = (row: ChainRow, type: Side) => {
    const side = type === 'CE' ? row.call : row.put;
    const g = greeks.get(row.strike)?.[type];
    const changeColor = (v: number) => (v >= 0 ? 'var(--good-text)' : 'var(--critical)');
    switch (view) {
      case 'oi':
        return {
          outer: side ? <span style={{ color: changeColor(side.oiChange) }}>{compactIndian(side.oiChange, 1)}</span> : '—',
          inner: side ? compactIndian(side.oi, 1) : '—',
        };
      case 'greeks':
        return { outer: num(g?.vega, 2), inner: num(g?.theta, 2) };
      default:
        return { outer: num(g?.delta, 2), inner: side ? num(side.ltp) : '—' };
    }
  };

  const th = 'whitespace-nowrap px-1.5 py-2 font-medium';

  const barCell = (row: ChainRow, type: Side, bg: string | undefined, props: HTMLAttributes<HTMLTableCellElement>) => {
    const side = type === 'CE' ? row.call : row.put;
    const key = `${row.strike}:${type}`;
    const held = positions.get(key) ?? [];
    const isActive = active?.strike === row.strike && active.side === type;
    const call = type === 'CE';
    const width = side ? Math.max((side.oi / maxOi) * 100, side.oi > 0 ? 3 : 0) : 0;
    const n = lots[key] ?? 1;
    const add = (action: LegAction) => onAddLeg(type, action, row.strike, side?.ltp ?? 0, side, n);

    const controls: ReactNode = isActive && side && (
      <div className={`relative z-[1] flex flex-col gap-1 ${call ? 'items-end' : 'items-start'}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex gap-1">
          {(['BUY', 'SELL'] as const).map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => add(action)}
              aria-label={`${action === 'BUY' ? 'Buy' : 'Sell'} ${n * lotSize} ${row.strike} ${call ? 'call' : 'put'}`}
              className="h-6 w-7 rounded border text-[11px] font-semibold transition-opacity hover:opacity-85"
              style={
                action === 'BUY'
                  ? { background: BUY, borderColor: BUY, color: '#fff' }
                  : { background: 'var(--surface-raised)', borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }
              }
            >
              {action === 'BUY' ? 'B' : 'S'}
            </button>
          ))}
        </div>
        <select
          aria-label={`Quantity for ${row.strike} ${call ? 'call' : 'put'}`}
          value={n}
          onFocus={() => (pinned.current = true)}
          onBlur={() => (pinned.current = false)}
          onChange={(e) => setLots((m) => ({ ...m, [key]: Number(e.target.value) }))}
          className="h-6 w-[60px] rounded border border-[var(--border)] bg-[var(--surface-raised)] px-1 text-[11px] tabular text-[var(--text-primary)]"
          title="Quantity"
        >
          {Array.from({ length: MAX_LOTS }, (_, i) => i + 1).map((l) => (
            <option key={l} value={l}>
              {l * lotSize}
            </option>
          ))}
        </select>
      </div>
    );

    return (
      <td className="relative px-1 py-1 align-middle" style={{ background: bg }} {...props}>
        {width > 0 && (
          <span
            aria-hidden="true"
            className={`absolute top-1/2 h-5 -translate-y-1/2 ${call ? 'right-0 rounded-l-full' : 'left-0 rounded-r-full'}`}
            style={{ width: `${width}%`, background: call ? 'var(--critical-fill)' : 'var(--good-fill)' }}
          />
        )}
        <div className={`relative flex flex-col gap-1 ${call ? 'items-end' : 'items-start'}`}>
          {controls}
          {held.length > 0 && (
            <div className={`flex gap-1.5 ${call ? 'justify-end' : ''}`}>
              {held.map((p) => (
                <PositionBadge key={p.action} position={p} onRemove={() => onRemoveLegs(p.ids)} />
              ))}
            </div>
          )}
        </div>
      </td>
    );
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-card)]" style={{ maxHeight }}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
        <h2 className="text-sm font-semibold">Strikes</h2>
        <div className="flex rounded-md border border-[var(--border)] p-0.5" role="group" aria-label="Chain columns">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={view === v.id}
              onClick={() => setView(v.id)}
              className="rounded px-3 py-1 text-xs font-medium transition-colors"
              style={view === v.id ? { background: BUY, color: '#fff' } : { color: 'var(--text-secondary)' }}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto"
        onMouseLeave={() => {
          if (!pinned.current) setActive(null);
        }}
      >
        <table className="w-full table-fixed border-collapse text-xs">
          <caption className="sr-only">
            Option chain for {symbol}
            {expiry ? `, expiry ${expiry}` : ''}. Hover or tap a call or put to buy or sell it.
          </caption>
          <colgroup>
            <col style={{ width: '10%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '17%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '17%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '10%' }} />
          </colgroup>
          <thead className="sticky top-0 z-[2] bg-[var(--surface-card)] text-[var(--text-secondary)] shadow-[0_1px_0_var(--border)]">
            <tr>
              <th className={`${th} text-left`}>{outerLabel}</th>
              <th className={`${th} text-left`}>
                {view === 'ltp' && <span className="hidden sm:inline">Call </span>}
                {innerLabel}
              </th>
              <th className={`${th} text-right text-[var(--critical)]`}>Call OI</th>
              <th className={`${th} text-center`}>Strike</th>
              <th className={`${th} text-center`}>IV</th>
              <th className={`${th} text-left text-[var(--good-text)]`}>Put OI</th>
              <th className={`${th} text-right`}>
                {view === 'ltp' && <span className="hidden sm:inline">Put </span>}
                {innerLabel}
              </th>
              <th className={`${th} text-right`}>{outerLabel}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const callItm = spot !== null && row.strike < spot;
              const putItm = spot !== null && row.strike > spot;
              const callBg = callItm ? 'var(--itm-fill)' : undefined;
              const putBg = putItm ? 'var(--itm-fill)' : undefined;
              const flags = unusual.get(row.strike) ?? [];
              const held = positions.has(`${row.strike}:CE`) || positions.has(`${row.strike}:PE`);
              const call = cells(row, 'CE');
              const put = cells(row, 'PE');
              const iv = row.call?.iv && row.put?.iv ? (row.call.iv + row.put.iv) / 2 : row.call?.iv || row.put?.iv || null;
              const sideProps = (side: Side) => ({
                onMouseEnter: () => {
                  if (!pinned.current) setActive({ strike: row.strike, side });
                },
                onClick: () => setActive({ strike: row.strike, side }),
              });
              const tdNum = 'px-1.5 py-2 tabular';

              return (
                <Fragment key={row.strike}>
                  {i === spotIndex && spot !== null && (
                    <tr ref={spotRef} aria-hidden="true">
                      <td colSpan={8} className="relative h-0 p-0">
                        <div className="absolute inset-x-0 top-0 z-[1] border-t-2 border-[var(--series-violet)]" />
                        <span className="absolute left-1/2 top-0 z-[1] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--series-violet)] px-2 py-0.5 text-[10px] font-semibold text-white tabular">
                          {symbol} {spot.toLocaleString('en-IN')}
                        </span>
                      </td>
                    </tr>
                  )}
                  <tr
                    className="border-b border-[var(--gridline)]"
                    style={held ? { background: 'color-mix(in srgb, var(--series-blue) 7%, transparent)' } : undefined}
                    title={flags.length ? describeFlags(flags) : undefined}
                  >
                    <td className={`${tdNum} text-left text-[var(--text-secondary)]`} style={{ background: callBg }} {...sideProps('CE')}>
                      {call.outer}
                    </td>
                    <td className={`${tdNum} text-left font-medium`} style={{ background: callBg }} {...sideProps('CE')}>
                      {call.inner}
                    </td>
                    {barCell(row, 'CE', callBg, sideProps('CE'))}
                    <td className="relative px-1 py-1 text-center" style={{ background: 'var(--surface-sunken)' }}>
                      <span
                        className="inline-block rounded px-1 py-0.5 font-semibold tabular"
                        style={{
                          background: held ? 'color-mix(in srgb, var(--series-blue) 22%, transparent)' : 'var(--surface-card)',
                        }}
                      >
                        {row.strike.toLocaleString('en-IN')}
                      </span>
                      {flags.length > 0 && (
                        <span className="absolute right-0.5 top-0.5 text-[8px] leading-none text-[var(--unusual)]" aria-label="Unusual activity">
                          ●
                        </span>
                      )}
                    </td>
                    <td className={`${tdNum} text-center text-[var(--text-secondary)]`} style={{ background: 'var(--surface-sunken)' }}>
                      {iv ? iv.toFixed(1) : '—'}
                    </td>
                    {barCell(row, 'PE', putBg, sideProps('PE'))}
                    <td className={`${tdNum} text-right font-medium`} style={{ background: putBg }} {...sideProps('PE')}>
                      {put.inner}
                    </td>
                    <td className={`${tdNum} text-right text-[var(--text-secondary)]`} style={{ background: putBg }} {...sideProps('PE')}>
                      {put.outer}
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--border)] px-3 py-2 text-[11px] text-[var(--text-muted)]">
        <span className="font-medium text-[var(--text-primary)]">
          {legCount} leg{legCount === 1 ? '' : 's'} selected
        </span>
        <LegendSwatch color="var(--itm-fill)">ITM</LegendSwatch>
        <span>Lot {lotSize}</span>
        {unusual.size > 0 && <span title="Strikes marked ● have unusual OI, volume or build-up. Hover the row for detail.">● Unusual ({unusual.size})</span>}
        <button
          type="button"
          onClick={onClear}
          disabled={legs.length === 0}
          className="ml-auto rounded-md border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)] disabled:opacity-40"
        >
          Clear all
        </button>
      </div>
    </div>
  );
}
