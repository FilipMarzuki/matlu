/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  /** Preferred: publishable key from dashboard (sb_publishable_…). */
  readonly VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY?: string;
  /** Legacy anon JWT; used if publishable key is unset. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Optional; set in deploy (e.g. Vercel) for build metadata if you need it. */
  readonly VITE_GIT_SHA?: string;
  /** Better Stack source token (Logs → your source → "Source token"). */
  readonly VITE_BETTERSTACK_DSN?: string;
  /** Matlu Codex URL — used for the in-game playtest feedback link. Defaults to production URL. */
  readonly VITE_WIKI_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
