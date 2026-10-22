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
 * Play reads them with the `history-in-play` rule switch (#1656, history-in-play.ts): road people
 * answer from them, each telling an old event their own People's way.
 *
 * **One list of what a place knows (#1618).** Each village also gets its country (the generated
 * region its province lies in, #1598) and `known`: its own facts and its country's regional facts
 * (regional-facts.ts) as one list, with a seizure, a lord's death or who holds the seat that both
 * tell merged into one fact (`placeKnowledge`). `facts` stays as it was for existing callers.
 *
 * Pure and deterministic: the same told history gives the same facts. The only dice are old
 * history's (#1650, world/old-history.ts), seeded by the event and who tells it, never a sim
 * stream. It reads a told history as plain data (history-format.ts) and never runs the engine, so the
 * page can call it with the history it keeps, and only a caller with no history to hand pays for
 * telling one (history.ts `rememberedOf`, kept per seed by `rememberedCache`).
 *
 * ## The rules (the owner's answers on PR #1592, 2026-10-11)
 *
 * - **Something true and recent.** Each province keeps one of its told events from within living
 *   memory when it has any (history.ts `pickLines`), so a village always has a true, recent
 *   event to tell if its history holds one. Beyond that, every village always
 *   has recent local history of its own (#1613, local-history.ts): its last LOCAL_YEARS of
 *   local politics and events, crafted where we've written them and generated to fill the rest
 *   (`VillageMemory.local`).
 * - **Regions are semi-generated** (regions.ts): crafted where we write them (the three road
 *   villages are on the north road), generated where we don't. A village's people know their own
 *   lord (village scope, depth 1); most of its region know who holds each place in it (depth 2).
 * - **Server games** compute this lazily, the first time a road question needs a regional fact,
 *   and keep it per seed (history-in-play.ts keeps the told history per seed, #1656).
 * - **Sensitivity is not a blanket rule.** It comes from how public the event was (`publicityOf`:
 *   a war, a plague, a crowning are public; a kinslaying, a scandal, a house's secret are not)
 *   and the teller's stake in it (`hasStake`: a fact about a house is one step more guarded told
 *   by that house's own people, or those living under its rule). Age doesn't soften it: a
 *   legend about your own lord's house is still told with care.
 */

import type { Fact, Sensitivity } from '../knowledge';
import { featureOn, type FeatureSwitches } from '../features';
import { LIVING_MEMORY, type HistoryLine, type ProvinceHistory, type ReachHistory, type RegionHistory, type RegionLine } from './history-format';
import { generateReach } from './reach';
import { countryOf, localHistory, type LocalHistory } from './local-history';
import { provincesOf, type AnchorId, type Provinces } from './provinces';
import { NORTH_ROAD, generatedRegions, regionOf, roadRegions, type GeneratedRegions, type VillageRegion } from './regions';
import { GENERATION, factsOfRegion, type RegionalFact } from './regional-facts';
import { oldTellings, regionHolders, tellingId, villageHolders, type HeldBy, type Holder } from './old-history';

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
  /**
   * Who in the village tells it this way (#1650), on an old event with `old-history-drift` on:
   * their People and culture, their share of the village, and how often it's been retold among
   * them (0: one of them saw it). Absent on everything else.
   */
  heldBy?: readonly HeldBy[];
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
  /**
   * Its own recent past (#1613, local-history.ts): who leads the village, its quarrels and
   * council decisions, its fires, hard winters and good years, each also as facts. Kept apart
   * from `facts`, which are what the told history says of the province.
   */
  local: LocalHistory;
  /** Who holds it now, or null if it lies vacant. */
  holder: string | null;
  /** Its told events, oldest first. */
  events: RememberedEvent[];
  /** All of the above as facts: the holder (for the province and for the road), then the events. */
  facts: RememberedFact[];
  /**
   * The generated region its province lies in (#1598, e.g. `hollowford-country`): its country,
   * whose news it hears. Not `region`: for the road villages the crafted north road wins there,
   * which is the road's scope, not the country's. Null when `generated` knows no region for the
   * province, or the history has none by that id.
   */
  country: string | null;
  /**
   * Everything the place knows, as one list (#1618): `facts` and its country's regional facts
   * (regional-facts.ts `factsOfRegion`), with what both tell merged into one (`placeKnowledge`).
   */
  known: PlaceFact[];
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
 *
 * `features` are the run's rule switches. With `old-history-drift` on (#1650), a village tells
 * its old events the way its own people do (world/old-history.ts `villageHolders`: by People, as
 * the run plays them, and culture), one fact per telling, and its country's old news the way the
 * country's people do. Without (and in every run from before the switch), as the history tells it.
 */
export function remembered(history: ReachHistory, provinces: Provinces = provincesOf(generateReach(history.seed)), generated: GeneratedRegions = generatedRegions(history), features?: FeatureSwitches): Remembered {
  const drift = featureOn(features, 'old-history-drift');
  return {
    seed: history.seed,
    year: history.year,
    villages: roadRegions(provinces, generated).map(where => {
      const p = history.provinces.find(q => q.id === where.province.id);
      // The province ids (`p3`) only mean something within one Reach: a history and provinces
      // from different seeds would pair the wrong places, so refuse rather than misread.
      if (!p || p.name !== where.province.name) throw new Error(`This history (seed ${history.seed}) has no province ${where.province.name} (${where.province.id}): the provinces are another seed's.`);
      // The country: the generated region, asked for directly, so the crafted north road winning
      // the village's `region` doesn't hide the country it actually lies in.
      const countryId = generated(where.province.id);
      const country = countryId ? history.regions.find(r => r.id === countryId) ?? null : null;
      // An old event's places blur among its country's lands (#1650); with no country, among none.
      const tellers = drift ? { holders: villageHolders(where.village, features), places: country?.provinces.map(q => q.name) ?? [] } : null;
      const facts = [...holderFacts(where, p), ...p.lines.flatMap((line, k) => (tellers
        ? eventTellings(where.village, line, history.year, k, p.house, tellers.holders, tellers.places)
        : [eventFact(where.village, line, history.year, k, p.house)]))];
      return {
        ...where,
        title: p.title,
        holder: p.holder,
        local: localHistory({ seed: history.seed, present: history.year, village: where.village, province: p, country: countryOf(history, where.province.id, generated) }),
        events: p.lines.map(line => recall(line, history.year)),
        facts,
        country: country?.id ?? null,
        known: placeKnowledge(where.village, p, facts, country, history.year, drift && country ? regionHolders(history, country.id) : undefined),
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
 * One of a province's events as its village's `holders` tell it (#1650, world/old-history.ts
 * `oldTellings`): within LIVING_MEMORY and seen by all of them, the one fact `eventFact` gives;
 * older, or past some People's living memory, one fact per telling. The most widely held keeps
 * the event's own id, each other one is told under `tellingId`; every one names who tells it
 * (`heldBy`). An eyewitness telling is `true` (depth 1 within its witnesses' first generation, else
 * 2); a retold one a `rumour` at depth 3. Sensitivity is the event's, whoever tells it. Only the
 * event's words bend: "N years ago, in year Y:" goes on after, so the year never moves.
 */
export function eventTellings(village: AnchorId, line: HistoryLine, present: number, k: number, lord: string | null, holders: readonly Holder[], places: readonly string[]): RememberedFact[] {
  const base = eventFact(village, line, present, k, lord);
  const ago = present - line.year;
  const told = oldTellings(base.id, line.text, ago, holders, places);
  if (!told) return [base];
  return told.map((t, i) => ({
    ...base,
    id: i === 0 ? base.id : tellingId(base.id, t),
    text: `${ago === 0 ? 'This year' : ago === 1 ? 'A year ago' : `${ago} years ago`}, in year ${line.year}: ${t.text}`,
    truth: t.truth,
    depth: t.truth === 'rumour' ? 3 : t.recent ? 1 : 2,
    heldBy: t.heldBy,
  }));
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

// --- One list of what a place knows (#1618) ---

/**
 * A fact in a place's one list (`VillageMemory.known`): one of its own remembered facts, or one of
 * its country's regional facts. A fact that merged the two names what it took in (`absorbs`).
 */
export type PlaceFact = (RememberedFact | RegionalFact) & {
  /** The ids of the regional facts merged into this one because they tell the same thing. */
  absorbs?: readonly string[];
};

/**
 * The engine's event kinds each regional event kind is read from (storytelling/regions.ts: the
 * `switch` in its politics pass, its `UNREST`, `ARRIVALS`, `BANDITS` and `FAIRS` sets, and the
 * famine and plague pass). Kept here as names so this module never loads the engine; if the
 * regional level starts reading another engine event, add it here (remembered-known.test.ts
 * checks the four sets against that file's source). Regional kinds that come from no one engine event (a
 * hard winter, a boom, a venture's luck, levies, dues, a flared feud) aren't listed: no
 * province line tells the same thing.
 */
export const SAME_EVENT_KINDS: Readonly<Record<string, readonly string[]>> = {
  LORD_DIED: ['SUCCESSION'],
  SEAT_VACANT: ['SUCCESSION_CRISIS'],
  SEAT_SEIZED: ['USURP', 'LOWBORN_RISE'],
  FEUD: ['WAR'],
  BORDER_WAR: ['WAR'],
  FAMINE: ['FAMINE'],
  PLAGUE: ['PLAGUE'],
  FESTIVAL: ['FESTIVAL_HELD'],
  FAIR: ['GREAT_MARKET_FAIR', 'GRAND_FAIR'],
  BANDITRY: ['HIGHWAY_ROBBER_LEGEND', 'BANDIT_KING_RISES', 'MASS_JAILBREAK'],
  UNREST: ['FOOD_RIOT', 'MARKETPLACE_RIOT', 'PEASANT_REVOLT', 'BREAD_RIOT', 'TAX_REVOLT', 'URBAN_MOB_RIOT', 'TAX_COLLECTOR_LYNCHED', 'PEASANT_JACQUERIE'],
  MIGRATION: [
    'REFUGEES_ARRIVE', 'SETTLED_NEW_HOMELAND', 'BARBARIAN_INVASION', 'DIASPORA_FORMED',
    'LOST_ROMAN_LEGION', 'LOST_VIKING_EXPEDITION', 'LOST_MONGOL_TUMEN', 'LOST_GREEK_HOPLITES', 'LOST_EGYPTIAN_PRIESTHOOD',
    'LOST_CELTIC_WARBAND', 'LOST_SAMURAI_RETINUE', 'LOST_BYZANTINE_CATAPHRACTS', 'LOST_PERSIAN_IMMORTALS',
    'LOST_CARTHAGINIAN_FLEET', 'LOST_NORMAN_KNIGHTS', 'LOST_HAN_EXPEDITION',
  ],
};

/** Regional kinds told once for the whole region, with no province when several of its lands suffered. */
const REGION_WIDE: ReadonlySet<string> = new Set(['FAMINE', 'PLAGUE']);

/**
 * Whether a province's told event and one of its region's told events are the same happening:
 * the same year, the regional kind read from the province event's kind (`SAME_EVENT_KINDS`), and
 * the same place, or, for a famine or plague across several of the region's lands (told with no
 * province), the region's telling of it. Told lines carry no engine event id, so this is what's
 * left to match on, and it's enough: a province tells one deed per person per year (history.ts
 * `pickLines`) and the regional level tells a deed once, so a year, a kind and a place pin it.
 */
export function sameEvent(line: HistoryLine, province: string, regional: RegionLine): boolean {
  if (line.year !== regional.year || !line.kind) return false;
  if (!(SAME_EVENT_KINDS[regional.kind] ?? []).includes(line.kind)) return false;
  return regional.province === province || (regional.province === null && REGION_WIDE.has(regional.kind));
}

/**
 * Two facts telling the same thing, as one. The place's own (`own`) keeps its id and scope and
 * takes the richer text (the longer; its own on a tie), the stricter sensitivity, the shallower
 * depth, and both facts' topics. Truth is the same for both (the same year against the same
 * LIVING_MEMORY); if it ever weren't, the less certain would win.
 *
 * Why the place's own scope: the knowledge model gives a fact one scope, and everyone in the
 * village lives in its country, so for the people this list is about, the village scope loses
 * nothing. It's the more specific scope, which the model answers from first anyway (knowledge.ts
 * `SPECIFICITY`). Depth only gets shallower: the country tells a seizure to most (depth 2), the
 * village to everyone (1), so everyone in the village knows it.
 */
export function mergeFacts(own: RememberedFact, regional: RegionalFact, absorbs: readonly string[] = [regional.id]): PlaceFact {
  // An old event told by who remembers it (#1650, `heldBy` on either): the village's own telling
  // stands, words and truth, since it's the village's memory the list is of, and the country's
  // tellings are absorbed all the same, so the list doesn't hold the event twice.
  const ownTelling = !!own.heldBy || !!regional.heldBy;
  return {
    ...own,
    about: [...own.about, ...regional.about.filter(a => !own.about.includes(a))],
    text: ownTelling || regional.text.length <= own.text.length ? own.text : regional.text,
    sensitivity: STEPS[Math.max(STEPS.indexOf(own.sensitivity), STEPS.indexOf(regional.sensitivity))],
    truth: ownTelling || own.truth === regional.truth ? own.truth : 'rumour',
    depth: Math.min(own.depth, regional.depth) as 1 | 2 | 3,
    absorbs,
  };
}

/**
 * What one road village knows, as one list (#1618): its own remembered facts (`facts`: who holds
 * it, for the village and for the road, and its told events), then its country's regional facts
 * (regional-facts.ts `factsOfRegion`). Two that tell the same thing become one (`mergeFacts`, at
 * the village fact's place in the list):
 * - **who holds it**: the village's holder fact and its country's `lord:` fact for its seat;
 * - **an event**: one of its told events and its country's telling of it (`sameEvent`).
 * The north-road holder fact stays as it is: it's the caravan's (scope `north-road`), who live in
 * no village and no country, and no country fact can stand in for it.
 *
 * Every regional fact left keeps its own id, scope and fields, so a country's facts are the same
 * in every village's list that has them: an id means one thing in every list. A merged fact keeps
 * the village fact's id (`history:<village>:…`), which only that village's list has.
 * Pure: nothing read but the arguments (an old event's tellings are already in them, #1650).
 */
export function placeKnowledge(village: AnchorId, p: ProvinceHistory, facts: readonly RememberedFact[], country: RegionHistory | null, present: number, countryHolders?: readonly Holder[]): PlaceFact[] {
  if (!country) return [...facts];
  const regional = factsOfRegion(country, present, countryHolders);
  const byId = new Map(regional.map(f => [f.id, f]));
  const lineId = (i: number) => `region:${country.id}:${country.lines[i].year}:${i}`;
  const absorbed = new Set<string>();
  const own: PlaceFact[] = facts.map(f => {
    let match: RegionalFact | undefined;
    if (f.id === `history:${village}:holder`) {
      // The country's lord fact for this seat, if it names the same holder (it should: both are
      // read from the same title at the end of the history).
      const lord = byId.get(`region:${country.id}:lord:${regionOf(p)}`);
      if (lord && p.holder && lord.text.startsWith(`${p.holder} holds `)) match = lord;
    } else {
      const k = p.lines.findIndex((line, i) => f.id === `history:${village}:${line.year}:${i}`);
      const j = k < 0 ? -1 : country.lines.findIndex((r, i) => !absorbed.has(lineId(i)) && sameEvent(p.lines[k], p.name, r));
      if (j >= 0) match = byId.get(lineId(j));
    }
    if (!match) return f;
    // With old history bending (#1650), the country may tell the same event several ways: when the
    // village tells it its own way, every one of the country's tellings goes into the one fact.
    const others = f.heldBy || match.heldBy ? regional.filter(r => r.id.startsWith(`${match!.id}:told-by:`)).map(r => r.id) : [];
    for (const id of [match.id, ...others]) absorbed.add(id);
    return mergeFacts(f, match, [match.id, ...others]);
  });
  return [...own, ...regional.filter(f => !absorbed.has(f.id))];
}
