import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api/client';
import { authRedirectUrl, clearAuthRedirect, isAuthRedirect, supabaseAuth } from '../api/supabase';
import type { SupabaseConfig } from '../api/types';

const FIELD =
  'mt-1 w-full border border-[var(--border)] bg-transparent px-3 py-2.5 text-sm normal-case tracking-normal text-[var(--text-primary)]';
const LABEL = 'block text-left text-[9px] uppercase tracking-[0.14em] text-[var(--text-secondary)]';
const PRIMARY =
  'mt-4 min-h-11 w-full bg-[var(--accent)] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--accent-text)] hover:opacity-90 disabled:opacity-50';
const SECONDARY =
  'mt-3 min-h-11 w-full text-[11px] uppercase tracking-[0.14em] text-[var(--text-secondary)] hover:text-[var(--text-primary)]';

type Step = 'email' | 'code';

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
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<Step>('email');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  // Return leg of a magic link or Google: supabase-js exchanges the ?code= on load.
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
        if (!data.session) throw new Error('The sign-in link has expired. Request a new one.');
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

  const sendCode = (e: FormEvent) => {
    e.preventDefault();
    if (!supabase || !email.trim()) return;
    void run(async () => {
      const sb = await supabaseAuth(supabase);
      const { error: err } = await sb.auth.signInWithOtp({
        email: email.trim(),
        // The Supabase project serves other apps too: never create accounts from here.
        options: { shouldCreateUser: false, emailRedirectTo: authRedirectUrl() },
      });
      if (err) throw err;
      setStep('code');
    }, 'Could not send the code');
  };

  const verifyCode = (e: FormEvent) => {
    e.preventDefault();
    if (!supabase || !code.trim()) return;
    void run(async () => {
      const sb = await supabaseAuth(supabase);
      const { data, error: err } = await sb.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
      if (err) throw err;
      if (!data.session) throw new Error('Code not accepted. Request a new one.');
      await finish(data.session.access_token);
    }, 'Code not accepted');
  };

  const signInWithGoogle = () => {
    if (!supabase) return;
    void run(async () => {
      const sb = await supabaseAuth(supabase);
      const { error: err } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: authRedirectUrl() } });
      if (err) throw err;
      // The browser now leaves for Google; keep the button disabled until it does.
      await new Promise(() => undefined);
    }, 'Google sign-in failed');
  };

  const errorBox = error && (
    <div id="login-error" role="alert" className="mt-2 text-left text-[11px] text-[var(--critical)]">
      {error}
    </div>
  );

  const card = 'w-full max-w-[22rem] border border-[var(--border)] bg-[var(--surface-card)] px-[30px] pt-[34px] pb-[30px] text-center';
  const header = (subtitle: string) => (
    <>
      <div className="ad-mark" aria-hidden="true">
        AD
      </div>
      <h1 className="ob-title text-[1.6rem]">Option Builder</h1>
      <p className="ob-sub mt-2 mb-[26px]">ADD DOTS · {subtitle}</p>
    </>
  );
  const back = onBack && (
    <button type="button" onClick={onBack} className={SECONDARY}>
      ← Back
    </button>
  );

  if (supabase && !passwordLogin) {
    return (
      <main className="flex min-h-[calc(100vh-64px)] items-center justify-center px-4">
        <div className={card}>
          {header(step === 'email' ? 'Sign in to continue' : 'Check your email')}

          {supabase.google && step === 'email' && (
            <>
              <button
                type="button"
                onClick={signInWithGoogle}
                disabled={busy}
                className="flex min-h-11 w-full items-center justify-center gap-2 border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--surface-hover,transparent)] disabled:opacity-50"
              >
                <GoogleMark />
                Continue with Google
              </button>
              <div className="my-4 text-[9px] uppercase tracking-[0.14em] text-[var(--text-muted)]">or</div>
            </>
          )}

          {step === 'email' ? (
            <form onSubmit={sendCode}>
              <label className={LABEL}>
                Email
                <input
                  type="email"
                  value={email}
                  autoFocus
                  autoComplete="email"
                  inputMode="email"
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'login-error' : undefined}
                  className={FIELD}
                />
              </label>
              {errorBox}
              <button type="submit" disabled={busy || email.trim() === ''} className={PRIMARY}>
                {busy ? 'Please wait…' : 'Email me a code'}
              </button>
            </form>
          ) : (
            <form onSubmit={verifyCode}>
              <p className="mb-4 text-left text-xs text-[var(--text-secondary)]">
                We sent a sign-in email to <strong className="text-[var(--text-primary)]">{email.trim()}</strong>. Enter
                the code from it, or just tap the link in the email.
              </p>
              <label className={LABEL}>
                Code
                <input
                  type="text"
                  value={code}
                  autoFocus
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={10}
                  onChange={(e) => setCode(e.target.value.replace(/\s/g, ''))}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'login-error' : undefined}
                  className={`${FIELD} tracking-[0.3em]`}
                />
              </label>
              {errorBox}
              <button type="submit" disabled={busy || code.trim() === ''} className={PRIMARY}>
                {busy ? 'Checking…' : 'Open'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep('email');
                  setCode('');
                  setError(null);
                }}
                className={SECONDARY}
              >
                Use a different email
              </button>
            </form>
          )}
          {back}
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-[calc(100vh-64px)] items-center justify-center px-4">
      <form onSubmit={submitPassword} className={card}>
        {header('Enter your password')}
        <label className={LABEL}>
          Password
          <input
            type="password"
            value={password}
            autoFocus
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'login-error' : undefined}
            className={FIELD}
          />
        </label>
        {errorBox}
        <button type="submit" disabled={busy || password === ''} className={PRIMARY}>
          {busy ? 'Checking…' : 'Open'}
        </button>
        {back}
      </form>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
