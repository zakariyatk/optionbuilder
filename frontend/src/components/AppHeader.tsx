import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ExternalLink, LogOut, Moon, Sun } from 'lucide-react';
import { UPSTOX_LOGIN_URL } from '../api/client';
import type { AuthStatus } from '../api/types';
import { useTheme } from '../hooks/useTheme';
import { MOBILE_TABS, NAV, PAGE_ICONS, PAGE_LABELS, type NavItem, type PageId, type Route } from './tabs';
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

const navItemClass = (active: boolean) =>
  `relative flex h-full items-center gap-1 px-3 text-sm font-medium transition-colors ${
    active
      ? 'text-[var(--text-primary)] after:absolute after:inset-x-2 after:bottom-0 after:h-[3px] after:rounded-t after:bg-[var(--accent)]'
      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
  }`;

function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'AD';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
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
    <header className="safe-top sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface-raised)]">
      <div className="safe-x flex h-14 w-full items-center gap-x-4">
        <div className="flex h-14 min-w-0 items-center gap-2.5">
          <a className="ob-logo" href="https://www.adddots.com/" aria-label="ADD DOTS home">
            <Logo size={36} />
          </a>
          <button type="button" onClick={() => go('builder')} className="ob-title hidden !text-base sm:block">
            Option Builder
          </button>
          <span className="hidden text-xl font-light text-[var(--text-muted)] sm:inline" aria-hidden="true">
            /
          </span>
          <span className="truncate text-sm font-semibold text-[var(--text-primary)]">{PAGE_LABELS[route.page]}</span>
        </div>

        <nav aria-label="Main" className="hidden h-full flex-1 items-stretch justify-center gap-1 md:flex">
          {NAV.map((entry) =>
            'page' in entry ? (
              <button
                key={entry.label}
                type="button"
                onClick={() => go(entry.page)}
                aria-current={route.page === entry.page ? 'page' : undefined}
                className={navItemClass(route.page === entry.page)}
              >
                {entry.label}
              </button>
            ) : (
              <Menu
                key={entry.label}
                label={`${entry.label} menu`}
                trigger={(open) => (
                  <span className={navItemClass(entry.items.some((i) => i.page === route.page))}>
                    {entry.label} <Chevron open={open} />
                  </span>
                )}
              >
                {(close) =>
                  entry.items.map((item) => (
                    <PageItem
                      key={item.page}
                      item={item}
                      active={route.page === item.page}
                      onClick={() => {
                        go(item.page);
                        close();
                      }}
                    />
                  ))
                }
              </Menu>
            ),
          )}
        </nav>

        <div className="ml-auto flex h-14 shrink-0 items-center gap-3 md:ml-0">
          <span className="hidden lg:block">
            <BrokerBadge status={broker} />
          </span>
          <Menu
            label="Account menu"
            align="right"
            trigger={(open) => (
              <span className="flex min-h-11 items-center gap-1 text-[var(--text-secondary)]">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-bold text-[var(--accent-text)]">
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
