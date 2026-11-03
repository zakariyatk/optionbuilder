import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Lock } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import { authRedirectUrl, clearAuthRedirect, isAuthRedirect, isDesktopApp, supabaseAuth } from '../api/supabase';
import type { SupabaseConfig } from '../api/types';
import { Logo } from './Logo';

const FIELD =
  'h-[42px] w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface-page)] pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_30%,transparent)]';
const PRIMARY =
  'mt-3 flex h-[42px] w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] text-sm font-medium text-[var(--accent-text)] hover:opacity-90 disabled:opacity-50';
const LINK = 'inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:hover:text-[var(--text-muted)]';

/** Faint candles behind the card, in the theme's blue and its ink colour. Fixed, so the page doesn't shift between renders. */
const CANDLES = Array.from({ length: 42 }, (_, i) => {
  const h = 20 + Math.abs(Math.sin(i * 0.7)) * 50;
  return { x: 10 + i * 16, h, y: 150 - Math.sin(i * 0.25) * 60 - h / 2, up: Math.sin(i * 1.3) > -0.2 };
});

function Backdrop() {
  return (
    <svg viewBox="0 0 680 300" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      {CANDLES.map((c, i) => {
        const color = c.up ? 'var(--series-blue)' : 'var(--text-primary)';
        return (
          <g key={i}>
            <line x1={c.x + 4} x2={c.x + 4} y1={c.y - 10} y2={c.y + c.h + 10} stroke={color} opacity={c.up ? 0.4 : 0.22} />
            <rect x={c.x} y={c.y} width={8} height={c.h} rx={1} fill={color} opacity={c.up ? 0.3 : 0.14} />
          </g>
        );
      })}
    </svg>
  );
}

/** The page around the sign-in card: candle backdrop, the logo top-left, the disclaimer at the foot. */
function Shell({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <main className="relative flex min-h-[calc(100dvh-64px)] items-center justify-center overflow-hidden bg-[var(--surface-page)] px-4 py-16">
      <Backdrop />
      <div className="absolute top-4 left-4 flex items-center gap-2">
        <Logo size={28} />
        <span className="text-[13px] font-semibold tracking-[0.06em]">ADDSTOCK</span>
      </div>
      <span className="absolute top-4 right-4 text-xs text-[var(--text-muted)]">ADD DOTS</span>
      <div className="relative w-full max-w-[22rem] rounded-2xl border border-[var(--border-strong)] bg-[color-mix(in_srgb,var(--surface-card)_86%,transparent)] p-6 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Logo size={44} />
          <div>
            <h1 className="text-[17px] font-semibold leading-tight">Sign in</h1>
            <p className="text-xs text-[var(--text-muted)]">{subtitle}</p>
          </div>
        </div>
        {children}
      </div>
      <p className="absolute right-0 bottom-3 left-0 text-center text-[11px] text-[var(--text-muted)]">An analysis tool, not investment advice.</p>
    </main>
  );
}

/** Google's four-colour "G", on a white disc so it reads on the accent button. */
function GoogleMark() {
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white" aria-hidden="true">
      <svg viewBox="0 0 48 48" width="14" height="14">
        <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.8 6C12.4 13.6 17.7 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 2.9-2.2 5.4-4.7 7.1l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17.5z" />
        <path fill="#FBBC05" d="M10.5 28.8c-.5-1.5-.8-3.1-.8-4.8s.3-3.3.8-4.8l-7.8-6C1 16.5 0 20.1 0 24s1 7.5 2.7 10.8l7.8-6z" />
        <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.7l-7.8 6C6.6 42.6 14.6 48 24 48z" />
      </svg>
    </span>
  );
}

export function LoginGate({
  supabase,
  passwordLogin = true,
  onSuccess,
  onBack,
}: {
  supabase?: SupabaseConfig | null;
  passwordLogin?: boolean;
  onSuccess: () => void;
  onBack?: () => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Windows app: Google sign-in was handed to the system browser and hasn't come back yet. */
  const [waitingForBrowser, setWaitingForBrowser] = useState(false);

  /** Hand the Supabase token to the backend, which opens the app session; then drop Supabase's own. */
  const finish = useCallback(
    async (accessToken: string) => {
      if (!supabase) return;
      try {
        await api.loginSupabase(accessToken);
        onSuccess();
      } finally {
        const sb = await supabaseAuth(supabase);
        await sb.auth.signOut({ scope: 'local' }).catch(() => undefined);
      }
    },
    [supabase, onSuccess],
  );

  // Return leg of Google sign-in: supabase-js exchanges the ?code= on load.
  useEffect(() => {
    if (!supabase || !isAuthRedirect()) return;
    let cancelled = false;
    const params = new URLSearchParams(window.location.search + '&' + window.location.hash.slice(1));
    const failed = params.get('error_description');
    setBusy(true);
    (async () => {
      try {
        if (failed) throw new Error(failed);
        const sb = await supabaseAuth(supabase);
        const { data, error: err } = await sb.auth.getSession();
        if (err) throw err;
        if (!data.session) throw new Error('Google sign-in did not finish. Try again.');
        await finish(data.session.access_token);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err) || 'Sign-in failed');
      } finally {
        clearAuthRedirect();
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, finish]);

  const run = async (fn: () => Promise<void>, fallback: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err) || fallback);
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    if (!password) return;
    void run(async () => {
      try {
        await api.login(password);
        onSuccess();
      } finally {
        setPassword('');
      }
    }, 'Login failed');
  };

  /**
   * On the web the page goes to Google and comes back to the app's root. In the Windows app the shell sends
   * Supabase's authorize page to the system browser, since Google refuses embedded webviews.
   */
  const signInWithGoogle = () =>
    run(async () => {
      if (!supabase) return;
      const sb = await supabaseAuth(supabase);
      const { data, error: err } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: authRedirectUrl(), skipBrowserRedirect: true },
      });
      if (err) throw err;
      if (isDesktopApp()) setWaitingForBrowser(true);
      window.location.assign(data.url);
    }, 'Could not start Google sign-in');

  const errorBox = error && (
    <p id="login-error" role="alert" className="mt-2 text-left text-xs text-[var(--critical)]">
      {error}
    </p>
  );
  const back = onBack && (
    <button type="button" onClick={onBack} className={`${LINK} mt-4`}>
      <ArrowLeft size={13} aria-hidden="true" /> Back
    </button>
  );

  if (supabase && !passwordLogin) {
    return (
      <Shell subtitle="to your AddStock workspace">
        {errorBox}
        <button type="button" onClick={() => void signInWithGoogle()} disabled={busy} className={`${PRIMARY} mt-5`}>
          <GoogleMark />
          {busy ? 'Signing in…' : waitingForBrowser ? 'Open Google again' : 'Continue with Google'}
        </button>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <Lock size={13} aria-hidden="true" />
          {waitingForBrowser ? 'Finish signing in in your browser, then come back here' : 'Only approved Google accounts can sign in'}
        </p>
        {back}
      </Shell>
    );
  }

  return (
    <Shell subtitle="Enter your password">
      <form onSubmit={submitPassword} className="mt-5">
        <label htmlFor="login-password" className="mb-1.5 block text-xs text-[var(--text-secondary)]">
          Password
        </label>
        <div className="relative">
          <Lock size={16} className="pointer-events-none absolute top-[13px] left-3 text-[var(--text-muted)]" aria-hidden="true" />
          <input
            id="login-password"
            type="password"
            value={password}
            autoFocus
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'login-error' : undefined}
            className={FIELD}
          />
        </div>
        {errorBox}
        <button type="submit" disabled={busy || password === ''} className={PRIMARY}>
          {busy ? 'Checking…' : 'Open'}
          {!busy && <ArrowRight size={16} aria-hidden="true" />}
        </button>
      </form>
      {back}
    </Shell>
  );
}
