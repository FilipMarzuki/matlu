/**
 * The play API's games, kept in Supabase (#1555): tables `artificer_games` and
 * `artificer_play_usage` (supabase/migrations/20261010000000_artificer_games.sql).
 *
 * Both have row-level security on and no policies, so the browser's publishable key can't read
 * or write it at all: only this server code can, with the service-role key. That matters because a
 * row's `session` holds the seed (see api.ts), and the seed must never reach a player.
 */

import { createClient } from '@supabase/supabase-js';
import type { GameRecord, GameStore } from './api';

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
  created_at: string;
  updated_at: string;
}

const TABLE = 'artificer_games';

const toRow = (g: GameRecord): Row => ({
  id: g.id, version: g.version, session: g.session, moves: g.moves, move_count: g.moves.length, phase: g.phase,
  name: g.name, client: g.client, model: g.model, ip_key: g.ipKey, created_at: g.createdAt, updated_at: g.updatedAt,
});

const fromRow = (r: Row): GameRecord => ({
  id: r.id, version: r.version, session: r.session, moves: r.moves, phase: r.phase,
  name: r.name, client: r.client, model: r.model ?? null, ipKey: r.ip_key, createdAt: r.created_at, updatedAt: r.updated_at,
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
  };
}
