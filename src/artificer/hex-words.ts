/**
 * "Further off" — hexes in words (#1902, hex world step 9 of 17, #1873; plan:
 * docs/spikes/artificer-hex-world.md §6 Views, "The hex overview, in words").
 *
 * The hex map is words first: it's drawn only after map-learning (#1903). With `hex-world` on,
 * `describeLand` (descriptive-map.ts) gets one more block, "Further off": one line per hex you
 * know of other than the one you stand in, by direction and days away — "North, a day's walk: the
 * high fells (you've seen it)." The AI reads the same text (observe.ts), through the `describeLand`
 * loop it already has; `HEX_RULES` below is the one rules paragraph pushed alongside it, only with
 * the switch on, so `RULES` itself stays byte-identical.
 *
 * Hex-level knowledge is derived, never stored (plan §5): a hex is seen when one of its cells is
 * noted seen (`seenOut`, `seenWorld`) or in plain view of camp (today's rule, `IN_VIEW_HOURS`);
 * heard of when its `hexKey` is in `heardHexes`; on the skyline when it's tall (hex-summary.ts
 * `height.max`) and close enough to ground you've seen. Pure and deterministic: every value is a
 * function of the run's own saved knowledge and the seed.
 */

import { hasKit } from './kit';
import { landOfRun, toLocal, hexWorldOn, type Land } from './world/hex-window';
import { inReach } from './world/hex-knowledge';
import { reachOfRun, landOrigin, directionWords, directionIndex } from './descriptive-map';
import { REACH_W, IN_VIEW_HOURS } from './world/reach';
import { hexOfCell, hexKey, hexDistance, hexCentre, cellsOfHex, packCell, type Hex, type CellXY } from '../../worldmap/coords';
import { summariesAround, KNOWN_RADIUS } from '../../worldmap/hex-summary';
import { hexName, type HexNameLang } from '../../worldmap/hex-names';
import { seedOf } from './rng';
import { NUMBER_WORDS } from './claims';
import type { T, Key } from './i18n';
import type { Region1State } from './region1';

/** What this needs of a run: its switches, who it is (the seed), what it packed, where it stands, and what it knows. */
type Run = Pick<Region1State, 'config' | 'character'> &
  Partial<Pick<Region1State, 'kit' | 'campSpot' | 'afield' | 'seenOut' | 'seenWorld' | 'heardHexes'>>;

/** How a hex beyond your own is known. */
export type FurtherHow = 'seen' | 'heard' | 'skyline';

export interface FurtherOff {
  hex: Hex;
  /** The hex's name, in English (hex-names.ts `hexName`): `text` stays this language. */
  name: string;
  dir: { exact: boolean; i: number };
  /** Hex distance from the Warden's own hex: a day a hex (plan §6; out of scope: walking cost). */
  days: number;
  how: FurtherHow;
  /** As a scout would say it, in English: the AI's and the API's words. */
  text: string;
}

/** Fell height (hex-summary.ts `height.max`) at or past which a hex stands on the skyline, unvisited. */
const SKYLINE_HEIGHT = 0.76;
/** How close a skyline hex must lie to ground you've seen, in hexes. */
const SKYLINE_REACH = 2;

const HOW_WORDS: Readonly<Record<FurtherHow, string>> = { seen: "you've seen it", heard: 'heard of', skyline: 'on the skyline' };

const dayWords = (n: number): string => (n === 1 ? "a day's walk" : `${NUMBER_WORDS[n] ?? n} days`);

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Degrees clockwise from north, from one hex's centre to another's — the same convention as descriptive-map.ts's own `bearingOf` (screen y grows southwards). */
const hexBearing = (from: Hex, to: Hex): number => {
  const a = hexCentre(from), b = hexCentre(to);
  return (Math.atan2(b.x - a.x, a.y - b.y) * 180 / Math.PI + 360) % 360;
};

/** Is `c` known seen: a noted cell (`seenOut`/`seenWorld`), or in plain view of camp by today's rule (≤ `IN_VIEW_HOURS`)? */
function cellSeen(land: Land, seenOut: ReadonlySet<number>, seenWorld: ReadonlySet<number>, c: CellXY): boolean {
  if (inReach(c.cx, c.cy)) {
    if (seenOut.has(c.cy * REACH_W + c.cx)) return true;
  } else if (seenWorld.has(packCell(c))) {
    return true;
  }
  const local = toLocal(land, c.cx, c.cy);
  return local !== null && land.hours[local.y * land.w + local.x] <= IN_VIEW_HOURS;
}

/** Does `hex` hold any cell known seen? */
const hexSeen = (land: Land, seenOut: ReadonlySet<number>, seenWorld: ReadonlySet<number>, hex: Hex): boolean =>
  cellsOfHex(hex).some(c => cellSeen(land, seenOut, seenWorld, c));

/**
 * Every hex within `KNOWN_RADIUS` of (0,0) you know of, other than your own: one entry each, sorted
 * by days then direction then `hexKey`. Empty with the `hex-world` switch off.
 */
export function furtherOff(s: Run): FurtherOff[] {
  if (!hexWorldOn(s)) return [];
  const r = reachOfRun(s);
  const land = landOfRun(s);
  const origin = landOrigin({ config: s.config, campSpot: s.campSpot }, r);
  const standing: CellXY = s.afield ? { cx: s.afield.x, cy: s.afield.y } : { cx: origin.x, cy: origin.y };
  const ownHex = hexOfCell(standing);
  const ownKey = hexKey(ownHex);

  const seed = seedOf(s.character.id);
  const seenOut = new Set(s.seenOut ?? []);
  const seenWorld = new Set(s.seenWorld ?? []);
  const heard = new Set(s.heardHexes ?? []);
  const compass = hasKit(s, 'map-compass');

  const summaries = summariesAround(seed, KNOWN_RADIUS);
  const seenHexes: Hex[] = [];
  const seenKeys = new Set<string>();
  for (const sum of summaries) {
    if (hexSeen(land, seenOut, seenWorld, sum.hex)) { seenHexes.push(sum.hex); seenKeys.add(hexKey(sum.hex)); }
  }

  const out: FurtherOff[] = [];
  for (const sum of summaries) {
    const key = hexKey(sum.hex);
    if (key === ownKey) continue;
    const how: FurtherHow | null = seenKeys.has(key) ? 'seen'
      : heard.has(key) ? 'heard'
      : sum.height.max >= SKYLINE_HEIGHT && seenHexes.some(h => hexDistance(h, sum.hex) <= SKYLINE_REACH) ? 'skyline'
      : null;
    if (!how) continue;

    const days = hexDistance(ownHex, sum.hex);
    const bearing = hexBearing(ownHex, sum.hex);
    const dir = { exact: compass, i: directionIndex(bearing, compass) };
    const name = hexName(seed, sum.hex, 'en');
    const text = `${capitalize(directionWords(bearing, compass))}, ${dayWords(days)}: ${name} (${HOW_WORDS[how]}).`;
    out.push({ hex: sum.hex, name, dir, days, how, text });
  }

  return out.sort((a, b) => a.days - b.days || a.dir.i - b.dir.i || (hexKey(a.hex) < hexKey(b.hex) ? -1 : hexKey(a.hex) > hexKey(b.hex) ? 1 : 0));
}

/** The rules paragraph pushed into the AI's `observe()` only with `hex-world` on (`RULES` itself never changes). */
export const HEX_RULES = 'HEXES: the known land beyond camp is divided into hexes, each about a day across. "Further off" under THE LAND lists every hex you know of besides your own, by direction and days away (a day a hex, however the ground inside it walks): seen (you have looked into it), heard of (someone has told you of it, or you once stood there), or on the skyline (high ground spotted from afar but never visited).';

/** One `FurtherOff` entry in the viewer's language, from its parts: `dir`, `days`, `how`, and the hex's name in that language. */
export function furtherOffLine(f: FurtherOff, t: T, seed: number, lang: HexNameLang): string {
  const dir = f.dir.exact ? t(`map.dir.${f.dir.i}` as Key) : t(`map.vague.${f.dir.i}` as Key);
  const days = f.days === 1 ? t('map.further.days.one') : t('map.further.days.many', { n: f.days });
  const name = hexName(seed, f.hex, lang);
  return capitalize(t(`map.further.${f.how}` as Key, { dir, days, name }));
}
