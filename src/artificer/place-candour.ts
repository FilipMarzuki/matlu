/**
 * Where someone is, read as a `Place` (culture-lore.ts, #1619): what nudges how openly they voice
 * their people's views. Two sources:
 *
 * - **a region of a told history** (#1598 regions, #1608 hardship, prosperity and unease):
 *   `placeOfRegion`. Its turning points are the region's own facts' (regional-facts.ts), so people
 *   speak bluntly exactly where they'd tell you "Times are hard", and carefully where they'd tell
 *   you "The lords are uneasy". Nothing in play reads it yet: the road's history joins the sim in
 *   knowledge slice F, and the road villages belong to the crafted north road (world/regions.ts),
 *   which has no generated state of its own.
 * - **a road village**, written by hand (`VILLAGE_PLACES`), with the road's season on top
 *   (`villagePlace`). This is what free questions on the road use, behind `candour-by-place`.
 *
 * Pure and deterministic: plain data in, plain data out.
 */

import type { Place } from './culture-lore';
import type { RegionHistory } from './world/history-format';
import { DEAR_BREAD, HARD_TIMES, HEAVY_DUES, LIGHT_DUES, POOR, UNSETTLED } from './world/regional-facts';

/** Harvests poor enough to make a place hard, whatever its prosperity says yet. */
const HARD_HARVESTS: readonly RegionHistory['harvest'][] = ['poor', 'failed'];

/**
 * A region as a place. `province` (its id this run, or its name) narrows it to one of its places:
 * a place on hard times is hard even in a region that gets by. A region getting by, with ordinary
 * dues and settled lords, is `{}`: ordinary times, no nudge.
 *
 * The lord is read from the dues, the one thing the history says about how the lords treat their
 * people: heavy dues make them `strict`, light ones `lax`. `feared` and `liked` are for places
 * written by hand.
 */
export function placeOfRegion(r: RegionHistory, province?: string): Place {
  const p = province ? r.provinces.find(x => x.id === province || x.name === province) : undefined;
  const hard = r.prosperity <= HARD_TIMES || r.price >= DEAR_BREAD || HARD_HARVESTS.includes(r.harvest) || (p !== undefined && p.wealth <= POOR);
  const lord = r.tax >= HEAVY_DUES ? 'strict' : r.tax <= LIGHT_DUES ? 'lax' : undefined;
  // Spread in only what's set, so a region getting by reads as `{}`, not a row of `undefined`s.
  return {
    ...(hard ? { hard: true } : {}),
    ...(lord ? { lord } : {}),
    ...((r.unsettled ?? 0) >= UNSETTLED ? { uneasy: true } : {}),
  };
}

/**
 * The road villages as places, by village id (road.ts ROUTE). Invented to fit what villages.ts
 * says of each, not taken from canon; the owner can change them here:
 * - **Hollowford** is hard-pressed: its high fields have gone dead to the corruption ("the plough
 *   rings on them, and nothing roots"), and it lives on what's left. People there say things straight.
 * - **Saltmere** is ordinary: a salt lake, Pandor wells and steppe trade, nothing pressing on it.
 * - **Kestrel Gate** is held strictly: nothing passes the Gate unpaid and uncounted, and its
 *   people are used to weighing what they say ("he weighs every word as if it had a toll").
 */
export const VILLAGE_PLACES: Readonly<Record<string, Place>> = {
  hollowford: { hard: true },
  saltmere: {},
  'kestrel-gate': { lord: 'strict' },
};

/**
 * Where someone on the road is: their village's place (none on the wagon) and the season. The
 * road's weather isn't simulated (every road day is clear), so it isn't read.
 */
export function villagePlace(village: string | null, season: string): Place {
  return { ...(village ? VILLAGE_PLACES[village] ?? {} : {}), season };
}
