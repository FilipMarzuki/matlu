/**
 * Hex names (#1898, plan: docs/spikes/artificer-hex-world.md §6 Views): what people call each hex,
 * in English and Swedish. Step 5 of the hex world (#1873), with hex-summary.ts.
 *
 * A hex is named for its land, with the definite article, as people name country they know by
 * sight: "the birch valley", "the high fells", "the marsh country"; in Swedish "björkdalen",
 * "fjällen", "myrlandet". The words view (#1902) and the journal (#1901) put these in sentences:
 * "South, a day's walk: the marsh country". Plain names are lower case for that reason; a caller
 * starting a sentence with one capitalises it.
 *
 * Two hexes of the known world (radius 4) can't share a name, or "the marsh country" would be two
 * places. So when several share a land, the one nearest the start hex keeps the plain name and
 * every other one gets a qualifier drawn from a fixed list: "the Elk marsh country", "Älgmyren".
 * The draws come from the world's own stream for names, `seedOf(\`${seed}|hexworld|names\`)`,
 * in `summariesAround` order, so the same seed always gives the same names however they're asked
 * for, and no other stream (the Reach's, the sim's) moves.
 *
 * Pure, given the seed. Nothing calls this yet: it's new code behind no switch.
 */

import { hexDistance, hexKey, type Hex } from './coords';
import { generator, seedOf } from './rng';
import { hexSummary, summariesAround, KNOWN_RADIUS, type HexLand } from './hex-summary';

export type HexNameLang = 'en' | 'sv';

const ORIGIN: Hex = { q: 0, r: 0 };

/**
 * One qualifier in both languages. `en` is a word put before the land ("the Elk marsh country");
 * `sv` is the first half of a compound ("Älg" + "myren" = "Älgmyren"), as Swedish place names are
 * made. Both are capitalised: a qualified name is a proper name.
 */
export interface Qualifier {
  en: string;
  sv: string;
}

/**
 * The words for each land.
 * - `en` / `sv`: the plain name, the land with its article.
 * - `enNoun`: what follows the qualifier in English ("the Elk fells", not "the Elk high fells").
 * - `svEnd`: the second half of the Swedish compound, a definite noun ("myren", the bog).
 *
 * No `svEnd` is the end of another (as "dalen" would be of "björkdalen"), so "Q1" + one end can
 * never spell "Q2" + another: with distinct qualifiers, every name comes out distinct.
 * hex-names.test.ts checks every land with every qualifier.
 */
const LAND_WORDS: Readonly<Record<HexLand, { en: string; enNoun: string; sv: string; svEnd: string }>> = {
  fells: { en: 'the high fells', enNoun: 'fells', sv: 'fjällen', svEnd: 'fjällen' },
  heights: { en: 'the stony heights', enNoun: 'heights', sv: 'höjderna', svEnd: 'höjden' },
  pinewood: { en: 'the pinewood', enNoun: 'pinewood', sv: 'tallskogen', svEnd: 'skogen' },
  'birch-valley': { en: 'the birch valley', enNoun: 'valley', sv: 'björkdalen', svEnd: 'dalen' },
  marsh: { en: 'the marsh country', enNoun: 'marsh country', sv: 'myrlandet', svEnd: 'myren' },
  lakes: { en: 'the lake country', enNoun: 'lakes', sv: 'sjölandet', svEnd: 'sjön' },
  meadows: { en: 'the meadows', enNoun: 'meadows', sv: 'ängarna', svEnd: 'ängen' },
  heath: { en: 'the heath', enNoun: 'heath', sv: 'heden', svEnd: 'heden' },
};

/**
 * The qualifiers: animals, trees, colours, metals, weather and the look of the land, as northern
 * place names have them. 66 of them. The known world has 61 hexes and the nearest of each land is
 * never qualified, so at most 60 hexes need one; each is used once a seed, so they never run out.
 * No tree that is also a land (birch, pine): "the Birch valley" would read as a mistake.
 *
 * Order matters: the draws index into this list, so reordering or inserting renames hexes.
 * Add new ones at the end.
 */
export const QUALIFIERS: readonly Qualifier[] = [
  // Animals and birds
  { en: 'Elk', sv: 'Älg' }, { en: 'Wolf', sv: 'Varg' }, { en: 'Bear', sv: 'Björn' }, { en: 'Fox', sv: 'Räv' },
  { en: 'Hare', sv: 'Har' }, { en: 'Lynx', sv: 'Lo' }, { en: 'Otter', sv: 'Utter' }, { en: 'Raven', sv: 'Korp' },
  { en: 'Crane', sv: 'Tran' }, { en: 'Eagle', sv: 'Örn' }, { en: 'Owl', sv: 'Uggle' }, { en: 'Swan', sv: 'Svan' },
  { en: 'Grouse', sv: 'Orr' }, { en: 'Beaver', sv: 'Bäver' }, { en: 'Wolverine', sv: 'Järv' }, { en: 'Reindeer', sv: 'Ren' },
  { en: 'Cuckoo', sv: 'Gök' }, { en: 'Hawk', sv: 'Hök' }, { en: 'Falcon', sv: 'Falk' }, { en: 'Stag', sv: 'Hjort' },
  { en: 'Salmon', sv: 'Lax' }, { en: 'Pike', sv: 'Gädd' }, { en: 'Snake', sv: 'Orm' }, { en: 'Heron', sv: 'Häger' },
  { en: 'Goose', sv: 'Gås' }, { en: 'Horse', sv: 'Häst' },
  // Trees and plants
  { en: 'Rowan', sv: 'Rönn' }, { en: 'Alder', sv: 'Al' }, { en: 'Aspen', sv: 'Asp' }, { en: 'Juniper', sv: 'En' },
  { en: 'Spruce', sv: 'Gran' }, { en: 'Oak', sv: 'Ek' }, { en: 'Ash', sv: 'Ask' }, { en: 'Hazel', sv: 'Hassel' },
  { en: 'Linden', sv: 'Lind' }, { en: 'Elm', sv: 'Alm' }, { en: 'Willow', sv: 'Sälg' }, { en: 'Cloudberry', sv: 'Hjortron' },
  // Colours and metals
  { en: 'Black', sv: 'Svart' }, { en: 'White', sv: 'Vit' }, { en: 'Grey', sv: 'Grå' }, { en: 'Red', sv: 'Röd' },
  { en: 'Blue', sv: 'Blå' }, { en: 'Green', sv: 'Grön' }, { en: 'Gold', sv: 'Guld' }, { en: 'Silver', sv: 'Silver' },
  { en: 'Iron', sv: 'Järn' }, { en: 'Copper', sv: 'Koppar' }, { en: 'Stone', sv: 'Sten' }, { en: 'Flint', sv: 'Flint' },
  // Weather and sky
  { en: 'Frost', sv: 'Frost' }, { en: 'Snow', sv: 'Snö' }, { en: 'Wind', sv: 'Vind' }, { en: 'Sun', sv: 'Sol' },
  { en: 'Moon', sv: 'Mån' }, { en: 'Star', sv: 'Stjärn' }, { en: 'Thunder', sv: 'Åsk' }, { en: 'Mist', sv: 'Dimm' },
  // The look of the land
  { en: 'Cold', sv: 'Kall' }, { en: 'Long', sv: 'Lång' }, { en: 'Deep', sv: 'Djup' }, { en: 'Old', sv: 'Gammel' },
  { en: 'Bright', sv: 'Ljus' }, { en: 'Dark', sv: 'Mörk' }, { en: 'Broad', sv: 'Bred' }, { en: 'Great', sv: 'Stor' },
];

/** A land's name: the plain one ("the marsh country", "myrlandet"), or with a qualifier ("the Elk marsh country", "Älgmyren"). */
export function landName(land: HexLand, lang: HexNameLang, qualifier?: Qualifier): string {
  const w = LAND_WORDS[land];
  if (!qualifier) return lang === 'en' ? w.en : w.sv;
  return lang === 'en' ? `the ${qualifier.en} ${w.enNoun}` : `${qualifier.sv}${w.svEnd}`;
}

/**
 * The name of hex `h`. Within the known world (`KNOWN_RADIUS` of the start hex) it's distinct from
 * every other hex's there. Beyond it a hex is only heard of, and goes by its land's plain name
 * ("the marsh country, far to the south").
 */
export function hexName(seed: number, h: Hex, lang: HexNameLang): string {
  if (hexDistance(h, ORIGIN) > KNOWN_RADIUS) return landName(hexSummary(seed, h).land, lang);
  const names = knownNames(seed).get(hexKey(h));
  // Every hex within the radius is in the table; this only satisfies the compiler.
  if (names === undefined) throw new Error(`hex-names: no name for hex ${hexKey(h)}`);
  return names[lang];
}

/** Nearer the start hex, or as near and first by hexKey. Plain `<` on the keys, not localeCompare, which can differ between machines. */
const nearer = (a: Hex, b: Hex): boolean => {
  const da = hexDistance(a, ORIGIN), db = hexDistance(b, ORIGIN);
  return da < db || (da === db && hexKey(a) < hexKey(b));
};

/** Every name in the known world, by hexKey, made at once: a name depends on which other hexes share its land. */
function namesAround(seed: number): Map<string, Record<HexNameLang, string>> {
  const summaries = summariesAround(seed, KNOWN_RADIUS);

  // The nearest hex of each land keeps the plain name.
  const plain = new Map<HexLand, Hex>();
  for (const s of summaries) {
    const held = plain.get(s.land);
    if (held === undefined || nearer(s.hex, held)) plain.set(s.land, s.hex);
  }

  const rnd = generator(seedOf(`${seed}|hexworld|names`));
  const unused = [...QUALIFIERS]; // each qualifier names one hex at most, so "the Elk …" is one place
  const out = new Map<string, Record<HexNameLang, string>>();
  for (const s of summaries) {
    // Drawn for every hex, needed or not, so each hex's draw sits at the same place in the stream
    // whatever the lands of the hexes before it (as provinces.ts draws its seat noise).
    const roll = rnd();
    const key = hexKey(s.hex);
    const nearest = plain.get(s.land);
    if (nearest !== undefined && hexKey(nearest) === key) {
      out.set(key, { en: landName(s.land, 'en'), sv: landName(s.land, 'sv') });
      continue;
    }
    const [q] = unused.splice(Math.floor(roll * unused.length), 1);
    // Can't happen while QUALIFIERS has at least 60 (hex-names.test.ts checks): fail loudly if it does.
    if (q === undefined) throw new Error('hex-names: ran out of qualifiers');
    out.set(key, { en: landName(s.land, 'en', q), sv: landName(s.land, 'sv', q) });
  }
  return out;
}

/**
 * The names of the last two seeds asked for. Making them means summarising 61 hexes (some 20 ms),
 * and a caller asks for one hex's name at a time, so they're kept rather than made again each call.
 * They're a pure function of the seed, so keeping them changes no answer, only how fast it comes.
 */
const MEMO_SEEDS = 2;
const memo = new Map<number, Map<string, Record<HexNameLang, string>>>();
function knownNames(seed: number): Map<string, Record<HexNameLang, string>> {
  let names = memo.get(seed);
  if (names === undefined) {
    names = namesAround(seed);
    // A Map keeps insertion order, so its first key is the oldest: drop that one.
    const oldest = memo.keys().next();
    if (memo.size >= MEMO_SEEDS && !oldest.done) memo.delete(oldest.value);
    memo.set(seed, names);
  }
  return names;
}
