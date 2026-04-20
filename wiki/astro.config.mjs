import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// Matlu Codex — community hub for the Matlu multiworld
// Players and contributors read lore, biomes, and creatures for Core Warden.
// hybrid: pages are static by default; API routes opt-in with `prerender = false`.
export default defineConfig({
  output: 'hybrid',
  adapter: vercel(),
});
