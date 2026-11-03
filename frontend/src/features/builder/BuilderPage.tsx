import { useMemo, useState, type ReactNode } from 'react';
import type { OptionChain, SpotQuote } from '../../api/types';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { OptionChainTable, type AddLegFn } from '../../components/OptionChainTable';
import { StrikeChain } from '../../components/StrikeChain';
import { Notice } from '../../components/ui';
import { expectedMove, expectedValue, probabilityOfProfit } from '../../domain/analysis';
import { daysToExpiry, formatExpiry, yearsToExpiry } from '../../domain/dates';
import { strategyGreeks } from '../../domain/payoff';
import { matchTemplate, type StrategyTemplate } from '../../domain/templates';
import type { Leg, NewLeg, StrategyMetrics } from '../../domain/types';
import { AnalysisPanel } from './AnalysisPanel';
import { BuilderHeader } from './BuilderHeader';
import { ChainDrawer } from './ChainDrawer';
import { MarketContext, type MarketView } from './market';
import { PositionPanel } from './PositionPanel';
import { PresetBar, StrategyGallery } from './Presets';
import { StatusBar } from './StatusBar';
import { StrategyChart } from './StrategyChart';
import { SummaryStrip } from './SummaryStrip';

/**
 * The strategy builder: header with the underlying, a pinned summary strip,
 * presets, the payoff chart / heatmap, and the position and analysis panels
 * side by side. Strikes are picked from a slide-over option chain. The same
 * page serves India (Upstox, NSE model) and the US (Yahoo, US model) — the
 * `market` decides currency, pricing inputs and labels.
 */
export function BuilderPage({
  market,
  marketSwitch,
  picker,
  symbol,
  spotQuote,
  spotError,
  spot,
  chain,
  chainLoading,
  chainNotice,
  quoteSource,
  expiry,
  onExpiryChange,
  updatedAt,
  legs,
  lotSize,
  metrics,
  fallbackIv,
  marks,
  brokerMargin,
  marginLoading,
  draftCount,
  onTemplate,
  onAddFromChain,
  onAddLeg,
  onUpdateLeg,
  onRemoveLeg,
  onRemoveLegs,
  onClear,
  onSaveDraft,
  onShare,
  onViewDrafts,
  onOpenChainPage,
}: {
  market: MarketView;
  marketSwitch: ReactNode;
  picker: ReactNode;
  symbol: string;
  spotQuote: SpotQuote | null;
  spotError: string | null;
  spot: number | null;
  chain: OptionChain | null;
  chainLoading: boolean;
  /** A notice above the presets: a chain error, or model prices in use. */
  chainNotice: ReactNode;
  /** Where the prices come from, for the status bar. */
  quoteSource: string;
  expiry: string | null;
  onExpiryChange: (e: string) => void;
  updatedAt: number | null;
  legs: Leg[];
  lotSize: number;
  metrics: StrategyMetrics;
  fallbackIv: number | null;
  marks: (number | null)[];
  /** India only. */
  brokerMargin: number | null;
  marginLoading: boolean;
  draftCount: number;
  onTemplate: (t: StrategyTemplate) => void;
  onAddFromChain: AddLegFn;
  onAddLeg: (leg: NewLeg) => void;
  onUpdateLeg: (id: string, patch: Partial<Leg>) => void;
  onRemoveLeg: (id: string) => void;
  onRemoveLegs: (ids: string[]) => void;
  onClear: () => void;
  /** Null when saving to drafts isn't available (US). */
  onSaveDraft: ((name: string) => Promise<boolean>) | null;
  onShare: () => void;
  onViewDrafts: (() => void) | null;
  onOpenChainPage: (() => void) | null;
}) {
  const [chainOpen, setChainOpen] = useState(false);
  const us = market.id === 'US';
  const rows = chain?.rows?.length ? chain.rows : null;
  const chainExpiry = chain?.expiry ?? null;
  const template = useMemo(() => matchTemplate(legs), [legs]);

  // Probabilities run to the nearest leg expiry; with no legs, to the selected expiry.
  const horizon = useMemo(() => legs.map((l) => l.expiry).filter((e): e is string => !!e).sort()[0] ?? expiry, [legs, expiry]);
  const model = market.model;
  const analysis = useMemo(() => {
    const years = horizon ? yearsToExpiry(new Date(), horizon) : 0;
    return {
      em: spot ? expectedMove(spot, fallbackIv, years) : null,
      pop: spot ? probabilityOfProfit(legs, spot, fallbackIv, years) : null,
      ev: spot ? expectedValue(legs, spot, fallbackIv, years) : null,
      greeks: strategyGreeks(legs, spot ?? 0, fallbackIv, new Date(), model),
    };
  }, [legs, spot, fallbackIv, horizon, model]);

  // India quotes margin (broker, else estimate); US quotes capital at risk, as US brokers do.
  const capitalAtRisk = metrics.maxLoss !== null && metrics.maxLoss < 0 ? -metrics.maxLoss : null;
  const margin = !legs.length ? null : us ? capitalAtRisk : (brokerMargin ?? (metrics.marginEstimate > 0 ? metrics.marginEstimate : null));
  const capital = margin ?? capitalAtRisk;
  const horizonLabel = horizon ? formatExpiry(horizon) : null;
  const dte = horizon ? daysToExpiry(horizon) : null;
  const caption = [
    template?.name ?? `Custom · ${legs.length} leg${legs.length === 1 ? '' : 's'}`,
    horizonLabel && `${horizonLabel}${dte !== null ? ` (${dte}d)` : ''}`,
    legs.some((l) => l.type === 'CE' || l.type === 'PE') && `${market.money(Math.abs(metrics.netPremium))} ${metrics.netPremium >= 0 ? 'credit' : 'debit'}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <MarketContext.Provider value={market}>
      <section className="flex flex-col gap-3">
        <BuilderHeader
          symbol={symbol}
          marketSwitch={marketSwitch}
          picker={picker}
          canSave={onSaveDraft !== null}
          spot={spotQuote}
          spotError={spotError}
          expectedMove={analysis.em}
          expiryLabel={horizonLabel}
          atmIv={fallbackIv}
          hasLegs={legs.length > 0}
          draftCount={draftCount}
          onOpenChain={() => setChainOpen(true)}
          onSaveDraft={onSaveDraft ?? (async () => false)}
          onShare={onShare}
          onViewDrafts={onViewDrafts}
          onClear={onClear}
        />

        {legs.length > 0 && <SummaryStrip metrics={metrics} pop={analysis.pop} margin={margin} marginIsBroker={brokerMargin !== null} />}

        {chainNotice}

        <PresetBar
          expiryDates={chain?.expiryDates ?? []}
          expiry={expiry}
          onExpiryChange={onExpiryChange}
          activeTemplate={template?.id ?? null}
          canBuild={spot !== null}
          onTemplate={onTemplate}
        />

        <ErrorBoundary label="the payoff chart">
          {legs.length === 0 ? (
            <StrategyGallery canBuild={spot !== null} onTemplate={onTemplate} onOpenChain={() => setChainOpen(true)} />
          ) : (
            <StrategyChart
              legs={legs}
              spot={spot}
              symbol={symbol}
              title={caption}
              metrics={metrics}
              fallbackIv={fallbackIv}
              marks={marks}
              oiRows={rows}
              capital={capital}
            />
          )}
        </ErrorBoundary>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <PositionPanel
            legs={legs}
            symbol={symbol}
            spot={spot}
            lotSize={lotSize}
            rows={rows}
            chainExpiry={chainExpiry}
            expiryDates={chain?.expiryDates ?? []}
            strategyName={template?.name ?? null}
            onUpdate={onUpdateLeg}
            onRemove={onRemoveLeg}
            onAdd={onAddLeg}
            onClear={onClear}
            onOpenChain={() => setChainOpen(true)}
          />
          <AnalysisPanel
            legs={legs}
            symbol={symbol}
            spot={spot}
            expiryLabel={horizonLabel}
            daysLeft={dte}
            metrics={metrics}
            greeks={analysis.greeks}
            pop={analysis.pop}
            expectedValue={analysis.ev}
            expectedMove={analysis.em}
            atmIv={fallbackIv}
            margin={margin}
            marginIsBroker={brokerMargin !== null}
            marginLoading={marginLoading}
            onOpenChainPage={onOpenChainPage}
            onViewDrafts={onViewDrafts}
          />
        </div>

        <StatusBar updatedAt={updatedAt} source={quoteSource} />

        <ChainDrawer
          open={chainOpen}
          onClose={() => setChainOpen(false)}
          title={
            <>
              Option chain · {market.display(symbol)}
              {chainExpiry && <span className="font-normal text-[var(--text-muted)]"> · {formatExpiry(chainExpiry)}</span>}
              {chain?.source === 'model' && <span className="font-normal text-[var(--warning)]"> · model prices</span>}
            </>
          }
        >
          <ErrorBoundary label="the option chain">
            {rows ? (
              <StrikeChain
                rows={rows}
                spot={spot}
                symbol={symbol}
                lotSize={lotSize}
                expiry={chainExpiry}
                legs={legs}
                maxHeight={2000}
                onAddLeg={onAddFromChain}
                onRemoveLegs={onRemoveLegs}
                onClear={onClear}
              />
            ) : (
              <OptionChainTable rows={null} loading={chainLoading} spot={spot} symbol={symbol} lotSize={lotSize} expiry={chainExpiry} onAddLeg={onAddFromChain} maxHeight="none" />
            )}
          </ErrorBoundary>
        </ChainDrawer>
      </section>
    </MarketContext.Provider>
  );
}

/** The India | US toggle shown at the start of the builder header. */
export function MarketSwitch({ value, onChange }: { value: 'IN' | 'US'; onChange: (m: 'IN' | 'US') => void }) {
  return (
    <div role="group" aria-label="Market" className="inline-flex rounded-lg bg-[var(--surface-sunken)] p-0.5 text-xs font-semibold">
      {(
        [
          ['IN', 'India'],
          ['US', 'US'],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={`rounded-md px-2.5 py-1 transition-colors pointer-coarse:min-h-9 ${
            value === id ? 'bg-[var(--surface-raised)] text-[var(--text-primary)] shadow-[0_1px_2px_#0000001f]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function ModelPriceNotice({ iv, onIvChange, reason }: { iv: number; onIvChange: (v: number) => void; reason: string }) {
  return (
    <Notice
      tone="warning"
      action={
        <label className="flex items-center gap-2">
          <span>IV</span>
          <input
            type="range"
            className="ob-range w-28"
            min={5}
            max={120}
            step={1}
            value={iv}
            onChange={(e) => onIvChange(Number(e.target.value))}
            aria-label="Model implied volatility"
          />
          <span className="w-10 tabular">{iv}%</span>
        </label>
      }
    >
      Model prices — {reason}. Premiums are Black-Scholes values at the IV you set, not market quotes.
    </Notice>
  );
}
