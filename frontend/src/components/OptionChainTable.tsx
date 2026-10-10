import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChainRow, ChainSide } from '../api/types';
import { describeFlags, detectUnusual, generateStrikes, type UnusualFlag } from '../domain/chain';
import type { LegAction } from '../domain/types';
import { compactIndian, num } from '../lib/format';
import { LegendSwatch, SideChip, Skeleton } from './ui';

export type AddLegFn = (
  type: 'CE' | 'PE',
  action: LegAction,
  strike: number,
  premium: number,
  side: ChainSide | null,
) => void;

const changeColor = (v: number | undefined) => ((v ?? 0) >= 0 ? 'var(--good-text)' : 'var(--critical)');

function PriceCell({
  ltp,
  bold,
  align,
  onBuy,
  onSell,
}: {
  ltp: number | null;
  bold: boolean;
  align: 'left' | 'right';
  onBuy: () => void;
  onSell: () => void;
}) {
  const price = <span className={bold ? 'font-semibold' : ''}>{ltp === null ? '—' : num(ltp)}</span>;
  const chips = (
    <>
      <SideChip side="BUY" onClick={onBuy} />
      <SideChip side="SELL" onClick={onSell} />
    </>
  );
  return (
    <div className={`flex items-center gap-1.5 tabular ${align === 'right' ? 'justify-end' : ''}`}>
      {align === 'right' ? (
        <>
          {price}
          {chips}
        </>
      ) : (
        <>
          {chips}
          {price}
        </>
      )}
    </div>
  );
}

function ManualPremium({ value, onChange, label }: { value: number | undefined; onChange: (v: number) => void; label: string }) {
  return (
    <input
      type="number"
      min={0}
      step="0.05"
      inputMode="decimal"
      aria-label={label}
      className="w-16 rounded border border-[var(--border)] bg-transparent px-1 py-0.5 text-right tabular"
      placeholder="premium"
      value={value ?? ''}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

export function OptionChainTable({
  rows,
  loading,
  spot,
  symbol,
  lotSize,
  expiry,
  maxHeight = 520,
  detailed = false,
  onAddLeg,
}: {
  rows: ChainRow[] | null;
  loading: boolean;
  spot: number | null;
  symbol: string;
  lotSize: number;
  expiry: string | null;
  maxHeight?: number;
  /** Adds IV and volume columns — used on the full-width chain tab. */
  detailed?: boolean;
  onAddLeg: AddLegFn;
}) {
  const [manual, setManual] = useState<Record<string, number>>({});
  const manualMode = !rows || rows.length === 0;

  const ladder = useMemo<ChainRow[]>(() => {
    if (!manualMode) return rows!;
    return spot ? generateStrikes(symbol, spot).map((strike) => ({ strike, call: null, put: null })) : [];
  }, [rows, spot, symbol, manualMode]);

  const atmStrike = useMemo(() => {
    if (!spot || ladder.length === 0) return null;
    return ladder.reduce((best, r) => (Math.abs(r.strike - spot) < Math.abs(best - spot) ? r.strike : best), ladder[0].strike);
  }, [ladder, spot]);

  const unusual = useMemo(() => (manualMode ? new Map<number, UnusualFlag[]>() : detectUnusual(ladder)), [manualMode, ladder]);

  // Centre the ATM row once per symbol/expiry — not on every poll, or the
  // table would yank itself back while the user is scrolling.
  const scrollRef = useRef<HTMLDivElement>(null);
  const atmRef = useRef<HTMLTableRowElement>(null);
  const centredFor = useRef('');
  useEffect(() => {
    const key = `${symbol}|${expiry}|${manualMode}`;
    if (centredFor.current === key) return;
    const box = scrollRef.current;
    const row = atmRef.current;
    if (!box || !row) return;
    box.scrollTop = row.offsetTop - box.clientHeight / 2 + row.clientHeight / 2;
    centredFor.current = key;
  }, [symbol, expiry, manualMode, atmStrike, ladder.length]);

  if (ladder.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-card)] p-4" aria-busy="true">
        {loading || !spot ? (
          Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-5 w-full" />)
        ) : (
          <span className="text-sm text-[var(--text-muted)]">Waiting for spot price to build a strike ladder…</span>
        )}
      </div>
    );
  }

  const sideCols = manualMode ? 1 : detailed ? 5 : 3;
  const th = 'border-b border-[var(--border)] px-2 py-2 font-medium';

  return (
    <div
      ref={scrollRef}
      className="overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface-card)]"
      style={{ maxHeight }}
    >
      {manualMode && (
        <div className="border-b border-[var(--border)] px-3 py-2 text-xs text-[var(--warning)]">
          Live chain unavailable — showing a generated strike ladder. Enter premiums before adding legs.
          Unusual-activity detection needs live OI and volume, so it is off here.
        </div>
      )}

      <table className="w-full border-collapse text-xs">
        <caption className="sr-only">
          Option chain for {symbol}
          {expiry ? `, expiry ${expiry}` : ''}
        </caption>
        <thead className="sticky top-0 z-10 bg-[var(--surface-card)] text-[var(--text-muted)]">
          <tr>
            <th colSpan={sideCols} className={`${th} text-right`}>
              CALLS
            </th>
            <th className={`${th} text-center`}>STRIKE</th>
            <th colSpan={sideCols} className={`${th} text-left`}>
              PUTS
            </th>
          </tr>
          {!manualMode && (
            <tr className="text-[10px]">
              <th className="px-2 py-1 text-right font-normal">OI</th>
              {detailed && <th className="px-2 py-1 text-right font-normal">Volume</th>}
              {detailed && <th className="px-2 py-1 text-right font-normal">IV</th>}
              <th className="px-2 py-1 text-right font-normal">LTP</th>
              <th className="px-2 py-1 text-right font-normal">Chg</th>
              <th className="px-2 py-1" />
              <th className="px-2 py-1 text-left font-normal">Chg</th>
              <th className="px-2 py-1 text-left font-normal">LTP</th>
              {detailed && <th className="px-2 py-1 text-left font-normal">IV</th>}
              {detailed && <th className="px-2 py-1 text-left font-normal">Volume</th>}
              <th className="px-2 py-1 text-left font-normal">OI</th>
            </tr>
          )}
        </thead>
        <tbody>
          {ladder.map((row) => {
            const isAtm = row.strike === atmStrike;
            const callLtp = row.call?.ltp ?? (manualMode ? (manual[`${row.strike}-C`] ?? 0) : null);
            const putLtp = row.put?.ltp ?? (manualMode ? (manual[`${row.strike}-P`] ?? 0) : null);
            const flags = unusual.get(row.strike) ?? [];
            const flagged = flags.length > 0;
            const callItm = !isAtm && spot !== null && row.strike < spot;
            const putItm = !isAtm && spot !== null && row.strike > spot;
            const callBg = callItm ? 'var(--itm-fill)' : undefined;
            const putBg = putItm ? 'var(--itm-fill)' : undefined;
            const add = (type: 'CE' | 'PE', action: LegAction) =>
              onAddLeg(type, action, row.strike, (type === 'CE' ? callLtp : putLtp) ?? 0, type === 'CE' ? row.call : row.put);

            return (
              <tr
                key={row.strike}
                ref={isAtm ? atmRef : undefined}
                title={flagged ? describeFlags(flags) : undefined}
                className="border-b border-[var(--gridline)] hover:brightness-110"
                style={{
                  background: isAtm ? 'var(--good-fill)' : undefined,
                  boxShadow: flagged ? 'inset 0 0 0 2px var(--unusual)' : undefined,
                }}
              >
                {!manualMode && (
                  <td className="px-2 py-1 text-right tabular text-[var(--text-muted)]" style={{ background: callBg }}>
                    {num(row.call?.oi, 0)}
                  </td>
                )}
                {!manualMode && detailed && (
                  <td className="px-2 py-1 text-right tabular text-[var(--text-muted)]" style={{ background: callBg }}>
                    {row.call ? compactIndian(row.call.volume, 1) : '—'}
                  </td>
                )}
                {!manualMode && detailed && (
                  <td className="px-2 py-1 text-right tabular text-[var(--text-secondary)]" style={{ background: callBg }}>
                    {row.call?.iv ? row.call.iv.toFixed(1) : '—'}
                  </td>
                )}
                <td className="px-2 py-1" style={{ background: callBg }}>
                  {manualMode ? (
                    <div className="flex items-center justify-end gap-1.5">
                      <ManualPremium
                        label={`Call premium at ${row.strike}`}
                        value={manual[`${row.strike}-C`]}
                        onChange={(v) => setManual((m) => ({ ...m, [`${row.strike}-C`]: v }))}
                      />
                      <SideChip side="BUY" onClick={() => add('CE', 'BUY')} />
                      <SideChip side="SELL" onClick={() => add('CE', 'SELL')} />
                    </div>
                  ) : (
                    <PriceCell ltp={callLtp} bold={isAtm} align="right" onBuy={() => add('CE', 'BUY')} onSell={() => add('CE', 'SELL')} />
                  )}
                </td>
                {!manualMode && (
                  <td className="px-2 py-1 text-right tabular" style={{ color: changeColor(row.call?.change), background: callBg }}>
                    {num(row.call?.change)}
                  </td>
                )}

                <td
                  className="whitespace-nowrap px-2 py-1 text-center font-semibold tabular"
                  style={{ background: isAtm ? 'var(--good-fill)' : 'var(--surface-sunken)' }}
                >
                  {row.strike.toLocaleString('en-IN')}
                  {flagged && (
                    <span className="ml-1 align-middle text-[9px] font-bold text-[var(--unusual)]" aria-label="Unusual activity">
                      ●{Math.max(...flags.map((f) => f.ratio)) >= 6 ? '●' : ''}
                    </span>
                  )}
                </td>

                {!manualMode && (
                  <td className="px-2 py-1 text-left tabular" style={{ color: changeColor(row.put?.change), background: putBg }}>
                    {num(row.put?.change)}
                  </td>
                )}
                <td className="px-2 py-1" style={{ background: putBg }}>
                  {manualMode ? (
                    <div className="flex items-center gap-1.5">
                      <SideChip side="BUY" onClick={() => add('PE', 'BUY')} />
                      <SideChip side="SELL" onClick={() => add('PE', 'SELL')} />
                      <ManualPremium
                        label={`Put premium at ${row.strike}`}
                        value={manual[`${row.strike}-P`]}
                        onChange={(v) => setManual((m) => ({ ...m, [`${row.strike}-P`]: v }))}
                      />
                    </div>
                  ) : (
                    <PriceCell ltp={putLtp} bold={isAtm} align="left" onBuy={() => add('PE', 'BUY')} onSell={() => add('PE', 'SELL')} />
                  )}
                </td>
                {!manualMode && detailed && (
                  <td className="px-2 py-1 text-left tabular text-[var(--text-secondary)]" style={{ background: putBg }}>
                    {row.put?.iv ? row.put.iv.toFixed(1) : '—'}
                  </td>
                )}
                {!manualMode && detailed && (
                  <td className="px-2 py-1 text-left tabular text-[var(--text-muted)]" style={{ background: putBg }}>
                    {row.put ? compactIndian(row.put.volume, 1) : '—'}
                  </td>
                )}
                {!manualMode && (
                  <td className="px-2 py-1 text-left tabular text-[var(--text-muted)]" style={{ background: putBg }}>
                    {num(row.put?.oi, 0)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-[var(--border)] bg-[var(--surface-card)] px-3 py-1.5 text-[10px] text-[var(--text-muted)]">
        <LegendSwatch color="var(--itm-fill)">In the money</LegendSwatch>
        <LegendSwatch color="var(--good-fill)">At the money</LegendSwatch>
        {!manualMode && (
          <LegendSwatch color="var(--unusual)" kind="ring">
            <span title="OI, volume or position build-up at least 4× the nearby strikes. Hover a marked row for detail.">
              Unusual activity ({unusual.size})
            </span>
          </LegendSwatch>
        )}
        <span>Lot size: {lotSize}</span>
      </div>
    </div>
  );
}
