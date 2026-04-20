/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
  // Supabase — used by the playtest feedback form (client-side, VITE_ prefix exposes via Vite)
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY: string;
  // Supabase service role — server-side only; bypasses RLS for admin operations
  readonly SUPABASE_SERVICE_ROLE_KEY: string;
  // Notion — server-side only (no VITE_ prefix)
  readonly NOTION_API_KEY: string;
  // GitHub token with issues:write scope — used by tracker endpoints
  readonly GH_TRACKER_TOKEN: string;
  // Secret shared with the admin UI to authenticate /api/creatures/* endpoints
  readonly ADMIN_SECRET: string;
  // Public URL of this wiki (used when building GitHub issue bodies)
  readonly WIKI_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}