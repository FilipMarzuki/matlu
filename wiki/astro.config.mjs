import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// Matlu Codex — community hub for the Matlu multiworld
// Players and contributors read lore, biomes, and creatures for Core Warden
export default defineConfig({
  // hybrid: most pages are prerendered (static), but pages/API routes that
  // export `prerender = false` are rendered on-demand (needed for the admin
  // moderation page and its API routes, which read cookies and service-role creds).
  output: 'hybrid',
  adapter: vercel(),
});
