/**
 * Supabase auth helpers for the wiki.
 *
 * Two clients:
 *   createBrowserClient() — for client-side <script> blocks (session in localStorage)
 *   serviceHeaders()      — raw fetch headers using the service-role key, for API routes
 *
 * Auth flow: Supabase magic-link (passwordless). The sign-in page calls
 * signInWithOtp({ email, emailRedirectTo: '/account/callback' }). After the
 * user clicks the link, /account/callback exchanges the PKCE code for a
 * session via exchangeCodeForSession(code).
 *
 * Protected API routes extract the JWT from the Authorization header and
 * verify it with the service-role client (getUser(token)).
 */

import { createClient } from '@supabase/supabase-js';

/** Browser-side Supabase client. Import inside <script> blocks only. */
export function createBrowserClient() {
  const url = import.meta.env.VITE_SUPABASE_URL ?? '';
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY ?? '';
  return createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
}

/**
 * Raw fetch headers for server-side Supabase REST calls using the service key.
 * Bypasses RLS — use only in API routes (server-side).
 */
export function serviceHeaders(): Record<string, string> {
  const key = import.meta.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

/** Verify a user JWT from an Authorization header. Returns null if invalid. */
export async function verifyUserToken(
  authHeader: string | null
): Promise<{ id: string; email: string } | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const url = import.meta.env.VITE_SUPABASE_URL ?? '';
  const serviceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !serviceKey) return null;

  // Use service-role client to verify the user token
  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? '' };
}

export const PRIVACY_POLICY_VERSION = 'v1-2026-04';
