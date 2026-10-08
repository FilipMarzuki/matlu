import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// Agentic Experiments — personal AI/automation learning log for building Core Warden
// Tracks agent performance, automation evolution, and dev learnings. Shared publicly.
//
// Pages are static by default; the audio editor and its API routes opt into SSR
// with `export const prerender = false` (#944) — same pattern as wiki/'s admin
// page. The Vercel adapter provides the serverless functions for those routes.
export default defineConfig({
  adapter: vercel(),
  // Needed for RSS feed and canonical URLs
  site: 'https://agentic-experiments.vercel.app',
});
