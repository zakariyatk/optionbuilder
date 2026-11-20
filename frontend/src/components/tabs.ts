import { ChartCandlestick, ChartColumn, ChartLine, FolderOpen, IndianRupee, Layers, Newspaper, PieChart, Sparkles, Table2, type LucideIcon } from 'lucide-react';

export type PageId = 'builder' | 'drafts' | 'ai' | 'chart' | 'oi' | 'chain' | 'report' | 'portfolio' | 'pnl';

export interface Route {
  page: PageId;
  /** Draft being monitored, for `#drafts/<id>`. */
  draftId?: string;
}

export const PAGE_LABELS: Record<PageId, string> = {
  builder: 'Strategy Builder',
  drafts: 'Draft Portfolios',
  ai: 'AI Trade',
  chart: 'Chart',
  oi: 'Open Interest',
  chain: 'Option Chain',
  report: 'Daily Report',
  portfolio: 'Portfolio',
  pnl: 'P&L Report',
};

export const PAGE_ICONS: Record<PageId, LucideIcon> = {
  builder: Layers,
  drafts: FolderOpen,
  ai: Sparkles,
  chart: ChartCandlestick,
  oi: ChartColumn,
  chain: Table2,
  report: Newspaper,
  portfolio: PieChart,
  pnl: IndianRupee,
};

export interface NavItem {
  page: PageId;
  description: string;
}

export type NavEntry = { label: string; items: NavItem[] } | { label: string; page: PageId };

/** Desktop sidebar: every page, under a heading per group. */
export const SIDEBAR: { label: string; pages: PageId[] }[] = [
  { label: 'Trade', pages: ['builder', 'drafts', 'ai'] },
  { label: 'Analyse', pages: ['chart', 'oi', 'chain', 'report'] },
  { label: 'Invest', pages: ['portfolio', 'pnl'] },
];

/** Phone navigation groups: plain links, and groups that open as a sheet from the tab bar. */
export const NAV: NavEntry[] = [
  {
    label: 'Trade',
    items: [
      { page: 'builder', description: 'Build and analyse a strategy' },
      { page: 'drafts', description: 'Saved strategies, tracked live' },
    ],
  },
  // The chart has its own tab on phones, so it isn't repeated in the Analyse sheet.
  { label: 'Chart', page: 'chart' },
  {
    label: 'Analyse',
    items: [
      // Phones reach AI Trade here: the Trade pages there are tabs of their own.
      { page: 'ai', description: 'Claude reads the chart: levels, signal, stop loss and targets' },
      { page: 'oi', description: 'OI and OI change by strike, over any part of the day' },
      { page: 'chain', description: 'Full chain with OI, volume and IV' },
      { page: 'report', description: 'Levels, flows, global cues and news' },
    ],
  },
  {
    label: 'Portfolio',
    items: [
      { page: 'portfolio', description: 'Your investments, P&L and performance' },
      { page: 'pnl', description: 'Live P&L from your Zerodha account' },
    ],
  },
];

/** Phone tab bar: the most used pages one tap away; the Analyse group opens as a sheet. */
export type MobileTab = { label: string; icon: LucideIcon; page: PageId } | { label: string; icon: LucideIcon; group: string };
export const MOBILE_TABS: MobileTab[] = [
  { label: 'Builder', icon: Layers, page: 'builder' },
  { label: 'Drafts', icon: FolderOpen, page: 'drafts' },
  { label: 'Chart', icon: ChartCandlestick, page: 'chart' },
  { label: 'Analyse', icon: ChartLine, group: 'Analyse' },
  { label: 'Portfolio', icon: PieChart, group: 'Portfolio' },
];

const PAGES = Object.keys(PAGE_LABELS) as PageId[];

/** Reads `#builder`, `#drafts/abc123`, … — older `#chain` style links keep working. */
export function parseRoute(hash: string): Route | null {
  const [page, id] = hash.replace(/^#/, '').split('/');
  if (!PAGES.includes(page as PageId)) return null;
  return page === 'drafts' && id ? { page: 'drafts', draftId: decodeURIComponent(id) } : { page: page as PageId };
}

export const routeHash = (r: Route) => `#${r.page}${r.draftId ? `/${encodeURIComponent(r.draftId)}` : ''}`;
