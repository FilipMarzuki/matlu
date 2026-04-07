import type { MatluRunInsert } from '../types/database.types';
import { supabase } from './supabaseClient';

/** Insert a run row (RLS allows anon insert on `matlu_runs`). Returns null if Supabase is not configured. */
export async function insertMatluRun(row: MatluRunInsert) {
  if (!supabase) return null;
  return supabase.from('matlu_runs').insert(row).select().single();
}

/** Top scores for a simple leaderboard (newest first when scores tie). Returns null if Supabase is not configured. */
export async function fetchMatluLeaderboard(limit = 10) {
  if (!supabase) return null;
  return supabase
    .from('matlu_runs')
    .select('*')
    .order('score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
}
