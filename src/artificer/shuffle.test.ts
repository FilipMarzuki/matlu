/**
 * Acceptance tests for #1877: shuffles are a seeded Fisher–Yates (rng.ts shuffledBy), never a sort
 * with a random comparator, whose order depends on the engine's sort algorithm.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { generator, seedOf, shuffled, shuffledBy } from './rng';

/** Every .ts file under the src/artificer* folders. */
function artificerSources(): string[] {
  const src = join(__dirname, '..');
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name)) out.push(p);
    }
  };
  for (const name of readdirSync(src)) if (name.startsWith('artificer') && statSync(join(src, name)).isDirectory()) walk(join(src, name));
  return out;
}

// `.sort(` whose comparator takes no arguments, or ignores them, and calls a generator: the shape
// `sort(() => rand() - 0.5)`, `sort((a, b) => r() - 0.5)` or `sort(() => Math.random() - 0.5)`.
const RANDOM_SORT = /\.sort\(\s*\(\s*(?:\w+\s*,\s*\w+)?\s*\)\s*=>\s*[\w.]+\(\)\s*-/;

describe('Seeded Fisher–Yates shuffles (#1877)', () => {
  it('leaves no sort-with-a-random-comparator shuffles in src/artificer*', () => {
    const files = artificerSources();
    expect(files.length).toBeGreaterThan(50);
    const hits: string[] = [];
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const code = line.trim();
        // Comments may name the pattern to warn against it; only code counts.
        if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return;
        if (RANDOM_SORT.test(code.replace(/`[^`]*`/g, ''))) hits.push(`${f}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('gives the same shuffle for the same seed, and leaves the input alone', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
    const a = shuffledBy(items, generator(seedOf('w-vega')));
    expect(shuffledBy(items, generator(seedOf('w-vega')))).toEqual(a);
    expect([...a].sort()).toEqual([...items]);
    expect(items).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    // The seeded form is the same shuffle from a fresh generator on that seed.
    expect(shuffled(items, 42)).toEqual(shuffledBy(items, generator(42)));
    // Some other seed orders them differently (not a promise for every pair, just these).
    expect(shuffledBy(items, generator(seedOf('w-ash')))).not.toEqual(a);
    // One draw per position after the first: the generator is left where n − 1 draws put it.
    const g = generator(7);
    const h = generator(7);
    shuffledBy(items, g);
    for (let i = 0; i < items.length - 1; i++) h();
    expect(g()).toBe(h());
  });

  it('keeps each item near an even share of each position over many seeds', () => {
    const n = 5;
    const seeds = 5000;
    const items = Array.from({ length: n }, (_, i) => i);
    // counts[item][position]
    const counts = items.map(() => new Array<number>(n).fill(0));
    for (let s = 0; s < seeds; s++) shuffledBy(items, generator(seedOf(`uniform|${s}`))).forEach((item, pos) => counts[item][pos]++);
    const even = seeds / n;
    for (const row of counts) for (const c of row) expect(Math.abs(c - even) / even).toBeLessThan(0.1);
  });
});
