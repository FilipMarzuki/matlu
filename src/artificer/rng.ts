/**
 * Seeded randomness for the sim (#1279, epic #1272).
 *
 * The sim stays deterministic: every "random" value comes from a seed (made
 * from the character id) plus *where in time* it's used — never from a
 * counter that advances with what you do. So a run replays exactly, AI
 * playtests are reproducible, and changing your plan never rerolls your luck.
 *
 * - `streamFor(seed, day, salt)` — a generator for one purpose on one day
 *   (e.g. the day's weather).
 * - `fortuneAt(seed, day, hour)` — one fixed value per hour of each day; the
 *   accident system compares it with the risk of what you're doing then.
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

/** A seeded shuffle (Fisher–Yates) of a copy. */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const r = generator(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A generator for one purpose (`salt`) on one day — the same every time for the same seed. */
export const streamFor = (seed: number, day: number, salt: string): (() => number) => generator(seedOf(`${seed}|${day}|${salt}`));

/** The fixed fortune of one hour of one day, in [0, 1) — low is bad luck. A pure function of seed, day and hour. */
export const fortuneAt = (seed: number, day: number, hour: number): number => streamFor(seed, day, `fortune@${hour}`)();
