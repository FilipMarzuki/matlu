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
 * Pure and deterministic: plain data in, plain data out, no randomness, no engine.
 */

import { LIVING_MEMORY, type ReachHistory, type RegionHistory, type RegionLine } from './history-format';

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
}

/**
 * About a generation: within living memory, an event this recent is remembered by everyone
 * (depth 1), an older one by most (depth 2), since the young weren't born to see it. The one
 * definition, shared with remembered.ts (#1586).
 */
export const GENERATION = LIVING_MEMORY / 2;

/** Lines whose subject people are careful about. */
const GUARDED = new Set(['FEUD', 'SEAT_SEIZED']);

/** Every region's facts, region by region in the history's order. */
export function regionalFacts(history: ReachHistory): RegionalFact[] {
  return history.regions.flatMap(r => factsOfRegion(r, history.year));
}

/** The region a province belongs to, by the province's id this run (`p3`) or its name. */
export function regionOfProvince(history: ReachHistory, province: string): RegionHistory | undefined {
  return history.regions.find(r => r.provinces.some(p => p.id === province || p.name === province));
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

const TRADE: Record<string, string> = {
  farming: 'its fields', lumber: 'timber', mining: 'ore', fishing: 'fish', herding: 'its flocks', peat: 'peat and reed', trading: 'its market',
};

const FOUNDED: Record<string, string> = {
  crossing: 'the ford', farming: 'its fields', lumber: 'the woods', mining: 'a seam of ore', fishing: 'the fishing',
  herding: 'its pastures', peat: 'the peat cuttings',
};

/** "Hollowford grew up around the ford; today it lives on its market, and on timber besides." */
export function placeTrade(p: RegionHistory['provinces'][number]): string {
  const founded = FOUNDED[p.founding] ?? p.founding;
  const today = TRADE[p.livelihood] ?? p.livelihood;
  const also = (p.secondary ?? []).map(t => TRADE[t] ?? t);
  const besides = also.length ? `, and on ${also.join(' and ')} besides` : '';
  return p.founding === p.livelihood
    ? `${p.name} grew up around ${founded}, and still lives on ${today}${besides}.`
    : `${p.name} grew up around ${founded}; today it lives on ${today}${besides}.`;
}

/** One region's facts: how things stand now, then what happened there, oldest first. */
export function factsOfRegion(r: RegionHistory, present: number): RegionalFact[] {
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
  facts.push(now('trade', 'economy', `${Name} lives on ${TRADE[r.primary] ?? r.primary}; its market is at ${r.centre.name}.`, 1, { about: [place(r.centre.name)] }));
  // Each place: what it grew up around, and what it lives on today ("Hollowford grew up around
  // the ford; today it lives on its market, and on timber besides").
  for (const p of r.provinces) {
    facts.push(now(`livelihood:${slug(p.name)}`, 'economy', placeTrade(p), p.name === r.centre.name ? 1 : 2, { about: [place(p.name)] }));
  }
  const ventureText = {
    thriving: `The ${r.venture.kind} at ${r.venture.province} is thriving.`,
    steady: `The ${r.venture.kind} at ${r.venture.province} gets by.`,
    failing: `The ${r.venture.kind} at ${r.venture.province} is failing.`,
    closed: `The ${r.venture.kind} at ${r.venture.province} has closed.`,
  }[r.venture.state];
  facts.push(now('venture', 'economy', ventureText, 1, { about: [place(r.venture.province)] }));
  facts.push(now('times', 'economy',
    r.prosperity >= 0.65 ? `Times are good in ${r.name}.` : r.prosperity <= 0.35 ? `Times are hard in ${r.name}.` : `${Name} gets by, neither rich nor poor.`, 1));
  facts.push(now('bread', 'economy',
    r.price >= 1.4 ? `Bread is dear in ${r.name}: ${r.price.toFixed(1)} times its usual price.` : r.price <= 0.8 ? `Bread is cheap in ${r.name} this year.` : `Bread costs what it usually does in ${r.name}.`, 1));
  for (const road of r.roads) {
    if (road.trade >= 0.55) facts.push(now(`road:${road.to}`, 'economy', `Trade is brisk on the road to ${road.name}.`, 2, { about: [`region:${road.to}`] }));
    else if (road.trade <= 0.28) facts.push(now(`road:${road.to}`, 'economy', `Little trade goes on the road to ${road.name} these days.`, 3, { about: [`region:${road.to}`] }));
  }

  // --- politics, as it stands ---
  if (r.leadingHouse) facts.push(now('leading-house', 'politics', `The house of ${r.leadingHouse} holds the most seats in ${r.name}.`, 1));
  // Everyone knows who holds the market town; most know the other seats' lords.
  r.lords.forEach(lord => facts.push(now(`lord:${slug(lord.province)}`, 'politics', lord.text, lord.province === r.centre.name ? 1 : 2, { about: [place(lord.province)] })));
  facts.push(now('dues', 'politics',
    r.tax >= 0.45 ? `The lords of ${r.name} tax heavily.` : r.tax <= 0.25 ? `The lords of ${r.name} ask little in dues.` : `The lords' dues in ${r.name} are what they've always been.`, 1));
  if (r.levy >= 0.2) facts.push(now('levy', 'politics', `Many of ${r.name}'s men are away, called up for their lords' wars.`, 1));
  for (const f of r.feuds) {
    facts.push(now(`feud:${slug(f.houses.join('-'))}`, 'politics', `The houses of ${f.houses[0]} and ${f.houses[1]} are at odds: their lords last fought in year ${f.year}.`, 2, { sensitivity: 'guarded' }));
  }
  r.alliances.forEach(([a, b], k) => facts.push(now(`alliance:${k}`, 'politics', `${a} and ${b} stand together.`, 2)));

  // --- what happened there ---
  r.lines.forEach((line, k) => facts.push(lineFact(r, line, present, k)));
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
  const when = ago === 0 ? 'This year' : ago === 1 ? 'A year ago' : `${ago} years ago`;
  return {
    id: `region:${r.id}:${line.year}:${k}`,
    about: [`region:${r.id}`, ...(line.province ? [`place:${slug(line.province)}`] : [])],
    text: `${when}, in year ${line.year}: ${line.text}`,
    scope: { kind: 'region', id: r.id },
    sensitivity: GUARDED.has(line.kind) ? 'guarded' : 'public',
    truth: living ? 'true' : 'rumour',
    depth,
    year: line.year,
    kind: line.category,
  };
}
