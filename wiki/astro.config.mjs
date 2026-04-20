import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Matlu Codex — community hub for the Matlu multiworld
// Players and contributors read lore, biomes, and creatures for Core Warden.
//
// Pages are static by default; the admin page and API routes opt into SSR with
// `export const prerender = false`. This keeps the password gate and
// service-role Supabase calls server-side only. Vercel adapter handles the
// serverless functions for those routes.
export default defineConfig({
  adapter: vercel(),
  vite: {
    resolve: {
      alias: {
        // wiki/src/pages/biomes/index.astro imports the game's pure-data biomes
        // module via a deep relative path (../../../../src/world/biomes).
        // Vite restricts imports outside its project root at build time; on
        // Vercel the relative path fails to resolve. This alias maps it to an
        // absolute path so it works in both local dev and Vercel CI.
        '../../../../src/world/biomes': path.resolve(__dirname, '../src/world/biomes.ts'),
      },
    },
  },
});
