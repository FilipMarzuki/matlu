/**
 * Seeded randomness for the world generator (#1895): a copy of `seedOf` and `generator` from
 * `src/artificer/rng.ts`, character for character.
 *
 * Why a copy and not an import: worldmap/ is the world both games read, so it must not reach into
 * either game's code (src/). Keeping it self-contained also keeps the planned repo split easy. A
 * copy can drift, so `rng.test.ts` pins the two equal, value for value: change one, change both.
 *
 * Nothing else from the Artificer's rng is copied (no `streamFor`, `shuffled`…): the world draws
 * each stream as `generator(seedOf(\`${seed}|world|${salt}\`))`, which needs only these two.
 */

/** A stable 32-bit seed from a string (FNV-1a). */
export function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A small deterministic generator (mulberry32): the same seed gives the same sequence, values in [0, 1). */
export function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
