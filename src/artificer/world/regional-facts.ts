/**
 * What the people of a region know of it (#1598): the story engine's regional level
 * (storytelling/regions.ts), read off a told history as facts for the knowledge model
 * (docs/knowledge-model-design.md; owner's answer 3: regional facts come from the story engine
 * and cover politics, economics and regional events, not only who holds a province).
 *
 * Two kinds of fact per region:
 * - **how things stand now** (the present year): what it lives on and where its market is, how
 *   it's doing and what bread costs, its venture (the mine, the lumber camp…), who leads it,
 *   its lords' dues and levies, feuds and alliances, the roads to its neighbours;
 * - **what happened there**: its told regional events (history.ts `regionsOf`), each dated,
 *   true within living memory and drifting into rumour beyond it.
 *
 * Nothing in play reads these yet. Which region a place belongs to is regions.ts's rule (#1586):
 * a crafted region (the road villages' north road) wins, and these generated ones fill the rest.
 *
 * With remembered.ts (#1586): both make the knowledge model's `Fact` shape (knowledge.ts), so a
 * village's facts and its region's can be read as one `Fact[]`. They share `GENERATION` and the
 * living-memory rule. Sensitivity differs on purpose: remembered.ts grades a house's affairs by
 * how public they were and the teller's stake (up to `private`/`secret`); regional news here is
 * `public` or `guarded`.
 *
 * **Old history bends (#1650)**, with `old-history-drift` on: an event past its tellers' living
 * memory is told as the region's Peoples and cultures tell it (world/old-history.ts), one fact
 * per telling, so a region of short-lived humans and long-lived Bergfolk can hold two accounts of
 * one old plague. Off (and in every run from before the switch), as the history tells it.
 *
 * Pure and deterministic: plain data in, plain data out, no engine. The only dice are
 * old-history.ts's, seeded by the event and who tells it.
 */

import { economyLine, economyOfProvince, ventureFits, TRADE_WORDS } from '../economy';
import { featureOn, type FeatureSwitches } from '../features';
import { LIVING_MEMORY, type ReachHistory, type RegionHistory, type RegionLine } from './history-format';
import { oldTellings, regionHolders, tellingId, type HeldBy, type Holder } from './old-history';

/** A regional fact: the knowledge model's `Fact` shape (design §1), with when and what kind. */
export interface RegionalFact {
  /** Stable for the same history: `region:<region id>:<what>`. */
  id: string;
  /** The topic keys it answers: the region's (`region:hollowford-country`) and its places' (`place:saltmere`). */
  about: readonly string[];
  text: string;
  /** Everyone living or travelling in the region can know it. */
  scope: { kind: 'region'; id: string };
  /** `public` for most news; `guarded` for lords' quarrels and seized seats, which people are careful about. */
  sensitivity: 'public' | 'guarded';
  /** `true` for how things stand and what's remembered; `rumour` for what has passed into legend. */
  truth: 'true' | 'rumour';
  /** 1 everyone in the region knows it, 2 most do, 3 only the best-placed (a trader, an elder). */
  depth: 1 | 2 | 3;
  /** The year it's about: the present for how things stand. */
  year: number;
  kind: 'politics' | 'economy' | 'event';
  /**
   * Who tells it this way (#1650), on an old event with `old-history-drift` on: the region's
   * People and cultures whose telling this is, their share of the region, and how many times it's
   * been retold among them (0: an eyewitness still tells it). Absent on everything else.
   */
  heldBy?: readonly HeldBy[];
}

/**
 * About a generation: within living memory, an event this recent is remembered by everyone
 * (depth 1), an older one by most (depth 2), since the young weren't born to see it. The one
 * definition, shared with remembered.ts (#1586).
 */
export const GENERATION = LIVING_MEMORY / 2;

/** A region's richest and poorest places are told when their wealth (#1608; 0.5 getting by) is this far apart. */
const WEALTH_SPREAD = 0.12;
/** ...and the richest is "wanting for little" at this or more, the poorest "on hard times" at this or less. */
const RICH = 0.68;
export const POOR = 0.32;
/** A region is told as uneasy at this unsettlement or more (#1608): about a seized seat in the last year or two. */
export const UNSETTLED = 0.25;
/**
 * Where a region's facts turn: times are hard at this prosperity or less (good at `GOOD_TIMES` or
 * more), bread dear at this price or more, its lords tax heavily at this tax or more and ask
 * little at `LIGHT_DUES` or less. Exported so how people speak there (place-candour.ts, #1619)
 * turns where the facts they'd tell you do.
 */
export const HARD_TIMES = 0.35;
const GOOD_TIMES = 0.65;
export const DEAR_BREAD = 1.4;
export const HEAVY_DUES = 0.45;
export const LIGHT_DUES = 0.25;

/** Lines whose subject people are careful about. */
const GUARDED = new Set(['FEUD', 'SEAT_SEIZED']);

/**
 * Every region's facts, region by region in the history's order. With `old-history-drift` on in
 * the run (#1650), each region's old events are told the way its people tell them (`regionHolders`):
 * one fact per telling, bent by age and culture (world/old-history.ts).
 */
export function regionalFacts(history: ReachHistory, features?: FeatureSwitches): RegionalFact[] {
  const drift = featureOn(features, 'old-history-drift');
  return history.regions.flatMap(r => factsOfRegion(r, history.year, drift ? regionHolders(history, r.id) : undefined));
}

/** The region a province belongs to, by the province's id this run (`p3`) or its name. */
export function regionOfProvince(history: ReachHistory, province: string): RegionHistory | undefined {
  return history.regions.find(r => r.provinces.some(p => p.id === province || p.name === province));
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * What a place grew up around and lives on today, from its economy (economy.ts, #1599): a road
 * village's as written ("Saltmere grew up around the fishing, when the mere was still sweet
 * water; today it lives on salt…"), any other place's as the engine gave it ("Ravenford grew up
 * around the ford; today it lives on its market, and on timber besides"). The engine scores the
 * land at a road village's seat like any other, so without this it could tell Saltmere as a
 * lumber town.
 */
export function placeTrade(p: RegionHistory['provinces'][number]): string {
  return economyLine(p.name, economyOfProvince(p));
}

/**
 * The region's venture as people at `place` tell it. At a road village that doesn't live on the
 * venture's trade (a lumber camp at Saltmere, which lives on salt), it's out in the province's
 * land beyond the village, not in it: the engine put it there because that land suits it.
 */
export function ventureWhere(r: RegionHistory): string {
  const p = r.provinces.find(x => x.name === r.venture.province);
  return p && !ventureFits(economyOfProvince(p), r.venture.kind) ? `out beyond ${r.venture.province}` : `at ${r.venture.province}`;
}

/**
 * One region's facts: how things stand now, then what happened there, oldest first. Given its
 * `holders` (#1650: who lives there, `regionHolders`), an old event is told as they tell it
 * (`lineFacts`); without, as the history tells it, as before the switch.
 */
export function factsOfRegion(r: RegionHistory, present: number, holders?: readonly Holder[]): RegionalFact[] {
  const scope = { kind: 'region' as const, id: r.id };
  const regionKey = `region:${r.id}`;
  const place = (name: string) => `place:${slug(name)}`;
  const now = (what: string, kind: RegionalFact['kind'], text: string, depth: 1 | 2 | 3, extra: { about?: string[]; sensitivity?: RegionalFact['sensitivity'] } = {}): RegionalFact => ({
    id: `region:${r.id}:${what}`, about: [regionKey, ...(extra.about ?? [])], text, scope,
    sensitivity: extra.sensitivity ?? 'public', truth: 'true', depth, year: present, kind,
  });
  const Name = cap(r.name);
  const facts: RegionalFact[] = [];

  // --- economy, as it stands ---
  facts.push(now('trade', 'economy', `${Name} lives on ${TRADE_WORDS[r.primary] ?? r.primary}; its market is at ${r.centre.name}.`, 1, { about: [place(r.centre.name)] }));
  // Each place: what it grew up around, and what it lives on today ("Hollowford grew up around
  // the ford; today it lives on its market, and on timber besides").
  for (const p of r.provinces) {
    facts.push(now(`livelihood:${slug(p.name)}`, 'economy', placeTrade(p), p.name === r.centre.name ? 1 : 2, { about: [place(p.name)] }));
  }
  // How well off its places are (#1608), only where one stands out from the rest: people talk
  // about the richest and the poorest place around, not every place that gets by. (How the
  // region as a whole is doing is the `times` fact below.)
  const byWealth = [...r.provinces].sort((a, b) => (b.wealth ?? 0.5) - (a.wealth ?? 0.5) || a.name.localeCompare(b.name));
  const richest = byWealth[0], poorest = byWealth[byWealth.length - 1];
  if (richest && poorest && (richest.wealth ?? 0.5) - (poorest.wealth ?? 0.5) >= WEALTH_SPREAD) {
    facts.push(now(`wealth:${slug(richest.name)}`, 'economy', `${richest.name} is the best-off place in ${r.name}: its stores are full${(richest.wealth ?? 0.5) >= RICH ? ' and its people want for little' : ''}.`, 2, { about: [place(richest.name)] }));
    facts.push(now(`wealth:${slug(poorest.name)}`, 'economy', `${poorest.name} is the worst-off place in ${r.name}${(poorest.wealth ?? 0.5) <= POOR ? ': it has fallen on hard times' : ''}.`, 2, { about: [place(poorest.name)] }));
  }
  const where = ventureWhere(r);
  const ventureText = {
    thriving: `The ${r.venture.kind} ${where} is thriving.`,
    steady: `The ${r.venture.kind} ${where} gets by.`,
    failing: `The ${r.venture.kind} ${where} is failing.`,
    closed: `The ${r.venture.kind} ${where} has closed.`,
  }[r.venture.state];
  facts.push(now('venture', 'economy', ventureText, 1, { about: [place(r.venture.province)] }));
  facts.push(now('times', 'economy',
    r.prosperity >= GOOD_TIMES ? `Times are good in ${r.name}.` : r.prosperity <= HARD_TIMES ? `Times are hard in ${r.name}.` : `${Name} gets by, neither rich nor poor.`, 1));
  facts.push(now('bread', 'economy',
    r.price >= DEAR_BREAD ? `Bread is dear in ${r.name}: ${r.price.toFixed(1)} times its usual price.` : r.price <= 0.8 ? `Bread is cheap in ${r.name} this year.` : `Bread costs what it usually does in ${r.name}.`, 1));
  for (const road of r.roads) {
    if (road.trade >= 0.55) facts.push(now(`road:${road.to}`, 'economy', `Trade is brisk on the road to ${road.name}.`, 2, { about: [`region:${road.to}`] }));
    else if (road.trade <= 0.28) facts.push(now(`road:${road.to}`, 'economy', `Little trade goes on the road to ${road.name} these days.`, 3, { about: [`region:${road.to}`] }));
  }

  // --- politics, as it stands ---
  if (r.leadingHouse) facts.push(now('leading-house', 'politics', `The house of ${r.leadingHouse} holds the most seats in ${r.name}.`, 1));
  // Everyone knows who holds the market town; most know the other seats' lords.
  r.lords.forEach(lord => facts.push(now(`lord:${slug(lord.province)}`, 'politics', lord.text, lord.province === r.centre.name ? 1 : 2, { about: [place(lord.province)] })));
  facts.push(now('dues', 'politics',
    r.tax >= HEAVY_DUES ? `The lords of ${r.name} tax heavily.` : r.tax <= LIGHT_DUES ? `The lords of ${r.name} ask little in dues.` : `The lords' dues in ${r.name} are what they've always been.`, 1));
  // Unsettled (#1608): lords dying and seats changing hands lately make people wary of what's next.
  if ((r.unsettled ?? 0) >= UNSETTLED) facts.push(now('unsettled', 'politics', `The lords of ${r.name} are uneasy: lords have died and seats have changed hands lately.`, 1, { sensitivity: 'guarded' }));
  if (r.levy >= 0.2) facts.push(now('levy', 'politics', `Many of ${r.name}'s men are away, called up for their lords' wars.`, 1));
  for (const f of r.feuds) {
    facts.push(now(`feud:${slug(f.houses.join('-'))}`, 'politics', `The houses of ${f.houses[0]} and ${f.houses[1]} are at odds: their lords last fought in year ${f.year}.`, 2, { sensitivity: 'guarded' }));
  }
  r.alliances.forEach(([a, b], k) => facts.push(now(`alliance:${k}`, 'politics', `${a} and ${b} stand together.`, 2)));

  // --- what happened there ---
  r.lines.forEach((line, k) => facts.push(...(holders ? lineFacts(r, line, present, k, holders) : [lineFact(r, line, present, k)])));
  return facts;
}

/**
 * A told regional event as a fact. Within living memory it's `true`: everyone remembers it if
 * it's within a generation (depth 1), most if older (2), and small news (a fair, a road's trade,
 * significance 2 or less) only most (2) even when recent. Beyond living memory it's a `rumour`
 * that only the best-placed still tell (3), as #1592's province events.
 */
export function lineFact(r: RegionHistory, line: RegionLine, present: number, k = 0): RegionalFact {
  const ago = present - line.year;
  const living = ago <= LIVING_MEMORY;
  const depth: 1 | 2 | 3 = !living ? 3 : ago <= GENERATION && line.significance > 2 ? 1 : 2;
  const when = whenOf(ago);
  // The engine's venture news names the venture "at" its province ("The lumber camp at Saltmere
  // was thriving."); at a road village that doesn't live on it, it's out beyond (`ventureWhere`).
  const told = toldLine(r, line);
  return {
    id: `region:${r.id}:${line.year}:${k}`,
    about: [`region:${r.id}`, ...(line.province ? [`place:${slug(line.province)}`] : [])],
    text: `${when}, in year ${line.year}: ${told}`,
    scope: { kind: 'region', id: r.id },
    sensitivity: GUARDED.has(line.kind) ? 'guarded' : 'public',
    truth: living ? 'true' : 'rumour',
    depth,
    year: line.year,
    kind: line.category,
  };
}

const whenOf = (ago: number): string => (ago === 0 ? 'This year' : ago === 1 ? 'A year ago' : `${ago} years ago`);

/** A regional event's words as told in the region: a venture out beyond a road village that doesn't live on it (`lineFact`). */
function toldLine(r: RegionHistory, line: RegionLine): string {
  const beyond = line.kind.startsWith('VENTURE_') && line.province === r.venture.province && ventureWhere(r).startsWith('out beyond');
  return beyond ? line.text.replace(` at ${line.province}`, ` out beyond ${line.province}`) : line.text;
}

/**
 * A told regional event as its region's `holders` tell it (#1650, world/old-history.ts
 * `oldTellings`): within LIVING_MEMORY and seen by all of them, the one fact `lineFact` gives.
 * Older, or past some People's living memory, one fact per telling: the most widely held keeps
 * the event's own id (so `placeKnowledge` still finds it), each other one is told under
 * `tellingId`. An eyewitness telling is `true`, at depth 1 within its witnesses' first generation
 * if it's big news, else 2; a retold one is a `rumour` only the best-placed tell (3). Only the
 * event's words bend: "N years ago, in year Y:" is put on after, so the year never moves.
 */
export function lineFacts(r: RegionHistory, line: RegionLine, present: number, k: number, holders: readonly Holder[]): RegionalFact[] {
  const base = lineFact(r, line, present, k);
  const ago = present - line.year;
  const told = oldTellings(base.id, toldLine(r, line), ago, holders, r.provinces.map(p => p.name));
  if (!told) return [base];
  return told.map((t, i) => ({
    ...base,
    id: i === 0 ? base.id : tellingId(base.id, t),
    text: `${whenOf(ago)}, in year ${line.year}: ${t.text}`,
    truth: t.truth,
    depth: t.truth === 'rumour' ? 3 : t.recent && line.significance > 2 ? 1 : 2,
    heldBy: t.heldBy,
  }));
}
