import { Briefcase, ChartCandlestick, ChartColumn, ChartLine, FolderOpen, Layers, Newspaper, Table2, type LucideIcon } from 'lucide-react';

export type PageId = 'builder' | 'drafts' | 'chart' | 'oi' | 'chain' | 'report' | 'positions';

export interface Route {
  page: PageId;
  /** Draft being monitored, for `#drafts/<id>`. */
  draftId?: string;
}

export const PAGE_LABELS: Record<PageId, string> = {
  builder: 'Strategy Builder',
  drafts: 'Draft Portfolios',
  chart: 'Chart',
  oi: 'Open Interest',
  chain: 'Option Chain',
  report: 'Daily Report',
  positions: 'Positions',
};

export const PAGE_ICONS: Record<PageId, LucideIcon> = {
  builder: Layers,
  drafts: FolderOpen,
  chart: ChartCandlestick,
  oi: ChartColumn,
  chain: Table2,
  report: Newspaper,
  positions: Briefcase,
};

export interface NavItem {
  page: PageId;
  description: string;
}

export type NavEntry = { label: string; items: NavItem[] } | { label: string; page: PageId };

/** Top-bar navigation: dropdown groups, then plain links. */
export const NAV: NavEntry[] = [
  {
    label: 'Trade',
    items: [
      { page: 'builder', description: 'Build and analyse a strategy' },
      { page: 'drafts', description: 'Saved strategies, tracked live' },
    ],
  },
  {
    label: 'Analyse',
    items: [
      { page: 'chart', description: 'TradingView chart with indicators and drawing tools' },
      { page: 'oi', description: 'OI and OI change by strike, over any part of the day' },
      { page: 'chain', description: 'Full chain with OI, volume and IV' },
      { page: 'report', description: 'Levels, flows, global cues and news' },
    ],
  },
  { label: 'Positions', page: 'positions' },
];

/** Phone tab bar: the most used pages one tap away; the Analyse group opens as a sheet. */
export type MobileTab = { label: string; icon: LucideIcon; page: PageId } | { label: string; icon: LucideIcon; group: string };
export const MOBILE_TABS: MobileTab[] = [
  { label: 'Builder', icon: Layers, page: 'builder' },
  { label: 'Drafts', icon: FolderOpen, page: 'drafts' },
  { label: 'Analyse', icon: ChartLine, group: 'Analyse' },
  { label: 'Positions', icon: Briefcase, page: 'positions' },
];

const PAGES = Object.keys(PAGE_LABELS) as PageId[];

/** Reads `#builder`, `#drafts/abc123`, … — older `#chain` style links keep working. */
export function parseRoute(hash: string): Route | null {
  const [page, id] = hash.replace(/^#/, '').split('/');
  if (!PAGES.includes(page as PageId)) return null;
  return page === 'drafts' && id ? { page: 'drafts', draftId: decodeURIComponent(id) } : { page: page as PageId };
}

export const routeHash = (r: Route) => `#${r.page}${r.draftId ? `/${encodeURIComponent(r.draftId)}` : ''}`;
