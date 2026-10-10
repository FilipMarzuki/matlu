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
 *   - Vite builds artificer.html alone. Its output keeps the file's name, so it's renamed to
 *     index.html afterwards; asset URLs are absolute (/assets/…), so the rename is safe.
 *   - publicDir is off: public/ holds the whole game's art (hundreds of MB). The few sprites the
 *     Artificer shows are found by scanning its source for "/assets/…" strings and copied in, so a
 *     new portrait is picked up without a hand-kept list. A missing one fails the build.
 */

import { build } from 'vite';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'artificer', 'dist');
const SOURCES = ['src/artificer', 'src/artificer-app', 'src/artificer-ai'];

/** Every non-test .ts file under a directory. */
function sources(dir) {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return f.endsWith('.ts') && !f.endsWith('.test.ts') ? [p] : [];
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
    rollupOptions: { input: { artificer: join(root, 'artificer.html') } },
  },
});

renameSync(join(outDir, 'artificer.html'), join(outDir, 'index.html'));

const assets = referencedAssets();
for (const url of assets) {
  const from = join(root, 'public', url);
  if (!existsSync(from)) throw new Error(`The Artificer names ${url}, but public${url} doesn't exist`);
  mkdirSync(dirname(join(outDir, url)), { recursive: true });
  copyFileSync(from, join(outDir, url));
}
console.log(`Artificer built to ${outDir.slice(root.length + 1)}/: index.html, ${assets.length} sprite(s) copied from public/.`);
