/// <reference types="astro/client" />

interface ImportMetaEnv {
  // Supabase — server-side only (no VITE_ prefix, not exposed to the client)
  readonly SUPABASE_URL: string;
  readonly SUPABASE_ANON_KEY: string;
  // Notion — server-side only
  readonly NOTION_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
