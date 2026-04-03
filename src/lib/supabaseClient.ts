import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types';

const url = import.meta.env.VITE_SUPABASE_URL;
const key =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY;

if (import.meta.env.DEV && (!url || !key)) {
  console.warn(
    '[matlu] Missing VITE_SUPABASE_URL and a key (VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY or VITE_SUPABASE_ANON_KEY). See .env.example.'
  );
}

/**
 * Browser-safe Supabase client (anon / publishable key). Use from scenes or services when you add auth or data.
 */
export const supabase = createClient<Database>(url ?? '', key ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
