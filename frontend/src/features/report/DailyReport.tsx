import { useRef, useState, type ReactNode } from 'react';
import { Camera, Download, ExternalLink, TriangleAlert } from 'lucide-react';
import { UPSTOX_LOGIN_URL, api, assetUrl, errorMessage } from '../../api/client';
import type { FiiDiiRow, GlobalMarkets, MaxOiSummary, NewsItem, OiPeak } from '../../api/types';
import { Button, Card, Skeleton, Stat, type Tone } from '../../components/ui';
import { formatExpiry, timeAgo } from '../../domain/dates';
import { useAsync } from '../../hooks/useAsync';
import { compactIndian } from '../../lib/format';
import { openInstagramCarousel } from '../instagram/instagramCarousel';
import { downloadNodeAsImage, reportFilename, type ImageFormat } from './exportImage';
import { OiDistributionChart } from './OiDistributionChart';

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle && <p className="text-[11px] text-[var(--text-muted)]">{subtitle}</p>}
      </div>
      {children}
    </Card>
  );
}

/** Loading / error / content switch shared by every section. */
function Async<T>({ state, children }: { state: { data: T | null; error: string | null; loading: boolean; reload: () => void }; children: (data: T) => ReactNode }) {
  if (state.data) return <>{children(state.data)}</>;
  if (state.error) {
    return (
      <div className="flex items-center gap-2 text-xs text-[var(--critical)]">
        {state.error}
        <Button size="xs" onClick={state.reload} data-export-ignore="true">
          Retry
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-3/5" />
    </div>
  );
}

function PeakStat({ label, peak, tone }: { label: string; peak: OiPeak | null; tone: 'call' | 'put' }) {
  if (!peak) return <div className="text-[var(--text-muted)]">{label}: —</div>;
  const added = peak.oiChange >= 0;
  return (
    <div>
      <div className="text-[11px] text-[var(--text-muted)]">{label}</div>
      <div className="tabular text-lg font-semibold" style={{ color: tone === 'call' ? 'var(--critical)' : 'var(--good-text)' }}>
        {peak.strike.toLocaleString('en-IN')}
      </div>
      <div className="tabular text-[11px] text-[var(--text-secondary)]">
        OI {compactIndian(peak.oi)} · LTP {peak.ltp.toFixed(2)}
      </div>
      <div className="tabular text-[11px]" style={{ color: added ? 'var(--good-text)' : 'var(--critical)' }}>
        {added ? '▲ added' : '▼ unwound'} {compactIndian(Math.abs(peak.oiChange))}
      </div>
    </div>
  );
}

function ExpiryOiCard({ title, summary }: { title: string; summary: MaxOiSummary | null }) {
  if (!summary) {
    return (
      <Card className="p-3">
        <div className="text-xs font-medium">{title}</div>
        <div className="mt-2 text-xs text-[var(--text-muted)]">Not available</div>
      </Card>
    );
  }
  return (
    <Card className="p-3">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-xs font-medium">{title}</span>
        <span className="tabular text-[11px] text-[var(--text-muted)]">{formatExpiry(summary.expiry)}</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <PeakStat label="Highest Call OI (resistance)" peak={summary.maxCallOi} tone="call" />
        <PeakStat label="Highest Put OI (support)" peak={summary.maxPutOi} tone="put" />
      </div>
      <div className="mt-3 border-t border-[var(--border)] pt-3">
        <OiDistributionChart
          data={summary.distribution}
          spot={summary.spot}
          maxCallStrike={summary.maxCallOi?.strike}
          maxPutStrike={summary.maxPutOi?.strike}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-4 border-t border-[var(--border)] pt-2 text-[11px] tabular text-[var(--text-muted)]">
        <span>
          PCR <span className="text-[var(--text-primary)]">{summary.pcr === null ? '—' : summary.pcr.toFixed(2)}</span>
          {summary.pcr !== null && (
            <span style={{ color: summary.pcr >= 1 ? 'var(--good-text)' : 'var(--critical)' }}>
              {' '}
              {summary.pcr >= 1 ? 'bullish tilt' : 'bearish tilt'}
            </span>
          )}
        </span>
        <span>
          Total call OI <span className="text-[var(--text-primary)]">{compactIndian(summary.totalCallOi)}</span>
        </span>
        <span>
          Total put OI <span className="text-[var(--text-primary)]">{compactIndian(summary.totalPutOi)}</span>
        </span>
      </div>
    </Card>
  );
}

function FlowBars({ buy, sell }: { buy: number; sell: number }) {
  const max = Math.max(buy, sell, 1);
  const bar = (label: string, v: number, color: string) => (
    <div className="flex items-center gap-2">
      <span className="w-9 text-[10px] text-[var(--text-muted)]">{label}</span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-sm bg-[var(--gridline)]">
        <div className="h-full rounded-sm" style={{ width: `${(v / max) * 100}%`, background: color }} />
      </div>
      <span className="tabular w-20 text-right text-[10px] text-[var(--text-secondary)]">₹{v.toLocaleString('en-IN')}</span>
    </div>
  );
  return (
    <div className="mt-2 flex flex-col gap-1">
      {bar('Buy', buy, 'var(--good)')}
      {bar('Sell', sell, 'var(--critical)')}
    </div>
  );
}

function FlowCards({ rows }: { rows: FiiDiiRow[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {rows.map((r) => {
        const buyers = r.net >= 0;
        return (
          <Card key={r.category} className="p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium">{r.category}</span>
              <span className="text-[11px] text-[var(--text-muted)]">{r.date}</span>
            </div>
            <div className="tabular text-2xl font-semibold" style={{ color: buyers ? 'var(--good-text)' : 'var(--critical)' }}>
              {buyers ? '+' : '−'}₹{Math.abs(r.net).toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr
            </div>
            <div className="text-[11px] text-[var(--text-secondary)]">{buyers ? 'Net buyers' : 'Net sellers'} · ₹ crore</div>
            <FlowBars buy={r.buy} sell={r.sell} />
          </Card>
        );
      })}
    </div>
  );
}

/** Colour from India's point of view: a rise in crude, USD/INR or VIX is a headwind. */
function cueColor(changePct: number, inverse?: boolean) {
  if (Math.abs(changePct) < 0.005) return 'var(--text-muted)';
  return (inverse ? changePct < 0 : changePct > 0) ? 'var(--good-text)' : 'var(--critical)';
}

function GlobalCues({ data }: { data: GlobalMarkets }) {
  const { sentiment } = data;
  const tone = ['Risk-on', 'Mildly positive'].includes(sentiment.label)
    ? 'var(--good-text)'
    : ['Risk-off', 'Mildly negative'].includes(sentiment.label)
      ? 'var(--critical)'
      : 'var(--text-primary)';
  return (
    <div className="flex flex-col gap-3">
      <Card className="p-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Sentiment</span>
          <span className="text-xl font-semibold" style={{ color: tone }}>
            {sentiment.label}
          </span>
          {sentiment.equityAvg !== null && (
            <span className="tabular text-[11px] text-[var(--text-secondary)]">
              global equities avg {sentiment.equityAvg >= 0 ? '+' : ''}
              {sentiment.equityAvg.toFixed(2)}%
            </span>
          )}
        </div>
        {sentiment.drivers.length > 0 && (
          <div className="mt-1 tabular text-[11px] text-[var(--text-secondary)]">Biggest moves: {sentiment.drivers.join(' · ')}</div>
        )}
        {sentiment.caveats.length > 0 && (
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {sentiment.caveats.map((c) => (
              <li key={c} className="flex items-start gap-1 text-[11px] text-[var(--warning)]">
                <TriangleAlert size={14} aria-hidden="true" className="mt-px shrink-0" />
                {c}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.groups.map((g) => (
          <Card key={g.group} className="p-3">
            <div className="mb-2 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{g.group}</div>
            <ul className="flex flex-col gap-1">
              {g.items.map((item) => (
                <li key={item.symbol} className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[11px] text-[var(--text-secondary)]">{item.name}</span>
                  {item.ok ? (
                    <span className="tabular shrink-0 text-[11px] font-semibold" style={{ color: cueColor(item.changePct, item.inverseForIndia) }}>
                      {item.changePct >= 0 ? '+' : ''}
                      {item.changePct.toFixed(2)}%
                    </span>
                  ) : (
                    <span className="shrink-0 text-[11px] text-[var(--text-muted)]">—</span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}

const TAG_COLOR: Record<string, string> = {
  RESULTS: 'var(--series-blue)',
  INDEX: 'var(--unusual)',
  POLICY: 'var(--warning)',
  FLOWS: 'var(--good-text)',
};

function NewsList({ items }: { items: NewsItem[] }) {
  if (items.length === 0) return <div className="text-xs text-[var(--text-muted)]">No headlines right now.</div>;
  return (
    <ul className="flex flex-col">
      {items.map((n, i) => {
        const color = (n.tag && TAG_COLOR[n.tag]) ?? 'var(--text-muted)';
        return (
          <li key={n.link} className={`flex items-baseline gap-2 py-1.5 ${i ? 'border-t border-[var(--gridline)]' : 'pt-0'}`}>
            {n.tag && (
              <span
                className="min-w-[3.4rem] shrink-0 rounded px-1 py-px text-center text-[8px] font-bold tracking-wide opacity-90"
                style={{ color, border: `1px solid ${color}` }}
              >
                {n.tag}
              </span>
            )}
            <a href={n.link} target="_blank" rel="noreferrer noopener" className="flex-1 text-xs leading-snug hover:underline" title={n.title}>
              {n.point ?? n.title}
            </a>
            {n.figures && n.figures.length > 0 && (
              <span className="tabular hidden shrink-0 text-[10px] font-semibold text-[var(--text-secondary)] sm:inline">{n.figures.join(' · ')}</span>
            )}
            <span className="shrink-0 text-[10px] text-[var(--text-muted)]">{timeAgo(n.published)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function DailyReport({ symbol, brokerConnected }: { symbol: string; brokerConnected: boolean }) {
  const maxOi = useAsync(() => api.maxOi(symbol), [symbol], { enabled: brokerConnected });
  const flows = useAsync(() => api.fiiDii().then((r) => r.data), []);
  const global = useAsync(() => api.globalMarkets(), []);
  const news = useAsync(() => api.news().then((r) => r.items), []);

  const reportRef = useRef<HTMLDivElement>(null);
  const brandRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState<ImageFormat | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [logoOk, setLogoOk] = useState(true);

  const exportAs = async (format: ImageFormat) => {
    const node = reportRef.current;
    if (!node) return;
    setExporting(format);
    setExportError(null);
    // The brand header only appears in the exported image.
    if (brandRef.current) brandRef.current.style.display = 'flex';
    try {
      const background = getComputedStyle(document.body).backgroundColor || '#ffffff';
      await downloadNodeAsImage(node, { filename: reportFilename(symbol), format, background });
    } catch (e) {
      setExportError(errorMessage(e));
    } finally {
      if (brandRef.current) brandRef.current.style.display = 'none';
      setExporting(null);
    }
  };

  const current = maxOi.data?.currentMonthly;
  const fii = flows.data?.find((r) => r.category === 'FII');
  const dii = flows.data?.find((r) => r.category === 'DII');
  const pcrTone: Tone = current?.pcr == null ? 'neutral' : current.pcr >= 1 ? 'good' : 'critical';
  const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(0)}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {exportError && <span className="mr-auto text-[11px] text-[var(--critical)]">{exportError}</span>}
        <Button onClick={() => openInstagramCarousel(symbol)} title="Build a 7-slide Instagram carousel from this report" className="font-semibold">
          <Camera size={16} aria-hidden="true" />
          Instagram post
        </Button>
        <span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
          <Download size={14} aria-hidden="true" />
          Export report
        </span>
        <Button onClick={() => exportAs('png')} disabled={exporting !== null} title="Download as PNG — sharper text, larger file">
          {exporting === 'png' ? 'Rendering…' : 'PNG'}
        </Button>
        <Button onClick={() => exportAs('jpeg')} disabled={exporting !== null} title="Download as JPG — smaller file, best for sharing">
          {exporting === 'jpeg' ? 'Rendering…' : 'JPG'}
        </Button>
      </div>

      <div ref={reportRef} className="flex flex-col gap-4">
        <div ref={brandRef} className="items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-card)] p-3" style={{ display: 'none' }}>
          <div className="flex items-center gap-2.5">
            {logoOk && (
              <img src={assetUrl('logo.png')} alt="" width={32} height={32} className="rounded-full object-cover" onError={() => setLogoOk(false)} />
            )}
            <div className="leading-tight">
              <div className="text-sm font-semibold">Daily Report — {symbol}</div>
              <div className="text-[10px] text-[var(--text-muted)]">ZAK TRADE · Learn · Trade · Grow</div>
            </div>
          </div>
          <div className="text-right text-[10px] text-[var(--text-muted)]">
            {new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
          </div>
        </div>

        <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          <Stat size="lg" label="Resistance" value={current?.maxCallOi ? current.maxCallOi.strike.toLocaleString('en-IN') : '—'} hint="Highest call OI" tone="critical" />
          <Stat size="lg" label="Support" value={current?.maxPutOi ? current.maxPutOi.strike.toLocaleString('en-IN') : '—'} hint="Highest put OI" tone="good" />
          <Stat
            size="lg"
            label="PCR"
            value={current?.pcr == null ? '—' : current.pcr.toFixed(2)}
            hint={current?.pcr == null ? 'Put/call ratio' : current.pcr >= 1 ? 'Bullish tilt' : 'Bearish tilt'}
            tone={pcrTone}
          />
          <Stat
            size="lg"
            label="FII / DII net"
            value={fii && dii ? `${signed(fii.net)} / ${signed(dii.net)}` : '—'}
            hint={fii ? `₹ crore · ${fii.date}` : '₹ crore'}
            tone={fii ? (fii.net >= 0 ? 'good' : 'critical') : undefined}
          />
        </Card>

        <Section
          title="Global market sentiment"
          subtitle="Overnight and morning cues that shape the Indian open. Colour is from India's point of view — a rise in crude, USD/INR or VIX reads as a negative."
        >
          <Async state={global}>{(d) => <GlobalCues data={d} />}</Async>
        </Section>

        <Section
          title={`Open interest — ${symbol}`}
          subtitle="The strikes carrying the most open interest, which tend to act as resistance (calls) and support (puts)."
        >
          {brokerConnected ? (
            <Async state={maxOi}>
              {(d) => (
                <div className="grid gap-3 lg:grid-cols-2">
                  <ExpiryOiCard title="Current monthly expiry" summary={d.currentMonthly} />
                  <ExpiryOiCard title={`December ${new Date().getFullYear()} expiry`} summary={d.december} />
                </div>
              )}
            </Async>
          ) : (
            <div className="text-xs text-[var(--text-muted)]">
              Connect Upstox to load open-interest data.{' '}
              <a href={UPSTOX_LOGIN_URL} target="_blank" rel="noreferrer" className="text-[var(--good-text)] hover:underline">
                Connect
                <ExternalLink size={12} aria-hidden="true" className="ml-0.5 inline align-[-1px]" />
              </a>
            </div>
          )}
        </Section>

        <Section title="FII / DII activity" subtitle="Cash-market flows, ₹ crore. Source: NSE.">
          <Async state={flows}>{(rows) => <FlowCards rows={rows} />}</Async>
        </Section>

        <Section title="Key market news" subtitle="Headlines condensed to the point, tagged and de-duplicated. Hover a line for the full headline.">
          <Async state={news}>{(items) => <NewsList items={items} />}</Async>
        </Section>
      </div>
    </div>
  );
}
