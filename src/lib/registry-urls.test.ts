/**
 * Acceptance tests for #1512 — every registry the game loads by URL has to be in the built site.
 *
 * Vite serves the whole project root in `npm run dev`, but the build ships only `public/`. So a
 * scene that fetches `/macro-world/item-registry.json` works locally and, in production, gets the
 * host's index.html instead (Vercel rewrites every miss to it, with a 200). That's how the
 * Homestead's crafting menu ended up on its placeholder data on the live site.
 *
 * #1518 moved the last two, the forge scenes' building-registry.json and architecture.json, into
 * public/macro-world/, so nothing is excused any more.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import type { ViteDevServer } from 'vite';
import recipesJson from '../../public/macro-world/recipes.json';
import { fetchMenuLists } from './registryFetch';
import viteConfig, { devSaveRegistryPlugin, SAVED_REGISTRY } from '../../vite.config';

const root = join(__dirname, '..', '..');

/** Every non-test .ts file under src/. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return f.endsWith('.ts') && !f.endsWith('.test.ts') ? [p] : [];
  });
}

describe('Registries load from the built site (#1512)', () => {
  // 1. A URL string (`'/macro-world/x.json'`, as fetch() and this.load.json() take) must name a file
  //    under public/macro-world/. Imports (`'../../macro-world/x.json'`) are bundled, so they're fine.
  it('finds every /macro-world/ URL that src/ loads under public/macro-world/', () => {
    const missing: string[] = [];
    let urls = 0;
    for (const f of sources(join(root, 'src'))) {
      // Code lines only: a comment that mentions a path isn't a load.
      const code = readFileSync(f, 'utf8').split('\n').filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
      for (const m of code.matchAll(/['"`]\/macro-world\/([\w.-]+\.json)/g)) {
        urls++;
        if (!existsSync(join(root, 'public', 'macro-world', m[1]))) missing.push(`${relative(root, f)}: ${m[1]}`);
      }
    }
    expect(urls).toBeGreaterThan(5); // the scan is finding the loads
    expect(missing).toEqual([]);
  });

  // 2. The crafting menu reads each list on its own, so one file that comes back as a web page
  //    (or not at all) can't throw away the others and drop the menu onto its fallback data.
  it('keeps the registry recipes when another file comes back as HTML', async () => {
    const html = () => new Response('<!DOCTYPE html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    const lists = await fetchMenuLists(async url => (url.endsWith('/recipes.json') ? json(recipesJson) : html()));
    const recipes = (lists.recipes ?? []).filter(r => typeof (r as { id?: unknown }).id === 'string');
    expect(recipes).toHaveLength(131);
    expect(lists.concepts).toBeNull();
    // A request that fails outright reads as missing too, rather than throwing.
    const failed = await fetchMenuLists(async () => { throw new TypeError('Failed to fetch'); });
    expect(failed).toEqual({ concepts: null, recipes: null });
    const notFound = await fetchMenuLists(async () => new Response('nope', { status: 404 }));
    expect(notFound).toEqual({ concepts: null, recipes: null });
  });
});

describe('Building Forge saves the registry it loads (#1518)', () => {
  // 3. In dev, Building Forge POSTs its edits to /__save-registry and reads them back from the URL
  //    it loads at startup. The save has to land on the file behind that URL, now in public/, and
  //    the dev server must not reload the page when that file changes.
  it('writes the saved registry to the file the forge loads by URL, without a reload', async () => {
    const forge = readFileSync(join(root, 'src/scenes/BuildingForgeScene.ts'), 'utf8');
    const url = forge.match(/load\.json\('building-registry', '([^']+)'\)/)?.[1];
    expect(url).toBe('/macro-world/building-registry.json');
    expect(`public${url}`).toBe(SAVED_REGISTRY);

    // Drive the dev plugin's middleware against a scratch root, as the dev server would.
    const tmp = mkdtempSync(join(tmpdir(), 'save-registry-'));
    try {
      mkdirSync(join(tmp, 'public/macro-world'), { recursive: true });
      let handler: ((req: unknown, res: unknown) => void) | undefined;
      const server = { middlewares: { use: (_path: string, h: typeof handler) => { handler = h; } } };
      (devSaveRegistryPlugin(tmp).configureServer as (s: ViteDevServer) => void)(server as unknown as ViteDevServer);
      const saved = { buildings: [{ id: 'smithy', sprite: 'saved-in-test' }] };
      const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(saved))]), { method: 'POST' });
      const reply = await new Promise<string>(resolve => handler!(req, { statusCode: 200, setHeader() {}, end: resolve }));
      expect(JSON.parse(reply)).toEqual({ ok: true });
      expect(JSON.parse(readFileSync(join(tmp, 'public', url!), 'utf8'))).toEqual(saved);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }

    // The dev server's watcher skips that file, so a save doesn't reload the page.
    expect(viteConfig.server?.watch?.ignored).toContain(`**/${SAVED_REGISTRY}`);
  });
});
