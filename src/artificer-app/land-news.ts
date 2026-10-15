/**
 * What's new on the land (#1730): after an Explore (or a scout, look-out or survey), the ring it
 * went to opens on the LAND tab, and the places and knowledge chips that are new since the viewer
 * last looked carry a "new" mark.
 *
 * Nothing here is in the sim or the save: "new" is the difference between what the run knows now
 * and a snapshot of what it knew when the viewer last saw the LAND tab (`LandSeen`), kept per viewer
 * in this browser like the open tab. Storage can be missing or refuse, so every touch is wrapped:
 * without it the snapshot lives until the page is closed.
 *
 * The trips are told apart by their journal lines (the sim's English, which the log keeps), since a
 * log entry doesn't carry its action: `tripRing` reads the ring a land trip went to off its line.
 */

import { RINGS, RING_NAME, domainsOf, level, type Ring } from '../artificer/exploration';
import { knownPlaces } from '../artificer/descriptive-map';
import { ringOfHours } from '../artificer/world/reach';
import type { LogEntry, Region1State } from '../artificer/region1';

/** What the viewer has seen of the land: each chip's level (`"ring:domain"`), and the places (`placeKey`). */
export interface LandSeen { levels: Record<string, number>; places: string[] }

/** What's new since then: chips that went up, places that are new, and the rings they're in. */
export interface LandNews { chips: ReadonlySet<string>; places: ReadonlySet<string>; rings: readonly Ring[] }

export const NO_NEWS: LandNews = { chips: new Set(), places: new Set(), rings: [] };

type Run = Parameters<typeof knownPlaces>[0];

/** A place by kind and ring (and whether it's only on the skyline): seeing it nearer, or reaching it, makes it new. */
export const placeKey = (p: ReturnType<typeof knownPlaces>[number]): string => `${p.kind}@${ringOfHours(p.hours) ?? 3}${p.horizon ? '~' : ''}`;
export const chipKey = (r: Ring, d: string): string => `${r}:${d}`;

/** What the run knows of the land now, as a snapshot. */
export function landSeen(s: Run): LandSeen {
  const levels: Record<string, number> = {};
  for (const r of RINGS) for (const d of domainsOf(r)) levels[chipKey(r, d)] = level(s.explore, r, d);
  return { levels, places: knownPlaces(s).map(placeKey) };
}

/** What's new now against a snapshot (nothing against none: a viewer's first look sets the baseline). */
export function landNews(s: Run, seen: LandSeen | null): LandNews {
  if (!seen) return NO_NEWS;
  const chips = new Set<string>(), places = new Set<string>(), rings = new Set<Ring>();
  for (const r of RINGS) for (const d of domainsOf(r)) {
    if (level(s.explore, r, d) > (seen.levels[chipKey(r, d)] ?? 0)) { chips.add(chipKey(r, d)); rings.add(r); }
  }
  const had = new Set(seen.places);
  for (const p of knownPlaces(s)) {
    const k = placeKey(p);
    if (!had.has(k)) { places.add(k); rings.add(ringOfHours(p.hours) ?? 3); }
  }
  return { chips, places, rings: RINGS.filter(r => rings.has(r)) };
}

/** Both at once: what a viewer still hasn't seen from an earlier look, and what's come since. */
export const mergeNews = (a: LandNews, b: LandNews): LandNews => ({
  chips: new Set([...a.chips, ...b.chips]), places: new Set([...a.places, ...b.places]), rings: RINGS.filter(r => a.rings.includes(r) || b.rings.includes(r)),
});

// ── Land trips, by their journal lines (region1.ts ACTIONS: scout, survey, lookout, explore) ──

const RING_BY_NAME: Readonly<Record<string, Ring>> = Object.fromEntries(RINGS.map(r => [RING_NAME[r].toLowerCase(), r]));
const ringIn = (where: string | undefined): Ring => (where ? RING_BY_NAME[where] ?? 1 : 1);

const TRIP_LINES: readonly [RegExp, (m: RegExpMatchArray) => Ring][] = [
  [/^Scouted the near ground — /, () => 1],
  [/^Pushed out to the far ring — /, () => 2],
  [/^Reached the distant hills — /, () => 3],
  [/^Walked out and looked around — /, () => 1],
  [/^Walked out to the far ring and looked around — /, () => 2],
  [/^Walked out as far as the distant hills — /, () => 3],
  [/^Walked the ground(?: in the (\w+) ring)? again and looked closer/, m => ringIn(m[1])],
  [/^Surveyed carefully(?: in the (\w+) ring)? — /, m => ringIn(m[1])],
  [/^Climbed high(?: in the (\w+) ring)? and looked out/, m => ringIn(m[1])],
];

/** The ring a land trip went to, read off its journal line; null for any other line. */
export function tripRing(text: string): Ring | null {
  for (const [re, ring] of TRIP_LINES) { const m = text.match(re); if (m) return ring(m); }
  return null;
}

/**
 * The rings to open after the game moved from `before` to `after` (a trip, or a played-out day):
 * each ring a land trip went to in the new journal lines, if the land there now shows something new.
 * A trip that added nothing opens nothing; a new run (another Warden) opens nothing.
 */
export function ringsToOpen(before: Run & Pick<Region1State, 'log'>, after: Run & Pick<Region1State, 'log'>): Ring[] {
  if (before.character.id !== after.character.id || after.log.length <= before.log.length) return [];
  const went = new Set(after.log.slice(before.log.length).map((l: LogEntry) => tripRing(l.text)).filter((r): r is Ring => r !== null));
  if (!went.size) return [];
  const news = landNews(after, landSeen(before));
  return news.rings.filter(r => went.has(r));
}

// ── The viewer's snapshot, in this browser ─────────────────────────────────

export const LAND_SEEN_KEY = 'artificer.landSeen';
export type SeenStore = Pick<Storage, 'getItem' | 'setItem'>;
const storage = (): SeenStore | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

/** The snapshot, kept for one Warden at a time (a new run starts a new baseline). */
let kept: { id: string; seen: LandSeen } | null | undefined;

export function storedSeen(characterId: string, store: SeenStore | null = storage()): LandSeen | null {
  if (kept === undefined) {
    kept = null;
    try {
      const raw = JSON.parse(store?.getItem(LAND_SEEN_KEY) ?? 'null') as { id?: unknown; seen?: { levels?: unknown; places?: unknown } } | null;
      if (raw && typeof raw.id === 'string' && raw.seen && typeof raw.seen.levels === 'object' && Array.isArray(raw.seen.places)) kept = raw as { id: string; seen: LandSeen };
    } catch { /* junk or no storage */ }
  }
  return kept?.id === characterId ? kept.seen : null;
}

export function storeSeen(characterId: string, seen: LandSeen, store: SeenStore | null = storage()): void {
  kept = { id: characterId, seen };
  try { store?.setItem(LAND_SEEN_KEY, JSON.stringify(kept)); } catch { /* kept for this visit only */ }
}

/** Forget the snapshot (tests). */
export const resetSeen = (): void => { kept = undefined; };
