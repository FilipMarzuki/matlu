/**
 * The play API's games, kept in Supabase (#1555): tables `artificer_games` and
 * `artificer_play_usage` (supabase/migrations/20261010000000_artificer_games.sql), and the run
 * records of finished games, `artificer_runs` (#1558, 20261010220000_artificer_runs.sql).
 *
 * All have row-level security on and no policies, so the browser's publishable key can't read
 * or write them at all: only this server code can, with the service-role key. That matters because
 * a game row's `session` holds the seed (see api.ts), and the seed must never reach a player. Run
 * records are public, but only through the API, which picks the columns that go out.
 */

import { createClient } from '@supabase/supabase-js';
import type { GameRecord, GameStore } from './api';
import { rankKey, type Run, type StoredRun } from './records';

/** A row as Postgres has it: snake_case, moves as jsonb, and the move count kept for `update`. */
interface Row {
  id: string;
  version: string;
  session: string;
  moves: GameRecord['moves'];
  move_count: number;
  phase: GameRecord['phase'];
  name: string;
  client: string | null;
  model: string | null;
  ip_key: string;
  surface: GameRecord['surface'];
  player: GameRecord['player'];
  measures: GameRecord['measures'];
  created_at: string;
  updated_at: string;
}

const TABLE = 'artificer_games';

const toRow = (g: GameRecord): Row => ({
  id: g.id, version: g.version, session: g.session, moves: g.moves, move_count: g.moves.length, phase: g.phase,
  name: g.name, client: g.client, model: g.model, ip_key: g.ipKey, surface: g.surface, player: g.player, measures: g.measures,
  created_at: g.createdAt, updated_at: g.updatedAt,
});

const fromRow = (r: Row): GameRecord => ({
  id: r.id, version: r.version, session: r.session, moves: r.moves, phase: r.phase,
  name: r.name, client: r.client, model: r.model ?? null, ipKey: r.ip_key,
  surface: r.surface ?? 'api', player: r.player ?? 'ai', measures: r.measures ?? {},
  createdAt: r.created_at, updatedAt: r.updated_at,
});

/** A run record as Postgres has it. `source_key` is written but never read back out. */
interface RunRow {
  id: string;
  created_at: string;
  player_kind: Run['playerKind'];
  model: string | null;
  client: string | null;
  surface: Run['surface'];
  game_version: string;
  nickname: string | null;
  outcome: string;
  grade: string | null;
  stage: Run['stage'];
  end_day: number;
  ready_day: number | null;
  larder_midwinter: number | null;
  shelter_tier: number;
  skill_levels: number;
  concept_ranks: number;
  recipes: number;
  milestones: number;
  moves: number;
  cost_usd: number | string | null;
  detail: Run['detail'];
}

const RUNS = 'artificer_runs';
/** The columns that go out: everything but `source_key` (it holds the game id) and `rank_key`. */
const RUN_COLUMNS = 'id, created_at, player_kind, model, client, surface, game_version, nickname, outcome, grade, stage, end_day, ready_day, larder_midwinter, shelter_tier, skill_levels, concept_ranks, recipes, milestones, moves, cost_usd, detail';

/** Whole numbers for the integer columns: Postgres refuses 2.5 for an integer, and the record would be lost. */
const int = (x: number): number => Math.round(x);
const intOrNull = (x: number | null): number | null => (x === null ? null : Math.round(x));

export const runToRow = (sourceKey: string, r: Run): Omit<RunRow, 'id' | 'created_at'> & { source_key: string; rank_key: number } => ({
  source_key: sourceKey, player_kind: r.playerKind, model: r.model, client: r.client, surface: r.surface, game_version: r.gameVersion,
  nickname: r.nickname, outcome: r.outcome, grade: r.grade, stage: r.stage, end_day: int(r.endDay), ready_day: intOrNull(r.readyDay),
  larder_midwinter: intOrNull(r.larderMidwinter), shelter_tier: int(r.shelterTier), skill_levels: int(r.skillLevels),
  concept_ranks: int(r.conceptRanks), recipes: int(r.recipes), milestones: int(r.milestones), moves: int(r.moves),
  cost_usd: r.costUsd, rank_key: rankKey(r), detail: r.detail,
});

const runFromRow = (r: RunRow): StoredRun => ({
  id: r.id, createdAt: r.created_at, playerKind: r.player_kind, model: r.model, client: r.client, surface: r.surface,
  gameVersion: r.game_version, nickname: r.nickname, outcome: r.outcome, grade: r.grade, stage: r.stage, endDay: r.end_day,
  readyDay: r.ready_day, larderMidwinter: r.larder_midwinter, shelterTier: r.shelter_tier, skillLevels: r.skill_levels,
  conceptRanks: r.concept_ranks, recipes: r.recipes, milestones: r.milestones, moves: r.moves,
  // Postgres numeric comes back as a string, to keep its precision.
  costUsd: r.cost_usd === null ? null : Number(r.cost_usd), detail: r.detail,
});

export function supabaseStore(url: string, serviceRoleKey: string): GameStore {
  // A server has no user session to keep or refresh: each call is the service role.
  const db = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const check = (error: { message: string } | null, what: string): void => {
    if (error) throw new Error(`${what}: ${error.message}`);
  };
  return {
    async insert(g) {
      const { error } = await db.from(TABLE).insert(toRow(g));
      check(error, 'insert game');
    },
    async get(id) {
      // Public ids are UUIDs; anything else can't be a game, and Postgres would reject it as a uuid.
      if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
      const { data, error } = await db.from(TABLE).select('*').eq('id', id).maybeSingle();
      check(error, 'get game');
      return data ? fromRow(data as Row) : null;
    },
    async update(g, movesBefore) {
      // Only if nobody else saved a move since this one was read: the move count is the version.
      const { id, created_at: _created, ip_key: _ip, ...changes } = toRow(g);
      const { data, error } = await db.from(TABLE).update(changes).eq('id', id).eq('move_count', movesBefore).select('id');
      check(error, 'update game');
      return (data?.length ?? 0) === 1;
    },
    async countStartedSince(ipKey, sinceIso) {
      const { count, error } = await db.from(TABLE).select('id', { count: 'exact', head: true }).eq('ip_key', ipKey).gte('created_at', sinceIso);
      check(error, 'count games');
      return count ?? 0;
    },
    async countAllStartedSince(sinceIso) {
      const { count, error } = await db.from(TABLE).select('id', { count: 'exact', head: true }).gte('created_at', sinceIso);
      check(error, 'count all games');
      return count ?? 0;
    },
    async countMove(ipKey, day) {
      // One statement in Postgres (insert, or add one), so two moves at once both count.
      const { data, error } = await db.rpc('artificer_count_move', { p_ip_key: ipKey, p_day: day });
      check(error, 'count move');
      return data as number;
    },
    async insertRun(sourceKey, run) {
      // A second record for the same source is turned away by the unique key, and that's fine.
      const { error } = await db.from(RUNS).upsert(runToRow(sourceKey, run), { onConflict: 'source_key', ignoreDuplicates: true });
      check(error, 'insert run');
    },
    async recentRuns(limit) {
      const { data, error } = await db.from(RUNS).select(RUN_COLUMNS).order('created_at', { ascending: false }).limit(limit);
      check(error, 'recent runs');
      return ((data ?? []) as unknown as RunRow[]).map(runFromRow);
    },
    async bestRuns(limit) {
      const { data, error } = await db.from(RUNS).select(RUN_COLUMNS).order('rank_key', { ascending: false }).order('created_at').limit(limit);
      check(error, 'best runs');
      return ((data ?? []) as unknown as RunRow[]).map(runFromRow);
    },
    async runBySource(sourceKey) {
      const { data, error } = await db.from(RUNS).select(RUN_COLUMNS).eq('source_key', sourceKey).maybeSingle();
      check(error, 'run by source');
      return data ? runFromRow(data as unknown as RunRow) : null;
    },
  };
}
