import { ArrowRight, House, Lock } from 'lucide-react';
import { Logo } from '../../components/Logo';
import { PAGE_ICONS, PAGE_LABELS, type PageId } from '../../components/tabs';
import { nseOpen } from '../../lib/nse';

/** The pages the sidebar lists, in the order the app's own menu does. */
const SIDEBAR: PageId[] = ['builder', 'chart', 'portfolio', 'drafts', 'report'];

const SHORTCUTS: { page: PageId; title: string; text: string }[] = [
  { page: 'builder', title: 'New strategy', text: 'Build from the live chain or 9 templates' },
  { page: 'chart', title: 'Open chart', text: 'NIFTY, NSE stocks and US stocks' },
  { page: 'report', title: "Today's report", text: 'Max-OI levels, PCR, FII / DII flows' },
  { page: 'portfolio', title: 'Portfolio', text: 'Holdings, P&L and benchmarks' },
];

/** Hour of the day in India, where the market and most users are. */
function istHour(now = new Date()): number {
  return new Date(now.getTime() + 330 * 60_000).getUTCHours();
}

function greeting(): string {
  const h = istHour();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/**
 * The Windows app's start screen before sign-in: the app's sections down the side, a sign-in banner and
 * shortcuts. Every entry signs in first and then opens the page it names.
 */
export function DesktopHome({ onSignIn }: { onSignIn: (page?: PageId) => void }) {
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  const open = nseOpen();
  return (
    <div className="grid min-h-[100dvh] grid-cols-[200px_minmax(0,1fr)] bg-[var(--surface-page)]">
      <nav aria-label="Sections" className="flex flex-col border-r border-[var(--border)] px-3 py-4">
        <div className="mb-6 flex items-center gap-2 px-2">
          <Logo size={28} />
          <span className="text-[13px] font-semibold tracking-[0.06em]">ADDSTOCK</span>
        </div>
        <span className="mb-1 flex items-center gap-2 rounded-md bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] px-2.5 py-2 text-sm text-[var(--accent)]">
          <House size={16} aria-hidden="true" /> Home
        </span>
        {SIDEBAR.map((page) => {
          const Icon = PAGE_ICONS[page];
          return (
            <button
              key={page}
              type="button"
              onClick={() => onSignIn(page)}
              className="flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-card)] hover:text-[var(--text-primary)]"
            >
              <Icon size={16} aria-hidden="true" /> {PAGE_LABELS[page]}
            </button>
          );
        })}
        <span className="mt-auto px-2 text-[11px] text-[var(--text-muted)]">ADD DOTS</span>
      </nav>

      <main className="mx-auto w-full max-w-3xl px-8 py-10">
        <h1 className="text-2xl font-semibold">{greeting()}</h1>
        <p className="mt-1 flex items-center gap-2 text-sm text-[var(--text-muted)]">
          {today}
          <span aria-hidden="true">·</span>
          <span className={`inline-block h-2 w-2 rounded-full ${open ? 'bg-[var(--good-text)]' : 'bg-[var(--text-muted)]'}`} aria-hidden="true" />
          NSE {open ? 'open' : 'closed'}
        </p>

        <div className="mt-6 flex items-center gap-4 rounded-xl border border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] p-4">
          <Lock size={20} className="shrink-0 text-[var(--accent)]" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Sign in to load your workspace</div>
            <div className="text-xs text-[var(--text-muted)]">Saved strategies, watchlists and your portfolio</div>
          </div>
          <button
            type="button"
            onClick={() => onSignIn()}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-text)] hover:opacity-90"
          >
            Sign in <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          {SHORTCUTS.map((s) => {
            const Icon = PAGE_ICONS[s.page];
            return (
              <button
                key={s.page}
                type="button"
                onClick={() => onSignIn(s.page)}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4 text-left hover:border-[var(--border-strong)]"
              >
                <Icon size={18} className="text-[var(--accent)]" aria-hidden="true" />
                <div className="mt-2 text-sm font-medium">{s.title}</div>
                <div className="text-xs text-[var(--text-muted)]">{s.text}</div>
              </button>
            );
          })}
        </div>

        <p className="mt-10 text-[11px] text-[var(--text-muted)]">AddStock is an analysis tool, not investment advice.</p>
      </main>
    </div>
  );
}
