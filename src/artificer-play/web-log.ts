/**
 * A web-game run's log (#1559): the page's half of re-simulated runs. The server's half, which
 * checks a log and plays it again, is web-run.ts.
 *
 * The main Artificer page runs the sim in the browser, so a record it sent could say anything. The
 * sim is deterministic, so the page keeps a log instead: the Warden it started from (the creation
 * screen's choices, what an earlier Warden left, the rule features) and every move, in the
 * session's move format (session.ts). At the end the player may send the log with a claim, what
 * the page says the run came to, and the server writes a record only if its replay ends the same.
 *
 * Kept apart from the replay so the page bundles only this: no session core, no AI text views.
 */

import type { AppState } from '../artificer-app/controller';
import type { Tool } from '../artificer/crafting';
import type { TalentId } from '../artificer/talents';
import type { Stats } from '../artificer/stats';
import type { KitId } from '../artificer/kit';
import type { Move } from './session';
import type { Run } from './records';
import { measure, type GameMeasures } from './record-of';
import { GAME_VERSION } from './version';

/** The log format's own version: a log from another one isn't replayed. */
export const WEB_LOG_VERSION = 1;

/**
 * The Warden a web run started from: exactly what the page passed to `makeWarden` (and `repack`).
 * Left-out fields are the defaults, as on the page when the creation screen was skipped.
 */
export interface WebStart {
  /** The Warden's id, which seeds the world: a fresh one, or the weekly world's (weekly.ts). */
  id: string;
  name?: string;
  portrait?: string;
  /** The talents picked from the four on offer, up to two (#1728: fewer adds to the difficulty; the offer comes from the id). */
  chosen?: TalentId[];
  stats?: Stats;
  age?: number;
  /** The pack, if the packing screen was passed (it repacks); absent, the leader's list. */
  pack?: KitId[];
  /** The run's rule features (#1579), as the run holds them. */
  features: Record<string, boolean>;
  /**
   * What the last Warden left (#1455), as the page passed it: null for no legacy at all, a list
   * (maybe empty) for a legacy. The server believes heirlooms only from a run it has checked
   * itself: `heirloomsFrom`, that run's game id.
   */
  heirlooms: Tool[] | null;
  heirloomsFrom?: string | null;
}

/**
 * A move as the web game logs it: the session's moves, with pins (#1380) as two more free
 * settings, `{ set: { pin: "<pin id>|<0–3>" } }` and `{ set: { forget: "<pin id>" } }`.
 */
export type WebMove =
  | Exclude<Move, { set: unknown }>
  | { set: { focus?: string; eating?: string; site?: string; forget?: string; pin?: string } };

export interface WebLog {
  v: number;
  /** The session's version when the run began: another version's run can't replay. */
  version: string;
  start: WebStart;
  moves: WebMove[];
}

/** A log for a Warden the page just made, with no moves yet. */
export function newLog(start: WebStart): WebLog {
  return { v: WEB_LOG_VERSION, version: GAME_VERSION, start, moves: [] };
}

/** What the page keeps while it plays: the log, and the measures taken on the way (the larder at midwinter). */
export interface Recorder {
  log: WebLog;
  measures: GameMeasures;
  /**
   * Played with dev mode on (#1735): true once dev mode was on while the run was still being played,
   * absent otherwise. Beside the log, not in it: dev mode changes no move, so the replay (and the
   * game id made from the log) is the same either way. Sent with the run, so its record says so.
   */
  dev?: true;
}

/**
 * Mark a run as played in dev mode (#1735) if dev mode is on now and the run is this Warden's and
 * not over yet. Dev mode turned on after the end doesn't mark a run that was played without it. A
 * mark is never taken off: leaving dev mode doesn't unplay what was played in it. Hands back the
 * same recorder when nothing changes.
 */
export function markDev<R extends Recorder>(rec: R | null, a: AppState, dev: boolean): R | null {
  if (!rec || !dev || rec.dev || rec.log.start.id !== a.sim.character.id || runOver(a)) return rec;
  return { ...rec, dev: true };
}

/** What the page sends to the records (POST /api/v1/runs/submit): the log, the claim, a name, and `dev` only if it was on. */
export function submitBody(rec: Recorder, claim: Claim, name: string): { log: WebLog; claim: Claim; name: string; dev?: true } {
  return { log: rec.log, claim, name, ...(rec.dev ? { dev: true as const } : {}) };
}

/**
 * Is a run over, as the page sees it: dead or collapsed in the Reach, stayed behind at the thaw, or
 * at the end of the road? A Warden who survived the winter but hasn't met the caravan yet isn't done.
 */
export const runOver = (a: AppState): boolean =>
  a.stage === 'road' ? !!a.road?.outcome : !!a.sim.outcome && (a.sim.outcome.kind !== 'survived' || !!a.stayed);

/**
 * Did a page action change the game, not just the plan? The queue is the page's own: editing it
 * isn't a move, only running it is. Controller functions hand back the same objects when they do
 * nothing, so a reference check is enough.
 */
export const gameChanged = (before: AppState, after: AppState): boolean =>
  before.sim !== after.sim || before.road !== after.road || before.meeting !== after.meeting || before.stage !== after.stage || before.stayed !== after.stayed;

/**
 * Write down a move the page made, if it changed the game, and take any measure due after it, as
 * the API does after every move. A recorder for another Warden (or none) is handed back as it is,
 * and so is one whose run is over: the page still lets you pick a focus or let a pin go after the
 * end, but the run is what it was, and a replay goes no further than its last move.
 */
export function recordMove<R extends Recorder>(rec: R | null, before: AppState, after: AppState, move: WebMove): R | null {
  if (!rec || rec.log.start.id !== after.sim.character.id || runOver(before) || !gameChanged(before, after)) return rec;
  return { ...rec, log: { ...rec.log, moves: [...rec.log.moves, move] }, measures: measure(rec.measures, after) };
}

// ── The claim: what the page says its run came to ───────────────────────────

/** The fields that rank a run and the measures achievements read: what a replay must match. */
export const CLAIM_FIELDS = ['outcome', 'grade', 'stage', 'endDay', 'readyDay', 'larderMidwinter', 'shelterTier', 'skillLevels', 'conceptRanks', 'recipes', 'milestones'] as const;
export type Claim = Pick<Run, typeof CLAIM_FIELDS[number]>;

export const claimOf = (r: Run): Claim => Object.fromEntries(CLAIM_FIELDS.map(k => [k, r[k]])) as Claim;

/** The fields where a claim and the replay's record differ: empty when the run replays to itself. */
export function claimMismatch(claim: unknown, replayed: Run): string[] {
  if (typeof claim !== 'object' || claim === null || Array.isArray(claim)) return [...CLAIM_FIELDS];
  const c = claim as Record<string, unknown>;
  return CLAIM_FIELDS.filter(k => c[k] !== replayed[k]);
}
