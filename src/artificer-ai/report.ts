/**
 * Cross-run progression report (#1229): fold many AI transcripts into
 * per-model, day-by-day curves and "when did it first happen" milestones, so
 * you can see *how* each model progresses, not only how it ended.
 *
 * Pure — the CLI (scripts/ai-report.ts) reads the files and renders the result.
 */

import type { Progress, RoadProgress } from './progress';

/** The parts of a saved transcript the report reads (see scripts/ai-play.ts). */
export interface Transcript {
  player: string;
  start: Progress;
  turns: { day: number; queue: (string | { q: string })[]; invalid: boolean; exit?: string | null; progress: Progress; journal?: string[];
    encounters?: { id: string; kind: string; choice: string; died?: boolean; forced?: boolean; state?: string; override?: { chosen: string; taken: string }; fearsGained?: string[] }[];
    fright?: { spooks: number; uneasyNights: number; sleeplessNights: number; fearsGained: string[]; fearsLost: string[] };
    pins?: { made: string[]; forgotten: string[]; held: string[] } }[];
  record: { kind: string; choice: string; day: number; readyDay: number | null; grade?: string };
  usage: { input: number; output: number; cacheRead: number; cost?: number | null; costEstimated?: boolean };
  /** The caravan meeting at the thaw (#1357). */
  meeting?: { steps: { step: string; choice: string; success: boolean; forced?: boolean }[]; ended: string; fare: string | null; owesHelp: number };
  /** The Warden's talents and quirks at the end (#1267): true tiers, signs, reveal days. Absent on older transcripts. */
  gifts?: {
    talents: { id: string; tier: number; chosen: boolean; foundEarlier?: boolean; signs: number; revealedDay: number | null }[];
    quirks: { id: string; known: boolean; revealedDay: number | null }[];
  };
  /** The caravan road, for a run that rode on (#1251). */
  road?: {
    start: RoadProgress;
    turns: { day: number; actions: string[]; invalid: boolean; progress: RoadProgress; journal?: string[] }[];
    record: { kind: string; road?: { villages: string[]; quests: number; marks: number } };
  };
}

/** Road-day numbers worth plotting (#1251). */
export const ROAD_METRICS = {
  marks: { label: 'Marks', unit: '', of: (p: RoadProgress) => p.marks },
  totalTrust: { label: 'Trust (sum over people met)', unit: '', of: (p: RoadProgress) => p.totalTrust },
  questsDone: { label: 'Quests done', unit: '', of: (p: RoadProgress) => p.questsDone },
  techniques: { label: 'Techniques known', unit: '', of: (p: RoadProgress) => p.techniques },
  loreHeard: { label: 'Lore lines heard', unit: '', of: (p: RoadProgress) => p.loreHeard },
  condition: { label: 'Condition', unit: '', of: (p: RoadProgress) => p.vitals.condition },
} as const;
export type RoadMetricKey = keyof typeof ROAD_METRICS;

/** How a model plays the road (#1251), over its runs that rode on. */
export interface RoadSummary {
  runs: number;
  outcomes: Record<string, number>;
  /** Means at the end of the road. */
  marks: number | null;
  quests: number | null;
  trust: number | null;
  invalidDays: number;
  /** metric → mean at the end of road day d (index 0 = boarding). */
  series: Record<RoadMetricKey, (number | null)[]>;
  /** Road action kind (talk, sell, …) → how often it was chosen, per run. */
  actions: Record<string, number>;
}

/** Summarise the runs that rode the road, or null when none did. */
export function roadSummaryOf(runs: readonly Transcript[]): RoadSummary | null {
  const rode = runs.filter(r => r.road);
  if (!rode.length) return null;
  const timelines = rode.map(r => [r.road!.start, ...r.road!.turns.map(t => t.progress)]);
  const days = Math.max(...timelines.map(t => t.length));
  const series = Object.fromEntries((Object.keys(ROAD_METRICS) as RoadMetricKey[]).map(k => [k,
    Array.from({ length: days }, (_, d) => round(mean(timelines.filter(t => t[d]).map(t => ROAD_METRICS[k].of(t[d]))))),
  ])) as Record<RoadMetricKey, (number | null)[]>;
  const outcomes: Record<string, number> = {};
  for (const r of rode) outcomes[r.road!.record.kind] = (outcomes[r.road!.record.kind] ?? 0) + 1;
  const last = (r: Transcript): RoadProgress => r.road!.turns.at(-1)?.progress ?? r.road!.start;
  const actions: Record<string, number> = {};
  for (const r of rode) for (const t of r.road!.turns) for (const a of t.actions) {
    const kind = a.split(':')[0];
    actions[kind] = (actions[kind] ?? 0) + 1 / rode.length;
  }
  for (const k of Object.keys(actions)) actions[k] = round(actions[k])!;
  return {
    runs: rode.length,
    outcomes,
    marks: round(mean(rode.map(r => last(r).marks))),
    quests: round(mean(rode.map(r => last(r).questsDone))),
    trust: round(mean(rode.map(r => last(r).totalTrust))),
    invalidDays: rode.reduce((n, r) => n + r.road!.turns.filter(t => t.invalid).length, 0),
    series,
    actions,
  };
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
  // Carrying (#1297): totals so far, so the curve's steps show the day it happened.
  leftStones: { label: 'Stones left behind (total)', unit: '', of: (p: Progress) => p.carry?.leftStones ?? 0 },
  overloadedHours: { label: 'Hours walked overloaded (total)', unit: '', of: (p: Progress) => p.carry?.overloadedHours ?? 0 },
  spoiled: { label: 'Raw food spoiled (total)', unit: '', of: (p: Progress) => p.carry?.spoiled ?? 0 },
  strain: { label: 'Strain', unit: '', of: (p: Progress) => p.carry?.strain ?? 0 },
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
  cost: { perGame: number | null; total: number | null; perWin: number | null; estimated: boolean };
  /** metric → mean value at the end of day d (index 0 = before day 1), over runs still going that day. */
  series: Record<MetricKey, (number | null)[]>;
  /** event → mean first day, and how many runs reached it. */
  events: Record<EventKey, { day: number | null; runs: number }>;
  /** Action id → how often it was queued, per run. */
  actions: Record<string, number>;
  /** Surviving the winter (#1309). */
  survival: Survival;
  /** The caravan road (#1251), over runs that rode on; null when none did. */
  road: RoadSummary | null;
  /** Encounters met out on the land (#1348). */
  encounters: EncounterSummary;
  /** What fear did (#1365). */
  fright: FrightSummary;
  /** Places remembered (#1381). */
  pins: PinSummary;
  /** Injuries (#1395): how bad, how they worsened, what they left. */
  injuries: InjurySummary;
  /** Talents and quirks (#1267): what was picked, how far each grew, and whether the hidden ones came to light. Null without gift records. */
  gifts: GiftSummary | null;
  /** How the caravan was met (#1357); null when no run met it. */
  meetings: MeetingSummary | null;
}

/** How a model's Wardens met the caravan (#1357). */
export interface MeetingSummary {
  runs: number;
  /** How the ride was paid (goods, marks, work, word, craft) — or `stayed`, for letting them pass. Counts. */
  fares: Record<string, number>;
  /** Answers that fell back to the safest option (total). */
  forced: number;
}

/** Count how a model's Wardens met the caravan (#1357). */
export function meetingSummaryOf(runs: readonly Transcript[]): MeetingSummary | null {
  const met = runs.filter(r => r.meeting);
  if (!met.length) return null;
  const fares: Record<string, number> = {};
  for (const r of met) { const k = r.meeting!.ended === 'stay' ? 'stayed' : r.meeting!.fare ?? 'none'; fares[k] = (fares[k] ?? 0) + 1; }
  return { runs: met.length, fares, forced: met.reduce((n, r) => n + r.meeting!.steps.filter(s => s.forced).length, 0) };
}

/** What a model's Wardens chose to remember (#1381). */
export interface PinSummary {
  /** Places remembered, let go, and held at the end — mean per run. */
  made: number;
  forgotten: number;
  held: number;
  /** Pin kind → how many were remembered, let go, and held at the end (totals over all runs). */
  madeByKind: Record<string, number>;
  forgottenByKind: Record<string, number>;
  heldByKind: Record<string, number>;
}

/** Count the places a model's Wardens remembered, let go, and kept to the end (#1381). */
export function pinSummaryOf(runs: readonly Transcript[]): PinSummary {
  const madeByKind: Record<string, number> = {}, forgottenByKind: Record<string, number> = {}, heldByKind: Record<string, number> = {};
  const add = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };
  let made = 0, forgotten = 0, held = 0;
  for (const r of runs) {
    for (const t of r.turns) for (const k of t.pins?.made ?? []) { add(madeByKind, k); made++; }
    for (const t of r.turns) for (const k of t.pins?.forgotten ?? []) { add(forgottenByKind, k); forgotten++; }
    // Pins change only on turns that made or let one go, so the last such turn holds what the run ended with.
    const last = [...r.turns].reverse().find(t => t.pins);
    for (const k of last?.pins?.held ?? []) { add(heldByKind, k); held++; }
  }
  const n = runs.length || 1;
  return { made: round(made / n, 2)!, forgotten: round(forgotten / n, 2)!, held: round(held / n, 2)!, madeByKind, forgottenByKind, heldByKind };
}

/** How a model's Wardens got hurt (#1395): injuries by severity, how many worsened, and the harms they left. */
export interface InjurySummary {
  /** Severity → injuries suffered (totals). */
  bySeverity: Record<string, number>;
  /** Injuries made grave by working through them, and cuts that festered (totals). */
  aggravated: number;
  festered: number;
  /** Lasting harm → times gained (totals). */
  harms: Record<string, number>;
  /** Injuries per run. */
  perRun: number;
}

/** Count injuries over a model's runs (#1395), from the journal. */
export function injurySummaryOf(runs: readonly Transcript[]): InjurySummary {
  const s: InjurySummary = { bySeverity: {}, aggravated: 0, festered: 0, harms: {}, perRun: 0 };
  let total = 0;
  for (const r of runs) for (const t of r.turns) for (const l of t.journal ?? []) {
    // An injuring accident's line ends with its severity (#1392).
    const sev = /\((minor|serious|grave)\)$/.exec(l)?.[1];
    if (sev && !/is mending/.test(l)) { s.bySeverity[sev] = (s.bySeverity[sev] ?? 0) + 1; total++; }
    if (/You push on through it, and something gives/.test(l)) s.aggravated++;
    if (/has gone bad overnight/.test(l)) s.festered++;
    const harm = /it has left you with (a stiff knee|a weak grip|a scar)/.exec(l)?.[1];
    if (harm) s.harms[harm] = (s.harms[harm] ?? 0) + 1;
  }
  return { ...s, perRun: round(total / (runs.length || 1), 2)! };
}

/** Talents and quirks over a model's runs (#1267). */
export interface GiftSummary {
  /** Runs with a gift record. */
  runs: number;
  /** How often each talent was picked at creation. */
  picked: Record<string, number>;
  /** Each talent's mean true tier at the end of a run, picked or hidden. */
  tiers: Record<string, number>;
  /** Hidden talents still to find at a run's start, how many came to light, on what mean day, and the mean signs they gathered. */
  hidden: number;
  revealed: number;
  revealDay: number | null;
  signs: number | null;
  /** Runs where at least one quirk showed itself, and the mean day of each run's first. */
  quirkRuns: number;
  quirkDay: number | null;
}

/** What the runs' talents and quirks came to (#1267). */
export function giftSummaryOf(runs: readonly Transcript[]): GiftSummary | null {
  const gs = runs.flatMap(r => (r.gifts ? [r.gifts] : []));
  if (!gs.length) return null;
  const picked: Record<string, number> = {}, tierSum: Record<string, number[]> = {};
  for (const g of gs) for (const t of g.talents) {
    if (t.chosen) picked[t.id] = (picked[t.id] ?? 0) + 1;
    (tierSum[t.id] ??= []).push(t.tier);
  }
  // Only a hidden talent not yet found when the run began can be found in it.
  const toFind = gs.flatMap(g => g.talents.filter(t => !t.chosen && !t.foundEarlier));
  const found = toFind.filter(t => t.revealedDay !== null);
  const firstQuirkDays = gs.flatMap(g => {
    const days = g.quirks.flatMap(q => (q.revealedDay !== null ? [q.revealedDay] : []));
    return days.length ? [Math.min(...days)] : [];
  });
  return {
    runs: gs.length,
    picked,
    tiers: Object.fromEntries(Object.entries(tierSum).map(([id, ts]) => [id, round(mean(ts))!])),
    hidden: toFind.length,
    revealed: found.length,
    revealDay: round(mean(found.map(t => t.revealedDay!))),
    signs: round(mean(toFind.map(t => t.signs))),
    quirkRuns: firstQuirkDays.length,
    quirkDay: round(mean(firstQuirkDays)),
  };
}

/** How a model's Wardens stood up to fear (#1365): panics and overrides in encounters, spooks, fearful nights, fears. */
export interface FrightSummary {
  /** Encounters met shaken, and panicked (totals). */
  shaken: number;
  panicked: number;
  /** Times the body overrode the choice (total). */
  overrides: number;
  /** Per run. */
  spooks: number;
  uneasyNights: number;
  sleeplessNights: number;
  /** Fear id → how many times gained, and faded (totals). */
  fearsGained: Record<string, number>;
  fearsLost: Record<string, number>;
}

/** Count what fear did over a model's runs (#1365). */
export function frightSummaryOf(runs: readonly Transcript[]): FrightSummary {
  const f: FrightSummary = { shaken: 0, panicked: 0, overrides: 0, spooks: 0, uneasyNights: 0, sleeplessNights: 0, fearsGained: {}, fearsLost: {} };
  const add = (m: Record<string, number>, id: string) => { m[id] = (m[id] ?? 0) + 1; };
  for (const r of runs) for (const t of r.turns) {
    for (const e of t.encounters ?? []) {
      if (e.state === 'shaken') f.shaken++;
      if (e.state === 'panicked') f.panicked++;
      if (e.override) f.overrides++;
    }
    if (t.fright) {
      f.spooks += t.fright.spooks; f.uneasyNights += t.fright.uneasyNights; f.sleeplessNights += t.fright.sleeplessNights;
      for (const id of t.fright.fearsGained) add(f.fearsGained, id);
      for (const id of t.fright.fearsLost) add(f.fearsLost, id);
    }
  }
  const n = runs.length || 1;
  return { ...f, spooks: round(f.spooks / n, 2)!, uneasyNights: round(f.uneasyNights / n, 2)!, sleeplessNights: round(f.sleeplessNights / n, 2)! };
}

/** How a model handles encounters (#1348). */
export interface EncounterSummary {
  /** Mean encounters met per run. */
  perRun: number;
  /** Encounter kind → option id → how often it was chosen (totals over all runs). */
  choices: Record<string, Record<string, number>>;
  /** Encounter id → how many runs it ended. */
  deaths: Record<string, number>;
  /** Choices that fell back to the safest option because no valid one came back. */
  forced: number;
}

/** Count encounters, choices by kind and deaths by encounter over a model's runs (#1348). */
export function encounterSummaryOf(runs: readonly Transcript[]): EncounterSummary {
  const choices: Record<string, Record<string, number>> = {};
  const deaths: Record<string, number> = {};
  let met = 0, forced = 0;
  for (const r of runs) for (const t of r.turns) for (const e of t.encounters ?? []) {
    met++;
    if (e.forced) forced++;
    const byKind = (choices[e.kind] ??= {});
    byKind[e.choice] = (byKind[e.choice] ?? 0) + 1;
    if (e.died) deaths[e.id] = (deaths[e.id] ?? 0) + 1;
  }
  return { perRun: runs.length ? round(met / runs.length, 2)! : 0, choices, deaths, forced };
}

/** How a model fares against the winter (#1309). */
export interface Survival {
  /** Share of runs that reached the thaw, 0..1. */
  rate: number;
  /** Survivors by grade. */
  grades: Record<'hale' | 'worn' | 'broken', number>;
  /** Median day the run ended, over runs that didn't reach the thaw (null when all did). */
  deathDay: number | null;
  /** What ended the runs that didn't make it. */
  deaths: Record<string, number>;
  /** The hard nights, by cause, per run. */
  nights: Record<string, number>;
}

/** What ended a run, from its last journal lines. */
export function deathCause(journal: readonly string[]): string {
  const text = journal.join('\n');
  if (/Killed by /.test(text)) return 'encounter';
  if (/Dead of thirst/.test(text)) return 'thirst';
  if (/Dead of starvation/.test(text)) return 'starvation';
  if (/Dead of the cold/.test(text)) return 'cold';
  if (/lost the way back/.test(text)) return 'blizzard';
  if (/wolves find you|bear finds you/.test(text)) return 'collapse (animals)';
  if (/collapse/i.test(text)) return 'collapse (found)';
  return 'other';
}

/** The night hardships worth counting, and how to spot each in the journal. */
export const NIGHT_CAUSES: Readonly<Record<string, RegExp>> = {
  cold: /cold, broken night|fireless night|frost bites|freezing/i,
  hunger: /^Hungry/,
  thirst: /^Thirsty/,
  lean: /lean night/,
  'cabin fever': /^Cabin fever/,
};

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function survivalOf(runs: readonly Transcript[]): Survival {
  const survived = runs.filter(r => r.record.kind === 'survived');
  const grades = { hale: 0, worn: 0, broken: 0 };
  for (const r of survived) if (r.record.grade && r.record.grade in grades) grades[r.record.grade as keyof typeof grades]++;
  const lost = runs.filter(r => r.record.kind === 'died' || r.record.kind === 'collapsed');
  const deaths: Record<string, number> = {};
  for (const r of lost) { const c = deathCause(r.turns.at(-1)?.journal ?? []); deaths[c] = (deaths[c] ?? 0) + 1; }
  const nights: Record<string, number> = {};
  for (const r of runs) for (const t of r.turns) for (const line of t.journal ?? []) {
    for (const [cause, re] of Object.entries(NIGHT_CAUSES)) if (re.test(line)) nights[cause] = (nights[cause] ?? 0) + 1 / runs.length;
  }
  for (const k of Object.keys(nights)) nights[k] = round(nights[k])!;
  return { rate: runs.length ? survived.length / runs.length : 0, grades, deathDay: median(lost.map(r => r.record.day)), deaths, nights };
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
      survival: survivalOf(runs),
      road: roadSummaryOf(runs),
      encounters: encounterSummaryOf(runs),
      fright: frightSummaryOf(runs),
      pins: pinSummaryOf(runs),
      injuries: injurySummaryOf(runs),
      gifts: giftSummaryOf(runs),
      meetings: meetingSummaryOf(runs),
    };
  }).sort((a, b) => wins(b.outcomes) / b.runs - wins(a.outcomes) / a.runs || (a.readyDay ?? 99) - (b.readyDay ?? 99));
}

/**
 * A win: surviving the winter to the thaw (#1302), or — in transcripts from
 * before winter was played — thriving with the caravan.
 */
export const WIN_KINDS: readonly string[] = ['survived', 'thrive'];
/** Wins among a model's outcome counts. */
export const wins = (outcomes: Readonly<Record<string, number>>): number => WIN_KINDS.reduce((n, k) => n + (outcomes[k] ?? 0), 0);

function costOf(runs: readonly Transcript[]): ModelSummary['cost'] {
  const known = runs.filter(r => typeof r.usage.cost === 'number');
  if (!known.length) return { perGame: null, total: null, perWin: null, estimated: false };
  const total = known.reduce((n, r) => n + (r.usage.cost as number), 0);
  const won = known.filter(r => WIN_KINDS.includes(r.record.kind)).length;
  const r4 = (x: number): number => Math.round(x * 10000) / 10000;
  return {
    perGame: r4(total / known.length),
    total: r4(total),
    perWin: won ? r4(total / won) : null,
    estimated: known.some(r => r.usage.costEstimated),
  };
}
