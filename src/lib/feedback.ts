import type { MatluFeedbackInsert } from '../types/database.types';
import { supabase } from './supabaseClient';

/** Semver string embedded in every feedback row — bump when cutting a release. */
export const GAME_VERSION = '0.0.1';

/**
 * Insert a feedback row into `matlu_feedback`.
 *
 * RLS allows anon/authenticated INSERT, matching the pattern used by `insertMatluRun`.
 * `user_agent` is captured automatically from the browser so the team can distinguish
 * device types (e.g. Android tablet vs desktop) when reading feedback.
 *
 * Returns null if Supabase is not configured (e.g. local dev without .env).
 * Throws on insert error so the caller can surface a UI message if needed.
 */
export async function insertFeedback(
  text: string,
  gameVersion: string,
  sessionId?: string
): Promise<void> {
  if (!supabase) return;

  const row: MatluFeedbackInsert = {
    feedback_text: text,
    game_version: gameVersion,
    session_id: sessionId ?? null,
    user_agent: navigator.userAgent,
  };

  const { error } = await supabase.from('matlu_feedback').insert(row);
  if (error) throw error;
}
