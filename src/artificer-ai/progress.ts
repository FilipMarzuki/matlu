/**
 * Progression snapshots (#1229): everything that "grows" in a run, captured
 * once per AI turn so runs can be compared day by day and aggregated across
 * models. Pure: a snapshot is read off the sim state, nothing more.
 */

import { warmth, readinessInput, survivalLockOf, type Region1State } from '../artificer/region1';
import { focusKey } from '../artificer/focus';
import { pillars, isWinterReady, type PillarKey } from '../artificer/readiness';
import { RINGS, DOMAINS, level } from '../artificer/exploration';
import { artificerRank, conceptRanks, type RankName } from '../artificer/rank';
import { SKILL_IDS, skillLevel, perceivedLevel } from '../artificer/skills';
import { villageOf, type RoadState } from '../artificer/road';
import type { Stats } from '../artificer/stats';

export interface Progress {
  /** The day about to start (a turn's snapshot is taken after its night). */
  day: number;
  rank: RankName;
  /** Concept id → rank and insight. */
  concepts: Record<string, { rank: number; insight: number }>;
  conceptRanks: number;
  /** Total insight across concepts, including what's banked toward the next rank. */
  insight: number;
  recipesKnown: number;
  /** Skill id → true level (#1236), and the sum of all levels. */
  skills: Record<string, number>;
  skillLevels: number;
  /** Sum of the self-assessed levels (#1241) — compare with skillLevels for the Dunning–Kruger gap. */
  perceivedSkillLevels: number;
  /** Recipes discovered this run (beyond what the run started with). */
  discoveries: number;
  /** Successful crafts and builds so far, and ones that came apart. */
  crafts: number;
  failedCrafts: number;
  tools: string[];
  stores: { rawFood: number; water: number; firewood: number; materials: number; rations: number; stone: number; hides: number };
  /** Sum of exploration levels over every ring × domain (0–3 each). */
  exploration: number;
  /** Per ring: the summed level of its domains. */
  explorationByRing: Record<1 | 2 | 3, number>;
  finds: number;
  shelter: { site: string | null; tier: number; warmth: number };
  vitals: { vigor: number; vigorCap: number; clarity: number; clarityCap: number; condition: number };
  /** Each readiness pillar's progress (0–1); `readiness` is their mean. */
  pillars: Record<PillarKey, number>;
  readiness: number;
  winterReady: boolean;
  milestones: number;
  /** The chosen focus key and the survival-lock reason, if any (#1238). */
  focus: string;
  locked: string | null;
  /** Times the Warden pushed past empty so far (each costs Condition). */
  overexertions: number;
  /** Carrying so far (#1297): stones left behind, hours walked overloaded, raw food spoiled — and strain now. */
  carry?: { leftStones: number; overloadedHours: number; spoiled: number; strain: number };
  /**
   * Stats (#1259): what they are now, and exercise (hours) — banked towards the next point, and
   * pending, waiting on a proper night. Absent on transcripts from before stats were recorded.
   */
  stats?: Stats;
  exercise?: { banked: Partial<Stats>; pending: Partial<Stats> };
}

const r1 = (x: number): number => Math.round(x * 10) / 10;
const r2 = (x: number): number => Math.round(x * 100) / 100;
/** Exercise hours to one decimal, dropping zeros so snapshots stay small. */
const roundAll = (x: Partial<Stats> | undefined): Partial<Stats> =>
  Object.fromEntries(Object.entries(x ?? {}).filter(([, h]) => h).map(([k, h]) => [k, r1(h as number)]));

/** Snapshot the state. `startKnown` is how many recipes the run began with. */
export function progressOf(s: Region1State, startKnown: number): Progress {
  const text = s.log.map(l => l.text);
  const count = (re: RegExp): number => text.filter(t => re.test(t)).length;
  const ps = pillars(readinessInput(s));
  const byRing = { 1: 0, 2: 0, 3: 0 } as Record<1 | 2 | 3, number>;
  for (const r of RINGS) for (const d of DOMAINS) byRing[r] += level(s.explore, r, d);

  return {
    day: s.day,
    rank: artificerRank(s),
    concepts: Object.fromEntries(Object.entries(s.concepts).map(([k, c]) => [k, { rank: c.rank, insight: r1(c.insight) }])),
    conceptRanks: conceptRanks(s),
    insight: r1(Object.values(s.concepts).reduce((n, c) => n + c.insight, 0)),
    recipesKnown: s.known.length,
    skills: Object.fromEntries(SKILL_IDS.map(id => [id, skillLevel(s.skills, id)])),
    skillLevels: SKILL_IDS.reduce((n, id) => n + skillLevel(s.skills, id), 0),
    perceivedSkillLevels: SKILL_IDS.reduce((n, id) => n + perceivedLevel(s.skills, id), 0),
    discoveries: s.known.length - startKnown,
    crafts: count(/^(Crafted|Raised) /),
    failedCrafts: count(/came apart in your hands/),
    tools: s.tools.map(t => `${t.item}:${t.grade}`),
    stores: { ...s.stores },
    exploration: byRing[1] + byRing[2] + byRing[3],
    explorationByRing: byRing,
    finds: s.explore.finds.length,
    shelter: { site: s.site, tier: s.tier, warmth: r2(warmth(s)) },
    vitals: {
      vigor: Math.round(s.vitals.vigor.current), vigorCap: Math.round(s.vitals.vigor.cap),
      clarity: Math.round(s.vitals.clarity.current), clarityCap: Math.round(s.vitals.clarity.cap),
      condition: Math.round(s.vitals.condition),
    },
    // A pillar reads 1 only when it's actually done — rounding 0.996 up to 1 hid an unmet threshold.
    pillars: Object.fromEntries(ps.map(p => [p.key, p.done ? 1 : Math.min(0.99, r2(p.progress))])) as Record<PillarKey, number>,
    readiness: ps.every(p => p.done) ? 1 : Math.min(0.99, r2(ps.reduce((n, p) => n + p.progress, 0) / ps.length)),
    winterReady: isWinterReady(readinessInput(s)),
    milestones: s.milestones.length,
    overexertions: count(/^Pushed past empty/),
    focus: focusKey(s.focus),
    locked: survivalLockOf(s),
    carry: { leftStones: r1(s.tally?.leftStones ?? 0), overloadedHours: r1(s.tally?.overloadedHours ?? 0), spoiled: s.tally?.spoiled ?? 0, strain: r1(s.strain ?? 0) },
    stats: { ...s.character.stats },
    exercise: { banked: roundAll(s.character.exercise), pending: roundAll(s.character.pending) },
  };
}

// ── The road (#1251) ────────────────────────────────────────────────────────

/** A road day's progression: what the caravan road grows — marks, trust, quests, techniques, lore. */
export interface RoadProgress {
  /** The road day about to start. */
  day: number;
  /** Index into ROUTE, and the village you're in (null on the wagon). */
  leg: number;
  village: string | null;
  marks: number;
  /** Sum of trust over everyone met. */
  totalTrust: number;
  peopleMet: number;
  questsDone: number;
  questsFailed: number;
  techniques: number;
  /** Lore lines heard, over everyone. */
  loreHeard: number;
  recipesKnown: number;
  vitals: { vigor: number; clarity: number; condition: number };
  stores: { rawFood: number; water: number };
}

/** Snapshot a road state. */
export function roadProgressOf(r: RoadState): RoadProgress {
  const quests = Object.values(r.quests);
  return {
    day: r.day,
    leg: r.leg,
    village: villageOf(r),
    marks: r.marks,
    totalTrust: Math.round(Object.values(r.trust).reduce((n, t) => n + t, 0) * 10) / 10,
    peopleMet: Object.keys(r.trust).length,
    questsDone: quests.filter(q => q === 'done').length,
    questsFailed: quests.filter(q => q === 'failed' || q === 'expired').length,
    techniques: r.techniques.length,
    loreHeard: Object.values(r.told).reduce((n, t) => n + t, 0),
    recipesKnown: r.known.length,
    vitals: { vigor: Math.round(r.vitals.vigor.current), clarity: Math.round(r.vitals.clarity.current), condition: Math.round(r.vitals.condition) },
    stores: { rawFood: r.stores.rawFood, water: r.stores.water },
  };
}
