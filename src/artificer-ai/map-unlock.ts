/**
 * When does a player unlock the map (#1797)? The measure behind `MAP_NIGHTS`, `MAP_PLACES` and
 * `MAP_DIRECTIONS` (map-learning.ts): the first day on which the map-drawing session opens
 * (`mapUnlockNeeds` is empty), for a run playing the game's default rules with `map-learning` on.
 *
 * Three ways to play it, none of them a paid model:
 *
 * - **The scripted baseline** (players/scripted.ts), through the harness the bench uses. It was
 *   written before the land had to be explored (it scouts and surveys a ring or two, then hunts
 *   and smokes), so under these rules it finds two to four places and seldom unlocks at all.
 * - **The random baseline** (players/random.ts, `legal`), seeded, through the same harness.
 * - **An explorer** (`explorerUnlock`): the "player who explores normally" the thresholds are
 *   tuned for, standing in for the scripted baseline, which doesn't explore. Each day it explores,
 *   makes camp once it knows a place to, explores again, and fetches wood and water. Plain sim
 *   calls, no harness.
 *
 * The harness shows a player the run at the start of each day (its first decision), so a baseline's
 * day is the first morning the session is open, or, when the random player drew the map the moment
 * it opened, the day it drew it. The explorer is checked after every action.
 *
 * Deterministic: each run's weather and luck come from its character id, and the random baseline's
 * choices from its seed, so the same seeds measure the same days.
 */

import { playRun, type Player } from './runner';
import { scriptedPlayer } from './players/scripted';
import { randomPlayer } from './players/random';
import { ruleFeatures } from '../artificer/features';
import { MAP_LEARNING, mapUnlockNeeds, mapProgress, type MapProgress } from '../artificer/map-learning';
import { createRegion1, runAction, endDay, blockedReason, parseItem, ACTIONS, DAY_HOURS, type QueueItem, type Region1State } from '../artificer/region1';
import { FULL_WORLD } from '../artificer/world';
import { SUGGESTED_PACK } from '../artificer/kit';
import type { Ring } from '../artificer/exploration';

/** The game's default rules, with the map to learn: what a new game plays. */
export const MAP_RULES = ruleFeatures({ [MAP_LEARNING]: true });

/**
 * Days a measured run plays at most: well past the target, so a slow unlock still shows. The harness
 * wants a run resolved by then; with `hunting-gear` (#1821) one random run (map-3) lives to day 16,
 * so the window is 20 (the unlock days, the first morning the session opens, don't depend on it).
 */
export const MEASURE_DAYS = 20;

/** The seeds the measure uses (character ids; the random baseline's seed is the index + 1). */
export const MEASURE_SEEDS: readonly string[] = Array.from({ length: 12 }, (_, i) => `map-${i + 1}`);

/** Can the map be drawn now (open, and not drawn already)? */
const unlocked = (s: Region1State): boolean => !s.mapLearned && mapUnlockNeeds(s).length === 0;

/** What a measured run saw: its unlock day (null if none), and where the unlock stood each day (index 0 is day 1). */
export interface Measured { day: number | null; days: MapProgress[] }

/** Note where a day stands: its progress, and the day if it's the first that opens (or a map drawn since the last look). */
function note(m: Measured, s: Region1State, last?: number): void {
  m.days[s.day - 1] = mapProgress(s);
  if (m.day !== null) return;
  if (unlocked(s)) m.day = s.day;
  else if (s.mapLearned && last !== undefined) m.day = last;
}

/** A harness player's unlock: looked at on each day's first decision. */
export async function baselineUnlock(player: Player, characterId: string): Promise<Measured> {
  const m: Measured = { day: null, days: [] };
  let last: number | undefined;
  const watched: Player = {
    ...player,
    async decide(message, s) {
      if (last !== s.day) { note(m, s, last); last = s.day; }
      return player.decide(message, s);
    },
  };
  // Encounters off: an encounter's choice is its own question, and the land is what's measured here.
  await playRun(watched, { characterId, features: MAP_RULES, encounters: false, maxDays: MEASURE_DAYS });
  return m;
}

export const scriptedUnlock = (characterId: string): Promise<Measured> => baselineUnlock(scriptedPlayer(), characterId);
export const randomUnlock = (characterId: string, seed: number): Promise<Measured> => baselineUnlock(randomPlayer({ mode: 'legal', seed }), characterId);

/** The explorer's first walk out each day, by day: home ground, then further, home again, further, the far hills. */
const EXPLORE_RINGS: readonly Ring[] = [1, 2, 1, 2, 3];

/** The first place to camp the Warden knows and isn't camped at, or null. */
function campSpot(s: Region1State): string | null {
  const g = ACTIONS.camp.options?.(s, {}).find(o => o.key === 'spot');
  return g?.choices.find(c => !c.blocked)?.value ?? null;
}

/** Do one thing if it can be done now, else nothing. */
function tryDo(s: Region1State, item: QueueItem): Region1State {
  if (s.outcome || s.pending || s.hoursToday >= DAY_HOURS) return s;
  const { id, ring, opts } = parseItem(item);
  return blockedReason(s, id, ring, opts) === null ? runAction(s, item) : s;
}

/**
 * The explorer's unlock (see the top): explore, make camp once (at the first place it knows),
 * explore again, wood, water and forage; then the night. One action at a time, as a new Warden
 * plays before planning opens. Daylight, weather and luck are the run's own.
 */
export function explorerUnlock(characterId: string): Measured {
  const m: Measured = { day: null, days: [] };
  let s = createRegion1({ world: { ...FULL_WORLD, encounters: false, features: { ...MAP_RULES } } }, undefined, { id: characterId, pack: [...SUGGESTED_PACK] });
  let camped = false;
  for (let i = 0; i < MEASURE_DAYS && !s.outcome; i++) {
    const ring = EXPLORE_RINGS[i % EXPLORE_RINGS.length];
    s = tryDo(s, ring === 1 ? 'explore' : `explore@${ring}`);
    note(m, s);
    const spot = camped ? null : campSpot(s);
    if (spot) { s = tryDo(s, { q: 'camp', opts: { spot } }); camped = s.campSpot !== undefined; note(m, s); }
    for (const item of ['explore', 'wood', 'water', 'gather'] as const) { s = tryDo(s, item); note(m, s); }
    if (s.outcome || s.pending) break;
    s = endDay(s);
    note(m, s);
  }
  return m;
}

/** Median, min and max of the days that unlocked, and how many did. */
export function summarise(days: readonly (number | null)[]): { unlocked: number; of: number; median: number | null; min: number | null; max: number | null } {
  const ok = days.filter((d): d is number => d !== null).sort((a, b) => a - b);
  const n = ok.length;
  const median = n === 0 ? null : n % 2 ? ok[(n - 1) / 2] : (ok[n / 2 - 1] + ok[n / 2]) / 2;
  return { unlocked: n, of: days.length, median, min: n ? ok[0] : null, max: n ? ok[n - 1] : null };
}
