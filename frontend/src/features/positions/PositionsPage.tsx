import { UPSTOX_LOGIN_URL, api } from '../../api/client';
import { ExternalLink } from 'lucide-react';
import type { BrokerPosition } from '../../api/types';
import { Card, CardHeader, Notice, Skeleton } from '../../components/ui';
import { useAsync } from '../../hooks/useAsync';
import { num, signedInr } from '../../lib/format';

const POSITIONS_POLL_MS = 5_000;

const pnlColor = (v: number) => (v > 0 ? 'var(--good-text)' : v < 0 ? 'var(--critical)' : 'var(--text-secondary)');

const PRODUCTS: Record<string, string> = { D: 'NRML', I: 'MIS', CO: 'CO', MTF: 'MTF' };

function Summary({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Card className="px-4 py-3">
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
      <div className="text-xl font-semibold tabular" style={{ color }}>
        {value}
      </div>
    </Card>
  );
}

/** The day's live positions from the connected Upstox account. Read-only. */
export function PositionsPage({ brokerConnected, brokerConfigured }: { brokerConnected: boolean; brokerConfigured: boolean }) {
  const state = useAsync(() => api.positions(), [], { pollMs: POSITIONS_POLL_MS, enabled: brokerConnected });

  if (!brokerConnected) {
    return (
      <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <div className="text-base font-semibold">Connect your broker to see live positions</div>
        <div className="max-w-md text-sm text-[var(--text-muted)]">
          Positions are read from your Upstox account and refresh every few seconds while this page is open.
        </div>
        {brokerConfigured && (
          <a
            href={UPSTOX_LOGIN_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-[var(--series-blue)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Connect Upstox
            <ExternalLink size={16} aria-hidden="true" />
          </a>
        )}
      </Card>
    );
  }

  const positions: BrokerPosition[] = state.data?.positions ?? [];
  const open = positions.filter((p) => p.quantity !== 0);
  const closed = positions.filter((p) => p.quantity === 0);
  const total = positions.reduce((s, p) => s + p.pnl, 0);
  const realised = positions.reduce((s, p) => s + p.realised, 0);
  const unrealised = positions.reduce((s, p) => s + p.unrealised, 0);

  const table = (list: BrokerPosition[], dim: boolean) => (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm tabular">
        <thead className="text-left text-xs text-[var(--text-muted)]">
          <tr className="border-b border-[var(--border)]">
            <th className="px-3 py-2 font-medium">Instrument</th>
            <th className="px-3 py-2 font-medium">Product</th>
            <th className="px-3 py-2 text-right font-medium">Qty</th>
            <th className="px-3 py-2 text-right font-medium">Avg</th>
            <th className="px-3 py-2 text-right font-medium">LTP</th>
            <th className="px-3 py-2 text-right font-medium">Day chg</th>
            <th className="px-3 py-2 text-right font-medium">P&amp;L</th>
          </tr>
        </thead>
        <tbody className={dim ? 'text-[var(--text-muted)]' : ''}>
          {list.map((p) => {
            const dayChg = p.closePrice > 0 ? ((p.ltp - p.closePrice) / p.closePrice) * 100 : null;
            return (
              <tr key={`${p.instrumentKey}:${p.product}`} className="border-b border-[var(--gridline)]">
                <td className="px-3 py-2 font-medium">
                  {p.symbol || p.instrumentKey}
                  <span className="ml-1.5 text-[10px] text-[var(--text-muted)]">{p.exchange}</span>
                </td>
                <td className="px-3 py-2 text-xs">{PRODUCTS[p.product] ?? p.product}</td>
                <td
                  className="px-3 py-2 text-right font-semibold"
                  style={{ color: p.quantity > 0 ? 'var(--series-blue)' : p.quantity < 0 ? 'var(--critical)' : undefined }}
                >
                  {p.quantity > 0 ? `+${p.quantity}` : p.quantity}
                </td>
                <td className="px-3 py-2 text-right">{num(p.averagePrice)}</td>
                <td className="px-3 py-2 text-right font-medium">{num(p.ltp)}</td>
                <td className="px-3 py-2 text-right" style={{ color: dayChg === null ? undefined : pnlColor(dayChg) }}>
                  {dayChg === null ? '—' : `${dayChg >= 0 ? '+' : ''}${dayChg.toFixed(2)}%`}
                </td>
                <td className="px-3 py-2 text-right font-semibold" style={{ color: pnlColor(p.pnl) }}>
                  {signedInr(p.pnl)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {state.error && <Notice tone="critical">Positions: {state.error}</Notice>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Summary label="Total P&L" value={signedInr(total)} color={pnlColor(total)} />
        <Summary label="Unrealised" value={signedInr(unrealised)} color={pnlColor(unrealised)} />
        <Summary label="Realised" value={signedInr(realised)} color={pnlColor(realised)} />
        <Summary label="Open positions" value={String(open.length)} />
      </div>

      <Card>
        <CardHeader title={`Open positions (${open.length})`}>
          {state.updatedAt && (
            <span className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--good)]" />
              Live · {new Date(state.updatedAt).toLocaleTimeString('en-IN')}
            </span>
          )}
        </CardHeader>
        {state.loading && !state.data ? (
          <div className="flex flex-col gap-2 p-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : open.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[var(--text-muted)]">No open positions in your Upstox account today.</div>
        ) : (
          table(open, false)
        )}
      </Card>

      {closed.length > 0 && (
        <Card>
          <CardHeader title={`Closed today (${closed.length})`} />
          {table(closed, true)}
        </Card>
      )}
    </div>
  );
}
