import { useEffect, useState } from 'react';
import { ActionType, type Chart, type Crosshair, type KLineData } from 'klinecharts';
import { num } from '../../../lib/format';
import { HEIKIN_ASHI, type HaBar } from '../heikinAshi';
import { barTime } from './mobileChartUtils';

const fmtVol = (v: number) =>
  v >= 1e7 ? `${(v / 1e7).toFixed(2)}Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(2)}L` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : String(Math.round(v));


interface Shown {
  bar: KLineData;
  prev: KLineData | null;
  ha: HaBar | null;
  /** The crosshair is on this bar (not just the latest). */
  cross: boolean;
}

/**
 * The OHLC line over the phone chart: the bar under the crosshair while you
 * press and hold, else the latest bar. Heikin Ashi charts show the HA values.
 */
export function Readout({ chart, precision, intraday }: { chart: Chart | null; precision: number; intraday: boolean }) {
  const [shown, setShown] = useState<Shown | null>(null);

  useEffect(() => {
    if (!chart) return;
    let cross: number | null = null;
    let frame = 0;
    const read = () => {
      frame = 0;
      const data = chart.getDataList();
      if (!data.length) return setShown(null);
      const i = cross !== null && cross >= 0 && cross < data.length ? cross : data.length - 1;
      const ha = (chart.getIndicatorByPaneId('candle_pane', HEIKIN_ASHI) as { result?: HaBar[] } | null)?.result?.[i] ?? null;
      setShown({ bar: data[i], prev: data[i - 1] ?? null, ha, cross: cross !== null });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    const onCross = (c?: unknown) => {
      const ch = c as Crosshair | undefined;
      // klinecharts reports the crosshair leaving as one without a bar.
      cross = ch?.kLineData && ch.dataIndex !== undefined ? ch.dataIndex : null;
      schedule();
    };
    chart.subscribeAction(ActionType.OnCrosshairChange, onCross);
    chart.subscribeAction(ActionType.OnDataReady, schedule);
    // The forming bar ticks without an action; follow it while nobody holds the crosshair.
    const timer = window.setInterval(() => cross === null && schedule(), 1000);
    schedule();
    return () => {
      chart.unsubscribeAction(ActionType.OnCrosshairChange, onCross);
      chart.unsubscribeAction(ActionType.OnDataReady, schedule);
      window.clearInterval(timer);
      cancelAnimationFrame(frame);
    };
  }, [chart]);

  if (!shown) return null;
  const { bar, prev, ha, cross } = shown;
  const o = ha?.open ?? bar.open;
  const h = ha?.high ?? bar.high;
  const l = ha?.low ?? bar.low;
  const c = ha?.close ?? bar.close;
  const up = c >= o;
  const color = up ? 'var(--good-text)' : 'var(--critical)';
  const chg = prev ? bar.close - prev.close : null;
  const pct = prev && prev.close ? (chg! / prev.close) * 100 : null;
  const f = (v: number) => num(v, precision);
  return (
    <div className="min-w-0 text-[11px] leading-[15px] tabular" aria-live="off">
      <div className={`h-[15px] truncate font-medium ${cross ? 'text-[var(--series-blue)]' : 'text-[var(--text-muted)]'}`}>
        {cross ? barTime(bar.timestamp, intraday) : `Last bar · ${barTime(bar.timestamp, intraday)}`}
      </div>
      <div className="flex h-[15px] gap-x-2 overflow-hidden whitespace-nowrap">
        <span>
          <span className="text-[var(--text-muted)]">O</span> <span style={{ color }}>{f(o)}</span>
        </span>
        <span>
          <span className="text-[var(--text-muted)]">H</span> <span style={{ color }}>{f(h)}</span>
        </span>
        <span>
          <span className="text-[var(--text-muted)]">L</span> <span style={{ color }}>{f(l)}</span>
        </span>
        <span>
          <span className="text-[var(--text-muted)]">C</span> <span style={{ color }}>{f(c)}</span>
        </span>
        {chg !== null && (
          <span style={{ color: chg >= 0 ? 'var(--good-text)' : 'var(--critical)' }}>
            {chg >= 0 ? '+' : ''}
            {f(chg)} ({pct !== null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` : '—'})
          </span>
        )}
        {!!bar.volume && (
          <span>
            <span className="text-[var(--text-muted)]">Vol</span> {fmtVol(bar.volume)}
          </span>
        )}
      </div>
    </div>
  );
}
