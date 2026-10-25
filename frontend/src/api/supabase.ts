import type { SupabaseClient } from '@supabase/supabase-js';
import { APP_BASE } from './client';
import type { SupabaseConfig } from './types';

let client: Promise<SupabaseClient> | null = null;

/**
 * The Supabase Auth client, loaded on first use so the landing page doesn't
 * pay for it. Only used to sign in: the access token is handed to the backend,
 * which opens its own session, and the Supabase session is then dropped.
 */
export function supabaseAuth(config: SupabaseConfig): Promise<SupabaseClient> {
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(config.url, config.key, {
      auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true, autoRefreshToken: false },
    }),
  );
  return client;
}

/** Where magic links and Google send the browser back to: the app's own root. */
export const authRedirectUrl = () => `${window.location.origin}${APP_BASE}/`;

/** True when this page load is the return leg of a magic link or Google sign-in. */
export function isAuthRedirect(): boolean {
  const q = new URLSearchParams(window.location.search);
  return q.has('code') || q.has('error_description') || /access_token=|error_description=/.test(window.location.hash);
}

/** Drop the ?code=… / #access_token=… Supabase left in the address bar. */
export function clearAuthRedirect(): void {
  window.history.replaceState(null, '', `${APP_BASE}/`);
}

/** True inside the AddStock Windows app, whose shell sets this flag before the page loads. */
export const isDesktopApp = () => typeof window !== 'undefined' && '__ADDSTOCK__' in window;
