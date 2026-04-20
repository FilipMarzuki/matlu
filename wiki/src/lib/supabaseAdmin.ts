import { createClient } from '@supabase/supabase-js';
import type { WikiDatabase } from '../types/wiki-database.types';

// Returns a Supabase client authenticated with the service-role key.
// The service-role key bypasses RLS, so this must only ever be called
// server-side (API routes, SSR Astro frontmatter). Never import this in
// a client-side <script> tag.
export function getAdminClient() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const serviceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      'Supabase admin credentials not configured. Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    );
  }
  return createClient<WikiDatabase>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
