import { useRef, useState, type PointerEvent } from 'react';
import type { OiBar } from '../../api/types';
import { axisIndian } from '../../lib/format';
import { LegendSwatch } from '../../components/ui';

const W = 720;
const H = 260;
const LEFT = 44;
const RIGHT = W - 12;
const TOP = 14;
const BASE_Y = 226;
const PLOT_H = BASE_Y - TOP;

/** Strike-wise call vs put open interest, with the spot marked and the two peaks labelled. */
export function OiDistributionChart({
  data,
  spot,
  maxCallStrike,
  maxPutStrike,
}: {
  data: OiBar[];
  spot: number | null;
  maxCallStrike?: number;
  maxPutStrike?: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) {
    return <div className="flex h-40 items-center justify-center text-xs text-[var(--text-muted)]">No open-interest data</div>;
  }

  const peak = Math.max(...data.flatMap((d) => [d.callOi, d.putOi]), 1);
  const slot = (RIGHT - LEFT) / data.length;
  const barW = Math.max(2, (slot - 4) / 2);
  const y = (v: number) => TOP + PLOT_H * (1 - v / peak);
  const slotX = (i: number) => LEFT + i * slot;
  const gridValues = [0.25, 0.5, 0.75, 1].map((f) => f * peak);

  // Spot sits between two strikes — interpolate its x within the slots.
  let spotX: number | null = null;
  if (spot !== null) {
    const i = data.findIndex((d) => d.strike >= spot);
    if (i > 0) {
      const [lo, hi] = [data[i - 1].strike, data[i].strike];
      spotX = slotX(i - 1) + slot / 2 + (hi === lo ? 0 : (spot - lo) / (hi - lo)) * slot;
    } else if (i === 0) {
      spotX = slotX(0) + slot / 2;
    }
  }

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    const x = ((e.clientX - box.left) / box.width) * W;
    const i = Math.floor((x - LEFT) / slot);
    setHover(i >= 0 && i < data.length ? i : null);
  };

  const hovered = hover === null ? null : data[hover];

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-3 text-[10px] text-[var(--text-muted)]">
        <LegendSwatch color="var(--critical)">Call OI — resistance</LegendSwatch>
        <LegendSwatch color="var(--good)">Put OI — support</LegendSwatch>
        {spot !== null && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-0.5" style={{ background: 'var(--series-violet)' }} />
            Spot {spot.toLocaleString('en-IN')}
          </span>
        )}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Open interest by strike, calls versus puts"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {gridValues.map((v) => (
          <g key={v}>
            <line x1={LEFT} x2={RIGHT} y1={y(v)} y2={y(v)} stroke="var(--gridline)" />
            <text x={LEFT - 6} y={y(v) + 3} textAnchor="end" fontSize={9} fill="var(--text-muted)">
              {axisIndian(v)}
            </text>
          </g>
        ))}

        {hover !== null && <rect x={slotX(hover)} y={TOP} width={slot} height={PLOT_H} fill="var(--text-muted)" opacity={0.08} />}

        {data.map((d, i) => {
          const isMaxCall = d.strike === maxCallStrike;
          const isMaxPut = d.strike === maxPutStrike;
          const cx = slotX(i) + slot / 2;
          return (
            <g key={d.strike}>
              <rect x={cx - barW - 1} y={y(d.callOi)} width={barW} height={BASE_Y - y(d.callOi)} rx={2} fill="var(--critical)" opacity={isMaxCall ? 1 : 0.75} />
              <rect x={cx + 1} y={y(d.putOi)} width={barW} height={BASE_Y - y(d.putOi)} rx={2} fill="var(--good)" opacity={isMaxPut ? 1 : 0.75} />
              {(isMaxCall || isMaxPut) && (
                <text
                  x={cx}
                  y={Math.min(y(d.callOi), y(d.putOi)) - 4}
                  textAnchor="middle"
                  fontSize={8}
                  fontWeight={600}
                  fill={isMaxCall ? 'var(--critical)' : 'var(--good-text)'}
                >
                  {isMaxCall ? 'MAX CALL' : 'MAX PUT'}
                </text>
              )}
              {i % 2 === 0 && (
                <text x={cx} y={BASE_Y + 13} textAnchor="middle" fontSize={8} fill="var(--text-muted)">
                  {(d.strike / 1000).toFixed(2)}k
                </text>
              )}
            </g>
          );
        })}

        <line x1={LEFT} x2={RIGHT} y1={BASE_Y} y2={BASE_Y} stroke="var(--baseline)" strokeWidth={1.5} />
        {spotX !== null && (
          <line x1={spotX} x2={spotX} y1={TOP} y2={BASE_Y} stroke="var(--series-violet)" strokeWidth={1.5} strokeDasharray="4 3" />
        )}
      </svg>
      <div className="flex min-h-6 flex-wrap justify-center gap-3 border-t border-[var(--border)] pt-1.5 text-[10px] tabular">
        {hovered ? (
          <>
            <span className="text-[var(--text-muted)]">
              Strike <span className="text-[var(--text-primary)]">{hovered.strike.toLocaleString('en-IN')}</span>
            </span>
            <span className="text-[var(--critical)]">Call OI {axisIndian(hovered.callOi)}</span>
            <span className="text-[var(--good-text)]">Put OI {axisIndian(hovered.putOi)}</span>
          </>
        ) : (
          <span className="text-[var(--text-muted)]">Hover a strike for its open interest</span>
        )}
      </div>
    </div>
  );
}
