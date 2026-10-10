/**
 * Building a run record (#1558) from a finished game: records.ts has the shape, this reads it off
 * the game's state. The API calls `measure` after every move and `runOf` when a game ends.
 */

import type { AppState } from '../artificer-app/controller';
import { summarizeRun, summarizeRoad, type RunRecord } from '../artificer/legacy';
import { conceptRanks } from '../artificer/rank';
import { SKILL_IDS, skillLevel } from '../artificer/skills';
import { MIDWINTER_AFTER } from '../artificer/winter';
import type { Region1State } from '../artificer/region1';
import { nicknameOf, type PlayerKind, type Run, type Surface } from './records';

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
  // Skills and concepts keep growing on the road, so they're read from wherever the run ended.
  const last = onRoad ? app.road! : app.sim;
  const skills = Object.fromEntries(SKILL_IDS.map(id => [id, skillLevel(last.skills, id)]));
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
    conceptRanks: conceptRanks(last),
    recipes: rec.recipes,
    milestones: rec.milestones,
    moves: meta.moves,
    costUsd: meta.costUsd ?? null,
    detail: { site: rec.site, tools: rec.tools, topConcept: rec.topConcept, skills, ...(rec.road ? { road: rec.road } : {}) },
  };
}
