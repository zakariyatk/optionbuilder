import type { AiAnalysis } from '../../api/types';
import type { Bar, Levels, Zone } from './levels';

export type AiSource = 'server' | 'local';

/** An analysis and where it ran: the site's server (API key) or this PC (ant CLI login). */
export interface AiResult extends AiAnalysis {
  source: AiSource;
}

/** Candles sent to Claude: enough structure to read, small enough to stay cheap (~3K tokens). */
export const BRIEF_BARS = 150;

const ist = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const when = (ms: number) => ist.format(new Date(ms)).replace(',', '');

const round = (v: number, dp: number) => Number(v.toFixed(dp));
const zoneLine = (z: Zone, dp: number) =>
  `${z.side === 'bull' ? 'bullish' : 'bearish'} ${z.kind} ${round(z.bottom, dp)}–${round(z.top, dp)} since ${when(z.from)}${z.touches ? `, ${z.touches} touches` : ''}`;

/**
 * The chart as text for Claude: what the symbol is, the recent candles, and
 * the levels the app found. The server and the PC helper wrap it in the same
 * system prompt, so this is the only per-request input.
 */
export function buildBrief(input: { symbol: string; name: string; exchange: string; currency: string; tf: string; bars: Bar[]; levels: Levels; precision: number }): string {
  const { levels: l, precision: dp } = input;
  const bars = input.bars.slice(-BRIEF_BARS);
  const csv = bars.map((b) => [when(b.time), round(b.open, dp), round(b.high, dp), round(b.low, dp), round(b.close, dp), Math.round(b.volume)].join(',')).join('\n');
  const recentBreaks = l.breaks.slice(-4).map((b) => `${b.side === 'bull' ? 'up' : 'down'} through ${round(b.price, dp)} at ${when(b.time)}`);
  const p = l.plan;
  return [
    `Symbol: ${input.symbol} (${input.name}), ${input.exchange}, prices in ${input.currency}.`,
    `Timeframe: ${input.tf}. Last close ${round(l.last.close, dp)} at ${when(l.last.time)} IST. ATR(14) ${round(l.atr, dp)}.`,
    '',
    'Levels found by the app:',
    `- Structure: ${l.trend}. Recent breaks of structure: ${recentBreaks.join('; ') || 'none'}.`,
    ...l.supports.map((z) => `- ${zoneLine(z, dp)}`),
    ...l.resistances.map((z) => `- ${zoneLine(z, dp)}`),
    ...l.orderBlocks.map((z) => `- ${zoneLine(z, dp)}`),
    ...l.fvgs.map((z) => `- ${zoneLine(z, dp)}`),
    `- Rule-based plan: ${p.action}${p.entry != null ? ` entry ${round(p.entry, dp)}, stop ${round(p.stop!, dp)}, targets ${p.targets.map((t) => round(t, dp)).join(' / ')}, ${p.rr!.toFixed(2)}R` : ''}. ${p.reason}`,
    '',
    `Last ${bars.length} candles (time IST,open,high,low,close,volume):`,
    csv,
  ].join('\n');
}
