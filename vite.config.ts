import { defineConfig } from 'vite';
import { execSync } from 'child_process';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',

      // generateSW strategy — Workbox writes the service worker for us.
      // For a Phaser game the main concern is caching the JS bundle and
      // HTML shell fast while NOT precaching the large asset packs (audio,
      // tilemaps, sprite sheets) — those would blow the SW cache quota.
      strategies: 'generateSW',

      workbox: {
        // Only precache the compiled JS/CSS bundles and the HTML shell.
        // Everything under /assets/packs/ is runtime-cached on first load
        // with a stale-while-revalidate strategy (see runtimeCaching below).
        globPatterns: ['**/*.{js,css,html,ico}'],
        // Phaser's compiled game bundle is slightly above Workbox's 2 MiB
        // default; keep it precached so installed/tablet users still boot fast.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,

        // Audio and large image packs: network-first with a 7-day cache.
        // This gives offline playback after the first visit without
        // blowing the ~50 MB SW cache limit.
        runtimeCaching: [
          {
            urlPattern: /\/assets\/packs\/.+\.(png|jpg|webp)$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'game-sprites',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            urlPattern: /\/assets\/packs\/.+\.(ogg|mp3|wav)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'game-audio',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],

        // Skip waiting so a returning user gets the latest build immediately.
        skipWaiting: true,
        clientsClaim: true,
      },

      manifest: {
        name: 'Core Warden',
        short_name: 'Core Warden',
        description: 'Top-down action RPG — explore a corrupted world and fight to cleanse it.',
        theme_color: '#1a0a2e',
        background_color: '#0d0d0d',
        // fullscreen removes all browser chrome — best for a game.
        display: 'fullscreen',
        // Lock to landscape — the game is designed for 800×600 landscape.
        orientation: 'landscape',
        start_url: '/',
        // TODO: replace with proper pixel art PNG icons (see Linear FIL-PWA-icons).
        // SVG works on Android Chrome and modern iOS Safari for now.
        icons: [
          {
            src: '/icons/icon-192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
          {
            src: '/icons/icon-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],

  server: {
    port: 3000,
  },
  build: {
    target: 'esnext',
  },
  define: {
    'import.meta.env.VITE_GIT_SHA': JSON.stringify(
      (() => {
        try {
          return execSync('git rev-parse --short HEAD').toString().trim();
        } catch {
          return 'unknown';
        }
      })()
    ),
  },
});
