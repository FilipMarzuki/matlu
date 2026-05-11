import type { AuthChangeEvent, Session, Subscription } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';

export type HomesteadAuthStatus =
  | { kind: 'offline'; label: string; detail: string }
  | { kind: 'guest'; label: string; detail: string; session: Session }
  | { kind: 'signed-in'; label: string; detail: string; session: Session };

type AuthListener = (event: AuthChangeEvent, session: Session | null) => void;

export async function getCurrentSession(): Promise<Session | null> {
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getOrSignInAnon(): Promise<Session | null> {
  if (!supabase) return null;

  const existing = await getCurrentSession();
  if (existing) return existing;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return data.session;
}

export async function sendMagicLink(email: string): Promise<void> {
  const trimmedEmail = email.trim();
  if (!trimmedEmail) {
    throw new Error('Email is required.');
  }
  if (!supabase) {
    throw new Error('Supabase is not configured for this build.');
  }

  const session = await getOrSignInAnon();
  if (!session) {
    throw new Error('Could not start a Homestead guest session.');
  }

  const { error } = await supabase.auth.updateUser(
    { email: trimmedEmail },
    { emailRedirectTo: `${window.location.origin}/homestead` },
  );
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export function describeAuthStatus(session: Session | null): HomesteadAuthStatus {
  if (!supabase) {
    return {
      kind: 'offline',
      label: 'Offline save',
      detail: 'Add VITE_SUPABASE_URL and a publishable key to enable cloud saves.',
    };
  }

  if (!session) {
    return {
      kind: 'offline',
      label: 'Connecting...',
      detail: 'Starting guest save session.',
    };
  }

  const email = session.user.email;
  if (email && session.user.is_anonymous !== true) {
    return {
      kind: 'signed-in',
      label: email,
      detail: 'Cloud save is linked to this email.',
      session,
    };
  }

  return {
    kind: 'guest',
    label: 'Guest',
    detail: 'Cloud save is active on this browser. Sign in with email to keep it.',
    session,
  };
}

export function onAuthStateChange(listener: AuthListener): Subscription | null {
  if (!supabase) return null;

  const { data } = supabase.auth.onAuthStateChange(listener);
  return data.subscription;
}
