import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types';

// `import.meta.env` only exists under Vite. Node scripts (tsx) that import
// game modules transitively land here too, so read it defensively — without
// Vite the client is simply null, the same as running with no .env.
const env = import.meta.env ?? ({} as Record<string, string | undefined>);
const url = env.VITE_SUPABASE_URL;
const key =
  env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
  env.VITE_SUPABASE_ANON_KEY;

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
