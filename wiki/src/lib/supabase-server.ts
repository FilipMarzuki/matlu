/**
 * Server-side Supabase client using the service role key.
 *
 * The service role key bypasses Row Level Security (RLS), so it can read all
 * creature submissions (including unapproved ones) and update any row. It must
 * NEVER be exposed to the browser — only use this in Astro API routes
 * (prerender = false endpoints) or Edge Functions.
 */
import { createClient } from '@supabase/supabase-js';

export function createServiceClient() {
  return createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
