import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../src/types/database.types';

/**
 * Anon Supabase client for wiki build-time queries.
 * Uses the publishable key — safe for public SELECT queries via RLS.
 */
export function getWikiSupabase() {
  return createClient<Database>(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY,
  );
}
