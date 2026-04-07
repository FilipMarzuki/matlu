import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types';

const url = import.meta.env.VITE_SUPABASE_URL;
const key =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.warn(
    '[matlu] Missing VITE_SUPABASE_URL / key — leaderboard features disabled. See .env.example.'
  );
}

/**
 * Browser-safe Supabase client (anon / publishable key). Use from scenes or services when you add auth or data.
 * null when env vars are not configured (e.g. local dev without .env, or Vercel before env vars are set).
 */
export const supabase = url && key
  ? createClient<Database>(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
