/**
 * Building a run record (#1558): records.ts has the shape, this reads it off a finished game. Two
 * sources, one shape: the API's games (`runOf`, from the game's state when it ends, with `measure`
 * called after every move) and the nightly AI playtest's transcripts (`runOfTranscript`, from the
 * day-by-day progress the harness already writes). Both fill the full progress in `detail` from
 * the same snapshot (artificer-ai/progress.ts), so a person's record and a model's compare field by
 * field.
 */

import { currentRun, type AppState } from '../artificer-app/controller';
import { summarizeRun, summarizeRoad, type RunRecord } from '../artificer/legacy';
import { conceptRanks } from '../artificer/rank';
import { SKILL_IDS, skillLevel } from '../artificer/skills';
import { DEFAULT_CALENDAR, MIDWINTER_AFTER } from '../artificer/winter';
import type { Region1State } from '../artificer/region1';
import { progressOf, type Progress } from '../artificer-ai/progress';
import type { Transcript } from '../artificer-ai/report';
import { nicknameOf, type PlayerKind, type Run, type RunDetail, type Surface } from './records';

/** Measures taken while a game is played, because the end state can't show them (#1558). */
export interface GameMeasures {
  larderMidwinter?: number;
}

/** The morning of midwinter in this run's calendar. */
export const midwinterDay = (s: Region1State): number => s.config.calendar.winterDay + MIDWINTER_AFTER;

/**
 * Take the measures due by now: the larder on the first morning at or past midwinter. Called after
 * every move; a measure is taken once and kept, so later moves don't change it.
 */
export function measure(m: GameMeasures, app: AppState): GameMeasures {
  if (m.larderMidwinter !== undefined || app.stage === 'road') return m;
  const s = app.sim;
  return s.day >= midwinterDay(s) && !s.outcome ? { ...m, larderMidwinter: s.stores.rations } : m;
}

export interface RunMeta {
  playerKind: PlayerKind;
  model: string | null;
  client: string | null;
  surface: Surface;
  gameVersion: string;
  name: string | null;
  moves: number;
  costUsd?: number | null;
}

/** The record for a game that has ended. Throws if it hasn't: only a finished game has a record. */
export function runOf(app: AppState, measures: GameMeasures, meta: RunMeta): Run {
  const onRoad = app.stage === 'road' && !!app.road;
  if (onRoad ? !app.road!.outcome : !app.sim.outcome) throw new Error('only a finished game has a run record');
  const rec: RunRecord = onRoad ? summarizeRoad(app.road!, app.sim, 1) : summarizeRun(app.sim, 1);
  // Skills, concepts, the land, the stores and readiness are the Reach's (at the thaw, for a run that
  // rode on): a playtest transcript keeps those only for the Reach, and records from both sources
  // must compare like with like. Stats and the body are read from wherever the run ended.
  const last = currentRun(app);
  const skills = Object.fromEntries(SKILL_IDS.map(id => [id, skillLevel(app.sim.skills, id)]));
  // The road counts its own days from 1 at the thaw (as summarizeRoad does).
  const roadDay = (d: number): number => app.sim.day + d - 1;
  const milestones = milestoneDays([
    ...app.sim.log,
    ...(onRoad ? app.road!.log.map(l => ({ ...l, day: roadDay(l.day) })) : []),
  ]);
  const v = last.vitals;
  return {
    playerKind: meta.playerKind,
    model: meta.model,
    client: meta.client,
    surface: meta.surface,
    gameVersion: meta.gameVersion,
    nickname: nicknameOf(meta.name),
    outcome: rec.kind,
    grade: rec.grade ?? null,
    stage: onRoad ? 'road' : 'reach',
    endDay: rec.day,
    readyDay: rec.readyDay,
    larderMidwinter: measures.larderMidwinter ?? null,
    shelterTier: rec.tier,
    skillLevels: Object.values(skills).reduce((n, l) => n + l, 0),
    conceptRanks: conceptRanks(app.sim),
    recipes: rec.recipes,
    milestones: rec.milestones,
    moves: meta.moves,
    costUsd: meta.costUsd ?? null,
    detail: {
      site: rec.site, tools: rec.tools, topConcept: rec.topConcept, skills, ...(rec.road ? { road: rec.road } : {}),
      ...progressDetail(progressOf(app.sim, 0)),
      concepts: Object.fromEntries(Object.entries(app.sim.concepts).map(([id, c]) => [id, c.rank])),
      stats: { ...last.character.stats },
      vitals: { vigor: Math.round(v.vigor.current), clarity: Math.round(v.clarity.current), condition: Math.round(v.condition) },
      milestones,
    },
  };
}

// ── From the playtest's transcripts ─────────────────────────────────────────

/**
 * The model a transcript's player played as: `openrouter:google/gemini-2.5-pro` → the OpenRouter id,
 * `claude:claude-haiku-5-5:low` → the Claude model. Anything else (the scripted and random
 * baselines) as it's named.
 */
export function modelOf(player: string): string {
  const [kind, model] = player.split(':');
  return (kind === 'openrouter' || kind === 'claude') && model ? model : player;
}

/** Is this transcript a model's game (not a scripted or random baseline)? Only those become records. */
export const isModelGame = (t: Pick<Transcript, 'player'>): boolean => /^(openrouter|claude):/.test(t.player);

/**
 * A playtest transcript's record. The transcript holds no game state, only the progress snapshot
 * the harness took after every day, so everything comes from those: the last snapshot for where the
 * run ended, the first one at or past midwinter for the larder, and each day's journal for when a
 * milestone came. Null for a game that didn't finish (the budget stopped it mid-run).
 */
export function runOfTranscript(t: Transcript, meta: { gameVersion: string; client?: string }): Run | null {
  // A game the budget stopped mid-Reach has no ending. One stopped at the thaw (`roadStopped`) did
  // finish the Reach, so it counts, as a run that lived to the thaw.
  if (t.record.kind === 'stopped') return null;
  const reach: Progress = t.turns.at(-1)?.progress ?? t.start;
  const road = t.road;
  const roadLast = road?.turns.at(-1)?.progress ?? road?.start;
  // The road counts its own days from 1 at the thaw (as summarizeRoad does).
  const roadDay = (d: number): number => t.record.day + d - 1;
  // The first snapshot at or past the morning of midwinter (a snapshot is taken after the night,
  // so its day is the morning about to start). It counts only if the Warden woke to it: a later
  // turn was played, or the run lived to the thaw. A transcript doesn't say its calendar, so this
  // assumes the default one, which the nightly playtest plays (a shortened test year would be off).
  const midwinter = DEFAULT_CALENDAR.winterDay + MIDWINTER_AFTER;
  const at = t.turns.findIndex(x => x.progress.day >= midwinter);
  const woke = at >= 0 && (at < t.turns.length - 1 || t.record.kind === 'survived');
  const lines = [
    ...t.turns.flatMap(x => (x.journal ?? []).map(text => ({ day: x.day, text }))),
    ...(road?.turns ?? []).flatMap(x => (x.journal ?? []).map(text => ({ day: roadDay(x.day), text }))),
  ];
  const top = Object.entries(reach.concepts).filter(([, c]) => c.rank > 0).sort((a, b) => b[1].rank - a[1].rank || a[0].localeCompare(b[0]))[0];
  return {
    playerKind: 'ai',
    model: modelOf(t.player),
    client: meta.client ?? 'artificer-bench',
    surface: 'bench',
    gameVersion: meta.gameVersion,
    nickname: null,
    outcome: road ? road.record.kind : t.record.kind,
    grade: t.record.grade ?? null,
    stage: road ? 'road' : 'reach',
    endDay: road && roadLast ? roadDay(roadLast.day) : t.record.day,
    readyDay: t.record.readyDay,
    larderMidwinter: woke ? t.turns[at].progress.stores.rations : null,
    shelterTier: reach.shelter.tier,
    skillLevels: reach.skillLevels,
    conceptRanks: reach.conceptRanks,
    recipes: roadLast?.recipesKnown ?? reach.recipesKnown,
    milestones: reach.milestones,
    // The playtest plans a whole day per turn, so its moves are its days played.
    moves: t.turns.length + (road?.turns.length ?? 0),
    costUsd: t.usage.cost ?? null,
    detail: {
      site: reach.shelter.site, tools: reach.tools, topConcept: top ? { id: top[0], rank: top[1].rank } : null, skills: reach.skills,
      ...(road?.record.road ? { road: road.record.road } : {}),
      ...progressDetail(reach),
      concepts: Object.fromEntries(Object.entries(reach.concepts).map(([id, c]) => [id, c.rank])),
      stats: { ...((roadLast?.stats ?? reach.stats) ?? {}) },
      vitals: roadLast ? { ...roadLast.vitals } : { vigor: reach.vitals.vigor, clarity: reach.vitals.clarity, condition: reach.vitals.condition },
      milestones: milestoneDays(lines),
    },
  };
}

// ── Shared ──────────────────────────────────────────────────────────────────

/** The parts of the full progress both sources read off the same snapshot. */
function progressDetail(p: Progress): Pick<RunDetail, 'stores' | 'exploration' | 'readiness'> {
  return {
    stores: { ...p.stores },
    exploration: { total: p.exploration, byRing: { ...p.explorationByRing }, finds: p.finds },
    readiness: { pillars: { ...p.pillars }, overall: p.readiness },
  };
}

const MILESTONE = /^Milestone — (.+)$/;

/** The day each milestone was first reached, from journal lines, in the order they came. */
export function milestoneDays(lines: readonly { day: number; text: string }[]): { name: string; day: number }[] {
  const seen = new Set<string>();
  const out: { name: string; day: number }[] = [];
  for (const l of lines) {
    const m = MILESTONE.exec(l.text);
    if (m && !seen.has(m[1])) {
      seen.add(m[1]);
      out.push({ name: m[1], day: l.day });
    }
  }
  return out;
}
