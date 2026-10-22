import { defineConfig, type Plugin } from 'vite';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Where Building Forge's saves land: the file behind the URL it loads the registry from
 * (`/macro-world/building-registry.json`). It's under public/ so the built site ships it (#1518).
 */
export const SAVED_REGISTRY = 'public/macro-world/building-registry.json';

/**
 * Dev-only plugin: POST /__save-registry writes building-registry.json to disk.
 * Used by BuildingForgeScene to persist sprite assignments without a manual download step.
 * `root` is the project root; a test passes a scratch directory.
 */
export function devSaveRegistryPlugin(root: string = __dirname): Plugin {
  return {
    name: 'dev-save-registry',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__save-registry', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            const dest = resolve(root, SAVED_REGISTRY);
            writeFileSync(dest, JSON.stringify(data, null, 2) + '\n');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } catch (err) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: String(err) }));
          }
        });
      });
    },
  };
}

/**
 * Dev-only plugin: POST /__save-map writes a map JSON to public/assets/maps/<id>.json.
 * Used by SettlementEditorScene and MapForgeScene's Export action (#1172) so a
 * hand-edited map is a file on disk the same way a generated one is.
 */
function devSaveMapPlugin(): Plugin {
  return {
    name: 'dev-save-map',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__save-map', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const { id, level } = JSON.parse(body);
            if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) {
              throw new Error('id must match [a-z0-9-]+');
            }
            const relPath = `assets/maps/${id}.json`;
            const dest = resolve(__dirname, 'public', relPath);
            writeFileSync(dest, JSON.stringify(level, null, 2) + '\n');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, path: `/${relPath}` }));
          } catch (err) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: String(err) }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [
    devSaveRegistryPlugin(),
    devSaveMapPlugin(),
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

        // Phaser + game code bundles above the default 2 MB limit.
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
    watch: {
      // Don't reload when the building registry is saved from BuildingForge
      ignored: [`**/${SAVED_REGISTRY}`],
    },
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      // Multi-page: the game (index.html) plus a standalone crafting testbed
      // (crafting.html → src/crafting.ts) that ships without the rest of the game,
      // and the Artificer web frontend (artificer.html → src/artificer-app/), a
      // plain-DOM page over the headless sim core.
      input: {
        main: resolve(__dirname, 'index.html'),
        crafting: resolve(__dirname, 'crafting.html'),
        artificer: resolve(__dirname, 'artificer.html'),
      },
    },
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
