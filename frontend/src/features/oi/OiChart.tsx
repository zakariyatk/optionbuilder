import { useState, type PointerEvent } from 'react';
import type { StrikeOiWindow } from '../../domain/oi';
import { axisIndian, compactIndian } from '../../lib/format';

/** change: Δ OI bars around zero · showOi: OI with increase hatched / decrease outlined · oi: OI now. */
export type OiChartMode = 'change' | 'showOi' | 'oi';

const W = 1000;
const H = 430;
const LEFT = 64;
const RIGHT = W - 16;
const TOP = 40;
const BOTTOM = H - 64;
const PLOT_W = RIGHT - LEFT;
const PLOT_H = BOTTOM - TOP;

const PUT = 'var(--good)';
const CALL = 'var(--critical)';

function ticks(min: number, max: number, count: number): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const r = raw / mag;
  const step = (r > 5 ? 10 : r > 2 ? 5 : r > 1 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v));
  return out;
}

const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${compactIndian(Math.abs(v), 2)}`;

export function OiChart({ rows, mode, spot, symbol }: { rows: StrikeOiWindow[]; mode: OiChartMode; spot: number | null; symbol: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = rows.length;
  if (n === 0) return <div className="flex h-72 items-center justify-center text-sm text-[var(--text-muted)]">No strikes in this range.</div>;

  const values = rows.flatMap((r) =>
    mode === 'change' ? [r.call.end - r.call.start, r.put.end - r.put.start] : mode === 'oi' ? [r.call.end, r.put.end] : [r.call.start, r.call.end, r.put.start, r.put.end],
  );
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const pad = (hi - lo || 1) * 0.06;
  const yMin = lo < 0 ? lo - pad : 0;
  const yMax = hi + pad;
  const y = (v: number) => TOP + (1 - (v - yMin) / (yMax - yMin)) * PLOT_H;
  const group = PLOT_W / n;
  const barW = Math.min(group * 0.34, 26);
  const cx = (i: number) => LEFT + group * (i + 0.5);

  // Spot sits between the two strikes around it.
  let spotX: number | null = null;
  if (spot !== null && n > 1 && spot >= rows[0].strike && spot <= rows[n - 1].strike) {
    const i = rows.findIndex((r) => r.strike >= spot);
    const a = rows[Math.max(0, i - 1)];
    const b = rows[i];
    spotX = a === b ? cx(i) : cx(i - 1) + ((spot - a.strike) / (b.strike - a.strike)) * group;
  }

  const labelEvery = Math.max(1, Math.ceil(n / 30));
  const yTicks = ticks(yMin, yMax, 6);

  const bar = (x: number, s: { start: number; end: number }, color: string, kind: 'put' | 'call') => {
    if (mode === 'change' || mode === 'oi') {
      const v = mode === 'change' ? s.end - s.start : s.end;
      const top = Math.min(y(v), y(0));
      return <rect x={x} y={top} width={barW} height={Math.max(Math.abs(y(v) - y(0)), v === 0 ? 0 : 1)} fill={color} rx={1} />;
    }
    const base = Math.min(s.start, s.end);
    const up = s.end > s.start;
    return (
      <g>
        <rect x={x} y={y(base)} width={barW} height={Math.max(y(0) - y(base), 0)} fill={color} />
        {s.end !== s.start && (
          <rect
            x={up ? x : x + 0.75}
            y={y(Math.max(s.start, s.end))}
            width={up ? barW : barW - 1.5}
            height={Math.abs(y(s.start) - y(s.end))}
            fill={up ? `url(#oi-hatch-${kind})` : 'var(--surface-card)'}
            stroke={up ? 'none' : color}
            strokeWidth={1.5}
          />
        )}
      </g>
    );
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * W;
    const i = Math.floor((x - LEFT) / group);
    setHover(i >= 0 && i < n ? i : null);
  };

  const h = hover !== null ? rows[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none" role="img" aria-label={`${symbol} open interest by strike`} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <defs>
          {(['put', 'call'] as const).map((k) => (
            <pattern key={k} id={`oi-hatch-${k}`} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <rect width="6" height="6" fill={k === 'put' ? 'var(--good-fill)' : 'var(--critical-fill)'} />
              <line x1="0" y1="0" x2="0" y2="6" stroke={k === 'put' ? PUT : CALL} strokeWidth="3" />
            </pattern>
          ))}
        </defs>

        {yTicks.map((v) => (
          <g key={v}>
            <line x1={LEFT} x2={RIGHT} y1={y(v)} y2={y(v)} stroke={v === 0 ? 'var(--baseline)' : 'var(--gridline)'} />
            <text x={LEFT - 8} y={y(v) + 3} textAnchor="end" fontSize={11} fill="var(--text-muted)">
              {v === 0 ? '0' : axisIndian(v)}
            </text>
          </g>
        ))}
        <text x={14} y={TOP + PLOT_H / 2} fontSize={11} fill="var(--text-muted)" textAnchor="middle" transform={`rotate(-90 14 ${TOP + PLOT_H / 2})`}>
          {mode === 'change' ? 'Call / Put OI change' : 'Call / Put OI'}
        </text>

        {rows.map((r, i) => (
          <g key={r.strike}>
            {i > 0 && <line x1={LEFT + group * i} x2={LEFT + group * i} y1={TOP} y2={BOTTOM} stroke="var(--gridline)" strokeOpacity={0.6} />}
            {hover === i && <rect x={LEFT + group * i} y={TOP} width={group} height={PLOT_H} fill="var(--surface-sunken)" opacity={0.7} />}
            {bar(cx(i) - barW - 1, r.put, PUT, 'put')}
            {bar(cx(i) + 1, r.call, CALL, 'call')}
            {i % labelEvery === 0 && (
              <text x={cx(i)} y={BOTTOM + 12} fontSize={11} fill="var(--text-muted)" textAnchor="end" transform={`rotate(-45 ${cx(i)} ${BOTTOM + 12})`}>
                {r.strike}
              </text>
            )}
          </g>
        ))}

        {spotX !== null && (
          <g pointerEvents="none">
            <line x1={spotX} x2={spotX} y1={TOP} y2={BOTTOM} stroke="var(--text-primary)" strokeDasharray="4 3" />
            <rect x={spotX - 70} y={6} width={140} height={24} rx={4} fill="var(--surface-sunken)" />
            <text x={spotX} y={22} textAnchor="middle" fontSize={12} fill="var(--text-primary)">
              {symbol} {spot!.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </text>
          </g>
        )}
      </svg>

      {h && (
        <div
          className="pointer-events-none absolute top-10 z-10 w-max rounded-lg px-3 py-2 text-xs tabular shadow-xl"
          style={{
            left: `${(cx(hover!) / W) * 100}%`,
            transform: `translateX(${cx(hover!) > W * 0.7 ? 'calc(-100% - 14px)' : '14px'})`,
            background: 'rgba(40,40,42,0.95)',
            color: '#fff',
          }}
        >
          <div className="mb-1 text-sm font-semibold">Strike {h.strike}</div>
          <div className="grid grid-cols-[auto_auto_auto] gap-x-3 gap-y-0.5">
            <span />
            <span className="text-[#a1a1aa]">OI</span>
            <span className="text-[#a1a1aa]">Change</span>
            <span className="text-[#f8977a]">Call</span>
            <span>{compactIndian(h.call.end, 2)}</span>
            <span>{signed(h.call.end - h.call.start)}</span>
            <span className="text-[#4ade80]">Put</span>
            <span>{compactIndian(h.put.end, 2)}</span>
            <span>{signed(h.put.end - h.put.start)}</span>
          </div>
        </div>
      )}

      <div className="mt-1 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs text-[var(--text-secondary)]">
        {mode === 'showOi' ? (
          <>
            <Legend color={PUT}>Put OI</Legend>
            <Legend hatch="put">Increase</Legend>
            <Legend outline={PUT}>Decrease</Legend>
            <Legend color={CALL}>Call OI</Legend>
            <Legend hatch="call">Increase</Legend>
            <Legend outline={CALL}>Decrease</Legend>
          </>
        ) : (
          <>
            <Legend color={PUT}>{mode === 'change' ? 'Put OI chg' : 'Put OI'}</Legend>
            <Legend color={CALL}>{mode === 'change' ? 'Call OI chg' : 'Call OI'}</Legend>
          </>
        )}
      </div>
    </div>
  );
}

function Legend({ color, hatch, outline, children }: { color?: string; hatch?: 'put' | 'call'; outline?: string; children: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="14" height="14" aria-hidden="true">
        {hatch ? (
          <rect width="14" height="14" rx="3" fill={`url(#oi-hatch-${hatch})`} />
        ) : outline ? (
          <rect x="1" y="1" width="12" height="12" rx="3" fill="none" stroke={outline} strokeWidth="1.5" />
        ) : (
          <rect width="14" height="14" rx="3" fill={color} />
        )}
      </svg>
      {children}
    </span>
  );
}
