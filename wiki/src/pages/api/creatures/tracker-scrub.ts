/**
 * POST /api/creatures/tracker-scrub?id=<creature-submission-id>
 *
 * GDPR erasure stub — FIL-445 (Creatures C2).
 *
 * Called by the #331 erasure flow when a contributor requests deletion.
 * Edits the GitHub tracker issue body to "[content removed]" and closes
 * the issue with a withdrawal comment. Does NOT touch the Supabase row —
 * that is handled by #331's deletion cascade.
 *
 * Auth: admin_session cookie (same gate as approve/reject).
 * Key: CODEX_ISSUE_CREATOR (fine-grained PAT, issues:write on this repo).
 * SUPABASE_SERVICE_ROLE_KEY: used to fetch the creature row (tracker_issue_number).
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { isAuthorized } from '../../../lib/admin-session';

const REPO = 'FilipMarzuki/matlu';

export const POST: APIRoute = async ({ request, url }) => {
  // ── Auth ────────────────────────────────────────────────────────────────
  const cookieHeader = request.headers.get('cookie');
  if (!isAuthorized(cookieHeader)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
  const serviceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const ghToken = import.meta.env.CODEX_ISSUE_CREATOR ?? '';

  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Parse creature id from query param ───────────────────────────────────
  const id = url.searchParams.get('id') ?? '';
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing id param' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const sbHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  // ── Fetch creature to get tracker_issue_number ───────────────────────────
  const fetchRes = await fetch(
    `${supabaseUrl}/rest/v1/creature_submissions?id=eq.${encodeURIComponent(id)}&select=id,tracker_issue_number&limit=1`,
    { headers: sbHeaders }
  );
  if (!fetchRes.ok) {
    return new Response(JSON.stringify({ error: 'Failed to fetch creature' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const rows = await fetchRes.json() as Array<{ id: string; tracker_issue_number: number | null }>;
  if (!rows.length) {
    return new Response(JSON.stringify({ error: 'Creature not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const { tracker_issue_number } = rows[0];

  if (!tracker_issue_number) {
    // No tracker issue was ever created — nothing to scrub.
    return new Response(JSON.stringify({ ok: true, skipped: 'no tracker issue' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!ghToken) {
    return new Response(JSON.stringify({ error: 'CODEX_ISSUE_CREATOR not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const ghHeaders = {
    Authorization: `Bearer ${ghToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
  const issueUrl = `https://api.github.com/repos/${REPO}/issues/${tracker_issue_number}`;

  // ── Edit issue body to "[content removed]" ───────────────────────────────
  const editRes = await fetch(issueUrl, {
    method: 'PATCH',
    headers: ghHeaders,
    body: JSON.stringify({ body: '[content removed]' }),
  });
  if (!editRes.ok) {
    return new Response(JSON.stringify({ error: 'Failed to edit tracker issue' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Post withdrawal comment ───────────────────────────────────────────────
  await fetch(`${issueUrl}/comments`, {
    method: 'POST',
    headers: ghHeaders,
    body: JSON.stringify({ body: 'Creature withdrawn by contributor.' }),
  });

  // ── Close the issue ───────────────────────────────────────────────────────
  await fetch(issueUrl, {
    method: 'PATCH',
    headers: ghHeaders,
    body: JSON.stringify({ state: 'closed', state_reason: 'not_planned' }),
  });

  return new Response(JSON.stringify({ ok: true, tracker_issue_number }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
