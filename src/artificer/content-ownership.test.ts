/**
 * Acceptance tests for #1531 — Artificer is the master for materials and concepts.
 *
 * The owner's call (2026-10-10): "Artificer will be the master for the material and concepts going
 * forward as we are moving beyond our earlier drafts." Artificer's concepts live in
 * src/artificer/content/concepts.json and its materials, recipes and items in its own code. The
 * Homestead's registries are earlier drafts, frozen as they are: Artificer doesn't read them, and
 * a change to one fails here until it's deliberately re-pinned.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { CRAFT_WORLD } from './region1';
import { FOCUS_CONCEPTS } from './focus';

const root = join(__dirname, '..', '..');

/** Every .ts file under a directory, tests included. */
function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return tsFiles(p);
    return f.endsWith('.ts') ? [p] : [];
  });
}

describe('Artificer owns its materials and concepts (#1531)', () => {
  // 1. Nothing in Artificer reads the Homestead's drafts, by import or by URL.
  it("doesn't import or fetch the Homestead's draft registries", () => {
    const hits: string[] = [];
    for (const dir of ['src/artificer', 'src/artificer-app', 'src/artificer-ai']) {
      for (const f of tsFiles(join(root, dir))) {
        const src = readFileSync(f, 'utf8');
        for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
          const target = relative(root, resolve(dirname(f), m[1]));
          if (/^(public\/)?macro-world\//.test(target)) hits.push(`${relative(root, f)} imports ${target}`);
        }
        for (const m of src.matchAll(/['"`]\/macro-world\/[\w.-]+/g)) hits.push(`${relative(root, f)} fetches ${m[0].slice(1)}`);
      }
    }
    expect(hits).toEqual([]);
  });

  // 2. The sim's concept web and Focus topics come from Artificer's own file.
  it('builds the concept web and Focus topics from src/artificer/content/concepts.json', () => {
    const file = join(root, 'src/artificer/content/concepts.json');
    expect(existsSync(file)).toBe(true);
    const own = JSON.parse(readFileSync(file, 'utf8')) as { concepts: { id: string }[] };
    const ids = own.concepts.map(c => c.id);
    expect(ids).toHaveLength(34);
    expect(Object.keys(CRAFT_WORLD.concepts)).toEqual(ids);
    expect(FOCUS_CONCEPTS).toEqual(ids);
    expect(CRAFT_WORLD.concepts.bearings?.requires).toEqual(['friction:1', 'rotation:1']);
  });

  // 3. The Homestead's drafts are frozen: pinned by hash on 2026-10-10. If a change to one is
  //    really meant (a Homestead fix), re-pin it here in the same PR, and say why.
  it("keeps the Homestead's draft registries frozen", () => {
    const FROZEN: Record<string, string> = {
      'macro-world/item-registry.json': 'a8a9b19149c48dc8d1463af8506e63ce1f0315d98b052cae7cc3810244381f69',
      'public/macro-world/recipes.json': 'e8f8843b96e28955e9f255486b2756668b3072976cee95e38fdd28942166d03c',
      'public/macro-world/concepts.json': 'e512ba3fd386eda0a30dbd01ab07d59f971d7283bcf3922309a8be8e4001ac89',
    };
    for (const [file, hash] of Object.entries(FROZEN)) {
      expect(createHash('sha256').update(readFileSync(join(root, file))).digest('hex'), `${file} is a frozen draft (#1531)`).toBe(hash);
    }
  });
});
