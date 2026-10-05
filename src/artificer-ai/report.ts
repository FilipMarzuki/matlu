/**
 * Cross-run progression report (#1229): fold many AI transcripts into
 * per-model, day-by-day curves and "when did it first happen" milestones, so
 * you can see *how* each model progresses, not only how it ended.
 *
 * Pure — the CLI (scripts/ai-report.ts) reads the files and renders the result.
 */

import type { Progress } from './progress';

/** The parts of a saved transcript the report reads (see scripts/ai-play.ts). */
export interface Transcript {
  player: string;
  start: Progress;
  turns: { day: number; queue: (string | { q: string })[]; invalid: boolean; exit: string | null; progress: Progress }[];
  record: { kind: string; choice: string; day: number; readyDay: number | null };
  usage: { input: number; output: number; cacheRead: number; cost?: number | null; costEstimated?: boolean };
}

/** Day-by-day numbers worth plotting. Each reads one value off a snapshot. */
export const METRICS = {
  readiness: { label: 'Winter readiness (mean of the 4 pillars)', unit: '%', of: (p: Progress) => p.readiness * 100 },
  conceptRanks: { label: 'Concept ranks', unit: '', of: (p: Progress) => p.conceptRanks },
  insight: { label: 'Insight (total)', unit: '', of: (p: Progress) => p.insight },
  recipesKnown: { label: 'Recipes known', unit: '', of: (p: Progress) => p.recipesKnown },
  skillLevels: { label: 'Skill levels — true (sum of 7)', unit: '', of: (p: Progress) => p.skillLevels ?? 0 },
  perceivedSkillLevels: { label: 'Skill levels — self-assessed', unit: '', of: (p: Progress) => p.perceivedSkillLevels ?? 0 },
  crafts: { label: 'Crafts & builds made', unit: '', of: (p: Progress) => p.crafts },
  exploration: { label: 'Exploration (sum of levels)', unit: '', of: (p: Progress) => p.exploration },
  rations: { label: 'Rations', unit: '', of: (p: Progress) => p.stores.rations },
  firewood: { label: 'Firewood', unit: '', of: (p: Progress) => p.stores.firewood },
  materials: { label: 'Materials', unit: '', of: (p: Progress) => p.stores.materials },
  warmth: { label: 'Shelter warmth', unit: '%', of: (p: Progress) => p.shelter.warmth * 100 },
  condition: { label: 'Condition', unit: '', of: (p: Progress) => p.vitals.condition },
  vigorCap: { label: 'Vigor capacity', unit: '', of: (p: Progress) => p.vitals.vigorCap },
  milestones: { label: 'Milestones', unit: '', of: (p: Progress) => p.milestones },
  overexertions: { label: 'Times pushed past empty', unit: '', of: (p: Progress) => p.overexertions },
} as const;
export type MetricKey = keyof typeof METRICS;

/** Key moments: the first day a predicate holds (the snapshot closing that day). */
export const EVENTS = {
  shelter: { label: 'First shelter', test: (p: Progress) => p.shelter.tier >= 1 },
  walls: { label: 'Shelter finished (tier 2)', test: (p: Progress) => p.shelter.tier >= 2 },
  discovery: { label: 'First recipe discovered', test: (p: Progress) => p.discoveries >= 1 },
  conceptRank: { label: 'First concept rank', test: (p: Progress, start: Progress) => p.conceptRanks > start.conceptRanks },
  firstTool: { label: 'First tool', test: (p: Progress) => p.tools.length >= 1 },
  ring2: { label: 'Reached the far ring', test: (p: Progress) => p.explorationByRing[2] > 0 },
  ring3: { label: 'Reached the distant ring', test: (p: Progress) => p.explorationByRing[3] > 0 },
  larder: { label: 'Larder pillar done', test: (p: Progress) => p.pillars.larder >= 1 },
  fuel: { label: 'Fuel pillar done', test: (p: Progress) => p.pillars.fuel >= 1 },
  shelterPillar: { label: 'Shelter pillar done', test: (p: Progress) => p.pillars.shelter >= 1 },
  ready: { label: 'Winter-ready', test: (p: Progress) => p.winterReady },
  locked: { label: 'First survival lock', test: (p: Progress) => !!p.locked },
} as const;
export type EventKey = keyof typeof EVENTS;

export interface ModelSummary {
  model: string;
  runs: number;
  outcomes: Record<string, number>;
  /** Mean ready day over runs that got ready, and how many did. */
  readyDay: number | null;
  readyRuns: number;
  invalidDays: number;
  tokens: { input: number; output: number; cacheRead: number };
  /** USD (#1231): mean per game, total, and per thriving run — null when no run reported a cost. */
  cost: { perGame: number | null; total: number | null; perThrive: number | null; estimated: boolean };
  /** metric → mean value at the end of day d (index 0 = before day 1), over runs still going that day. */
  series: Record<MetricKey, (number | null)[]>;
  /** event → mean first day, and how many runs reached it. */
  events: Record<EventKey, { day: number | null; runs: number }>;
  /** Action id → how often it was queued, per run. */
  actions: Record<string, number>;
}

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (x: number | null, dp = 1): number | null => (x === null ? null : Math.round(x * 10 ** dp) / 10 ** dp);

/** Short model name from a player id like "openrouter:anthropic/claude-haiku-4.5". */
export const modelOf = (player: string): string => player.replace(/^(openrouter|claude):/, '').replace(/:(low|medium|high|xhigh|max)$/, '');

/** Group transcripts by model and summarise each. */
export function aggregate(transcripts: readonly Transcript[]): ModelSummary[] {
  const byModel = new Map<string, Transcript[]>();
  for (const t of transcripts) {
    const m = modelOf(t.player);
    byModel.set(m, [...(byModel.get(m) ?? []), t]);
  }

  return [...byModel.entries()].map(([model, runs]) => {
    // Each run as a day-indexed list of snapshots: [start, end of day 1, end of day 2, …].
    const timelines = runs.map(r => [r.start, ...r.turns.map(t => t.progress)]);
    const days = Math.max(...timelines.map(t => t.length));

    const series = Object.fromEntries((Object.keys(METRICS) as MetricKey[]).map(k => [k,
      Array.from({ length: days }, (_, d) => round(mean(timelines.filter(t => t[d]).map(t => METRICS[k].of(t[d]))))),
    ])) as Record<MetricKey, (number | null)[]>;

    const events = Object.fromEntries((Object.keys(EVENTS) as EventKey[]).map(k => {
      const firsts = runs.map(r => r.turns.find(t => EVENTS[k].test(t.progress, r.start))?.day).filter((d): d is number => d !== undefined);
      return [k, { day: round(mean(firsts)), runs: firsts.length }];
    })) as Record<EventKey, { day: number | null; runs: number }>;

    const actions: Record<string, number> = {};
    for (const r of runs) for (const t of r.turns) for (const item of t.queue) {
      const id = (typeof item === 'string' ? item : item.q).split('@')[0];
      actions[id] = (actions[id] ?? 0) + 1 / runs.length;
    }
    for (const k of Object.keys(actions)) actions[k] = round(actions[k])!;

    const outcomes: Record<string, number> = {};
    for (const r of runs) outcomes[r.record.kind] = (outcomes[r.record.kind] ?? 0) + 1;
    const ready = runs.map(r => r.record.readyDay).filter((d): d is number => d !== null);

    return {
      model,
      runs: runs.length,
      outcomes,
      readyDay: round(mean(ready)),
      readyRuns: ready.length,
      invalidDays: runs.reduce((n, r) => n + r.turns.filter(t => t.invalid).length, 0),
      tokens: {
        input: Math.round(mean(runs.map(r => r.usage.input))!),
        output: Math.round(mean(runs.map(r => r.usage.output))!),
        cacheRead: Math.round(mean(runs.map(r => r.usage.cacheRead))!),
      },
      cost: costOf(runs),
      series,
      events,
      actions,
    };
  }).sort((a, b) => (b.outcomes.thrive ?? 0) / b.runs - (a.outcomes.thrive ?? 0) / a.runs || (a.readyDay ?? 99) - (b.readyDay ?? 99));
}

function costOf(runs: readonly Transcript[]): ModelSummary['cost'] {
  const known = runs.filter(r => typeof r.usage.cost === 'number');
  if (!known.length) return { perGame: null, total: null, perThrive: null, estimated: false };
  const total = known.reduce((n, r) => n + (r.usage.cost as number), 0);
  const thrives = known.filter(r => r.record.kind === 'thrive').length;
  const r4 = (x: number): number => Math.round(x * 10000) / 10000;
  return {
    perGame: r4(total / known.length),
    total: r4(total),
    perThrive: thrives ? r4(total / thrives) : null,
    estimated: known.some(r => r.usage.costEstimated),
  };
}
