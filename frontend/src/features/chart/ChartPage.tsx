import { useEffect, useState } from 'react';
import type { SymbolInfo } from '../../api/types';
import { ProChart } from './ProChart';
import { Watchlist } from './Watchlist';

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

/** Analyse → Chart: a TradingView-style chart on Upstox data, with a watchlist alongside. */
export function ChartPage({
  symbol,
  symbolInfo,
  brokerConnected,
  onOpenBuilder,
}: {
  /** The builder's underlying — the chart opens on it. */
  symbol: string;
  symbolInfo: SymbolInfo[];
  brokerConnected: boolean;
  onOpenBuilder: (symbol: string) => void;
}) {
  const theme = usePageTheme();
  // The chart has its own symbol, so browsing the watchlist never touches the strategy being built.
  const [chartSymbol, setChartSymbol] = useState(symbol);
  const panelHeight = 'max(520px, calc(100vh - 7rem))';

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-card)]" style={{ height: panelHeight }}>
        <ProChart symbol={chartSymbol} symbolInfo={symbolInfo} theme={theme} brokerConnected={brokerConnected} />
      </div>
      <div className="flex min-h-[420px] flex-col lg:min-h-0" style={{ height: panelHeight }}>
        <Watchlist symbolInfo={symbolInfo} selected={chartSymbol} onSelect={setChartSymbol} onOpenBuilder={onOpenBuilder} />
      </div>
    </div>
  );
}
