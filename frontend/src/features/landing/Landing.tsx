import { useId, type ReactNode } from 'react';
import type { PayoffPoint } from '../../domain/payoff';
import { useTheme } from '../../hooks/useTheme';
import { DEMO_CHANGE_PCT, DEMO_LEGS, DEMO_SPOT, STRATEGY_CARDS, demoCurve, demoMetrics } from './demo';
import './landing.css';

const inr = (v: number, digits = 2) =>
  `₹${Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const plain = (v: number, digits = 2) => v.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/* ------------------------------------------------------------------ icons */

const Icon = ({ d, size = 22 }: { d: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
const ICON = {
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  bars: <path d="M6 20V12M12 20V5M18 20v-6" />,
  layers: <path d="M12 3 3 8l9 5 9-5-9-5ZM3 13l9 5 9-5M3 17.5l9 5 9-5" />,
  shield: <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Zm-3 9 2 2 4-4" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </>
  ),
  chart: <path d="M3 3v18h18M7 15l4-4 3 3 6-7" />,
  pie: <path d="M21 12a9 9 0 1 1-9-9v9h9ZM14 3.3A9 9 0 0 1 20.7 10H14V3.3Z" />,
  grid: <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />,
  candles: <path d="M7 3v4M7 17v4M5 7h4v10H5zM17 3v6M17 19v2M15 9h4v10h-4z" />,
  doc: <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Zm0 0v6h6M8 13h8M8 17h5" />,
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
};

/* ---------------------------------------------------------- payoff graph */

/**
 * Expiry payoff as an SVG: profit filled green above zero, loss red below,
 * with optional spot / breakeven markers and axes.
 */
function Payoff({
  curve,
  width,
  height,
  spot,
  breakeven,
  axes = false,
  stroke = 2,
}: {
  curve: PayoffPoint[];
  width: number;
  height: number;
  spot?: number;
  breakeven?: number;
  axes?: boolean;
  stroke?: number;
}) {
  const id = useId().replace(/:/g, '');
  const pad = axes ? { l: 46, r: 8, t: 10, b: 24 } : { l: 4, r: 4, t: 6, b: 6 };
  const minX = curve[0].price;
  const maxX = curve[curve.length - 1].price;
  const pnls = curve.map((p) => p.pnl);
  const span = Math.max(...pnls) - Math.min(...pnls) || 1;
  const minY = Math.min(...pnls, 0) - span * 0.12;
  const maxY = Math.max(...pnls, 0) + span * 0.12;
  const x = (v: number) => pad.l + ((v - minX) / (maxX - minX)) * (width - pad.l - pad.r);
  const y = (v: number) => pad.t + ((maxY - v) / (maxY - minY)) * (height - pad.t - pad.b);
  const zero = y(0);
  const line = curve.map((p, i) => `${i ? 'L' : 'M'}${x(p.price).toFixed(1)},${y(p.pnl).toFixed(1)}`).join('');
  const area = `${line}L${x(maxX).toFixed(1)},${zero.toFixed(1)}L${x(minX).toFixed(1)},${zero.toFixed(1)}Z`;
  const yTicks = axes ? [maxY, (maxY + 0) / 2, 0, minY / 2, minY].map((v) => Math.round(v / 100) * 100) : [];
  const xTicks = axes ? [24200, 24500, 24800, 25100] : [];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" preserveAspectRatio="none" aria-hidden="true" className="lp-payoff">
      <defs>
        <clipPath id={`${id}-up`}>
          <rect x="0" y="0" width={width} height={zero} />
        </clipPath>
        <clipPath id={`${id}-down`}>
          <rect x="0" y={zero} width={width} height={height - zero} />
        </clipPath>
      </defs>
      {axes &&
        yTicks.map((v) => (
          <g key={`y${v}`}>
            <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} className="lp-grid" />
            <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" className="lp-tick">
              {v.toLocaleString('en-IN')}
            </text>
          </g>
        ))}
      {axes &&
        xTicks.map((v) => (
          <text key={`x${v}`} x={x(v)} y={height - 6} textAnchor="middle" className="lp-tick">
            {v.toLocaleString('en-IN')}
          </text>
        ))}
      <path d={area} clipPath={`url(#${id}-up)`} className="lp-fill-up" />
      <path d={area} clipPath={`url(#${id}-down)`} className="lp-fill-down" />
      <line x1={pad.l} x2={width - pad.r} y1={zero} y2={zero} className="lp-zero" />
      {spot !== undefined && <line x1={x(spot)} x2={x(spot)} y1={pad.t} y2={height - pad.b} className="lp-spot" />}
      {breakeven !== undefined && <line x1={x(breakeven)} x2={x(breakeven)} y1={pad.t} y2={height - pad.b} className="lp-be" />}
      <path d={line} className="lp-line" strokeWidth={stroke} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* --------------------------------------------------------- product mock */

function ProductPreview() {
  const m = demoMetrics;
  const be = m.breakevens[0];
  const debit = -m.netPremium;
  const tiles: [string, string, 'good' | 'bad' | undefined][] = [
    ['Max Profit', m.maxProfit !== null ? inr(m.maxProfit, 0) : 'Unlimited', 'good'],
    ['Max Loss', m.maxLoss !== null ? inr(m.maxLoss, 0) : 'Unlimited', 'bad'],
    ['Breakeven', be ? plain(be, 0) : '—', undefined],
    ['Risk / Reward', m.riskRewardRatio ? `1 : ${m.riskRewardRatio.toFixed(2)}` : '—', undefined],
    ['Premium Paid', inr(debit, 0), undefined],
    ['ROI (max)', m.maxProfit !== null && debit ? `${((m.maxProfit / debit) * 100).toFixed(1)}%` : '—', undefined],
    ['Margin', inr(m.marginEstimate, 0), undefined],
    ['Lot Size', String(DEMO_LEGS[0].lotSize), undefined],
  ];

  return (
    <div className="lp-preview" role="img" aria-label="Preview of the Strategy Builder: a NIFTY bull call spread with its payoff chart and risk metrics">
      <div className="lp-preview-bar">
        <span className="lp-mark lp-mark-sm">AD</span>
        <span className="lp-brand-sm">
          <b>AD OPTION</b> BUILDER
        </span>
        <span className="lp-preview-tabs">
          <span className="is-active">Strategy Builder</span>
          <span>Analyse</span>
          <span>Watchlist</span>
          <span>Positions</span>
        </span>
        <span className="lp-avatar">Z</span>
      </div>

      <div className="lp-preview-body">
        <div className="lp-col">
          <div className="lp-panel lp-symbol">
            <Icon d={ICON.search} size={14} />
            <b>NIFTY</b>
            <span>{plain(DEMO_SPOT)}</span>
            <span className="lp-up">+{DEMO_CHANGE_PCT.toFixed(2)}%</span>
            <span className="lp-chip">23 Oct 2026</span>
          </div>

          <div className="lp-panel">
            <div className="lp-panel-head">
              <b>Strategy: Bull Call Spread</b>
              <span className="lp-link">Clear All</span>
            </div>
            <div className="lp-legs">
              <span className="lp-legs-h" />
              <span className="lp-legs-h">Type</span>
              <span className="lp-legs-h">Strike</span>
              <span className="lp-legs-h">Lots</span>
              <span className="lp-legs-h">Premium</span>
              {DEMO_LEGS.map((l) => (
                <Leg key={l.id} buy={l.action === 'BUY'} strike={l.strike} lots={l.lots} premium={l.premium} />
              ))}
            </div>
            <span className="lp-addleg">+ Add Leg</span>
            <div className="lp-summary">
              <div>
                <small>Net Debit</small>
                <b>{inr(debit)}</b>
              </div>
              <div>
                <small>Margin</small>
                <b>{inr(m.marginEstimate, 0)}</b>
              </div>
              <div>
                <small>Max Profit</small>
                <b className="lp-up">{m.maxProfit !== null ? inr(m.maxProfit, 0) : '∞'}</b>
              </div>
              <div>
                <small>Max Loss</small>
                <b className="lp-down">{m.maxLoss !== null ? inr(m.maxLoss, 0) : '∞'}</b>
              </div>
            </div>
            <div className="lp-actions">
              <span>Save to Drafts</span>
              <span>Templates</span>
              <span className="is-primary">
                Analyse <Icon d={ICON.arrow} size={12} />
              </span>
            </div>
          </div>

          <div className="lp-panel lp-popular">
            <div className="lp-panel-head">
              <b>Popular Strategies</b>
              <span className="lp-link">View All</span>
            </div>
            <div className="lp-popular-row">
              {STRATEGY_CARDS.slice(0, 4).map(({ template, curve }, i) => (
                <div key={template.id} className={`lp-mini${i === 0 ? ' is-active' : ''}`}>
                  <Payoff curve={curve} width={80} height={34} stroke={1.5} />
                  <span>{template.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lp-col">
          <div className="lp-panel">
            <div className="lp-panel-head">
              <b>Strategy Analysis</b>
            </div>
            <div className="lp-tiles">
              {tiles.map(([k, v, tone]) => (
                <div key={k} className="lp-tile">
                  <small>{k}</small>
                  <b className={tone === 'good' ? 'lp-up' : tone === 'bad' ? 'lp-down' : undefined}>{v}</b>
                </div>
              ))}
            </div>
          </div>

          <div className="lp-panel lp-chart">
            <div className="lp-chart-tabs">
              <span className="is-active">Payoff Chart</span>
              <span>P&amp;L Table</span>
              <span>Greeks</span>
              <span className="lp-chip">At Expiry</span>
            </div>
            <div className="lp-legend">
              <span>
                <i className="lp-key-line" /> P&amp;L
              </span>
              <span>
                <i className="lp-key-spot" /> Spot ({plain(DEMO_SPOT, 0)})
              </span>
              {be && (
                <span>
                  <i className="lp-key-be" /> Breakeven ({plain(be, 0)})
                </span>
              )}
            </div>
            <Payoff curve={demoCurve} width={460} height={230} spot={DEMO_SPOT} breakeven={be} axes />
            <div className="lp-axis-label">Underlying price at expiry</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Leg({ buy, strike, lots, premium }: { buy: boolean; strike: number; lots: number; premium: number }) {
  return (
    <>
      <span className={`lp-side ${buy ? 'is-buy' : 'is-sell'}`}>{buy ? 'B' : 'S'}</span>
      <span className="lp-field">CALL</span>
      <span className="lp-field">{strike}</span>
      <span className="lp-field">{lots}</span>
      <span className="lp-field">{plain(premium)}</span>
    </>
  );
}

/* ------------------------------------------------------------------ page */

const FEATURES = [
  { icon: ICON.gear, title: 'Strategy Builder', text: 'Add legs straight from the live option chain, from one-click templates, or by hand — options, futures and stock.' },
  { icon: ICON.chart, title: 'Payoff Charts', text: 'Expiry and target-date curves with breakevens, so you see profit, loss and risk before you trade.' },
  { icon: ICON.bars, title: 'Greeks & Analytics', text: 'Position Delta, Gamma, Theta and Vega, risk/reward and broker margin for the whole strategy.' },
  { icon: ICON.pie, title: 'Positions & Drafts', text: 'Save strategies as drafts, track their live P&L, and follow your broker positions in one place.' },
];

const MORE = [
  { icon: ICON.grid, title: 'Smart option chain', text: 'ITM / ATM shading, IV and volume, and unusual activity — OI walls, volume surges and build-ups — flagged for you.' },
  { icon: ICON.candles, title: 'Pro charting', text: 'Candles on live Upstox data with indicators, drawing tools, horizontal rays and long / short position boxes.' },
  { icon: ICON.bolt, title: 'Live watchlists', text: 'Several named watchlists with prices refreshing every few seconds while NSE is open.' },
  { icon: ICON.layers, title: 'Open interest analysis', text: 'See OI change by strike over any window of the session to spot where positions are building.' },
  { icon: ICON.doc, title: 'Daily market report', text: 'Max-OI support and resistance, PCR, FII / DII flows and global cues — export it as an image or carousel.' },
  { icon: ICON.shield, title: 'Risk first', text: 'Max profit, max loss and margin are always on screen, so every trade starts from what you could lose.' },
];

const STEPS = [
  { title: 'Pick an underlying', text: 'Choose NIFTY, BANKNIFTY or any F&O stock and an expiry. The chain loads live.' },
  { title: 'Build the strategy', text: 'Tap strikes to buy or sell, or start from a template like a bull call spread or iron condor.' },
  { title: 'Read the risk', text: 'The payoff, breakevens, Greeks and margin update as you go. Save it, or track it as a draft.' },
];

export function Landing({ onSignIn }: { onSignIn: () => void }) {
  // Same light / dark choice as the app, remembered across both.
  const { theme, toggle } = useTheme();
  const nextTheme = theme === 'dark' ? 'light' : 'dark';

  return (
    <div className="lp">
      <a href="#lp-main" className="lp-skip">
        Skip to content
      </a>
      <header className="lp-header">
        <div className="lp-wrap lp-header-row">
          <a href="#top" className="lp-logo" aria-label="AD Option Builder home">
            <span className="lp-mark">AD</span>
            <span className="lp-brand">
              <b>AD OPTION</b> BUILDER
            </span>
          </a>
          <nav className="lp-nav" aria-label="Sections">
            <a href="#features">Features</a>
            <a href="#strategies">Strategies</a>
            <a href="#how">How it works</a>
          </nav>
          <div className="lp-header-cta">
            <button
              type="button"
              className="lp-btn lp-btn-ghost lp-theme"
              onClick={toggle}
              aria-label={`Switch to ${nextTheme} theme`}
              title={`Switch to ${nextTheme} theme`}
            >
              <Icon d={theme === 'dark' ? ICON.sun : ICON.moon} size={18} />
            </button>
            <button type="button" className="lp-btn lp-btn-ghost" onClick={onSignIn}>
              Sign in
            </button>
            <button type="button" className="lp-btn lp-btn-primary lp-hide-sm" onClick={onSignIn}>
              Get Started <Icon d={ICON.arrow} size={18} />
            </button>
          </div>
        </div>
      </header>

      <main id="lp-main">
        <section className="lp-hero" id="top">
          <div className="lp-wrap lp-hero-grid">
            <div className="lp-hero-copy">
              <span className="lp-pill">Smarter options strategy building</span>
              <h1>
                Build Options Strategies with <span className="lp-accent">Clarity &amp; Control</span>
              </h1>
              <p className="lp-lead">
                Visualise payoffs, compare strategies and make data-driven trading decisions with an intuitive options builder on live NSE
                data.
              </p>
              <div className="lp-cta-row">
                <button type="button" className="lp-btn lp-btn-primary lp-btn-lg" onClick={onSignIn}>
                  Launch Option Builder <Icon d={ICON.arrow} size={20} />
                </button>
                <a href="#features" className="lp-btn lp-btn-outline lp-btn-lg">
                  Explore Features
                </a>
              </div>
              <ul className="lp-points">
                <li>
                  <span className="lp-icon-box">
                    <Icon d={ICON.bars} />
                  </span>
                  Live payoff visualisation
                </li>
                <li>
                  <span className="lp-icon-box">
                    <Icon d={ICON.layers} />
                  </span>
                  Multi-leg strategy builder
                </li>
                <li>
                  <span className="lp-icon-box">
                    <Icon d={ICON.shield} />
                  </span>
                  Risk &amp; reward analysis
                </li>
              </ul>
            </div>
            <ProductPreview />
          </div>
        </section>

        <section className="lp-strip" id="features" aria-label="Features">
          <div className="lp-wrap lp-strip-grid">
            {FEATURES.map((f) => (
              <div key={f.title} className="lp-strip-item">
                <span className="lp-icon-box lp-icon-lg">
                  <Icon d={f.icon} size={26} />
                </span>
                <div>
                  <h2>{f.title}</h2>
                  <p>{f.text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="lp-section" id="strategies">
          <div className="lp-wrap">
            <div className="lp-section-head">
              <span className="lp-eyebrow">Strategies</span>
              <h2>One click from idea to position</h2>
              <p>Every template builds around the current ATM strike with live premiums, then you fine-tune strikes and lots.</p>
            </div>
            <div className="lp-cards">
              {STRATEGY_CARDS.map(({ template, curve }) => (
                <article key={template.id} className="lp-card">
                  <div className="lp-card-graph">
                    <Payoff curve={curve} width={240} height={90} />
                  </div>
                  <div className="lp-card-head">
                    <h3>{template.name}</h3>
                    <span className={`lp-view lp-view-${template.view.toLowerCase()}`}>{template.view}</span>
                  </div>
                  <p>{template.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-section lp-section-alt">
          <div className="lp-wrap">
            <div className="lp-section-head">
              <span className="lp-eyebrow">Everything in one workspace</span>
              <h2>Built for how options traders actually work</h2>
            </div>
            <div className="lp-more">
              {MORE.map((f) => (
                <div key={f.title} className="lp-more-item">
                  <span className="lp-icon-box">
                    <Icon d={f.icon} />
                  </span>
                  <h3>{f.title}</h3>
                  <p>{f.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-section" id="how">
          <div className="lp-wrap">
            <div className="lp-section-head">
              <span className="lp-eyebrow">How it works</span>
              <h2>From market view to a defined-risk trade in minutes</h2>
            </div>
            <ol className="lp-steps">
              {STEPS.map((s, i) => (
                <li key={s.title}>
                  <span className="lp-step-n">{i + 1}</span>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="lp-final">
          <div className="lp-wrap lp-final-box">
            <h2>
              Ready to build your next <span className="lp-accent">strategy</span>?
            </h2>
            <p>Open the builder and see the payoff of your idea before you place a single order.</p>
            <button type="button" className="lp-btn lp-btn-primary lp-btn-lg" onClick={onSignIn}>
              Launch Option Builder <Icon d={ICON.arrow} size={20} />
            </button>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-row">
          <span className="lp-logo">
            <span className="lp-mark lp-mark-sm">AD</span>
            <span className="lp-brand">
              <b>AD OPTION</b> BUILDER
            </span>
          </span>
          <p>
            Options trading involves substantial risk. Option Builder is an analysis tool, not investment advice. © {new Date().getFullYear()} ADD
            DOTS
          </p>
        </div>
      </footer>
    </div>
  );
}
