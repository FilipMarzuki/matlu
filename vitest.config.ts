import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only pick up test files under src/, wiki/src/, and dev/src/.
    // Excluding tests/ prevents Vitest from picking up Playwright specs, which
    // use a different test() API and would throw at runtime.
    include: [
      'src/**/*.test.ts',
      'wiki/src/**/*.test.ts',
      'dev/src/**/*.test.ts',
      'storytelling/**/*.test.ts',
      'mapgen/**/*.test.ts',
    ],
    // Unit tests must never talk to Supabase. Blank the credentials so
    // src/lib/supabaseClient.ts exports null and data loaders use their
    // bundled JSON fallbacks — even when CI or a local .env sets real or
    // placeholder VITE_SUPABASE_* values. (Creating a client on Node 20 also
    // crashes at import time: supabase-js realtime needs a native WebSocket.)
    env: {
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY: '',
      VITE_SUPABASE_ANON_KEY: '',
    },
  },
});
