/**
 * Service-role Supabase client for server-side admin operations.
 * Bypasses RLS — only call from SSR routes that have already verified
 * the admin session cookie.
 */
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../src/types/database.types';

export function getSupabaseAdmin() {
  // SUPABASE_URL falls back to the VITE_ variant (same value, both server-safe here)
  const url = import.meta.env.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  return createClient<Database>(url, key, {
    auth: { persistSession: false },
  });
}
