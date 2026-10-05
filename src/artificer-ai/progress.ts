/**
 * Progression snapshots (#1229): everything that "grows" in a run, captured
 * once per AI turn so runs can be compared day by day and aggregated across
 * models. Pure: a snapshot is read off the sim state, nothing more.
 */

import { warmth, readinessInput, type Region1State } from '../artificer/region1';
import { pillars, isWinterReady, type PillarKey } from '../artificer/readiness';
import { RINGS, DOMAINS, level } from '../artificer/exploration';
import { artificerRank, conceptRanks, type RankName } from '../artificer/rank';

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
  /** Times the Warden pushed past empty so far (each costs Condition). */
  overexertions: number;
}

const r1 = (x: number): number => Math.round(x * 10) / 10;
const r2 = (x: number): number => Math.round(x * 100) / 100;

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
  };
}
