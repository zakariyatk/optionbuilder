import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ExternalLink, LogOut, Moon, PanelLeftClose, PanelLeftOpen, Sun } from 'lucide-react';
import { UPSTOX_LOGIN_URL } from '../api/client';
import type { AuthStatus } from '../api/types';
import { useTheme } from '../hooks/useTheme';
import { MOBILE_TABS, NAV, PAGE_ICONS, PAGE_LABELS, SIDEBAR, type NavItem, type PageId, type Route } from './tabs';
import { Logo } from './Logo';
import { Dot } from './ui';

function BrokerBadge({ status }: { status: AuthStatus | null }) {
  if (status?.authenticated) {
    const expires = status.token?.expires_at
      ? new Date(status.token.expires_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
      : null;
    return (
      <span
        className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]"
        title={expires ? `Upstox session valid until ${expires}` : undefined}
      >
        <Dot color="var(--good)" />
        Live via Upstox
      </span>
    );
  }
  if (status?.marketData) {
    // Analytics token: live data with no daily login; Connect only adds broker margin.
    return (
      <span className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
        <span className="flex items-center gap-1.5" title="Live market data via the Upstox analytics token">
          <Dot color="var(--good)" />
          Live data
        </span>
        {status.configured && (
          <a
            href={UPSTOX_LOGIN_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-medium hover:opacity-85 pointer-coarse:min-h-10"
            style={{ background: 'var(--good-fill)', color: 'var(--good-text)' }}
            title="Log in to Upstox for real broker margin"
          >
            Connect for margin
            <ExternalLink size={12} aria-hidden="true" />
          </a>
        )}
      </span>
    );
  }
  if (status?.configured) {
    return (
      <a
        href={UPSTOX_LOGIN_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium hover:opacity-85 pointer-coarse:min-h-10"
        style={{ background: 'var(--good-fill)', color: 'var(--good-text)' }}
      >
        Connect Upstox for live data
        <ExternalLink size={14} aria-hidden="true" />
      </a>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
      <Dot color="var(--warning)" />
      Manual entry mode
    </span>
  );
}

/** A dropdown that opens on click (and on hover with a mouse), closing on outside click or Escape. */
function Menu({
  trigger,
  align = 'left',
  label,
  children,
}: {
  trigger: (open: boolean) => ReactNode;
  align?: 'left' | 'right';
  label: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hoverable = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? false;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div
      ref={ref}
      className="relative flex h-full items-stretch"
      onMouseEnter={hoverable ? () => setOpen(true) : undefined}
      onMouseLeave={hoverable ? () => setOpen(false) : undefined}
    >
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)} className="flex items-stretch">
        {trigger(open)}
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute top-full z-40 min-w-[15rem] rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] p-1 shadow-xl ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

const Chevron = ({ open }: { open: boolean }) => (
  <ChevronDown size={14} strokeWidth={2.25} aria-hidden="true" className={`transition-transform ${open ? 'rotate-180' : ''}`} />
);

/** One page in a navigation list: icon, name and a one-line description. */
function PageItem({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  const Icon = PAGE_ICONS[item.page];
  return (
    <button
      type="button"
      role="menuitem"
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left hover:bg-[var(--surface-sunken)]"
    >
      <Icon size={20} strokeWidth={1.75} aria-hidden="true" className={`mt-0.5 shrink-0 ${active ? 'text-[var(--series-blue)]' : 'text-[var(--text-secondary)]'}`} />
      <span className="min-w-0">
        <span className={`block text-sm font-medium ${active ? 'text-[var(--series-blue)]' : ''}`}>{PAGE_LABELS[item.page]}</span>
        <span className="block text-xs text-[var(--text-muted)]">{item.description}</span>
      </span>
    </button>
  );
}

/** Phone navigation: a bottom tab bar; a group tab opens its pages in a bottom sheet. */
function MobileTabBar({ route, onNavigate }: { route: Route; onNavigate: (page: PageId) => void }) {
  const [sheet, setSheet] = useState<string | null>(null);
  const group = sheet ? NAV.find((e) => e.label === sheet && 'items' in e) : undefined;
  const items = group && 'items' in group ? group.items : [];

  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSheet(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sheet]);

  return (
    <>
      {sheet && (
        <div className="fixed inset-0 z-40 bg-black/45 md:hidden" onClick={() => setSheet(null)}>
          <div
            role="menu"
            aria-label={`${sheet} pages`}
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-0 rounded-t-2xl border-t border-[var(--border-strong)] bg-[var(--surface-raised)] p-2 shadow-2xl"
            style={{ bottom: 'var(--tabbar-h)' }}
          >
            <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{sheet}</div>
            {items.map((item) => (
              <PageItem
                key={item.page}
                item={item}
                active={route.page === item.page}
                onClick={() => {
                  setSheet(null);
                  onNavigate(item.page);
                }}
              />
            ))}
          </div>
        </div>
      )}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-[var(--border)] bg-[var(--surface-raised)] md:hidden"
        style={{ height: 'var(--tabbar-h)', paddingBottom: 'env(safe-area-inset-bottom)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
      >
        {MOBILE_TABS.map((tab) => {
          const groupEntry = 'group' in tab ? NAV.find((e) => e.label === tab.group) : undefined;
          const active =
            'page' in tab
              ? route.page === tab.page
              : !!groupEntry && 'items' in groupEntry && groupEntry.items.some((i) => i.page === route.page);
          const open = 'group' in tab && sheet === tab.group;
          const Icon = tab.icon;
          return (
            <button
              key={tab.label}
              type="button"
              aria-current={'page' in tab && active ? 'page' : undefined}
              aria-haspopup={'group' in tab ? 'menu' : undefined}
              aria-expanded={'group' in tab ? open : undefined}
              onClick={() => {
                if ('page' in tab) {
                  setSheet(null);
                  onNavigate(tab.page);
                } else setSheet((s) => (s === tab.group ? null : tab.group));
              }}
              className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                active || open ? 'text-[var(--series-blue)]' : 'text-[var(--text-secondary)]'
              }`}
            >
              <span className={`flex h-7 w-14 items-center justify-center rounded-full ${active ? 'bg-[color-mix(in_srgb,var(--series-blue)_14%,transparent)]' : ''}`}>
                <Icon size={22} strokeWidth={active ? 2.1 : 1.75} aria-hidden="true" />
              </span>
              <span className="truncate">{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}

function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'AD';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

const SIDEBAR_KEY = 'ob.sidebar';

/** The sidebar's collapsed state, remembered per browser, and mirrored on <html> so --sidebar-w follows it. */
function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === 'collapsed';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-sidebar', collapsed ? 'collapsed' : 'open');
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'open');
    } catch {
      /* private window: the choice just isn't remembered */
    }
    return () => root.removeAttribute('data-sidebar');
  }, [collapsed]);
  return [collapsed, () => setCollapsed((c) => !c)];
}

const sideItem = (active: boolean) =>
  `flex min-h-9 w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
    active
      ? 'bg-[color-mix(in_srgb,var(--series-blue)_14%,transparent)] font-medium text-[var(--series-blue)]'
      : 'text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]'
  }`;

/** Desktop navigation and account controls: a left sidebar in place of a top header, collapsible to icons. */
function Sidebar({
  route,
  onNavigate,
  broker,
  onLogout,
  showLogout,
}: {
  route: Route;
  onNavigate: (page: PageId) => void;
  broker: AuthStatus | null;
  onLogout: () => void;
  showLogout: boolean;
}) {
  const { theme, toggle } = useTheme();
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const userName = broker?.token?.user_name ?? null;
  const live = !!(broker?.authenticated || broker?.marketData);
  // Collapsed, a label shows as the button's tooltip instead.
  const tip = (text: string) => (collapsed ? text : undefined);

  return (
    <aside
      aria-label="Main"
      className="safe-top fixed inset-y-0 left-0 z-30 hidden flex-col overflow-y-auto overflow-x-hidden border-r border-[var(--border)] bg-[var(--surface-raised)] px-2 py-3 transition-[width] duration-200 md:flex"
      style={{ width: 'var(--sidebar-w)' }}
    >
      <div className="mb-3 flex items-center gap-2.5 px-1">
        <a className="ob-logo shrink-0" href="https://www.adddots.com/" aria-label="ADD DOTS home">
          <Logo size={28} />
        </a>
        {!collapsed && (
          <button type="button" onClick={() => onNavigate('builder')} className="ob-title truncate !text-base">
            AddStock
          </button>
        )}
      </div>

      <nav className="flex flex-col gap-0.5">
        {SIDEBAR.map((group) => (
          <div key={group.label} className="flex flex-col gap-0.5">
            {collapsed ? (
              <div className="mx-2.5 my-2 border-t border-[var(--border)]" aria-hidden="true" />
            ) : (
              <div className="px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{group.label}</div>
            )}
            {group.pages.map((page) => {
              const Icon = PAGE_ICONS[page];
              const active = route.page === page;
              return (
                <button
                  key={page}
                  type="button"
                  onClick={() => onNavigate(page)}
                  aria-current={active ? 'page' : undefined}
                  aria-label={collapsed ? PAGE_LABELS[page] : undefined}
                  title={tip(PAGE_LABELS[page])}
                  className={sideItem(active)}
                >
                  <Icon size={19} strokeWidth={active ? 2.1 : 1.75} aria-hidden="true" className="shrink-0" />
                  {!collapsed && <span className="truncate">{PAGE_LABELS[page]}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-0.5 border-t border-[var(--border)] pt-3">
        {collapsed ? (
          <span className="flex min-h-9 items-center px-[0.9rem]" title={live ? 'Live via Upstox' : 'Upstox not connected'}>
            <Dot color={live ? 'var(--good)' : 'var(--warning)'} />
          </span>
        ) : (
          <div className="px-2.5 py-1.5">
            <BrokerBadge status={broker} />
          </div>
        )}
        <button type="button" onClick={toggle} title={tip(theme === 'light' ? 'Dark theme' : 'Light theme')} className={sideItem(false)}>
          {theme === 'light' ? <Moon size={19} aria-hidden="true" className="shrink-0" /> : <Sun size={19} aria-hidden="true" className="shrink-0" />}
          {!collapsed && (theme === 'light' ? 'Dark theme' : 'Light theme')}
        </button>
        <div className={`${sideItem(false)} pointer-events-none`} title={tip(userName ?? 'ADD DOTS')}>
          <span className="flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[9px] font-bold text-[var(--accent-text)]">
            {initials(userName)}
          </span>
          {!collapsed && <span className="truncate">{userName ?? 'ADD DOTS'}</span>}
        </div>
        {showLogout && (
          <button type="button" onClick={onLogout} title={tip('Sign out')} className={`${sideItem(false)} !text-[var(--critical)]`}>
            <LogOut size={19} aria-hidden="true" className="shrink-0" />
            {!collapsed && 'Sign out'}
          </button>
        )}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={tip('Expand sidebar')}
          className={sideItem(false)}
        >
          {collapsed ? <PanelLeftOpen size={19} aria-hidden="true" className="shrink-0" /> : <PanelLeftClose size={19} aria-hidden="true" className="shrink-0" />}
          {!collapsed && 'Collapse'}
        </button>
      </div>
    </aside>
  );
}

export function AppHeader({
  route,
  onNavigate,
  broker,
  onLogout,
  showLogout,
}: {
  route: Route;
  onNavigate: (r: Route) => void;
  broker: AuthStatus | null;
  onLogout: () => void;
  showLogout: boolean;
}) {
  const { theme, toggle } = useTheme();
  const go = (page: PageId) => onNavigate({ page });
  const userName = broker?.token?.user_name ?? null;

  return (
    <>
    <Sidebar route={route} onNavigate={go} broker={broker} onLogout={onLogout} showLogout={showLogout} />
    {/* Phones keep a slim top bar (page title and account); on desktop the sidebar holds all of it. */}
    <header className="safe-top sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface-raised)] md:hidden">
      <div className="safe-x flex h-[var(--header-h)] w-full items-center gap-x-4">
        <div className="flex h-full min-w-0 items-center gap-2.5">
          <a className="ob-logo" href="https://www.adddots.com/" aria-label="ADD DOTS home">
            <Logo size={28} />
          </a>
          <button type="button" onClick={() => go('builder')} className="ob-title hidden !text-base sm:block">
            AddStock
          </button>
          <span className="hidden text-xl font-light text-[var(--text-muted)] sm:inline" aria-hidden="true">
            /
          </span>
          <span className="truncate text-sm font-semibold text-[var(--text-primary)]">{PAGE_LABELS[route.page]}</span>
        </div>

        <div className="ml-auto flex h-full shrink-0 items-center gap-3">
          <Menu
            label="Account menu"
            align="right"
            trigger={(open) => (
              <span className="flex min-h-11 items-center gap-1 text-[var(--text-secondary)]">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-bold text-[var(--accent-text)]">
                  {initials(userName)}
                </span>
                <Chevron open={open} />
              </span>
            )}
          >
            {(close) => (
              <div className="flex flex-col">
                <div className="border-b border-[var(--border)] px-3 py-2">
                  <div className="text-sm font-semibold">{userName ?? 'ADD DOTS'}</div>
                  <div className="mt-1">
                    <BrokerBadge status={broker} />
                  </div>
                </div>
                <button type="button" role="menuitem" onClick={toggle} className={accountItem}>
                  {theme === 'light' ? <Moon size={18} aria-hidden="true" /> : <Sun size={18} aria-hidden="true" />}
                  {theme === 'light' ? 'Dark theme' : 'Light theme'}
                </button>
                {showLogout && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close();
                      onLogout();
                    }}
                    className={`${accountItem} text-[var(--critical)]`}
                  >
                    <LogOut size={18} aria-hidden="true" />
                    Sign out
                  </button>
                )}
              </div>
            )}
          </Menu>
        </div>
      </div>
    </header>
    <MobileTabBar route={route} onNavigate={go} />
    </>
  );
}

const accountItem = 'flex min-h-11 items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm hover:bg-[var(--surface-sunken)]';
