/**
 * POST /api/creatures/tracker-scrub?id=<creature-uuid>
 *
 * GDPR erasure stub. Called by the erasure flow in issue #331 as part of the
 * full deletion cascade when a contributor withdraws their submission.
 *
 * This endpoint:
 *   1. Looks up the creature's tracker_issue_number.
 *   2. Replaces the GitHub issue body with "[content removed]".
 *   3. Posts "Creature withdrawn by contributor." as a closing comment.
 *   4. Closes the GitHub issue.
 *
 * Authentication: Authorization: Bearer <ADMIN_SECRET>
 */

export const prerender = false;

import type { APIRoute } from 'astro';
import { createServiceClient } from '../../../lib/supabase-server';
import { scrubTrackerIssue } from '../../../lib/github-tracker';
import type { CreatureRow } from '../../../types/creature';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request, url }) => {
  // ── Auth ───────────────────────────────────────────────────────────────────
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || authHeader !== `Bearer ${import.meta.env.ADMIN_SECRET}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  // ── Parse query param ──────────────────────────────────────────────────────
  const id = url.searchParams.get('id');
  if (!id) {
    return json({ error: 'Missing query parameter: id' }, 400);
  }

  // ── Fetch creature ─────────────────────────────────────────────────────────
  const supabase = createServiceClient();

  const { data: creature, error: fetchError } = await supabase
    .from('creature_submissions')
    .select('id, tracker_issue_number')
    .eq('id', id)
    .single();

  if (fetchError || !creature) {
    return json({ error: 'Creature not found' }, 404);
  }

  const row = creature as unknown as Pick<CreatureRow, 'id' | 'tracker_issue_number'>;

  if (!row.tracker_issue_number) {
    // No tracker issue — nothing to scrub on GitHub.
    return json({ ok: true, note: 'No tracker issue linked; nothing scrubbed on GitHub.' });
  }

  // ── Scrub GitHub issue ─────────────────────────────────────────────────────
  try {
    await scrubTrackerIssue(import.meta.env.GH_TRACKER_TOKEN, row.tracker_issue_number);
  } catch (err) {
    return json({ error: 'GitHub scrub failed', detail: String(err) }, 502);
  }

  return json({ ok: true, scrubbed_issue: row.tracker_issue_number });
};
