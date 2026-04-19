import { defineConfig } from 'astro/config';

// Agentic Experiments — personal AI/automation learning log for building Core Warden
// Tracks agent performance, automation evolution, and dev learnings. Shared publicly.
export default defineConfig({
  output: 'static',
  // Needed for RSS feed and canonical URLs
  site: 'https://agentic-experiments.vercel.app',
});
