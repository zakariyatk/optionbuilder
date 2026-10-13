import { useEffect, useRef, useState } from 'react';
import { Card, Notice } from '../../components/ui';

/**
 * TradingView's free embeddable chart can't show NSE data (exchange licensing),
 * so NSE indices map to their nearest BSE index and stocks to their BSE listing.
 */
const BSE_INDEX: Record<string, { symbol: string; label: string }> = {
  NIFTY: { symbol: 'BSE:SENSEX', label: 'SENSEX' },
  BANKNIFTY: { symbol: 'BSE:BANKEX', label: 'BANKEX' },
  FINNIFTY: { symbol: 'BSE:SENSEX', label: 'SENSEX' },
  MIDCPNIFTY: { symbol: 'BSE:BSE_MIDCAP', label: 'BSE Midcap' },
};

function tradingViewSymbol(symbol: string): { symbol: string; note: string | null } {
  const index = BSE_INDEX[symbol];
  if (index) {
    return {
      symbol: index.symbol,
      note: `${symbol} isn't available in TradingView's free chart (NSE data licensing), so it shows ${index.label} — the closest BSE index (end-of-day data: daily, weekly and monthly candles).`,
    };
  }
  return {
    symbol: `BSE:${symbol.replace(/[^A-Z0-9_]/g, '_')}`,
    note: `Showing ${symbol}'s BSE listing — TradingView's free chart can't show NSE data. Prices track NSE closely; data is end-of-day.`,
  };
}

const WIDGET_SRC = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';

/** The theme actually applied to the page: the explicit choice on <html>, else the OS preference. */
function usePageTheme(): 'light' | 'dark' {
  const read = (): 'light' | 'dark' => {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'light' || attr === 'dark') return attr;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const update = () => setTheme(read());
    // The app may have applied the stored theme after the first render read it.
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener('change', update);
    return () => {
      observer.disconnect();
      mq?.removeEventListener('change', update);
    };
  }, []);
  return theme;
}

/**
 * TradingView's Advanced Chart: every chart type, timeframe, indicator,
 * drawing tool, compare and snapshot that tradingview.com has, with
 * TradingView's own NSE data. Rebuilt when the symbol or theme changes.
 */
export function ChartPage({ symbol }: { symbol: string }) {
  const host = useRef<HTMLDivElement>(null);
  const theme = usePageTheme();
  const [failed, setFailed] = useState(false);
  const tv = tradingViewSymbol(symbol);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    setFailed(false);
    el.replaceChildren();

    const container = document.createElement('div');
    container.className = 'tradingview-widget-container__widget';
    container.style.height = '100%';
    container.style.width = '100%';
    el.appendChild(container);

    // The embed script reads its config from its own text content.
    const script = document.createElement('script');
    script.src = WIDGET_SRC;
    script.async = true;
    script.type = 'text/javascript';
    script.onerror = () => setFailed(true);
    script.textContent = JSON.stringify({
      autosize: true,
      symbol: tv.symbol,
      // The free chart only has end-of-day BSE data: daily, weekly and monthly candles.
      interval: 'D',
      timezone: 'Asia/Kolkata',
      theme,
      style: '1',
      locale: 'en',
      backgroundColor: theme === 'dark' ? '#0d0d0d' : '#fcfcfb',
      allow_symbol_change: true,
      withdateranges: true,
      details: true,
      hotlist: true,
      calendar: false,
      hide_side_toolbar: false,
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: true,
      support_host: 'https://www.tradingview.com',
    });
    el.appendChild(script);

    return () => el.replaceChildren();
  }, [tv.symbol, theme]);

  return (
    <div className="flex flex-col gap-2">
      {tv.note && <Notice tone="info">{tv.note}</Notice>}
      {failed && (
        <Card className="px-4 py-3 text-sm text-[var(--critical)]">
          The TradingView chart could not load. Check your connection, or an ad / script blocker that blocks tradingview.com.
        </Card>
      )}
      {/* The widget sets its container to 100% × 100%, so the height lives on this wrapper. */}
      <div
        className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-card)]"
        style={{ height: 'max(480px, calc(100vh - 11rem))' }}
      >
        <div ref={host} className="tradingview-widget-container h-full w-full" />
      </div>
      <div className="text-[11px] text-[var(--text-muted)]">
        Chart and market data by{' '}
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer noopener" className="text-[var(--series-blue)] hover:underline">
          TradingView
        </a>
        . Use the symbol search in the chart to open any other instrument.
      </div>
    </div>
  );
}
