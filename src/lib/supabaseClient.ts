import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (import.meta.env.DEV && (!url || !anonKey)) {
  console.warn(
    '[matlu] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in values from the Supabase dashboard.'
  );
}

/**
 * Browser-safe Supabase client (anon / publishable key). Use from scenes or services when you add auth or data.
 */
export const supabase = createClient(url ?? '', anonKey ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
