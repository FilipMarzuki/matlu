/**
 * Auth helpers for Homestead cloud save (#851).
 *
 * Flow:
 *   1. Scene boots → ensureSession() — if no session, signs in anonymously.
 *      Anonymous users get a real auth.users row + user_id, so they save
 *      the same way real users do.
 *   2. User taps "Sign in with email" → sendMagicLink(email).
 *      Supabase emails a one-time link that includes a session token.
 *   3. User clicks the link → Supabase redirects them back to /homestead.
 *      The supabase client is configured with `detectSessionInUrl: true`,
 *      so it auto-extracts the session from the URL hash on load.
 *      The user_id is preserved when an anon account is upgraded, so the
 *      existing save row keeps working.
 *
 * Requires "Anonymous sign-ins" enabled in the Supabase dashboard
 * (Authentication → Providers → Anonymous).
 */

import { supabase } from './supabaseClient';
import type { Session, User } from '@supabase/supabase-js';

/** Where Supabase should send the user back after they click the magic link. */
const MAGIC_LINK_REDIRECT = `${window.location.origin}/homestead`;

/**
 * Returns the current session, signing in anonymously if there isn't one.
 * Returns null if Supabase isn't configured (no env vars) — caller should
 * gracefully degrade to localStorage-only persistence.
 */
export async function ensureSession(): Promise<Session | null> {
  if (!supabase) return null;

  const { data: existing } = await supabase.auth.getSession();
  if (existing.session) return existing.session;

  // No session yet → sign in as anonymous so we have a user_id to save against.
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.warn('[auth] anonymous sign-in failed:', error.message);
    return null;
  }
  return data.session;
}

/**
 * Send a magic-link email. If the current session is anonymous, the user
 * is upgraded in place: the email is attached to the existing auth.users
 * row, preserving user_id so saves keep working.
 */
export async function sendMagicLink(email: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'auth not configured' };

  const user = (await supabase.auth.getUser()).data.user;

  if (user?.is_anonymous) {
    // Upgrade path: attach email to the anon user. Sends a confirm email.
    const { error } = await supabase.auth.updateUser(
      { email },
      { emailRedirectTo: MAGIC_LINK_REDIRECT },
    );
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  // Returning user — standard magic link sign-in. Don't auto-create users
  // here, because the user might be coming back from a previous session;
  // signInWithOtp creates one if needed.
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: MAGIC_LINK_REDIRECT },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Sign the user out and immediately sign back in anonymously so saves keep working. */
export async function signOutAndAnon(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
  await ensureSession();
}

/** Snapshot of the current user for HUD rendering. */
export interface AuthInfo {
  userId: string | null;
  email: string | null;
  isAnonymous: boolean;
}

export function getAuthInfo(user: User | null): AuthInfo {
  return {
    userId: user?.id ?? null,
    email: user?.email ?? null,
    isAnonymous: user?.is_anonymous ?? !user,
  };
}
