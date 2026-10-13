export type PageId = 'builder' | 'drafts' | 'chain' | 'report' | 'positions';

export interface Route {
  page: PageId;
  /** Draft being monitored, for `#drafts/<id>`. */
  draftId?: string;
}

export const PAGE_LABELS: Record<PageId, string> = {
  builder: 'Strategy Builder',
  drafts: 'Draft Portfolios',
  chain: 'Option Chain',
  report: 'Daily Report',
  positions: 'Positions',
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
      { page: 'chain', description: 'Full chain with OI, volume and IV' },
      { page: 'report', description: 'Levels, flows, global cues and news' },
    ],
  },
  { label: 'Positions', page: 'positions' },
];

const PAGES = Object.keys(PAGE_LABELS) as PageId[];

/** Reads `#builder`, `#drafts/abc123`, … — older `#chain` style links keep working. */
export function parseRoute(hash: string): Route | null {
  const [page, id] = hash.replace(/^#/, '').split('/');
  if (!PAGES.includes(page as PageId)) return null;
  return page === 'drafts' && id ? { page: 'drafts', draftId: decodeURIComponent(id) } : { page: page as PageId };
}

export const routeHash = (r: Route) => `#${r.page}${r.draftId ? `/${encodeURIComponent(r.draftId)}` : ''}`;
