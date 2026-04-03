/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  /** Preferred: publishable key from dashboard (sb_publishable_…). */
  readonly VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY?: string;
  /** Legacy anon JWT; used if publishable key is unset. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
