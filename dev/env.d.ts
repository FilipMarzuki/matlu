/// <reference types="astro/client" />

interface ImportMetaEnv {
  // Supabase — reuse the same VITE_ vars set in Vercel for the main game
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY: string;
  // Notion — server-side only
  readonly NOTION_API_KEY: string;
  // Cross-site link to the game, used by Nav.astro and the /audio preview button
  readonly PUBLIC_GAME_URL: string;
  // Audio editor (#944) — server-side only
  readonly AUDIO_EDITOR_PASSWORD: string;
  readonly AUDIO_GITHUB_TOKEN: string;
  readonly AUDIO_GITHUB_REPO: string;
  readonly AUDIO_GITHUB_BRANCH: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
