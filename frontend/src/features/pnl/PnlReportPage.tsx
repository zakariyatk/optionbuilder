import type { ReactNode } from "react";
import { Download, ExternalLink, RefreshCw } from "lucide-react";
import { api, ZERODHA_LOGIN_URL } from "../../api/client";
import type { AuthStatus, ZerodhaPnl } from "../../api/types";
import {
  Button,
  Card,
  CardHeader,
  Notice,
  Skeleton,
  Stat,
  type Tone,
} from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { inr, num, signedInr, signedPct } from "../../lib/format";

/** P&L refreshes this often while the tab is visible. */
const PNL_POLL_MS = 15_000;

const th =
  "whitespace-nowrap bg-[var(--surface-sunken)] px-3 py-2 text-right text-[10px] font-normal uppercase tracking-[0.08em] text-[var(--text-muted)]";
const thLeft = th.replace("text-right", "text-left");
const td = "whitespace-nowrap px-3 py-2.5 text-right tabular";
const tdLeft = "whitespace-nowrap px-3 py-2.5 text-left";

const tone = (v: number): Tone | undefined =>
  v > 0 ? "good" : v < 0 ? "critical" : undefined;
const pnlColor = (v: number) =>
  v > 0
    ? "var(--good-text)"
    : v < 0
      ? "var(--critical)"
      : "var(--text-secondary)";

function Pnl({ value }: { value: number }) {
  return <span style={{ color: pnlColor(value) }}>{signedInr(value)}</span>;
}

/**
 * P&L Report: live profit and loss straight from the Zerodha account —
 * today's positions (F&O, intraday, delivery trades) and long-term holdings.
 */
export function PnlReportPage({ broker }: { broker: AuthStatus | null }) {
  const z = broker?.zerodha;
  const connected = !!z?.authenticated;
  const state = useAsync(() => api.zerodhaPnl(), [connected], {
    pollMs: PNL_POLL_MS,
    enabled: connected,
  });

  if (broker && !z?.configured) {
    return (
      <Card className="px-4 py-10 text-center text-sm text-[var(--text-secondary)]">
        The P&amp;L report reads your Zerodha account. Add{" "}
        <code>kite_api_key</code> and <code>kite_api_secret</code> to the server
        config to turn it on.
      </Card>
    );
  }

  const loginExpired =
    state.error !== null && state.error.includes("ZERODHA_NOT_AUTHENTICATED");
  if (!connected || loginExpired) {
    return (
      <Card className="flex flex-col items-center gap-3 px-4 py-10 text-center text-sm text-[var(--text-secondary)]">
        <p>
          {loginExpired
            ? "Your Zerodha login has expired (they end at 6:00 AM daily)."
            : "Connect Zerodha to see your live P&L."}
        </p>
        <a
          href={ZERODHA_LOGIN_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-[var(--series-blue)] px-4 py-2 font-medium text-white"
        >
          Connect Zerodha
          <ExternalLink size={16} aria-hidden="true" />
        </a>
        <p className="text-xs text-[var(--text-muted)]">
          Opens in a new tab. Come back here when it says connected.
        </p>
      </Card>
    );
  }

  const data = state.data;

  return (
    <div className="flex flex-col gap-4">
      {state.error && <Notice tone="critical">P&amp;L: {state.error}</Notice>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)]">
          Live from your Zerodha account
          {z?.token?.user_name ? ` (${z.token.user_name})` : ""}
          {data
            ? ` · updated ${new Date(data.at).toLocaleTimeString("en-IN")}`
            : ""}
        </p>
        <div className="flex gap-2">
          <Button
            onClick={state.reload}
            disabled={state.loading}
            aria-label="Refresh P&L"
          >
            <RefreshCw
              size={14}
              aria-hidden="true"
              className={state.loading ? "animate-spin" : ""}
            />
            Refresh
          </Button>
          <Button onClick={() => data && downloadCsv(data)} disabled={!data}>
            <Download size={14} aria-hidden="true" />
            Download CSV
          </Button>
        </div>
      </div>

      {!data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : (
        <>
          <Summary data={data} />
          <Positions data={data} />
          <Holdings data={data} />
          <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
            Positions show today&apos;s open and closed trades; realised P&amp;L
            is booked on closed quantity, unrealised on what is still open, and
            M2M is the move since yesterday&apos;s close. Holdings P&amp;L is
            against your average buy price. Older statements (tax P&amp;L, past
            financial years) are only in Zerodha Console — Kite Connect has no
            API for them.
          </p>
        </>
      )}
    </div>
  );
}

function Summary({ data }: { data: ZerodhaPnl }) {
  const p = data.totals.positions;
  const h = data.totals.holdings;
  const holdingsPct = h.invested > 0 ? (h.pnl / h.invested) * 100 : 0;
  const cards: {
    label: string;
    value: ReactNode;
    hint: string;
    tone?: Tone;
  }[] = [
    {
      label: "Positions P&L",
      value: signedInr(p.pnl),
      hint: `Realised ${signedInr(p.realised)} · Open ${signedInr(p.unrealised)}`,
      tone: tone(p.pnl),
    },
    {
      label: "Today's M2M",
      value: signedInr(p.m2m),
      hint: "Positions vs yesterday’s close",
      tone: tone(p.m2m),
    },
    {
      label: "Holdings P&L",
      value: signedInr(h.pnl),
      hint: `${signedPct(holdingsPct)} on ${inr(h.invested)}`,
      tone: tone(h.pnl),
    },
    {
      label: "Holdings today",
      value: signedInr(h.dayChange),
      hint: `Current value ${inr(h.current)}`,
      tone: tone(h.dayChange),
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((c) => (
        <Card key={c.label} className="px-4 py-3">
          <Stat
            label={c.label}
            value={c.value}
            hint={c.hint}
            tone={c.tone}
            size="lg"
          />
        </Card>
      ))}
    </div>
  );
}

function Positions({ data }: { data: ZerodhaPnl }) {
  const t = data.totals.positions;
  return (
    <Card>
      <CardHeader title={`Positions (${data.positions.length})`} />
      {data.positions.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">
          No positions today.
        </p>
      ) : (
        <>
          <MobileList
            rows={data.positions.map((p) => ({
              key: `${p.exchange}:${p.symbol}:${p.product}`,
              symbol: p.symbol,
              sub: `${p.product} · ${p.quantity === 0 ? "Closed" : `Qty ${p.quantity}`} · Avg ${num(p.average)} · LTP ${num(p.last)}`,
              value: p.pnl,
              valueSub: `M2M ${signedInr(p.m2m)}`,
              muted: p.quantity === 0,
            }))}
            total={t.pnl}
          />
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className={thLeft} scope="col">
                    Instrument
                  </th>
                  <th className={thLeft} scope="col">
                    Product
                  </th>
                  <th className={th} scope="col">
                    Net qty
                  </th>
                  <th className={th} scope="col">
                    Avg
                  </th>
                  <th className={th} scope="col">
                    LTP
                  </th>
                  <th className={th} scope="col">
                    Realised
                  </th>
                  <th className={th} scope="col">
                    Unrealised
                  </th>
                  <th className={th} scope="col">
                    M2M
                  </th>
                  <th className={th} scope="col">
                    P&amp;L
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.positions.map((p) => (
                  <tr
                    key={`${p.exchange}:${p.symbol}:${p.product}`}
                    className={`border-t border-[var(--border)] ${p.quantity === 0 ? "text-[var(--text-muted)]" : ""}`}
                  >
                    <td className={tdLeft}>
                      <span className="font-medium">{p.symbol}</span>{" "}
                      <span className="text-[10px] text-[var(--text-muted)]">
                        {p.exchange}
                      </span>
                    </td>
                    <td className={tdLeft}>{p.product}</td>
                    <td className={td}>
                      {p.quantity === 0 ? "Closed" : p.quantity}
                    </td>
                    <td className={td}>{num(p.average)}</td>
                    <td className={td}>{num(p.last)}</td>
                    <td className={td}>
                      <Pnl value={p.realised} />
                    </td>
                    <td className={td}>
                      <Pnl value={p.unrealised} />
                    </td>
                    <td className={td}>
                      <Pnl value={p.m2m} />
                    </td>
                    <td className={`${td} font-semibold`}>
                      <Pnl value={p.pnl} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[var(--border-strong)] font-semibold">
                  <td className={tdLeft} colSpan={5}>
                    Total
                  </td>
                  <td className={td}>
                    <Pnl value={t.realised} />
                  </td>
                  <td className={td}>
                    <Pnl value={t.unrealised} />
                  </td>
                  <td className={td}>
                    <Pnl value={t.m2m} />
                  </td>
                  <td className={td}>
                    <Pnl value={t.pnl} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

function Holdings({ data }: { data: ZerodhaPnl }) {
  const t = data.totals.holdings;
  return (
    <Card>
      <CardHeader title={`Holdings (${data.holdings.length})`} />
      {data.holdings.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">
          No holdings.
        </p>
      ) : (
        <>
          <MobileList
            rows={data.holdings.map((h) => ({
              key: `${h.exchange}:${h.symbol}`,
              symbol: h.symbol,
              sub: `Qty ${h.quantity} · Avg ${num(h.average)} · LTP ${num(h.last)}`,
              value: h.pnl,
              valueSub: `${h.invested > 0 ? signedPct((h.pnl / h.invested) * 100) : "—"} · Day ${signedPct(h.dayChangePct)}`,
            }))}
            total={t.pnl}
          />
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className={thLeft} scope="col">
                    Stock
                  </th>
                  <th className={th} scope="col">
                    Qty
                  </th>
                  <th className={th} scope="col">
                    Avg cost
                  </th>
                  <th className={th} scope="col">
                    LTP
                  </th>
                  <th className={th} scope="col">
                    Invested
                  </th>
                  <th className={th} scope="col">
                    Current
                  </th>
                  <th className={th} scope="col">
                    P&amp;L
                  </th>
                  <th className={th} scope="col">
                    Net chg
                  </th>
                  <th className={th} scope="col">
                    Day chg
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.holdings.map((h) => (
                  <tr
                    key={`${h.exchange}:${h.symbol}`}
                    className="border-t border-[var(--border)]"
                  >
                    <td className={tdLeft}>
                      <span className="font-medium">{h.symbol}</span>{" "}
                      <span className="text-[10px] text-[var(--text-muted)]">
                        {h.exchange}
                      </span>
                    </td>
                    <td className={td}>{h.quantity}</td>
                    <td className={td}>{num(h.average)}</td>
                    <td className={td}>{num(h.last)}</td>
                    <td className={td}>{inr(h.invested)}</td>
                    <td className={td}>{inr(h.current)}</td>
                    <td className={`${td} font-semibold`}>
                      <Pnl value={h.pnl} />
                    </td>
                    <td className={td} style={{ color: pnlColor(h.pnl) }}>
                      {h.invested > 0
                        ? signedPct((h.pnl / h.invested) * 100)
                        : "—"}
                    </td>
                    <td className={td} style={{ color: pnlColor(h.dayChange) }}>
                      {signedPct(h.dayChangePct)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[var(--border-strong)] font-semibold">
                  <td className={tdLeft} colSpan={4}>
                    Total
                  </td>
                  <td className={td}>{inr(t.invested)}</td>
                  <td className={td}>{inr(t.current)}</td>
                  <td className={td}>
                    <Pnl value={t.pnl} />
                  </td>
                  <td className={td} style={{ color: pnlColor(t.pnl) }}>
                    {t.invested > 0
                      ? signedPct((t.pnl / t.invested) * 100)
                      : "—"}
                  </td>
                  <td className={td}>
                    <Pnl value={t.dayChange} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

/** Phones: one row per instrument with its P&L in view, instead of a wide table to scroll. */
function MobileList({
  rows,
  total,
}: {
  rows: {
    key: string;
    symbol: string;
    sub: string;
    value: number;
    valueSub: string;
    muted?: boolean;
  }[];
  total: number;
}) {
  return (
    <ul className="md:hidden">
      {rows.map((r) => (
        <li
          key={r.key}
          className={`flex items-start justify-between gap-3 border-t border-[var(--border)] px-3 py-2.5 first:border-t-0 ${r.muted ? "opacity-70" : ""}`}
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{r.symbol}</div>
            <div className="text-[11px] text-[var(--text-muted)]">{r.sub}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="tabular text-sm font-semibold">
              <Pnl value={r.value} />
            </div>
            <div className="tabular text-[11px] text-[var(--text-muted)]">
              {r.valueSub}
            </div>
          </div>
        </li>
      ))}
      <li className="flex justify-between border-t border-[var(--border-strong)] px-3 py-2.5 text-sm font-semibold">
        <span>Total</span>
        <span className="tabular">
          <Pnl value={total} />
        </span>
      </li>
    </ul>
  );
}

/** Both tables as one CSV, for a spreadsheet or the accountant. */
function downloadCsv(data: ZerodhaPnl): void {
  const cell = (v: string | number) =>
    typeof v === "number" ? String(v) : `"${v.replace(/"/g, '""')}"`;
  const lines = [
    [
      "Section",
      "Instrument",
      "Exchange",
      "Product",
      "Quantity",
      "Average",
      "LTP",
      "Invested",
      "Current",
      "Realised",
      "Unrealised",
      "M2M",
      "P&L",
      "Day change",
    ],
    ...data.positions.map((p) => [
      "Position",
      p.symbol,
      p.exchange,
      p.product,
      p.quantity,
      p.average,
      p.last,
      "",
      "",
      p.realised,
      p.unrealised,
      p.m2m,
      p.pnl,
      "",
    ]),
    ...data.holdings.map((h) => [
      "Holding",
      h.symbol,
      h.exchange,
      "CNC",
      h.quantity,
      h.average,
      h.last,
      h.invested,
      h.current,
      "",
      "",
      "",
      h.pnl,
      h.dayChange,
    ]),
  ].map((row) => row.map(cell).join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `zerodha-pnl-${new Date(data.at).toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
