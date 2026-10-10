import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api/client';

export function LoginGate({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onSuccess();
    } catch (err) {
      setError(errorMessage(err) || 'Login failed');
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-[calc(100vh-64px)] items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-[22rem] border border-[var(--border)] bg-[var(--surface-card)] px-[30px] pt-[34px] pb-[30px] text-center"
      >
        <div className="ad-mark" aria-hidden="true">
          AD
        </div>
        <h1 className="ob-title text-[1.6rem]">Option Builder</h1>
        <p className="ob-sub mt-2 mb-[26px]">ADD DOTS · Enter your password</p>

        <label className="block text-left text-[9px] uppercase tracking-[0.14em] text-[var(--text-secondary)]">
          Password
          <input
            type="password"
            value={password}
            autoFocus
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'login-error' : undefined}
            className="mt-1 w-full border border-[var(--border)] bg-transparent px-3 py-2.5 text-sm normal-case tracking-normal text-[var(--text-primary)]"
          />
        </label>

        {error && (
          <div id="login-error" role="alert" className="mt-2 text-left text-[11px] text-[var(--critical)]">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || password === ''}
          className="mt-4 min-h-11 w-full bg-[var(--accent)] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--accent-text)] hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Open'}
        </button>
      </form>
    </main>
  );
}
