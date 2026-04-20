/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
  // Supabase — used by the playtest feedback form (client-side, VITE_ prefix exposes via Vite)
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY: string;
  // Notion — server-side only (no VITE_ prefix)
  readonly NOTION_API_KEY: string;
  // Admin — server-side only; never expose to client
  readonly ADMIN_PASSWORD: string;
  readonly SUPABASE_URL: string;
  readonly SUPABASE_SERVICE_ROLE_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
