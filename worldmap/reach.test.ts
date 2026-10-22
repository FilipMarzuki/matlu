/**
 * #1895 — the Reach's generation lives in worldmap/, and the Artificer re-exports it.
 *
 * worldmap/ is the world generator both games read (docs/spikes/artificer-hex-world.md §3), so it
 * must stand on its own: no imports from the games (src/) or the other engines (storytelling/,
 * mapgen/). These tests read the moved files' import lines to hold that boundary, and check the
 * Artificer's `world/reach.ts` hands out the very same functions rather than a second copy.
 *
 * (A test may import from src/: tests are not part of worldmap's build, see worldmap/tsconfig.json.)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as moved from './reach';
import * as artificer from '../src/artificer/world/reach';

const root = join(__dirname, '..');

/**
 * Every module a source file names, as a path from the repo root (relative specifiers resolved
 * against the file's folder; package names such as `simplex-noise` as written). Covers static
 * `import … from`, `export … from`, bare `import '…'`, dynamic `import('…')` and `require('…')`.
 */
function importsOf(file: string): string[] {
  const text = readFileSync(join(root, file), 'utf8');
  const specs = [...text.matchAll(/(?:\bfrom\s+|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g)].map(m => m[1]);
  return specs.map(s => (s.startsWith('.') ? relative(root, resolve(root, file, '..', s)) : s));
}

describe('worldmap/reach: the Reach, moved out of the Artificer (#1895)', () => {
  it('given worldmap/reach.ts and worldmap/rng.ts, their import lines name nothing in src/, storytelling/ or mapgen/', () => {
    for (const file of ['worldmap/reach.ts', 'worldmap/rng.ts']) {
      for (const target of importsOf(file)) {
        expect(target, `${file} imports ${target}`).not.toMatch(/^(src|storytelling|mapgen)(\/|$)/);
      }
    }
    // The scope, exactly: reach.ts needs only simplex-noise and the rng copy; rng.ts needs nothing.
    expect(importsOf('worldmap/reach.ts').sort()).toEqual(['simplex-noise', 'worldmap/rng']);
    expect(importsOf('worldmap/rng.ts')).toEqual([]);
  });

  it("the Artificer's world/reach.ts re-exports the same functions, so there is one generator and one walk cache", () => {
    expect(artificer.generateReach).toBe(moved.generateReach);
    expect(artificer.walkFrom).toBe(moved.walkFrom);
    expect(artificer.walkingHours).toBe(moved.walkingHours);
    expect(artificer.COST).toBe(moved.COST);
    expect([artificer.REACH_W, artificer.REACH_H]).toEqual([moved.REACH_W, moved.REACH_H]);
  });
});
