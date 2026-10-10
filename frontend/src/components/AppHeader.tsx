import { UPSTOX_LOGIN_URL } from '../api/client';
import type { AuthStatus } from '../api/types';
import { useTheme } from '../hooks/useTheme';
import { TABS, type TabId } from './tabs';
import { Button, Dot } from './ui';

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
        Live via Upstox{status.token?.user_name ? ` · ${status.token.user_name}` : ''}
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

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const light = theme === 'light';
  const label = light ? 'Switch to dark theme' : 'Switch to light theme';
  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
    >
      {light ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="2" />
          <path
            d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}

export function AppHeader({
  tab,
  onTab,
  broker,
  onLogout,
  showLogout,
}: {
  tab: TabId;
  onTab: (t: TabId) => void;
  broker: AuthStatus | null;
  onLogout: () => void;
  showLogout: boolean;
}) {
  return (
    <header>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="leading-tight">
          <h1 className="ob-title">Option Builder</h1>
          <div className="ob-sub">ADD DOTS · Options strategy workspace</div>
        </div>
        <div className="flex items-center gap-3">
          <BrokerBadge status={broker} />
          <ThemeToggle />
          {showLogout && (
            <Button variant="ghost" size="xs" onClick={onLogout} title="Sign out of Option Builder">
              Sign out
            </Button>
          )}
        </div>
      </div>

      <nav className="-mx-4 mb-4 overflow-x-auto px-4" aria-label="Sections">
        <div className="flex min-w-max gap-1 border-b border-[var(--border)]" role="tablist">
          {TABS.map(({ id, label }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={`tab-${id}`}
                aria-selected={active}
                aria-controls={`panel-${id}`}
                onClick={() => onTab(id)}
                className="-mb-px border-b-2 px-3 py-2 text-sm transition-colors"
                style={{
                  borderColor: active ? 'var(--text-primary)' : 'transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
