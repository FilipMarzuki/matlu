/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
  // Supabase — used by the playtest feedback form (client-side, VITE_ prefix exposes via Vite)
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY: string;
  // Notion — server-side only (no VITE_ prefix)
  readonly NOTION_API_KEY: string;
  // Moderation admin — server-side only
  readonly SUPABASE_SERVICE_ROLE_KEY: string;
  readonly ADMIN_PASSWORD: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}