import { useEffect, useRef, useState, type ReactNode } from 'react';
import { UPSTOX_LOGIN_URL } from '../api/client';
import type { AuthStatus } from '../api/types';
import { useTheme } from '../hooks/useTheme';
import { NAV, PAGE_LABELS, type PageId, type Route } from './tabs';
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
  if (status?.configured) {
    return (
      <a
        href={UPSTOX_LOGIN_URL}
        target="_blank"
        rel="noreferrer"
        className="rounded-md px-2.5 py-1 text-xs font-medium hover:opacity-85"
        style={{ background: 'var(--good-fill)', color: 'var(--good-text)' }}
      >
        Connect Upstox for live data →
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
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={`transition-transform ${open ? 'rotate-180' : ''}`}>
    <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const navItemClass = (active: boolean) =>
  `relative flex h-full items-center gap-1 px-3 text-sm font-medium transition-colors ${
    active
      ? 'text-[var(--series-blue)] after:absolute after:inset-x-2 after:bottom-0 after:h-[3px] after:rounded-t after:bg-[var(--series-blue)]'
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
    <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface-raised)]">
      <div className="flex w-full flex-wrap items-center gap-x-4 px-4 md:h-14 md:flex-nowrap lg:px-6">
        <div className="flex h-14 min-w-0 items-center gap-2.5">
          <a className="ob-logo" href="https://www.adddots.com/" aria-label="ADD DOTS home">
            AD
          </a>
          <button type="button" onClick={() => go('builder')} className="ob-title hidden !text-base sm:block">
            Option Builder
          </button>
          <span className="hidden text-xl font-light text-[var(--text-muted)] sm:inline" aria-hidden="true">
            /
          </span>
          <span className="truncate text-sm font-semibold text-[var(--text-primary)]">{PAGE_LABELS[route.page]}</span>
        </div>

        <nav
          aria-label="Main"
          className="order-last -mx-4 flex h-11 w-[calc(100%+2rem)] items-stretch justify-center gap-1 border-t border-[var(--border)] md:order-none md:mx-0 md:h-full md:w-auto md:flex-1 md:border-t-0"
        >
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
                    <button
                      key={item.page}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        go(item.page);
                        close();
                      }}
                      className="block w-full rounded-md px-3 py-2 text-left hover:bg-[var(--surface-sunken)]"
                    >
                      <div className={`text-sm font-medium ${route.page === item.page ? 'text-[var(--series-blue)]' : ''}`}>{PAGE_LABELS[item.page]}</div>
                      <div className="text-xs text-[var(--text-muted)]">{item.description}</div>
                    </button>
                  ))
                }
              </Menu>
            ),
          )}
        </nav>

        <div className="ml-auto flex h-14 items-center gap-3 md:ml-0">
          <span className="hidden lg:block">
            <BrokerBadge status={broker} />
          </span>
          <Menu
            label="Account menu"
            align="right"
            trigger={(open) => (
              <span className="flex items-center gap-1 text-[var(--text-secondary)]">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--series-blue)] text-xs font-bold text-white">
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
                <button type="button" role="menuitem" onClick={toggle} className="rounded-md px-3 py-2 text-left text-sm hover:bg-[var(--surface-sunken)]">
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
                    className="rounded-md px-3 py-2 text-left text-sm text-[var(--critical)] hover:bg-[var(--surface-sunken)]"
                  >
                    Sign out
                  </button>
                )}
              </div>
            )}
          </Menu>
        </div>
      </div>
    </header>
  );
}
