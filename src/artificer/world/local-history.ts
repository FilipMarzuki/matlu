/**
 * There is always recent history (#1613): each road village's last LOCAL_YEARS of local politics
 * and events, told as facts for the knowledge model (knowledge.ts).
 *
 * Owner (2026-10-11): "There is always recent history. We need to create some structure where
 * recent history is filled with local politics and events." The told history (history.ts) keeps a
 * province's few most significant events, which tend to be old and lordly: a war, a succession.
 * A village also has its own small past, the kind its people actually talk about: who speaks for
 * it and how they came to, two families' quarrel over a boundary stone, a council decision, a
 * marriage, a fire, a wolf winter, a good year for the nets, a new mill, someone who left.
 *
 * ## The structure: slots, crafted first, generated to fill
 *
 * A village's local history is a fixed set of **slots** (LOCAL_SLOTS), each told at most once:
 * - **politics**: `leader` (who speaks for the village, and how they came to), `dispute` (two
 *   families at odds over land, water or a debt), `council` (something the village decided),
 *   `marriage` (two families joined), `scandal` (what a family would rather nobody knew);
 * - **events**: `trade` (a good or bad year for what it lives on), `mishap` (a fire, a flood, a
 *   hard winter, a sickness), `building` (a mill, a smoke-house), `comings` (someone who left or
 *   arrived), `death` (one that mattered).
 * `leader`, `dispute`, `trade` and `mishap` are always told, so every village, in every seed, has
 * politics and events within living memory; the others are told by chance (CHANCE).
 *
 * Villages are semi-generated (owner): "We craft part of it and generate part of these villages.
 * The generation fills in what we don't craft." So a slot written by hand (CRAFTED_LOCAL) is told
 * as written, and only the slots left empty are generated. Each slot draws from **its own random
 * stream** (`seed|local|<village>|<slot>`), so writing one slot by hand never rerolls the others.
 *
 * ## Drawn from what the engine knows
 *
 * The generation reads the told history (plain data, history-format.ts), never the engine: the
 * village's province (who holds it), and its country (the generated region it lies in, #1598 and
 * #1608): what it lives on and grew up around, how well off it is, its venture, its lords' dues
 * and levies, and its told regional events of the last LOCAL_YEARS (a hard winter, a famine, a
 * plague, a seized seat, people arriving). So a heavy-taxed village sends someone to plead with
 * the steward, a fishing village has its good year when the nets come up full, and the wolf winter
 * falls in the year the country's hard winter did. Names come from the village's own culture
 * (peoples.ts), avoiding the road's people and the lords' houses.
 *
 * Its randomness is its own (rng.ts `generator`, seeded from the history's seed), not the engine's
 * `World.rng` or `World.regionRng`, and it runs on a told history after the fact: the engine's log,
 * the golden hashes and HISTORY_VERSION are untouched, and a kept history tells the same villages.
 *
 * ## Truth, reach and sensitivity
 *
 * Every entry is within living memory, so its facts are `true` (truth by age, the same test as
 * remembered.ts `recall`). Sensitivity is how public it was **and** the teller's stake in it, not
 * one rule (owner, on #1592 Q4): a fire is open to all; a quarrel the whole village saw at the
 * moot is told openly by the neighbours and guarded by those in it; a family's own trouble is
 * guarded, a scandal private (`localSensitivity`). A party to it on the road (a hand-written
 * person, like Hedda) gets their own more guarded telling as a person-scope fact, which the
 * knowledge model answers from first. Something touching the ruling house (pleading with the
 * lord's steward) is one step more guarded for the whole village, as remembered.ts does for a
 * lord's house. Reach follows publicity: everyone knows a fire (depth 1), most a family's
 * trouble (2), only the best-placed, an elder, a scandal (3).
 *
 * Nothing in play reads these yet, like the rest of remembered.ts. Pure and deterministic.
 */

import type { Fact, Sensitivity } from '../knowledge';
import { generator, seedOf, shuffled } from '../rng';
import { TRAVELLERS, VILLAGES } from '../villages';
import { LIVING_MEMORY, type ProvinceHistory, type ReachHistory, type RegionHistory, type RegionLine } from './history-format';
import { REACH_CULTURES } from './peoples';
import type { AnchorId } from './provinces';
import type { GeneratedRegions } from './regions';
import { GENERATION } from './regional-facts';

/** How far back a village's local history reaches: a generation, what everyone still talks about. */
export const LOCAL_YEARS = GENERATION;

export type LocalSlot = 'leader' | 'dispute' | 'council' | 'marriage' | 'scandal' | 'trade' | 'mishap' | 'building' | 'comings' | 'death';

/** Every slot, in the order they're generated (the order doesn't change what any one slot draws). */
export const LOCAL_SLOTS: readonly LocalSlot[] = ['leader', 'dispute', 'council', 'marriage', 'scandal', 'trade', 'mishap', 'building', 'comings', 'death'];

/** The politics slots; the rest are events. */
export const POLITICS: ReadonlySet<LocalSlot> = new Set(['leader', 'dispute', 'council', 'marriage', 'scandal']);

/** Always told, so every village has politics and events; the others by chance (CHANCE). */
const ALWAYS: ReadonlySet<LocalSlot> = new Set(['leader', 'dispute', 'trade', 'mishap']);
const CHANCE: Readonly<Partial<Record<LocalSlot, number>>> = { council: 0.7, marriage: 0.6, scandal: 0.5, building: 0.6, comings: 0.7, death: 0.5 };

/**
 * How public a local happening was:
 * - `public`: the whole village saw it: a fire, a wedding, who was chosen to lead. Anyone tells it.
 * - `open`: a quarrel or a plea everyone heard about, but that someone is in: neighbours tell it
 *   openly, the people in it are guarded.
 * - `house`: a family's own trouble, known but spoken of quietly: guarded (private to the family).
 * - `family`: a scandal, kept within a family's walls: private (secret to the family).
 * `house` and `family` grade exactly as remembered.ts `sensitivityOf` grades a lord's house's affairs.
 */
export type LocalPublicity = 'public' | 'open' | 'house' | 'family';

/** [told by a neighbour, told by someone with a stake]. */
const SENSITIVITY: Readonly<Record<LocalPublicity, readonly [Sensitivity, Sensitivity]>> = {
  public: ['public', 'public'],
  open: ['public', 'guarded'],
  house: ['guarded', 'private'],
  family: ['private', 'secret'],
};

/** How guarded a local fact is: by how public it was, and whether the teller has a stake in it. */
export function localSensitivity(publicity: LocalPublicity, stake: boolean): Sensitivity {
  return SENSITIVITY[publicity][stake ? 1 : 0];
}

/** How many in the village know it: everyone (1) what was public or open, most (2) a family's trouble, the best-placed (3) a scandal. */
const DEPTH: Readonly<Record<LocalPublicity, 1 | 2 | 3>> = { public: 1, open: 1, house: 2, family: 3 };

/**
 * Whether a teller has a stake in a local happening: they're one of the people in it (a road
 * person, by id), or of a family in it. Today only the road's hand-written people are knowers,
 * so a generated family's stake has no one to apply to yet; it's here for when villages have
 * generated people of their own.
 */
export function stakeIn(e: { families: readonly string[]; people: readonly string[] }, teller: { id?: string; family?: string | null }): boolean {
  return (!!teller.id && e.people.includes(teller.id)) || (!!teller.family && e.families.includes(teller.family));
}

/** A hand-written entry: what happened, how many years before the present, and who's in it. */
export interface CraftedEntry {
  slot: LocalSlot;
  /** Years before the present (the Reach's present differs by seed, so crafted history is dated back from it). */
  ago: number;
  text: string;
  publicity: LocalPublicity;
  /** Road people in it (villages.ts ids): they get their own telling when their stake makes it more guarded. */
  people?: readonly string[];
  /** Village families in it (family names). */
  families?: readonly string[];
  /** It touches the house that holds the village. */
  lord?: boolean;
}

export type CraftedLocal = Readonly<Partial<Record<AnchorId, readonly CraftedEntry[]>>>;

/**
 * The road villages' hand-written local history. Each entry fills its slot in every seed; the
 * rest are generated. Written to agree with what the road's people already say (villages.ts):
 * Bodil owes Hedda three barrels and Hedda tells everyone; Gunnar was a Watermaster in the delta
 * for forty years; the ash came down the pass this winter; the toll-keeper drinks.
 */
export const CRAFTED_LOCAL: CraftedLocal = {
  hollowford: [
    { slot: 'leader', ago: 12, publicity: 'public', people: ['hf-maren'],
      text: 'When old Sune was drowned at the stepping stones in the spring flood, the ford-moot chose Maren to speak for Hollowford. She has not let anyone forget the stones since.' },
    { slot: 'dispute', ago: 3, publicity: 'open', people: ['hf-tobin'], families: ['Brekke'],
      text: 'Tobin and the Brekkes came to hard words at the ford-moot over hides he had bought from them cheap the week before the price rose. The moot let the sale stand.' },
  ],
  saltmere: [
    { slot: 'dispute', ago: 2, publicity: 'public', people: ['sm-hedda', 'cv-bodil'],
      text: 'Bodil the caravan master came away from Saltmere owing Hedda three barrels. Hedda has told the whole village, more than once.' },
    { slot: 'comings', ago: 6, publicity: 'public', people: ['sm-gunnar'],
      text: 'Gunnar came up from the southern delta, forty years its Watermaster, and settled by the mere.' },
  ],
  'kestrel-gate': [
    { slot: 'leader', ago: 15, publicity: 'public', people: ['kg-veit'],
      text: 'When the old gate-warden died, the gate-council gave Veit the chair. He has not missed a council since.' },
    { slot: 'mishap', ago: 0, publicity: 'public',
      text: 'Ash came down off the high pass on the west wind this winter and settled grey on everything. It does not brush off.' },
    { slot: 'scandal', ago: 4, publicity: 'house',
      text: 'The toll-keeper was found asleep at the open gate one night, drunk. The gate-council kept him on, and nobody says why.' },
  ],
};

/** One happening in a village's local history. */
export interface LocalEntry {
  slot: LocalSlot;
  category: 'politics' | 'event';
  year: number;
  /** Years before the present. */
  ago: number;
  text: string;
  publicity: LocalPublicity;
  /** Village families in it (family names): who has a stake. */
  families: readonly string[];
  /** Road people in it (villages.ts ids). */
  people: readonly string[];
  /** It touches the house that holds the village: everyone there has that stake. */
  lord: boolean;
  /** Written by hand (CRAFTED_LOCAL), not generated. */
  crafted: boolean;
}

/** A local fact: the knowledge model's `Fact`, narrowed to what the local layer makes. */
export interface LocalFact extends Fact {
  /** `local:<village>:<slot>`, and `local:<village>:<slot>:<person>` for a party's own telling. */
  id: string;
  scope: { kind: 'village' | 'person'; id: string };
  truth: 'true' | 'rumour';
  depth: 1 | 2 | 3;
}

export interface LocalHistory {
  /** Oldest first, one per slot told. */
  entries: LocalEntry[];
  /** Each entry as a village fact, plus a more guarded person fact for each road person in it with a stake. */
  facts: LocalFact[];
}

/** What the generation reads: the present, the village, its province and its country. */
export interface LocalInput {
  seed: number;
  present: number;
  village: AnchorId;
  province: ProvinceHistory;
  /** The generated region it lies in (#1598), or null with none to hand. */
  country: RegionHistory | null;
}

/**
 * The generated region a village's province lies in: the caller's `generated` lookup (remembered.ts
 * passes its own), read off the history. Not the village's crafted region: the north road is a
 * road, not a country with a harvest and a lord's dues.
 */
export function countryOf(history: ReachHistory, provinceId: string, generated: GeneratedRegions): RegionHistory | null {
  const id = generated(provinceId);
  return id ? history.regions.find(r => r.id === id) ?? null : null;
}

/** A village's local history: the crafted slots as written, the rest generated. */
export function localHistory(input: LocalInput, crafted: CraftedLocal = CRAFTED_LOCAL): LocalHistory {
  const { present, village } = input;
  const written = crafted[village] ?? [];
  const ctx = context(input);
  const entries: LocalEntry[] = [];
  for (const slot of LOCAL_SLOTS) {
    const c = written.find(w => w.slot === slot);
    if (c) {
      entries.push({
        slot, category: POLITICS.has(slot) ? 'politics' : 'event', year: present - c.ago, ago: c.ago, text: c.text,
        publicity: c.publicity, families: [...(c.families ?? [])], people: [...(c.people ?? [])], lord: !!c.lord, crafted: true,
      });
      continue;
    }
    const r = generator(seedOf(`${input.seed}|local|${village}|${slot}`));
    // The chance roll is the stream's first draw, always made, so what follows is the same either way.
    const told = r() < (ALWAYS.has(slot) ? 1 : CHANCE[slot] ?? 0) || forced(slot, ctx);
    if (!told) continue;
    const g = GENERATE[slot](ctx, r);
    const ago = Math.max(0, Math.min(LOCAL_YEARS, g.ago));
    entries.push({
      slot, category: POLITICS.has(slot) ? 'politics' : 'event', year: present - ago, ago, text: g.text,
      publicity: g.publicity, families: g.families ?? [], people: [], lord: !!g.lord, crafted: false,
    });
  }
  // Oldest first; a crafted entry and a generated one of the same year stay in slot order.
  entries.sort((a, b) => a.year - b.year || LOCAL_SLOTS.indexOf(a.slot) - LOCAL_SLOTS.indexOf(b.slot));
  return { entries, facts: entries.flatMap(e => localFacts(village, e, present, !!input.province.house)) };
}

/**
 * An entry as facts: the village's telling, and for each road person in it whose stake makes it
 * more guarded, their own. `ruled` is whether a house holds the village (a lord's stake needs a lord).
 */
export function localFacts(village: AnchorId, e: LocalEntry, present: number, ruled: boolean): LocalFact[] {
  const when = e.ago === 0 ? 'This year' : e.ago === 1 ? 'A year ago' : `${e.ago} years ago`;
  const text = `${when}, in year ${e.year}: ${e.text}`;
  const about = [`place:${village}`, ...e.people.map(p => `person:${p}`)];
  // Truth by age, the same test as remembered.ts `recall`: local history is all within living memory.
  const truth = present - e.year <= LIVING_MEMORY ? 'true' : 'rumour';
  const sensitivity = localSensitivity(e.publicity, e.lord && ruled);
  const depth = Math.max(DEPTH[e.publicity], e.ago <= GENERATION ? 1 : 2) as 1 | 2 | 3;
  const facts: LocalFact[] = [{ id: `local:${village}:${e.slot}`, about, text, scope: { kind: 'village', id: village }, sensitivity, truth, depth }];
  const stake = localSensitivity(e.publicity, true);
  if (stake !== sensitivity) {
    for (const p of e.people.filter(isRoadPerson)) {
      facts.push({ id: `local:${village}:${e.slot}:${p}`, about, text, scope: { kind: 'person', id: p }, sensitivity: stake, truth, depth: 1 });
    }
  }
  return facts;
}

// --- the generation ---

/** What a slot's generator reads: the village, and what the engine says about its place. */
interface Ctx {
  present: number;
  name: string;
  /** What its people call their council: the ford-moot, the well-council, the gate-council. */
  moot: string;
  livelihood: string;
  founding: string;
  wealth: number;
  tax: number;
  levy: number;
  /** Its country's venture, when it's in this village. */
  venture: RegionHistory['venture'] | null;
  /** Its country's told events of the last LOCAL_YEARS, here or country-wide, newest first. */
  lines: RegionLine[];
  /** The village's families, drawn once per village (they recur from slot to slot). */
  families: readonly string[];
  /** Given names for its people, drawn once per village, a man's then a woman's, each used once (`person`). */
  names: readonly string[];
}

interface Generated { ago: number; text: string; publicity: LocalPublicity; families?: string[]; lord?: boolean }

/**
 * Village families' names, by culture: farmstead and trade names, never a lords' house (those are
 * peoples.ts `surnames`, which the engine gives the houses that hold land). Fieldborn, waterstead
 * and wallborn are the three road villages' own (villages.ts `cultures`).
 */
const FAMILIES: Readonly<Record<string, readonly string[]>> = {
  fieldborn: ['Brekke', 'Åkerman', 'Hagberg', 'Stenby', 'Lövgren', 'Myrén', 'Dalby'],
  waterstead: ['Strand', 'Näsman', 'Holmqvist', 'Vassby', 'Sälg', 'Grundel', 'Viksten'],
  wallborn: ['Murby', 'Portman', 'Vallin', 'Grind', 'Bergwall', 'Skanstorp', 'Tornqvist'],
  ridgefolk: ['Lid', 'Brant', 'Furu', 'Klev', 'Asplund', 'Hällby'],
  mountainhold: ['Hallr', 'Gruvman', 'Djupin', 'Skarv', 'Fjällby'],
};

const MOOT: Readonly<Record<string, string>> = {
  hollowford: 'ford-moot', saltmere: 'well-council', 'kestrel-gate': 'gate-council',
};

/** The road's people, by id and given name: generated villagers never share a name with one. */
const ROAD_PEOPLE = [...Object.values(VILLAGES).flatMap(v => v.people), ...TRAVELLERS];
const ROAD_NAMES = new Set(ROAD_PEOPLE.map(p => p.name));
const isRoadPerson = (id: string) => ROAD_PEOPLE.some(p => p.id === id);

function context(input: LocalInput): Ctx {
  const { seed, present, village, province, country } = input;
  const culture = VILLAGES[village]?.cultures[0] ?? 'fieldborn';
  const spec = REACH_CULTURES.find(c => c.id === culture) ?? REACH_CULTURES[0];
  const here = country?.provinces.find(p => p.id === province.id || p.name === province.name);
  const lines = (country?.lines ?? [])
    .filter(l => present - l.year >= 0 && present - l.year <= LOCAL_YEARS && (l.province === province.name || l.province === null))
    .sort((a, b) => b.year - a.year);
  // Drawn on their own streams, so the village's families and names are the same whatever slots are crafted.
  const families = shuffled(FAMILIES[culture] ?? FAMILIES.fieldborn, seedOf(`${seed}|local|${village}|families`)).slice(0, 4);
  // Men's and women's names in turn, so a marriage (people 3 and 4) is a woman and a man.
  const men = shuffled(spec.namesMale.filter(n => !ROAD_NAMES.has(n)), seedOf(`${seed}|local|${village}|men`));
  const women = shuffled(spec.namesFemale.filter(n => !ROAD_NAMES.has(n)), seedOf(`${seed}|local|${village}|women`));
  const names = men.flatMap((m, i) => (women[i] ? [m, women[i]] : [m]));
  return {
    present, name: VILLAGES[village]?.name ?? province.name, moot: MOOT[village] ?? 'moot',
    livelihood: here?.livelihood ?? 'farming', founding: here?.founding ?? 'farming', wealth: here?.wealth ?? 0.5,
    tax: country?.tax ?? 0.35, levy: country?.levy ?? 0,
    venture: country && country.venture.province === province.name ? country.venture : null,
    lines, families, names,
  };
}

/** A slot told whatever the chance roll, because the engine's state calls for it: heavy dues or a levy bring a council. */
function forced(slot: LocalSlot, c: Ctx): boolean {
  return slot === 'council' && (c.tax >= HEAVY_TAX || c.levy >= LEVY);
}
/** The same lines regional-facts.ts draws for "the lords tax heavily" and "many of its men are away". */
const HEAVY_TAX = 0.45;
const LEVY = 0.2;

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const anyYear = (r: () => number) => Math.floor(r() * (LOCAL_YEARS + 1));
/** The `k`th of the village's people: each slot has its own, so nobody is in two places at once. */
const person = (c: Ctx, k: number) => c.names[k % c.names.length];
/** The newest country line of these kinds, if any. */
const latest = (c: Ctx, ...kinds: string[]) => c.lines.find(l => kinds.includes(l.kind));

const GOOD_YEAR: Readonly<Record<string, string>> = {
  farming: 'the barley stood to the shoulder, and the village paid off its debts',
  fishing: 'the nets came up full all season',
  herding: 'nearly every ewe had twins',
  lumber: 'buyers came up from the lowlands for every log the village could cut',
  mining: 'the seam ran rich, and the ore-carts went out full',
  peat: 'the cuttings dried hard and sold well',
  trading: 'the market was full every week, and the stalls ran out of things to sell',
};
const BAD_YEAR: Readonly<Record<string, string>> = {
  farming: 'the rain came at harvest and the barley rotted in the stook',
  fishing: 'the fish went deep and stayed there',
  herding: 'the lambing came in sleet, and half the lambs were lost',
  lumber: 'no buyers came, and the logs rotted at the landing',
  mining: 'the seam pinched out, and the diggers worked for weeks for nothing',
  peat: 'the cuttings flooded and never dried',
  trading: 'the carts stopped coming, and the stalls stood empty',
};
const QUARREL: Readonly<Record<string, string>> = {
  farming: 'a boundary stone between their fields', fishing: 'the best drying racks on the shore', herding: 'grazing on the common',
  lumber: 'a stand of timber both said was theirs', mining: 'a claim on the seam', peat: 'the peat cuttings by the old track',
  trading: 'a stall by the market cross',
};
const BUILDING: Readonly<Record<string, string>> = {
  farming: 'a new mill on the stream', fishing: 'a smoke-house on the shore', herding: 'new stone folds on the hill',
  lumber: 'a saw-pit by the road', mining: 'an ore-shed with a proper roof', peat: 'a long drying barn', trading: 'a covered market',
};

/** One generator per slot. Each draws only from its own stream `r`, in a fixed order. */
const GENERATE: Readonly<Record<LocalSlot, (c: Ctx, r: () => number) => Generated>> = {
  leader(c, r) {
    const [lead, old] = [person(c, 0), person(c, 1)];
    const fam = c.families[0];
    const seized = latest(c, 'SEAT_SEIZED');
    if (seized) {
      // A seat seized here: the new lord's men put in a headman of their liking. Touches the ruling house.
      return { ago: c.present - seized.year, publicity: 'open', lord: true, families: [fam],
        text: `When the seat was seized, the new lord's men turned the old headman out, and the ${c.moot} was told to take ${lead} ${fam} to speak for ${c.name}. It did.` };
    }
    const ago = anyYear(r);
    const how = r();
    if (how < 0.45) return { ago, publicity: 'public', families: [fam], text: `When old ${old} died, the ${c.moot} chose ${lead} ${fam} to speak for ${c.name}.` };
    if (how < 0.8) return { ago, publicity: 'public', families: [fam], text: `When old ${old} grew too frail to walk the bounds, the ${c.moot} chose ${lead} ${fam} to speak for ${c.name}.` };
    const other = c.families[3];
    return { ago, publicity: 'open', families: [fam, other],
      text: `The ${c.moot} turned ${old} ${other} out over ${pick(r, ['a debt to the common chest', 'the lost seed-corn', 'a bad bargain with a cattle-dealer'])}, and chose ${lead} ${fam} to speak for ${c.name} instead. The ${other}s still sit apart at the moot.` };
  },
  dispute(c, r) {
    const [a, b] = [c.families[1], c.families[2]];
    const over = r() < 0.6 ? QUARREL[c.livelihood] ?? QUARREL.farming : pick(r, ['the water from the upper well', `a debt of ${3 + Math.floor(r() * 10)} marks`, 'a strayed ox and the damage it did']);
    const ending = pick(r, [
      `The ${c.moot} split it between them, and neither family thanked it.`,
      `The ${c.moot} found for the ${a}s; the ${b}s have not forgotten it.`,
      'It is not settled yet.',
    ]);
    return { ago: anyYear(r), publicity: 'open', families: [a, b], text: `The ${a}s and the ${b}s fell out over ${over}. ${ending}` };
  },
  council(c, r) {
    const who = person(c, 2);
    if (c.tax >= HEAVY_TAX) {
      return { ago: Math.floor(r() * 6), publicity: 'open', lord: true,
        text: `The lord's dues were raised again, and the ${c.moot} sent ${who} to the steward to ask for lighter dues. The steward sent ${who} home with nothing.` };
    }
    if (c.levy >= LEVY) {
      return { ago: Math.floor(r() * 4), publicity: 'public', lord: true,
        text: `When the lord's levy came, the ${c.moot} drew lots for who would go. ${pick(r, ['Three', 'Four', 'Five'])} of ${c.name}'s young men went, and not all have come back.` };
    }
    const act = pick(r, [
      'close the high pasture for a year to let it rest',
      'keep a night watch on the road after strangers were seen',
      'raise an orphan of the road in common, a week at each hearth',
      'mend the common track before the autumn rains, every house sending one pair of hands',
    ]);
    return { ago: anyYear(r), publicity: 'public', text: `The ${c.moot} agreed to ${act}.` };
  },
  marriage(c, r) {
    const [a, b] = r() < 0.5 ? [c.families[1], c.families[3]] : [c.families[2], c.families[3]];
    const joined = pick(r, ['have farmed as one since', 'keep one hearth-feast now', 'stopped quarrelling, mostly']);
    return { ago: anyYear(r), publicity: 'public', families: [a, b], text: `${person(c, 3)} ${a} married ${person(c, 4)} ${b}, and the ${a}s and the ${b}s ${joined}.` };
  },
  scandal(c, r) {
    const fam = pick(r, c.families);
    const who = person(c, 5);
    const text = pick(r, [
      `${who} ${fam} was moving a boundary stone by night, a hand's width a year, until the frost showed the fresh earth.`,
      `${who} ${fam} sold the ${c.moot}'s seed-corn short in a hungry spring and made up the sacks with chaff.`,
      `The ${fam}s' eldest ran up debts at market, and the family paid them off in secret with the dowry money.`,
    ]);
    return { ago: anyYear(r), publicity: 'family', families: [fam], text };
  },
  trade(c, r) {
    const v = c.venture;
    if (v && c.present - v.since <= LOCAL_YEARS) {
      const text = {
        thriving: `The ${v.kind} did well, and ${c.name} took on hands from the hill farms to work it.`,
        steady: `The ${v.kind} came through a lean spell and settled into steady work.`,
        failing: `The ${v.kind} began to fail, and ${c.name}'s young people started looking for work elsewhere.`,
        closed: `The ${v.kind} closed, and ${c.name} went back to what it lived on before.`,
      }[v.state];
      return { ago: c.present - v.since, publicity: 'public', text };
    }
    const told = latest(c, 'HARVEST_GOOD', 'BOOM', 'HARVEST_POOR', 'SLUMP', 'SHORTAGE');
    const good = told ? told.kind === 'HARVEST_GOOD' || told.kind === 'BOOM' : c.wealth >= 0.6 ? true : c.wealth <= 0.4 ? false : r() < 0.5;
    const detail = (good ? GOOD_YEAR : BAD_YEAR)[c.livelihood] ?? (good ? GOOD_YEAR : BAD_YEAR).farming;
    return { ago: told ? c.present - told.year : anyYear(r), publicity: 'public', text: `It was a ${good ? 'good' : 'bad'} year for ${c.name}: ${detail}.` };
  },
  mishap(c, r) {
    // The country's hard years come first: a famine, a plague, a hard winter here are the village's too.
    const hard = latest(c, 'FAMINE') ?? latest(c, 'PLAGUE') ?? latest(c, 'HARD_WINTER');
    const fam = pick(r, c.families);
    if (hard) {
      const text = {
        FAMINE: `The hungry year: ${c.name} ate its seed-corn before spring, and the ${fam}s sold their cow to buy more.`,
        PLAGUE: `The coughing sickness went through ${c.name}, and the ${fam}s buried two of their children.`,
        HARD_WINTER: 'The wolf winter: snow lay to the eaves, and wolves came down to the folds at night.',
      }[hard.kind as 'FAMINE' | 'PLAGUE' | 'HARD_WINTER'];
      return { ago: c.present - hard.year, publicity: 'public', families: hard.kind === 'HARD_WINTER' ? [] : [fam], text };
    }
    const options: Generated[] = [
      { ago: 0, publicity: 'public', families: [fam], text: `A fire took the ${fam}s' barn and half the winter's hay. The village helped them raise a new one.` },
      { ago: 0, publicity: 'public', text: `The old well went dry in a hot summer, and ${c.name} carried water until a new one was dug.` },
      { ago: 0, publicity: 'public', text: `A storm took the roof off the ${c.moot}'s hall, and it met in the ${fam}s' barn until spring.` },
    ];
    if (c.founding === 'crossing' || c.livelihood === 'fishing') options.push({ ago: 0, publicity: 'public', text: 'The spring flood came over the banks and took the lowest houses.' });
    if (c.livelihood === 'mining' || c.livelihood === 'lumber') options.push({ ago: 0, publicity: 'public', text: 'A slip came down the hillside after the rains and buried the upper path.' });
    return { ...pick(r, options), ago: anyYear(r) };
  },
  building(c, r) {
    const thing = r() < 0.7 ? BUILDING[c.livelihood] ?? BUILDING.farming : pick(r, ['a new well', `a new hall for the ${c.moot}`]);
    const fam = pick(r, c.families);
    return r() < 0.6
      ? { ago: anyYear(r), publicity: 'public', text: `${c.name} built ${thing}, every house giving a day's work a week to it.` }
      : { ago: anyYear(r), publicity: 'public', families: [fam], text: `The ${fam}s built ${thing}, and charge the village for using it.` };
  },
  comings(c, r) {
    const migrants = latest(c, 'MIGRATION');
    const fam = pick(r, c.families);
    if (migrants) {
      return { ago: c.present - migrants.year, publicity: 'public',
        text: `Families fleeing hard times elsewhere came through ${c.name}. One stayed, and has a house by the ${pick(r, ['mill', 'old track', 'water'])} now.` };
    }
    const who = person(c, 6);
    const text = pick(r, [
      `${who} ${fam} left for the lowlands one spring and never came back.`,
      `${who} ${fam} went off with the caravan and came back three years later with a lowland spouse and a mule.`,
      `A tinker came up the road with a cart of pots and stayed. He married into the ${fam}s.`,
    ]);
    return { ago: anyYear(r), publicity: 'public', families: [fam], text };
  },
  death(c, r) {
    const fam = pick(r, c.families);
    const who = pick(r, ['knew every boundary stone in the valley', 'kept the mill', 'had brought half the village into the world', 'could sing all the old road songs']);
    return { ago: anyYear(r), publicity: 'public', families: [fam], text: `Old ${person(c, 7)} ${fam}, who ${who}, died, and the whole village came to the burying.` };
  },
};
