/**
 * What each road village remembers (#1586): the generated history (history.ts), read as facts
 * the people of Hollowford, Saltmere and Kestrel Gate could tell you.
 *
 * Each road village is seated at a generated province (provinces.ts `placeAnchors`), and the
 * history engine leaves every province a title, the holder at the end, and up to three dated
 * events. This turns those into facts for the knowledge model (knowledge.ts; design in
 * docs/knowledge-model-design.md, spike #1577; slice F there): who holds the place, and what
 * happened there and when. Recent events are remembered as they were; older ones have drifted
 * into legend.
 *
 * Nothing in play reads these yet: the knowledge model answering from them is its own slice.
 *
 * Pure and deterministic: the same told history gives the same facts, with no randomness of its
 * own. It reads a told history as plain data (history-format.ts) and never runs the engine, so the
 * page can call it with the history it keeps, and only a caller with no history to hand pays for
 * telling one (history.ts `rememberedOf`, kept per seed by `rememberedCache`).
 *
 * ## The rules (the owner's answers on PR #1592, 2026-10-11)
 *
 * - **Something true and recent.** Each province keeps one of its told events from within living
 *   memory when it has any (history.ts `pickLines`), so a village always has a true, recent
 *   event to tell if its history holds one. The fuller "always some recent local history" layer
 *   is #1613.
 * - **Regions are semi-generated** (regions.ts): crafted where we write them (the three road
 *   villages are on the north road), generated where we don't. A village's people know their own
 *   lord (village scope, depth 1); most of its region know who holds each place in it (depth 2).
 * - **Server games** compute this lazily, the first time a road question needs a regional fact,
 *   and keep it per seed (history.ts `rememberedCache`). Not wired into play yet.
 * - **Sensitivity is not a blanket rule.** It comes from how public the event was (`publicityOf`:
 *   a war, a plague, a crowning are public; a kinslaying, a scandal, a house's secret are not)
 *   and the teller's stake in it (`hasStake`: a fact about a house is one step more guarded told
 *   by that house's own people, or those living under its rule). Age doesn't soften it: a
 *   legend about your own lord's house is still told with care.
 */

import type { Fact, Sensitivity } from '../knowledge';
import { LIVING_MEMORY, type HistoryLine, type ProvinceHistory, type ReachHistory } from './history-format';
import { generateReach } from './reach';
import { provincesOf, type AnchorId, type Provinces } from './provinces';
import { NORTH_ROAD, generatedRegions, roadRegions, type GeneratedRegions, type VillageRegion } from './regions';
import { GENERATION } from './regional-facts';

export { GENERATION };

/**
 * A fact, in the shape of the knowledge model's `Fact` (knowledge.ts), with the fields narrowed to
 * the values history makes: so every one of these is a `Fact` as it stands.
 */
export interface RememberedFact extends Fact {
  /** Stable for the same history: `history:<village>:<what>`. */
  id: string;
  /** The topic keys it answers: the village's place key (topics.ts), e.g. `place:saltmere`. */
  about: readonly string[];
  /** Who can know it: a village's people, or everyone in a region (regions.ts). */
  scope: { kind: 'region' | 'village'; id: string };
  /** How guarded it is: public, unless it touches a house (`publicityOf`, `hasStake`). */
  sensitivity: Sensitivity;
  /** `true` for what's still remembered; `rumour` for what has passed into legend. */
  truth: 'true' | 'rumour';
  /** 1 everyone in the scope knows it, 2 most do, 3 only the best-placed (an elder, for a village). */
  depth: 1 | 2 | 3;
}

/**
 * How public an event was, by the engine's event kind:
 * - `public`: the whole land saw it or felt it: a war, a plague, a famine, a lord crowned or
 *   dying, even a usurpation (everyone sees who sits in the hall now). Anyone tells it.
 * - `house`: it touches a house or family: a murder, a kinslaying, a plot uncovered, a lord's
 *   madness, a bastard acknowledged, an oath broken. Known, but spoken of quietly: `guarded`.
 * - `family`: kept within a house's walls: a secret heir, a favourite, a concubine's child, a
 *   lodge of assassins. `private`.
 * Kinds not listed are public: most of what the engine logs happens in the open. (The engine has
 * no disinheritance event yet; one would be a `house` affair.)
 */
export type Publicity = 'public' | 'house' | 'family';

const HOUSE_AFFAIRS: ReadonlySet<string> = new Set([
  'MURDER', 'KINSLAYING_NOTORIOUS', 'SCHEME_DISCOVERED', 'MADNESS_ONSET', 'KING_INCAPACITATED',
  'BASTARD_ACKNOWLEDGED', 'PRETENDER_UNMASKED', 'OATH_BROKEN_SACRED', 'MONSTROUS_BIRTH',
  'ALLIANCE_BETRAYED', 'GRUDGE_FORMED', 'DOOM_LAID', 'RITE_STOLEN',
]);
const FAMILY_SECRETS: ReadonlySet<string> = new Set([
  'SECRET_HEIR_DISCOVERED', 'CONCUBINE_FAVORED', 'CONCUBINE_BEARS_HEIR', 'MISTRESS_INFLUENCES_CROWN',
  'FAVORITE_ASCENDS', 'ASSASSINS_LODGE_FOUNDED',
]);

/** How public an event of this kind was (`Publicity`). No kind (a hand-written line): public. */
export function publicityOf(kind?: string): Publicity {
  return kind && FAMILY_SECRETS.has(kind) ? 'family' : kind && HOUSE_AFFAIRS.has(kind) ? 'house' : 'public';
}

/**
 * Whether a teller has a stake in a fact about `house`: they're of that house, or it rules them
 * (it holds the province they live in, `lord`). For them it's one step more guarded: it's their
 * own family's shame, or their lord's, and loose talk about the lord's house is dangerous.
 */
export function hasStake(house: string | null | undefined, teller: { house?: string | null; lord?: string | null }): boolean {
  return !!house && (teller.house === house || teller.lord === house);
}

const STEPS: readonly Sensitivity[] = ['public', 'guarded', 'private', 'secret'];

/**
 * A fact's sensitivity: public events stay public whoever tells them; a house affair is `guarded`
 * (`private` with a stake), a family secret `private` (`secret` with a stake).
 */
export function sensitivityOf(publicity: Publicity, stake: boolean): Sensitivity {
  if (publicity === 'public') return 'public';
  return STEPS[(publicity === 'house' ? 1 : 2) + (stake ? 1 : 0)];
}

/** One of a province's told events, dated against the present. */
export interface RememberedEvent {
  /** The year it happened, in the Reach's own count. */
  year: number;
  /** How many years before the present. */
  ago: number;
  /** Within LIVING_MEMORY: there are people alive who saw it. */
  living: boolean;
  text: string;
}

/** What one road village remembers: where it sits, who holds it, and what happened there. */
export interface VillageMemory extends VillageRegion {
  /** The lordship seated there, e.g. "Hundred of Hollowford". */
  title: string;
  /** Who holds it now, or null if it lies vacant. */
  holder: string | null;
  /** Its told events, oldest first. */
  events: RememberedEvent[];
  /** All of the above as facts: the holder (for the province and for the road), then the events. */
  facts: RememberedFact[];
}

export interface Remembered {
  seed: number;
  /** The present: the year the history ends, when the Warden arrives. */
  year: number;
  /** In the order the road reaches them. */
  villages: VillageMemory[];
}

/**
 * What the road villages remember, from a told history. `provinces` are the same seed's (rebuilt
 * from the seed if not given: a few milliseconds, no engine), and say where each village sits.
 * `generated` gives a province's generated region (regions.ts), for any village without a crafted
 * one: by default the history's own regions (#1598).
 */
export function remembered(history: ReachHistory, provinces: Provinces = provincesOf(generateReach(history.seed)), generated: GeneratedRegions = generatedRegions(history)): Remembered {
  return {
    seed: history.seed,
    year: history.year,
    villages: roadRegions(provinces, generated).map(where => {
      const p = history.provinces.find(q => q.id === where.province.id);
      // The province ids (`p3`) only mean something within one Reach: a history and provinces
      // from different seeds would pair the wrong places, so refuse rather than misread.
      if (!p || p.name !== where.province.name) throw new Error(`This history (seed ${history.seed}) has no province ${where.province.name} (${where.province.id}): the provinces are another seed's.`);
      return {
        ...where,
        title: p.title,
        holder: p.holder,
        events: p.lines.map(line => recall(line, history.year)),
        facts: [...holderFacts(where, p), ...p.lines.map((line, k) => eventFact(where.village, line, history.year, k, p.house))],
      };
    }),
  };
}

/** A told event dated against the present year. */
export function recall(line: HistoryLine, present: number): RememberedEvent {
  const ago = present - line.year;
  // The same test as the chronicle's LIVING MEMORY section (storytelling/render.ts: now - year <= living),
  // so what the HISTORY tab lists as living memory and what people remember as true agree.
  return { year: line.year, ago, living: ago <= LIVING_MEMORY, text: line.text };
}

/**
 * One of a province's events as a fact its village remembers. Within living memory it's `true`:
 * people saw it, everyone (depth 1) if it's within a generation, else most (depth 2). Older, it's
 * a `rumour` at depth 3: legends drift as they're retold, and only the best-placed (an elder, who
 * reaches 3 into their village) still tell it. `k` tells apart two events of the same year.
 *
 * Scoped to the village, not the province's region: the knowledge model's reach gives an elder
 * depth 3 in their village and a trader depth 3 in their region, so village scope makes Maren the
 * one who keeps Hollowford's old stories, not a trader passing through.
 *
 * Its sensitivity is how public the event was, one step more guarded if it touches the house that
 * rules the village (`lord`, the house holding its province now): everyone who knows a village
 * fact lives there, so all of them have that stake (`hasStake`). A deed of some other house is
 * told as openly as its kind allows.
 */
export function eventFact(village: AnchorId, line: HistoryLine, present: number, k = 0, lord: string | null = null): RememberedFact {
  const e = recall(line, present);
  return {
    id: `history:${village}:${e.year}:${k}`,
    about: [`place:${village}`],
    text: `${e.ago === 0 ? 'This year' : e.ago === 1 ? 'A year ago' : `${e.ago} years ago`}, in year ${e.year}: ${e.text}`,
    scope: { kind: 'village', id: village },
    sensitivity: sensitivityOf(publicityOf(line.kind), hasStake(line.house, { lord })),
    truth: e.living ? 'true' : 'rumour',
    depth: !e.living ? 3 : e.ago <= GENERATION ? 1 : 2,
  };
}

/**
 * Who holds the place, twice: everyone in the village knows their own lord (depth 1), and most who
 * live or travel in its region know who holds each place in it (depth 2). For the road villages
 * that's the north road, which is how the caravan's own people, who live in no province, can tell
 * you who rules the next stop. Who holds a place is nobody's secret: public.
 */
function holderFacts(where: VillageRegion, p: ProvinceHistory): RememberedFact[] {
  const title = `the ${p.title}`;
  const about = [`place:${where.village}`];
  const on = where.region === NORTH_ROAD ? 'On the north road, ' : '';
  const place = where.province.name;
  return [
    {
      id: `history:${where.village}:holder`, about,
      text: p.holder ? `${cap(title)} is held by ${p.holder}.` : `${cap(title)} lies vacant: no one holds it now.`,
      scope: { kind: 'village', id: where.village }, sensitivity: 'public', truth: 'true', depth: 1,
    },
    {
      id: `history:${where.region}:${where.village}`, about,
      text: p.holder ? `${on}${place} answers to ${p.holder}, who holds ${title}.` : `${on}${place} answers to no one: ${title} lies vacant.`,
      scope: { kind: 'region', id: where.region }, sensitivity: 'public', truth: 'true', depth: 2,
    },
  ];
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
