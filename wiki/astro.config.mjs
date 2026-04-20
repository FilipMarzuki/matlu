import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// Matlu Codex — community hub for the Matlu multiworld
// Players and contributors read lore, biomes, and creatures for Core Warden.
//
// Pages are static by default; the admin page and API routes opt into SSR with
// `export const prerender = false`. This keeps the password gate and
// service-role Supabase calls server-side only. Vercel adapter handles the
// serverless functions for those routes.
export default defineConfig({
  adapter: vercel(),
});
