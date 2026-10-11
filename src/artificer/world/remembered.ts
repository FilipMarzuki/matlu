/**
 * What each road village remembers (#1586): the generated history (history.ts), read as facts
 * the people of Hollowford, Saltmere and Kestrel Gate could tell you.
 *
 * Each road village is seated at a generated province (provinces.ts `placeAnchors`), and the
 * history engine leaves every province a title, the holder at the end, and up to three dated
 * events. This turns those into facts for the knowledge model (docs/knowledge-model-design.md,
 * spike #1577; slice F there): who holds the place, and what happened there and when. Recent
 * events are remembered as they were; older ones have drifted into legend.
 *
 * Nothing in play reads these yet: the knowledge model that answers from them is its own slice.
 *
 * Pure and deterministic: the same told history gives the same facts, with no randomness of its
 * own. It reads a told history as plain data (history-format.ts) and never runs the engine, so the
 * page can call it with the history it keeps, and only a caller with no history to hand pays for
 * telling one (history.ts `rememberedOf`).
 */

import { LIVING_MEMORY, type HistoryLine, type ProvinceHistory, type ReachHistory } from './history-format';
import { generateReach } from './reach';
import { provincesOf, type AnchorId, type Provinces } from './provinces';
import { NORTH_ROAD, roadRegions, type VillageRegion } from './regions';

/**
 * A fact, in the shape of the knowledge model's `Fact` (§1 of the design: the topics it answers,
 * what's said, who can know it, how guarded it is, whether it's true, how deep it lies). The model
 * itself isn't on main yet, so this is only the part history makes, with the fields narrowed to
 * the values it uses. Being a narrower version of the same shape, it's assignable to the model's
 * `Fact` as it stands in the prototype, so these slot in when the model lands.
 */
export interface RememberedFact {
  /** Stable for the same history: `history:<village>:<what>`. */
  id: string;
  /** The topic keys it answers: the village's place key (topics.ts), e.g. `place:saltmere`. */
  about: readonly string[];
  text: string;
  /** Who can know it: a village's people, or everyone in a region (regions.ts). */
  scope: { kind: 'region' | 'village'; id: string };
  /** Who holds a place and what happened there are nobody's secret. */
  sensitivity: 'public';
  /** `true` for what's still remembered; `rumour` for what has passed into legend. */
  truth: 'true' | 'rumour';
  /** 1 everyone in the scope knows it, 2 most do, 3 only the best-placed (an elder, for a village). */
  depth: 1 | 2 | 3;
}

/**
 * About a generation: within living memory, an event this recent is remembered by everyone
 * (depth 1); an older one by most (depth 2), since the young weren't born to see it.
 */
export const GENERATION = LIVING_MEMORY / 2;

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
 */
export function remembered(history: ReachHistory, provinces: Provinces = provincesOf(generateReach(history.seed))): Remembered {
  return {
    seed: history.seed,
    year: history.year,
    villages: roadRegions(provinces).map(where => {
      const p = history.provinces.find(q => q.id === where.province.id);
      // The province ids (`p3`) only mean something within one Reach: a history and provinces
      // from different seeds would pair the wrong places, so refuse rather than misread.
      if (!p || p.name !== where.province.name) throw new Error(`This history (seed ${history.seed}) has no province ${where.province.name} (${where.province.id}): the provinces are another seed's.`);
      return {
        ...where,
        title: p.title,
        holder: p.holder,
        events: p.lines.map(line => recall(line, history.year)),
        facts: [...holderFacts(where, p), ...p.lines.map((line, k) => eventFact(where.village, line, history.year, k))],
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
 */
export function eventFact(village: AnchorId, line: HistoryLine, present: number, k = 0): RememberedFact {
  const e = recall(line, present);
  return {
    id: `history:${village}:${e.year}:${k}`,
    about: [`place:${village}`],
    text: `${e.ago === 0 ? 'This year' : e.ago === 1 ? 'A year ago' : `${e.ago} years ago`}, in year ${e.year}: ${e.text}`,
    scope: { kind: 'village', id: village },
    sensitivity: 'public',
    truth: e.living ? 'true' : 'rumour',
    depth: !e.living ? 3 : e.ago <= GENERATION ? 1 : 2,
  };
}

/**
 * Who holds the place, twice: everyone in its province knows their own lord (depth 1), and most
 * who live or travel on the north road know who holds each place on it (depth 2), which is how
 * the caravan's own people, who live in no province, can tell you who rules the next stop.
 */
function holderFacts(where: VillageRegion, p: ProvinceHistory): RememberedFact[] {
  const title = `the ${p.title}`;
  const about = [`place:${where.village}`];
  return [
    {
      id: `history:${where.village}:holder`, about,
      text: p.holder ? `${cap(title)} is held by ${p.holder}.` : `${cap(title)} lies vacant: no one holds it now.`,
      scope: { kind: 'region', id: where.region }, sensitivity: 'public', truth: 'true', depth: 1,
    },
    {
      id: `history:${NORTH_ROAD}:${where.village}`, about,
      text: p.holder ? `On the north road, ${where.province.name} answers to ${p.holder}, who holds ${title}.` : `On the north road, ${where.province.name} answers to no one: ${title} lies vacant.`,
      scope: { kind: 'region', id: where.road }, sensitivity: 'public', truth: 'true', depth: 2,
    },
  ];
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
