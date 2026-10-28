/**
 * Finds as you explore (#1869, ui feature `explore-finds`). The owner: "I felt there was no feedback
 * when I explored. I'd like the resources or things of interest to pop up like a next log while
 * exploring: found a good source of firewood, found birch trees, found grassy meadow…"
 *
 * **What a find is.** The difference a land trip made to what the run knows, worked out on the page
 * from the state before the trip and the state after it (the timer already holds both, playback.ts):
 * - a knowledge chip that went up a level (exploration.ts, ring × domain): "A good source of smooth rocks";
 * - a new place (descriptive-map.ts `knownPlaces`, the same keys LAND's "new" marks use, land-news.ts):
 *   "Found birch trees", worded from the biome of the square it's described at;
 * - a new place to camp (camp-sites.ts `knownSpots`): "Found a good camp site by the water";
 * - heading out (#1839), the kinds of ground seen that way (`seenOut`, world/reach.ts biomes).
 * A trip that changed none of these says so: "Nothing new out that way."
 *
 * **How much, in words.** A chip's line is thin, some or rich, never a number: the same supply word
 * LAND shows (`supplyWord`: plenty rich, thinning some, scarce or bare thin), one step less sure
 * while the domain is only suspected. So a first look finds firewood, a closer one a good source of
 * it, and land worked down to scarce only a little. The kinds of land are worded from their biome.
 *
 * **Nothing here is in the sim or the save.** The day is resolved exactly as before; the finds only
 * read it. The journal's one line per trip is kept per viewer in this browser (like LAND's "new"
 * snapshot, land-news.ts), keyed by the trip's place in the run's log, which only grows. Storage can
 * be missing or refuse, so every touch is wrapped: without it the lines last until the page closes.
 *
 * Pure apart from that store (no DOM, no timers), so the words can be pinned in a unit test.
 */

import { domainsOf, level, supplyWord, type Domain, type Ring } from '../artificer/exploration';
import { knownPlaces, reachOfRun } from '../artificer/descriptive-map';
import { knownSpots } from '../artificer/camp-sites';
import { isHeading, wayOf, type Dir } from '../artificer/directed-explore';
import type { Biome } from '../artificer/world/reach';
import { landOfRun, toLocal } from '../artificer/world/hex-window';
import { unpackCell } from '../../worldmap/coords';
import { parseItem, type ActionId, type LogEntry, type QueueItem, type Region1State, type SiteId } from '../artificer/region1';
import { makeT, type Key, type T } from '../artificer/i18n';
import { placeKey } from './land-news';
import type { DayPlay } from './playback';

/** The ui switch (features.ts). */
export const FINDS_FEATURE = 'explore-finds';

/** How much a find holds, in words: thin, some or rich. */
export type Tier = 'thin' | 'some' | 'rich';
export const TIERS: readonly Tier[] = ['thin', 'some', 'rich'];

/** One thing a land trip turned up. Plain data, so the journal's store can keep it and say it in either language. */
export type Find =
  | { kind: 'chip'; ring: Ring; domain: Domain; tier: Tier }
  | { kind: 'land'; biome: Biome | 'skyline' }
  | { kind: 'spot'; site: SiteId };

/** The land trips: the actions that look at the land rather than work it. */
export const LAND_TRIPS: readonly ActionId[] = ['explore', 'scout', 'survey', 'lookout', 'track'];

/** A land trip as the journal names it: what it was and how far, or the way it headed. */
export interface Trip { act: ActionId; ring: Ring; head?: Dir; here?: boolean }

/** A land trip and what it turned up. */
export interface TripFinds { trip: Trip; finds: Find[] }

type Run = Region1State;

// ── What a trip turned up ───────────────────────────────────────────────────

/** The trip a queue item makes, read with the state it starts from; null for anything that isn't a land trip. */
export function tripOf(s: Run, item: QueueItem): Trip | null {
  const { id, ring, opts } = parseItem(item);
  if (!LAND_TRIPS.includes(id)) return null;
  if (id !== 'explore') return { act: id, ring };
  const way = wayOf(s, opts);
  if (isHeading(way)) return { act: id, ring, head: way };
  // Looking around away from camp (#1839) sees the land where you stand, not the rings.
  return way === 'here' && s.afield ? { act: id, ring, here: true } : { act: id, ring };
}

/** LAND's supply word as a tier: plenty is rich, thinning some, scarce or bare thin. */
const SUPPLY_TIER: Readonly<Record<ReturnType<typeof supplyWord>, number>> = { plenty: 2, thinning: 1, scarce: 0, bare: 0 };

/**
 * How much a ring holds of a domain, in words: LAND's supply word (what the sim's yields follow,
 * exploration.ts `supplyFactor`), one step less sure while the domain is only suspected. A way on
 * (routes) holds no supply: a hint of one until it's observed.
 */
export function tierOf(s: Run, ring: Ring, d: Domain): Tier {
  const lv = level(s.explore, ring, d);
  if (d === 'routes') return lv >= 2 ? 'some' : 'thin';
  return TIERS[Math.max(0, SUPPLY_TIER[supplyWord(s.explore.supply[ring][d])] - (lv < 2 ? 1 : 0))];
}

/** The biome a known place is described at: what its words come from. */
const biomeAt = (s: Run, at: { x: number; y: number }): Biome => { const r = reachOfRun(s); return r.cells[at.y * r.w + at.x].biome; };

/** Where the Warden stands, as a key: a trip that moves them re-measures every place from the new spot. */
const standing = (s: Run): string => `${s.afield ? `${s.afield.x},${s.afield.y}` : '-'}|${s.campSpot?.at ?? '-'}`;

/**
 * What changed between `before` and `after`: every chip that went up a level, every new place, every
 * new camp site and (heading out) every kind of ground seen that way that no place line already says.
 * In the order a scout would tell it: places nearest first, then the chips ring by ring, then the camp sites.
 */
export function findsBetween(before: Run, after: Run): Find[] {
  const out: Find[] = [];
  const said = new Set<string>();
  // New places, with the keys LAND's "new" marks use. A trip that moved you re-measures every place
  // from where you now stand, so only a kind of place you didn't know at all (or knew only on the skyline) is new.
  const had = knownPlaces(before);
  const hadKeys = new Set(had.map(placeKey));
  const moved = standing(before) !== standing(after);
  for (const p of knownPlaces(after)) {
    const fresh = moved ? !had.some(q => q.kind === p.kind && (!q.horizon || p.horizon)) : !hadKeys.has(placeKey(p));
    if (!fresh) continue;
    const biome: Biome | 'skyline' = p.horizon ? 'skyline' : biomeAt(after, p.at);
    if (said.has(biome)) continue;
    said.add(biome);
    out.push({ kind: 'land', biome });
  }
  // Heading out: each kind of ground seen that way, nearest first, unless a place already said it.
  // Past the Reach's edge with `hex-world` on (#1901), the new ground is `seenWorld`'s, on the land.
  const seenOut = new Set(before.seenOut ?? []);
  const seenWorld = new Set(before.seenWorld ?? []);
  const r = reachOfRun(after);
  const newReach = [...(after.seenOut ?? [])].filter(i => !seenOut.has(i)).map(i => ({ hours: r.hours[i], biome: r.cells[i].biome, key: i }));
  const newWorldIds = [...(after.seenWorld ?? [])].filter(i => !seenWorld.has(i));
  const land = newWorldIds.length ? landOfRun(after) : null;
  const newWorld = land ? newWorldIds.flatMap(n => {
    const c = unpackCell(n);
    const local = toLocal(land, c.cx, c.cy);
    if (!local) return [];
    const li = local.y * land.w + local.x;
    return [{ hours: land.hours[li], biome: land.cells[li].biome, key: n }];
  }) : [];
  for (const { biome } of [...newReach, ...newWorld].sort((a, b) => a.hours - b.hours || a.key - b.key)) {
    if (said.has(biome)) continue;
    said.add(biome);
    out.push({ kind: 'land', biome });
  }
  // The chips that went up a level.
  for (const ring of [1, 2, 3] as const) for (const d of domainsOf(ring)) {
    if (level(after.explore, ring, d) > level(before.explore, ring, d)) out.push({ kind: 'chip', ring, domain: d, tier: tierOf(after, ring, d) });
  }
  // New places to camp (camp-sites.ts): by kind, once each.
  const spots = new Set(knownSpots(before).map(sp => sp.id));
  const sites = new Set<SiteId>();
  for (const sp of knownSpots(after)) if (!spots.has(sp.id) && !sites.has(sp.kind)) { sites.add(sp.kind); out.push({ kind: 'spot', site: sp.kind }); }
  return out;
}

// ── In words ────────────────────────────────────────────────────────────────

/** One find as its own line, in the viewer's language. */
export function findLine(f: Find, t: T): string {
  if (f.kind === 'chip') return t(`find.${f.domain}.${f.tier}` as Key);
  if (f.kind === 'land') return t(`find.land.${f.biome}` as Key);
  return t(`find.spot.${f.site}` as Key);
}

/** One find as the journal's short list says it. */
export function findShort(f: Find, t: T): string {
  if (f.kind === 'chip') return t(`find.short.${f.domain}.${f.tier}` as Key);
  if (f.kind === 'land') return t(`find.short.land.${f.biome}` as Key);
  return t(`find.short.spot.${f.site}` as Key);
}

/** A trip's finds as the log's lines: one per find, or the one line that says there's nothing new. */
export const findLines = (finds: readonly Find[], t: T): string[] => (finds.length ? finds.map(f => findLine(f, t)) : [t('find.nothing')]);

/** The trip, as the journal's line starts: "Explored close by", "Headed north". */
export function tripName(trip: Trip, t: T): string {
  if (trip.head) return t('find.trip.head', { dir: t(`heading.${trip.head}` as Key) });
  if (trip.here) return t('find.trip.here');
  return t(`find.trip.${trip.act}` as Key, { where: t(`ring.at.${trip.ring}` as Key) });
}

/** The journal's one line for a trip: "Explored close by: birch trees, a clear stream, smooth rocks". */
export function tripSummary(tf: TripFinds, t: T): string {
  const trip = tripName(tf.trip, t);
  return tf.finds.length ? t('find.summary', { trip, finds: tf.finds.map(f => findShort(f, t)).join(', ') }) : t('find.summary.none', { trip });
}

// ── The day on the timer ────────────────────────────────────────────────────

/**
 * Each step of a play, with what it turned up if it was a land trip (null for anything else, and
 * for a land trip that was refused: too dark, fogged, no time). All null with the switch off.
 */
export function playFinds(p: DayPlay, on: boolean): (TripFinds | null)[] {
  return p.steps.map((st, i) => {
    if (!on) return null;
    const from = i > 0 ? p.steps[i - 1].sim : p.before.sim;
    const trip = tripOf(from, st.item);
    if (!trip || st.hours <= 0) return null;
    const lines = st.sim.log.slice(st.logFrom);
    if (!lines.length || lines.every(l => l.kind === 'skip')) return null;
    return { trip, finds: findsBetween(from, st.sim) };
  });
}

/** A line in the timer's log: one of the day's journal lines, or a find. */
export type TimerLine = { log: LogEntry } | { find: string };

/** How long one find waits after the one before it, in real milliseconds. */
export const FIND_MS = 650;

/** How many of a step's lines have shown `ms` after the step finished: the first at once, then one each `FIND_MS`. */
export const findsShown = (count: number, ms: number): number => Math.min(count, Math.max(0, Math.floor(ms / FIND_MS) + 1));

/**
 * The timer's log `done` steps into a play: each finished step's journal lines, then (a land trip)
 * its finds, as many as `shown(i)` says for step i, then the night's lines once it's come.
 */
export function timerLines(p: DayPlay, done: number, night: boolean, finds: readonly (TripFinds | null)[], shown: (i: number) => number, t: T): TimerLine[] {
  const out: TimerLine[] = [];
  p.steps.slice(0, done).forEach((st, i) => {
    for (const l of st.sim.log.slice(st.logFrom)) out.push({ log: l });
    const f = finds[i];
    if (f) for (const line of findLines(f.finds, t).slice(0, shown(i))) out.push({ find: line });
  });
  if (night && p.night) {
    const from = p.steps.length ? p.steps[p.steps.length - 1].sim.log.length : p.before.sim.log.length;
    for (const l of p.after.sim.log.slice(from)) out.push({ log: l });
  }
  return out;
}

/** How many find lines a step has on the timer (the nothing-new line counts as one). */
export const findCount = (f: TripFinds | null): number => (f ? Math.max(1, f.finds.length) : 0);

// ── The journal's line per trip, kept in this browser ───────────────────────

/** A trip's finds, at its place in the run's log: after line `at` (the trip's last line). */
export interface KeptTrip extends TripFinds { at: number }

export const TRIPS_KEY = 'artificer.tripFinds';
export type TripStore = Pick<Storage, 'getItem' | 'setItem'>;
const storage = (): TripStore | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

/** The trips kept, for one Warden at a time (a new run starts a new list), by their place in the log. */
let kept: { id: string; trips: Record<string, KeptTrip> } | null | undefined;

function load(store: TripStore | null): void {
  if (kept !== undefined) return;
  kept = null;
  try {
    const raw = JSON.parse(store?.getItem(TRIPS_KEY) ?? 'null') as { id?: unknown; trips?: unknown } | null;
    if (raw && typeof raw.id === 'string' && raw.trips && typeof raw.trips === 'object' && !Array.isArray(raw.trips)) kept = raw as { id: string; trips: Record<string, KeptTrip> };
  } catch { /* junk or no storage */ }
}

/** The trips this browser kept for this Warden, in log order. */
export function storedTrips(characterId: string, store: TripStore | null = storage()): KeptTrip[] {
  load(store);
  if (kept?.id !== characterId) return [];
  return Object.values(kept.trips).filter(k => Number.isInteger(k?.at) && Array.isArray(k.finds) && k.trip).sort((a, b) => a.at - b.at);
}

/** Keep a play's trips: each at its own line, so playing the same day again (a stop, #1815) writes over it. */
export function storeTrips(characterId: string, p: DayPlay, finds: readonly (TripFinds | null)[], store: TripStore | null = storage()): void {
  load(store);
  const trips = kept?.id === characterId ? { ...kept.trips } : {};
  p.steps.forEach((st, i) => {
    const f = finds[i];
    // A step that was going to write lines from here on, and won't now (a day stopped short): its old trip goes.
    for (const k of Object.keys(trips)) if (Number(k) >= st.logFrom && Number(k) < st.sim.log.length && !f) delete trips[k];
    if (f) trips[String(st.sim.log.length - 1)] = { ...f, at: st.sim.log.length - 1 };
  });
  kept = { id: characterId, trips };
  try { store?.setItem(TRIPS_KEY, JSON.stringify(kept)); } catch { /* kept for this visit only */ }
}

/** Forget the kept trips (tests). */
export const resetTrips = (): void => { kept = undefined; };

/**
 * The log with each kept trip's line after the trip's own last line, in the viewer's language. Only
 * where the log still has that line (a trip from a run since replaced is skipped). The line is
 * already said, so the journal shows it as it comes (sim-words.ts `simLine` reads no template off it).
 */
export function withTripLines(log: readonly LogEntry[], trips: readonly KeptTrip[], t: T): readonly LogEntry[] {
  const at = new Map(trips.filter(k => k.at >= 0 && k.at < log.length).map(k => [k.at, k]));
  if (!at.size) return log;
  return log.flatMap((l, i) => { const k = at.get(i); return k ? [l, { day: l.day, text: tripSummary(k, t), kind: 'action' as const }] : [l]; });
}

// ── The AI's observation ────────────────────────────────────────────────────

const EN = makeT('en');

/** Did these journal lines include a land trip? Read off the sim's English (land-news.ts `tripRing`, and #1839's lines). */
const LAND_TRIP_LINE = /^(Scouted the near ground|Pushed out|Reached the distant hills|Walked out|Walked the ground|Surveyed carefully|Climbed high|Tracked|Headed |Looked around where you stand)/;

/**
 * The AI's FOUND line (#1869): what the land trips since `before` turned up, as the page says it in
 * English; "nothing new" after a trip that turned up nothing; null when there was no land trip.
 */
export function foundLine(before: Run, after: Run): string | null {
  if (before.character.id !== after.character.id || after.log.length <= before.log.length) return null;
  if (!after.log.slice(before.log.length).some(l => LAND_TRIP_LINE.test(l.text))) return null;
  const finds = findsBetween(before, after);
  return `FOUND (what your trips out turned up): ${finds.length ? finds.map(f => findLine(f, EN)).join('; ') : 'nothing new'}.`;
}
