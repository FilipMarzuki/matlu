/**
 * Keeping a heading (#1868, switch `compass-heading`): heading out in one of the eight directions
 * (#1839, directed-explore.ts) needs something to tell north by.
 *
 * The owner: "Oh maybe having the compass or building one unlocks exploration in cardinal
 * directions", and then: "some water a floating needle of some kind. Should be some DIY option",
 * and "include the shadow stick too". So there are three ways to keep a heading, best first:
 *
 * 1. **The map and compass** from the pack (kit.ts `map-compass`): open from day 1, and it never drifts.
 * 2. **A needle compass** (*Make a needle compass*, half an hour): the scout-manual trick. A steel
 *    needle stroked many times one way on wool becomes weakly magnetised, and floated on still water
 *    it swings round to point north–south. The needle is the sewing kit's; failing that, the hook
 *    from the hook and line (hunting-gear.ts `HOOK_LINE`), a little less well. Wool is the wool
 *    underlayer or the hat and mittens, else your hair; still water the kåsa, else a calm pool. Only
 *    the needle (or hook) is a hard need: no materials are used up. It's kept once made, but a
 *    needle's pull fades: after `NEEDLE_PULL_DAYS` it must be stroked again (the same craft).
 *    It's fiddly and only checked now and then, so a trip with it can drift one direction off.
 * 3. **The shadow stick** (*skuggpinne*): no materials at all. Mark the tip of a stick's shadow, wait,
 *    mark it again, and the line between the marks runs west–east. It needs the sun, so only on
 *    clear or broken-cloud days (`SUN_WEATHER`), and it costs `SHADOW_HOURS` more each time you head
 *    out. A rough line can drift a little too.
 *
 * Without any of these, Explore offers only Look around: the eight ways are blocked with what's
 * missing (`headingLock`).
 *
 * **Drift.** A drifted trip goes one direction off, never more: meant north, you end up heading
 * north-east (or north-west) and see that sector's squares. The draw is the run's own and comes from a
 * stream of its own, keyed by a string on the character's seed (`seedOf`): the day, the direction and
 * how many trips you've made with the needle. Nothing here touches the sim's shared streams, so with
 * the switch off nothing is drawn and the run is exactly #1839's. The chance falls with practice:
 * each trip with the needle compass counts (`trips`).
 *
 * Pure, except the two "on an already-cloned state" helpers at the bottom, which write the save's
 * one new field, `needleCompass`, only with the switch on.
 */

import { featureOn } from './features';
import { hasKit, hasAxeFishing } from './kit';
import { HOOK_LINE } from './hunting-gear';
import { seedOf, streamFor } from './rng';
import type { WeatherId } from './world';
import { DIRS, HEADING, directedOn, isHeading, wayOf, type Dir } from './directed-explore';
import type { Region1State, ActionOpts, OptionGroup } from './region1';

/** The rule switch (features.ts). */
export const COMPASS_HEADING = 'compass-heading';

/** Heading out needs a heading kept: only with heading out itself (`directed-explore`) on too. */
export const compassOn = (s: Pick<Region1State, 'config'>): boolean =>
  directedOn(s) && featureOn(s.config.world.features, COMPASS_HEADING);

/** What keeps the heading: the packed compass, a needle compass (needle or hook), or the sun. */
export type Keeper = 'compass' | 'needle' | 'hook' | 'sun';
/** What a needle compass was made from. */
export type NeedleTool = 'needle' | 'hook';
/**
 * The needle compass, as saved (`Region1State.needleCompass`): the day it was last stroked, what it
 * was made from, and how many trips you've headed out with it (absent: none), which is the practice
 * that makes it drift less.
 */
export interface NeedleCompass { made: number; tool: NeedleTool; trips?: number }

/** Making (or refreshing) the needle compass: about half an hour. */
export const NEEDLE_HOURS = 0.5;
/** Days a stroked needle holds its pull: made on day d, it works through day d + 6. */
export const NEEDLE_PULL_DAYS = 7;
/** The shadow stick's time, on each trip out: two marks, a while apart. */
export const SHADOW_HOURS = 0.5;
/**
 * Days the sun shows: clear, and windy, the sim's broken-cloud day (thermal.ts `SKY_CHILL` gives it
 * half a clear sky's chill: the cloud comes and goes). Overcast, fog, rain, snow and storm hide it.
 */
export const SUN_WEATHER: readonly WeatherId[] = ['clear', 'wind'];
/**
 * A trip's chance of drifting one direction off, before practice: the needle a little, the hook
 * (thicker and shorter, a weaker magnet that floats less freely) more, the shadow line a little.
 * The packed compass never drifts.
 */
export const NEEDLE_DRIFT = 0.2, HOOK_DRIFT = 0.3, SUN_DRIFT = 0.1;
/** Practice: the chance is divided by 1 + trips / `DRIFT_PRACTICE`, so it halves after 4 trips with it. */
export const DRIFT_PRACTICE = 4;

type Run = Pick<Region1State, 'config' | 'day' | 'weatherToday' | 'tools' | 'character'> & Partial<Pick<Region1State, 'kit' | 'needleCompass'>>;

/** Does a needle compass still hold its pull today? */
export const pullHolds = (n: NeedleCompass, day: number): boolean => day - n.made < NEEDLE_PULL_DAYS;

/** Is the sun out enough for a shadow stick? */
export const sunShows = (w: WeatherId): boolean => SUN_WEATHER.includes(w);

/**
 * What you'd magnetise: the sewing kit's needle, else a hook (from a hook and line, or the fishing
 * kit's tin, #1870, with its switch on), else nothing.
 */
export function needleSource(s: Pick<Run, 'tools' | 'kit' | 'config'>): NeedleTool | null {
  if (hasKit(s, 'sewing-kit')) return 'needle';
  return s.tools.some(t => t.item === HOOK_LINE) || hasAxeFishing(s, 'fishing-kit') ? 'hook' : null;
}

/**
 * What keeps your heading today, best first: the packed compass, a needle compass with its pull, the
 * sun on a clear or broken-cloud day. Null when nothing does. (With the switch off, the question isn't
 * asked: see `headingLock`.)
 */
export function keeperOf(s: Run): Keeper | null {
  if (hasKit(s, 'map-compass')) return 'compass';
  if (s.needleCompass && pullHolds(s.needleCompass, s.day)) return s.needleCompass.tool;
  return sunShows(s.weatherToday) ? 'sun' : null;
}

// The words, in English: the sim's own (i18n/{en,sv}/explore.ts read them back).
const NEEDLE_WORD: Readonly<Record<NeedleTool, string>> = { needle: 'the needle from your sewing kit', hook: 'the hook from your hook and line' };
export const HEADING_TEXT = {
  canMake: 'you need something to keep a heading: a compass, or a needle you can magnetise — you have {w} (Make a needle compass); on a clear day the sun can do',
  nothing: 'you need something to keep a heading: a compass, or a needle you can magnetise — you have neither, and no needle or fish hook; on a clear day the sun can do',
  stale: 'your needle compass has lost its pull — stroke it on wool again (Make a needle compass); on a clear day the sun can do',
  needNeedle: 'needs a needle (a sewing kit) or the hook from a hook and line',
  fresh: 'your needle compass still holds its pull',
  packed: 'your map and compass keep a heading already',
} as const;

/**
 * Why heading out is blocked today (#1868): what's missing, and what you have that would do. Null
 * when something keeps your heading, or with the switch off (heading out as in #1839).
 */
export function headingLock(s: Run): string | null {
  if (!compassOn(s) || keeperOf(s)) return null;
  if (s.needleCompass) return HEADING_TEXT.stale;
  const src = needleSource(s);
  return src ? HEADING_TEXT.canMake.replace('{w}', NEEDLE_WORD[src]) : HEADING_TEXT.nothing;
}

/** Explore's way choices with the eight directions blocked when nothing keeps a heading (#1868). */
export function withHeadingLock(s: Run, groups: OptionGroup[]): OptionGroup[] {
  const lock = headingLock(s);
  if (!lock) return groups;
  return groups.map(g => (g.key !== 'way' ? g : { ...g, choices: g.choices.map(c => ((DIRS as readonly string[]).includes(c.value) ? { ...c, blocked: lock } : c)) }));
}

/** Explore's own gate for a way (#1868): heading out needs a heading kept. */
export const wayLock = (s: Run & Partial<Pick<Region1State, 'afield' | 'campSpot'>>, opts: ActionOpts): string | null =>
  (isHeading(wayOf(s, opts)) ? headingLock(s) : null);

/** The shadow stick's time on a trip out (#1868): only heading out by the sun. */
export const headingExtraHours = (s: Run & Partial<Pick<Region1State, 'afield' | 'campSpot'>>, opts: ActionOpts): number =>
  (compassOn(s) && isHeading(wayOf(s, opts)) && keeperOf(s) === 'sun' ? SHADOW_HOURS : 0);

// ── The craft ───────────────────────────────────────────────────────────────

/** Whether Make a needle compass is part of this game at all: the switch on, and no real compass packed. */
export const needleLock = (s: Run): string | null =>
  (!compassOn(s) ? "needlecompass isn't part of this game's rules" : hasKit(s, 'map-compass') ? HEADING_TEXT.packed : null);

/** Why Make a needle compass can't be done now: nothing to magnetise, or one that still holds its pull. */
export function needleGate(s: Run): string | null {
  if (!needleSource(s)) return HEADING_TEXT.needNeedle;
  return s.needleCompass && pullHolds(s.needleCompass, s.day) ? HEADING_TEXT.fresh : null;
}

const WOOL_WORD = { underlayer: 'your wool underlayer', mittens: 'your wool mittens', hair: 'your hair' } as const;
const WATER_WORD = { kasa: 'your kåsa', pool: 'a still pool' } as const;

/**
 * Make (or refresh) the needle compass (on an already-cloned state, gate passed): stroke the needle
 * on wool, float it in still water. Nothing is used up; practice is kept. Returns the journal's line.
 */
export function makeNeedleCompass(s: Region1State): string {
  const tool = needleSource(s)!;
  const wool = hasKit(s, 'wool-underlayer') ? WOOL_WORD.underlayer : hasKit(s, 'hat-mittens') ? WOOL_WORD.mittens : WOOL_WORD.hair;
  const water = hasKit(s, 'kasa') ? WATER_WORD.kasa : WATER_WORD.pool;
  const had = s.needleCompass;
  s.needleCompass = { made: s.day, tool, ...(had?.trips ? { trips: had.trips } : {}) };
  return had
    ? `Stroked ${NEEDLE_WORD[tool]} on ${wool} again and floated it in ${water}: it has its pull back.`
    : `Stroked ${NEEDLE_WORD[tool]} on ${wool}, one way, forty times, and floated it on a chip of birch bark in ${water}: it swung round to point north. You have a needle compass.`;
}

// ── Heading out ─────────────────────────────────────────────────────────────

/** A trip's chance of drifting one direction off (#1868): none with the real compass, falling with practice for a needle. */
export function driftChance(k: Keeper, trips = 0): number {
  if (k === 'compass') return 0;
  if (k === 'sun') return SUN_DRIFT;
  return (k === 'hook' ? HOOK_DRIFT : NEEDLE_DRIFT) / (1 + trips / DRIFT_PRACTICE);
}

/**
 * The stream a trip's drift is drawn from: its own, keyed by a string on the character's seed (the day,
 * the heading meant, and the trips made with the needle so far), so the same trip always drifts the same.
 */
const driftStream = (s: Run, dir: Dir): (() => number) =>
  streamFor(seedOf(s.character.id), s.day, `heading:${dir}:${s.needleCompass?.trips ?? 0}`);

/**
 * Where a trip meant `dir` really heads (pure): `dir`, or one direction either side of it when the
 * needle (or the shadow line) drifts. Never more than one off. With the switch off, or the real
 * compass, nothing is drawn.
 */
export function keptHeading(s: Run, dir: Dir): { dir: Dir; keeper: Keeper | null } {
  const keeper = compassOn(s) ? keeperOf(s) : null;
  if (!keeper || keeper === 'compass') return { dir, keeper };
  const rand = driftStream(s, dir);
  if (rand() >= driftChance(keeper, s.needleCompass?.trips ?? 0)) return { dir, keeper };
  const side = rand() < 0.5 ? -1 : 1;
  return { dir: DIRS[(DIRS.indexOf(dir) + side + 8) % 8], keeper };
}

/**
 * Set out on a heading (on an already-cloned state, the gate passed): where the trip really goes, and
 * the journal's lines that come before heading out's own (the shadow stick's marks, a drift). A trip
 * with the needle compass counts as practice.
 */
export function steerHeading(s: Region1State, dir: Dir): { dir: Dir; lines: string[] } {
  if (!compassOn(s)) return { dir, lines: [] };
  const k = keptHeading(s, dir);
  const lines: string[] = [];
  if (k.keeper === 'sun') lines.push(`Marked the tip of a stick's shadow twice, a while apart, to find your bearings: about ${SHADOW_HOURS} hours more.`);
  if (k.dir !== dir) {
    lines.push(k.keeper === 'sun'
      ? `The shadow line was rough: you meant to head ${HEADING[dir]}, and ended up heading ${HEADING[k.dir]}.`
      : `The needle wandered as you went: you meant to head ${HEADING[dir]}, and ended up heading ${HEADING[k.dir]}.`);
  }
  if ((k.keeper === 'needle' || k.keeper === 'hook') && s.needleCompass) s.needleCompass = { ...s.needleCompass, trips: (s.needleCompass.trips ?? 0) + 1 };
  return { dir: k.dir, lines };
}

// ── What the AI and the API read ────────────────────────────────────────────

/** One line on what keeps the Warden's heading today, and what would (#1868). Null with the switch off. */
export function headingLine(s: Run): string | null {
  if (!compassOn(s)) return null;
  const k = keeperOf(s);
  const has = k === 'compass' ? 'your map and compass: no drift'
    : k === 'needle' || k === 'hook' ? `your needle compass (made from ${NEEDLE_WORD[k]}), its pull good for ${NEEDLE_PULL_DAYS - (s.day - s.needleCompass!.made)} more day(s); a ${Math.round(driftChance(k, s.needleCompass!.trips ?? 0) * 100)}% chance a trip drifts one direction off, less with practice`
      : k === 'sun' ? `the sun today, with a shadow stick: +${SHADOW_HOURS}h each time you head out, and a ${Math.round(SUN_DRIFT * 100)}% chance a trip drifts one direction off`
        : 'nothing';
  const how = `Heading out (n … nw) needs something to keep a heading: the map and compass from the pack (never drifts); a needle compass ("needlecompass", ${NEEDLE_HOURS}h, no materials: a needle from the sewing kit, or the hook from a hook and line, a little worse; stroked on wool, or your hair; floated in the kåsa, or a still pool), whose pull lasts ${NEEDLE_PULL_DAYS} days and is refreshed by the same craft; or, on a clear or windy broken-cloud day, the sun and a shadow stick.`;
  const lock = headingLock(s);
  return `HEADING: ${how} You have: ${has}.${lock ? ` Blocked now: ${lock}.` : ''}`;
}

// ── The save ────────────────────────────────────────────────────────────────

const whole = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min;

/** A saved `needleCompass` that reads right: a day, a tool, and (if any) a count of trips. */
export function validNeedleCompass(x: unknown): x is NeedleCompass {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  return whole(o.made, 1) && (o.tool === 'needle' || o.tool === 'hook') && (o.trips === undefined || whole(o.trips, 0));
}
