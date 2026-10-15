/**
 * Distance instead of "rings" (#1752, switch `distance-not-rings`, epic #1750).
 *
 * The owner: "let's move rings to a more conceptual level. let's not call them rings for the
 * player, rather distance. before camp it's a day's distance back and forth from where you are,
 * and then within a day of the camp and so on."
 *
 * So the sim keeps its three rings (exploration.ts: what you know of each, its supply, the travel
 * on top of a trip, `gather@2` in a queue), and the player, the AI and the API are told distances:
 *
 * - ring 1 → **close by**: there and back in part of a day, no walk to speak of on top;
 * - ring 2 → **half a day out**: half a day's walking there and back on top of the work (+3h);
 * - ring 3 → **a day out**: the best part of a day's walking there and back (+6h);
 * - past that (the rest of the Reach, `ringOfHours` null) → **overnight away**.
 *
 * **Where they're measured from.** The rings were always measured from camp in the sim: a trip's
 * travel is the same however far camp has moved, and the land you know goes with you. What did not
 * follow camp was the land in words (descriptive-map.ts, #1686), measured from where the run
 * started. With this switch on, distances are measured from where you are until you make camp, and
 * from camp after that (camp-sites.ts `whereYouAre`): the places you know of are told from there,
 * and filed under the distance they are from there, so they follow camp when it moves.
 *
 * What you can reach, and what a trip costs, don't change: the rings are untouched, so this is
 * wording and a reference point only. Nothing here draws on a random stream or is saved; the one
 * thing it changes in a run is the English the journal keeps, so a run from before the switch
 * (absent: false) keeps its rings on replay.
 *
 * The sim's English goes through `unring`: a short list of fixed phrases, longest first, that turn
 * the ring wording the sim has always written into distances. One list, so the journal, the
 * reasons and the AI's observation can't drift apart; the app reads the new English back through
 * the catalog's `.dist` templates (sim-words.ts), and draws its own ring words through `distanceT`.
 */

import { featureOn } from './features';
import type { Ring } from './exploration';
import type { Region1State } from './region1';

/** The rule switch (features.ts). */
export const DISTANCE_NOT_RINGS = 'distance-not-rings';

export const distanceOn = (s: Pick<Region1State, 'config'>): boolean => featureOn(s.config.world.features, DISTANCE_NOT_RINGS);

/** A ring's distance as a heading ("Half a day out"): what replaces "Near", "Far", "Distant". */
export const DISTANCE_NAME: Readonly<Record<Ring, string>> = { 1: 'Close by', 2: 'Half a day out', 3: 'A day out' };
/** A ring's distance mid-sentence, after a place or a deed ("Fetched 4 water half a day out."). */
export const DISTANCE_AT: Readonly<Record<Ring, string>> = { 1: 'close by', 2: 'half a day out', 3: 'a day out' };
/** A ring's land as a noun ("the land half a day out isn't known yet"): what replaces "the far ring". */
export const DISTANCE_THE: Readonly<Record<Ring, string>> = { 1: 'the land close by', 2: 'the land half a day out', 3: 'the land a day out' };
/** Past the furthest ring: more than a day's walk there and back. */
export const BEYOND_WORDS = 'overnight away';

/**
 * The sim's ring wording, and the distance it becomes, longest first so a longer phrase is replaced
 * whole before a shorter one inside it is. Each is a phrase the sim writes (region1.ts, pins.ts,
 * panic.ts, injuries.ts, techniques.ts, action-unlocks.ts, descriptive-map.ts, the AI's hints).
 */
const PHRASES: readonly (readonly [string, string])[] = [
  ['the walk out to the far rings costs more', 'the long walks out cost more'],
  ['Pushed out to the far ring', 'Pushed out half a day'],
  ['Walked out to the far ring and', 'Walked out half a day and'],
  ['every part of the near ring observed', 'all the land close by observed'],
  ['sweep a whole ring', 'sweep a whole stretch of land'],
  ['scout a whole ring', 'scout a whole stretch of land'],
  [' in the near ring', ' close by'],
  [' in the far ring', ' half a day out'],
  [' in the distant ring', ' a day out'],
  [' in this ring', ' there'],
  ['the near ring', DISTANCE_THE[1]],
  ['the far ring', DISTANCE_THE[2]],
  ['the distant ring', DISTANCE_THE[3]],
  ['this ring', 'that ground'],
];

/** The sim's English with its rings said as distances. A line with no ring in it comes back as it was. */
export function unring(text: string): string {
  if (!/ring/.test(text)) return text;
  let out = text;
  for (const [from, to] of PHRASES) if (out.includes(from)) out = out.split(from).join(to);
  return out;
}

/** The sim's English as this run says it: with distances when the switch is on, as it always was when off. */
export const ringWordsFor = (s: Pick<Region1State, 'config'>, text: string): string => (distanceOn(s) ? unring(text) : text);

/**
 * Whether the distances are measured from camp yet (#1752): once camp is made (#1732's `campSpot`),
 * or, without camp as an action, once a site is chosen. Before that, from where you are.
 */
export const measuredFromCamp = (s: Pick<Region1State, 'config' | 'campSpot' | 'site'>): boolean =>
  !!s.campSpot || (!featureOn(s.config.world.features, 'camp-as-action') && !!s.site);
