import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, Lock, Mail } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import { authRedirectUrl, clearAuthRedirect, isAuthRedirect, supabaseAuth } from '../api/supabase';
import type { SupabaseConfig } from '../api/types';
import { Logo } from './Logo';

const CODE_LENGTH = 6;
/** Supabase refuses a new code for about a minute after the last one. */
const RESEND_AFTER_S = 60;

const FIELD =
  'h-[42px] w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface-page)] pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_30%,transparent)]';
const PRIMARY =
  'mt-3 flex h-[42px] w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] text-sm font-medium text-[var(--accent-text)] hover:opacity-90 disabled:opacity-50';
const LINK = 'inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:hover:text-[var(--text-muted)]';

type Step = 'email' | 'code';

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

/** "1 · Enter email  2 · Enter code", with the done step ticked. */
function Steps({ step }: { step: Step }) {
  const items: { key: Step; label: string }[] = [
    { key: 'email', label: 'Enter email' },
    { key: 'code', label: 'Enter code' },
  ];
  const current = items.findIndex((s) => s.key === step);
  return (
    <ol className="mt-[18px] mb-4 flex gap-2 text-xs">
      {items.map((s, i) => (
        <li
          key={s.key}
          aria-current={i === current ? 'step' : undefined}
          className={`flex flex-1 items-center gap-1 rounded-md px-2 py-1.5 ${
            i === current
              ? 'bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[var(--accent)]'
              : i < current
                ? 'border border-[var(--border-strong)] text-[var(--good-text)]'
                : 'border border-[var(--border-strong)] text-[var(--text-muted)]'
          }`}
        >
          {i < current ? <Check size={13} aria-hidden="true" /> : `${i + 1} ·`} {s.label}
        </li>
      ))}
    </ol>
  );
}

/** Six boxes over one real input, so typing, pasting and the phone's "from Messages" autofill all just work. */
function CodeBoxes({ value, onChange, invalid }: { value: string; onChange: (v: string) => void; invalid: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(true);
  return (
    <div className="relative" onClick={() => ref.current?.focus()}>
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoFocus
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label={`${CODE_LENGTH}-digit code`}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? 'login-error' : undefined}
        className="absolute inset-0 h-full w-full cursor-text opacity-0"
      />
      <div className="flex justify-between gap-2" aria-hidden="true">
        {Array.from({ length: CODE_LENGTH }, (_, i) => {
          const active = focused && (i === value.length || (i === CODE_LENGTH - 1 && value.length === CODE_LENGTH));
          return (
            <span
              key={i}
              className={`flex h-[46px] w-[40px] items-center justify-center rounded-lg border bg-[var(--surface-page)] text-xl font-semibold tabular ${
                active
                  ? 'border-[var(--accent)] ring-2 ring-[color-mix(in_srgb,var(--accent)_30%,transparent)]'
                  : invalid
                    ? 'border-[var(--critical)]'
                    : 'border-[var(--border-strong)]'
              }`}
            >
              {value[i] ?? ''}
            </span>
          );
        })}
      </div>
    </div>
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
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<Step>('email');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Seconds until another code may be sent. */
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

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

  // Return leg of a sign-in link (still sent alongside the code): supabase-js exchanges the ?code= on load.
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
        if (!data.session) throw new Error('The sign-in link has expired. Request a new code.');
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

  const sendCode = () =>
    run(async () => {
      if (!supabase) return;
      const sb = await supabaseAuth(supabase);
      const { error: err } = await sb.auth.signInWithOtp({
        email: email.trim(),
        // The Supabase project serves other apps too: never create accounts from here.
        options: { shouldCreateUser: false, emailRedirectTo: authRedirectUrl() },
      });
      if (err) throw err;
      setCode('');
      setStep('code');
      setWait(RESEND_AFTER_S);
    }, 'Could not send the code');

  const verifyCode = (e?: FormEvent) => {
    e?.preventDefault();
    if (!supabase || code.length !== CODE_LENGTH) return;
    void run(async () => {
      const sb = await supabaseAuth(supabase);
      const { data, error: err } = await sb.auth.verifyOtp({ email: email.trim(), token: code, type: 'email' });
      if (err) {
        setCode('');
        throw err;
      }
      if (!data.session) throw new Error('Code not accepted. Request a new one.');
      await finish(data.session.access_token);
    }, 'Code not accepted');
  };

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
        <Steps step={step} />
        {step === 'email' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (email.trim()) void sendCode();
            }}
          >
            <label htmlFor="login-email" className="mb-1.5 block text-xs text-[var(--text-secondary)]">
              Email
            </label>
            <div className="relative">
              <Mail size={16} className="pointer-events-none absolute top-[13px] left-3 text-[var(--text-muted)]" aria-hidden="true" />
              <input
                id="login-email"
                type="email"
                value={email}
                autoFocus
                autoComplete="email"
                inputMode="email"
                placeholder="you@gmail.com"
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'login-error' : undefined}
                className={FIELD}
              />
            </div>
            {errorBox}
            <button type="submit" disabled={busy || email.trim() === ''} className={PRIMARY}>
              {busy ? 'Sending…' : 'Send code'}
              {!busy && <ArrowRight size={16} aria-hidden="true" />}
            </button>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
              <Lock size={13} aria-hidden="true" /> Only approved emails can sign in
            </p>
          </form>
        ) : (
          <form onSubmit={verifyCode}>
            <p className="mb-3 text-[13px] text-[var(--text-secondary)]">
              We sent a {CODE_LENGTH}-digit code to <span className="text-[var(--text-primary)]">{email.trim()}</span>
            </p>
            <CodeBoxes
              value={code}
              invalid={!!error}
              onChange={(v) => {
                setCode(v);
                if (error) setError(null);
              }}
            />
            {errorBox}
            <button type="submit" disabled={busy || code.length !== CODE_LENGTH} className={PRIMARY}>
              {busy ? 'Checking…' : 'Verify & open'}
              {!busy && <ArrowRight size={16} aria-hidden="true" />}
            </button>
            <div className="mt-3 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setStep('email');
                  setCode('');
                  setError(null);
                }}
                className={LINK}
              >
                <ArrowLeft size={13} aria-hidden="true" /> Change email
              </button>
              <button type="button" disabled={busy || wait > 0} onClick={() => void sendCode()} className={LINK}>
                {wait > 0 ? `Resend in 0:${String(wait).padStart(2, '0')}` : 'Resend code'}
              </button>
            </div>
          </form>
        )}
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
