import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ExternalLink, Grip, ListChecks, LogOut, Moon, Star, Sun } from 'lucide-react';
import { UPSTOX_LOGIN_URL } from '../api/client';
import type { AuthStatus } from '../api/types';
import { useTheme } from '../hooks/useTheme';
import { MOBILE_TABS, NAV, PAGE_ICONS, PAGE_LABELS, SIDEBAR, type NavItem, type PageId, type Route } from './tabs';
import { Logo } from './Logo';
import { Dot } from './ui';
import { useRail } from '../store/rail';

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

const railButton = (active: boolean) =>
  `flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors ${
    active
      ? 'bg-[color-mix(in_srgb,var(--series-blue)_14%,transparent)] text-[var(--series-blue)]'
      : 'text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]'
  }`;

const menuRow = 'flex min-h-9 w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-[var(--surface-sunken)]';

/**
 * Desktop navigation, TradingView style: a slim rail on the right edge so pages use the full width.
 * Pinned pages sit on the rail; the grid button opens every page (star one to pin it) and the account controls.
 */
function RightRail({
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
  const { pins, togglePin, watchlistOpen, toggleWatchlist } = useRail();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLButtonElement>(null);
  const userName = broker?.token?.user_name ?? null;
  // Pins in the menu's order, wherever they were starred from.
  const pinned = SIDEBAR.flatMap((g) => g.pages).filter((p) => pins.includes(p));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !grid.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const go = (page: PageId) => {
    setOpen(false);
    onNavigate(page);
  };

  return (
    <>
      <aside
        aria-label="Main"
        className="fixed inset-y-0 right-0 z-30 hidden flex-col items-center gap-1.5 border-l border-[var(--border)] bg-[var(--surface-raised)] py-2.5 md:flex"
        style={{ width: 'var(--rail-w)' }}
      >
        <a className="ob-logo mb-1" href="https://www.adddots.com/" aria-label="ADD DOTS home">
          <Logo size={26} />
        </a>
        {route.page === 'chart' && (
          <button
            type="button"
            onClick={toggleWatchlist}
            aria-pressed={watchlistOpen}
            aria-label={watchlistOpen ? 'Hide watchlist' : 'Show watchlist'}
            title={watchlistOpen ? 'Hide watchlist' : 'Show watchlist'}
            className={railButton(watchlistOpen)}
          >
            <ListChecks size={19} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
        <div className="my-1 w-6 border-t border-[var(--border)]" aria-hidden="true" />
        <nav aria-label="Pinned pages" className="flex flex-col items-center gap-1.5">
          {pinned.map((page) => {
            const Icon = PAGE_ICONS[page];
            const active = route.page === page;
            return (
              <button
                key={page}
                type="button"
                onClick={() => go(page)}
                aria-current={active ? 'page' : undefined}
                aria-label={PAGE_LABELS[page]}
                title={PAGE_LABELS[page]}
                className={railButton(active)}
              >
                <Icon size={19} strokeWidth={active ? 2.1 : 1.75} aria-hidden="true" />
              </button>
            );
          })}
        </nav>
        <span className="flex-1" />
        <span title={broker?.authenticated || broker?.marketData ? 'Live via Upstox' : 'Upstox not connected'} className="mb-1">
          <Dot color={broker?.authenticated || broker?.marketData ? 'var(--good)' : 'var(--warning)'} />
        </span>
        <button
          ref={grid}
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="All pages and account"
          title="All pages"
          className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
            open ? 'bg-[var(--text-primary)] text-[var(--surface-raised)]' : 'bg-[var(--surface-sunken)] text-[var(--text-primary)] hover:opacity-85'
          }`}
        >
          <Grip size={20} strokeWidth={2} aria-hidden="true" />
        </button>
      </aside>

      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="All pages"
          className="fixed bottom-2 z-50 hidden max-h-[calc(100dvh-1rem)] w-64 overflow-y-auto rounded-xl border border-[var(--border-strong)] bg-[var(--surface-raised)] p-1.5 shadow-2xl md:block"
          style={{ right: 'calc(var(--rail-w) + 0.5rem)' }}
        >
          {SIDEBAR.map((group) => (
            <div key={group.label}>
              <div className="px-2.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{group.label}</div>
              {group.pages.map((page) => {
                const Icon = PAGE_ICONS[page];
                const active = route.page === page;
                const isPinned = pins.includes(page);
                return (
                  <div key={page} className="group flex items-center">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => go(page)}
                      aria-current={active ? 'page' : undefined}
                      className={`${menuRow} ${active ? 'font-medium text-[var(--series-blue)]' : ''}`}
                    >
                      <Icon size={19} strokeWidth={1.75} aria-hidden="true" className={`shrink-0 ${active ? '' : 'text-[var(--text-secondary)]'}`} />
                      {PAGE_LABELS[page]}
                    </button>
                    <button
                      type="button"
                      onClick={() => togglePin(page)}
                      aria-pressed={isPinned}
                      aria-label={isPinned ? `Unpin ${PAGE_LABELS[page]} from the rail` : `Pin ${PAGE_LABELS[page]} to the rail`}
                      title={isPinned ? 'Unpin from the rail' : 'Pin to the rail'}
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-[var(--surface-sunken)] ${
                        isPinned ? 'text-[var(--warning)]' : 'text-[var(--text-muted)] opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                      }`}
                    >
                      <Star size={16} fill={isPinned ? 'currentColor' : 'none'} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
          <div className="my-1.5 border-t border-[var(--border)]" />
          <div className="flex items-center gap-3 px-2.5 py-1.5">
            <span className="flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[9px] font-bold text-[var(--accent-text)]">
              {initials(userName)}
            </span>
            <span className="min-w-0 truncate text-sm font-medium">{userName ?? 'ADD DOTS'}</span>
          </div>
          <div className="px-2.5 pb-1.5">
            <BrokerBadge status={broker} />
          </div>
          <button type="button" role="menuitem" onClick={toggle} className={menuRow}>
            {theme === 'light' ? <Moon size={19} aria-hidden="true" className="shrink-0" /> : <Sun size={19} aria-hidden="true" className="shrink-0" />}
            {theme === 'light' ? 'Dark theme' : 'Light theme'}
          </button>
          {showLogout && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
              className={`${menuRow} text-[var(--critical)]`}
            >
              <LogOut size={19} aria-hidden="true" className="shrink-0" />
              Sign out
            </button>
          )}
        </div>
      )}
    </>
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
    <RightRail route={route} onNavigate={go} broker={broker} onLogout={onLogout} showLogout={showLogout} />
    {/* Phones keep a slim top bar (page title and account); on desktop the right rail holds all of it. */}
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
