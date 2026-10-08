/**
 * Stat spreads for the AI harness (#1259). AI players spend their point-buy like a person
 * would (the parity rule from #1267): a spread given with `--stats`, a preset, or — for the
 * random baseline — a random legal spread. None is stronger or weaker than a person could pick.
 */

import { rng } from './players/random';
import { STATS, STAT_IDS, DEFAULT_STATS, CREATION_MIN, CREATION_MAX, POINT_BUDGET, validStats, pointCost, canRaise, canLower, type StatId, type Stats } from '../artificer/stats';

/** Named spreads, each spending the full 6 points. */
export const STAT_PRESETS = {
  /** A little of everything. */
  balanced: { str: 11, con: 11, agi: 11, int: 11, wil: 11, cha: 11 },
  /** Body first: heavy work and long days. */
  strong: { str: 13, con: 13, agi: 10, int: 10, wil: 10, cha: 10 },
  /** Mind first: study, crafts and holding it together. */
  clever: { str: 10, con: 10, agi: 10, int: 13, wil: 13, cha: 10 },
} as const satisfies Record<string, Stats>;
export type StatPreset = keyof typeof STAT_PRESETS;

/** "STR 13 · CON 10 · …", the way the observation shows a spread. */
export const spreadText = (s: Stats): string => STAT_IDS.map(id => `${STATS[id].short} ${s[id]}`).join(' · ');

/**
 * Read a `--stats` value: a preset name, or `str=13,int=13` (unnamed stats stay 10).
 * Anything a person couldn't pick at creation is an error that says why.
 */
export function parseStatSpread(arg: string): { stats: Stats } | { error: string } {
  const name = arg.trim();
  if (name in STAT_PRESETS) return { stats: { ...STAT_PRESETS[name as StatPreset] } };
  const stats: Stats = { ...DEFAULT_STATS };
  for (const part of name.split(',').map(p => p.trim()).filter(Boolean)) {
    const [k, v] = part.split('=').map(x => x.trim().toLowerCase());
    if (!(STAT_IDS as readonly string[]).includes(k)) return { error: `unknown stat "${k}" — use ${STAT_IDS.join(', ')} or a preset (${Object.keys(STAT_PRESETS).join(', ')})` };
    const n = Number(v);
    if (!Number.isInteger(n)) return { error: `${k}=${v} is not a whole number` };
    if (n > CREATION_MAX) return { error: `${k}=${n} is over the creation max of ${CREATION_MAX} (stats only go higher by use)` };
    if (n < CREATION_MIN) return { error: `${k}=${n} is under the creation min of ${CREATION_MIN}` };
    stats[k as StatId] = n;
  }
  if (!validStats(stats)) return { error: `that spread costs ${pointCost(stats)} points; the budget is ${POINT_BUDGET}` };
  return { stats };
}

/**
 * A random legal spread (seeded): lower up to two stats for points, then spend everything left
 * on random raises. Every spread a person could reach this way is possible, and the same seed
 * always gives the same spread.
 */
export function randomSpread(seed: number): Stats {
  const rand = rng(seed * 7919 + 17);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const s: Stats = { ...DEFAULT_STATS };
  const lowers = Math.floor(rand() * 3);
  for (let i = 0; i < lowers; i++) {
    const id = pick(STAT_IDS);
    if (canLower(s, id)) s[id]--;
  }
  // Raising never makes another raise cheaper, so this always ends.
  for (;;) {
    const up = STAT_IDS.filter(id => canRaise(s, id));
    if (!up.length) break;
    s[pick(up)]++;
  }
  return s;
}
