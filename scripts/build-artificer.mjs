#!/usr/bin/env node
/**
 * build-artificer (#1534): build the Artificer on its own, for artificer.corewarden.app.
 *
 *   npm run build:artificer        # → artificer/dist/ (index.html + assets)
 *
 * The root build (`npm run build`) bundles the game, the crafting testbed and the Artificer into
 * dist/ for corewarden.app. The Artificer's own Vercel project (Root Directory `artificer/`, see
 * artificer/vercel.json) needs just the Artificer, served at `/`:
 *
 *   - Vite builds artificer.html (renamed to index.html afterwards), the "Play with your AI"
 *     page and the text console (moved to play-with-ai/index.html and console/index.html).
 *     Asset URLs are absolute (/assets/…), so moving the HTML files is safe.
 *   - publicDir is off: public/ holds the whole game's art (hundreds of MB). The few sprites the
 *     Artificer shows are found by scanning its source and content (.ts, .json) for "/assets/…"
 *     strings and copied in, so a new portrait is picked up without a hand-kept list. A missing one
 *     fails the build. A URL built at runtime (`/assets/${x}.png`) isn't seen: name assets whole.
 *   - The play API (#1555) is a function beside the page. Vite bundles src/artificer-play/vercel-handler.ts
 *     with the sim, its JSON and supabase-js into one file, and the site is written out in Vercel's
 *     Build Output API layout (artificer/.vercel/output: static/, functions/api/play.func/,
 *     config.json routing /api/v1/* and /mcp to the function). Vercel deploys that layout as it stands when a
 *     build leaves one; dist/ stays the plain site, for previews and as the fallback.
 */

import { build } from 'vite';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'artificer', 'dist');
const SOURCES = ['src/artificer', 'src/artificer-app', 'src/artificer-ai'];

/** Every non-test .ts file and every .json file (content such as content/concepts.json) under a directory. */
function sources(dir) {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return (f.endsWith('.ts') && !f.endsWith('.test.ts')) || f.endsWith('.json') ? [p] : [];
  });
}

/** The public/ files the Artificer's code names, e.g. "/assets/sprites/…/skald.png". */
export function referencedAssets() {
  const found = new Set();
  for (const dir of SOURCES) {
    for (const f of sources(join(root, dir))) {
      for (const m of readFileSync(f, 'utf8').matchAll(/['"`](\/assets\/[^'"`$]+\.(?:png|jpg|webp|svg|gif|json|ogg|mp3))['"`]/g)) found.add(m[1]);
    }
  }
  return [...found].sort();
}

await build({
  configFile: false,
  root,
  publicDir: false,
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: {
      input: {
        artificer: join(root, 'artificer.html'),
        // The "Play with your AI" page (#1556) and the text console (#1557), moved to
        // /play-with-ai/ and /console/ below.
        playWithAi: join(root, 'src', 'artificer-app', 'play-with-ai.html'),
        console: join(root, 'src', 'artificer-app', 'console.html'),
      },
    },
  },
});

renameSync(join(outDir, 'artificer.html'), join(outDir, 'index.html'));
// Vite keeps an entry's path from the root (dist/src/artificer-app/…); serve each page from its
// own folder (/play-with-ai/, /console/).
for (const page of ['play-with-ai', 'console']) {
  mkdirSync(join(outDir, page), { recursive: true });
  renameSync(join(outDir, 'src', 'artificer-app', `${page}.html`), join(outDir, page, 'index.html'));
}
rmSync(join(outDir, 'src'), { recursive: true, force: true });

const assets = referencedAssets();
for (const url of assets) {
  const from = join(root, 'public', url);
  if (!existsSync(from)) throw new Error(`The Artificer names ${url}, but public${url} doesn't exist`);
  mkdirSync(dirname(join(outDir, url)), { recursive: true });
  copyFileSync(from, join(outDir, url));
}
console.log(`Artificer built to ${outDir.slice(root.length + 1)}/: index.html, ${assets.length} sprite(s) copied from public/.`);

// ── The play API's function, and the Build Output API layout (#1555) ───────────────────────────

const vercelOut = join(root, 'artificer', '.vercel', 'output');
const funcDir = join(vercelOut, 'functions', 'api', 'play.func');
rmSync(vercelOut, { recursive: true, force: true });

await build({
  configFile: false,
  root,
  publicDir: false,
  logLevel: 'warn',
  // Bundle every dependency (supabase-js too): the function gets this one file and nothing else.
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: join(root, 'src', 'artificer-play', 'vercel-handler.ts'),
    outDir: funcDir,
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: { output: { format: 'cjs', exports: 'named', entryFileNames: 'handler.js' } },
  },
});
// Vercel's Node launcher calls the module's export as `(req, res)`; hand it the function itself.
writeFileSync(join(funcDir, 'index.js'), "module.exports = require('./handler.js').default;\n");
writeFileSync(join(funcDir, 'package.json'), JSON.stringify({ type: 'commonjs' }) + '\n');
writeFileSync(join(funcDir, '.vc-config.json'), JSON.stringify({
  runtime: 'nodejs22.x', handler: 'index.js', launcherType: 'Nodejs', maxDuration: 10,
}, null, 2) + '\n');

cpSync(outDir, join(vercelOut, 'static'), { recursive: true });
writeFileSync(join(vercelOut, 'config.json'), JSON.stringify({
  version: 3,
  routes: [
    // The API first, so no static file can shadow it; the rest of the path rides along as ?path=.
    { src: '^/api/v1/?$', dest: '/api/play?path=' },
    { src: '^/api/v1/(.*)$', dest: '/api/play?path=$1' },
    // The MCP server (#1556), in the same function.
    { src: '^/mcp/?$', dest: '/api/play?surface=mcp' },
    { handle: 'filesystem' },
  ],
}, null, 2) + '\n');
console.log(`Play API bundled to ${funcDir.slice(root.length + 1)}/; Build Output API layout in ${vercelOut.slice(root.length + 1)}/.`);
