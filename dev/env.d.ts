/// <reference types="astro/client" />

interface ImportMetaEnv {
  // Supabase — reuse the same VITE_ vars set in Vercel for the main game
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY: string;
  // Notion — server-side only
  readonly NOTION_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
