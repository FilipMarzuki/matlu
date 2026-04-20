import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// Matlu Codex — community hub for the Matlu multiworld
// Hybrid output: most pages are static SSG; admin + API routes opt in to SSR
// with `export const prerender = false`.
// In Astro 6, "static" replaced "hybrid": static pages are pre-rendered by default;
// individual pages opt into SSR with `export const prerender = false`.
// The Vercel adapter is required to serve those server-rendered endpoints at runtime.
export default defineConfig({
  output: 'static',
  adapter: vercel(),
});
