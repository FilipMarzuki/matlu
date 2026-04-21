/**
 * POST /api/drafts/save
 *
 * Upserts a creature draft for the authenticated user.
 * One draft per (user_id, kid_id) pair; subsequent saves overwrite.
 *
 * Body: { kid_id?: string | null, draft_data: Record<string, unknown> }
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { verifyUserToken, serviceHeaders } from '../../../lib/supabase-auth';

export const POST: APIRoute = async ({ request }) => {
  const user = await verifyUserToken(request.headers.get('Authorization'));
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
  if (!supabaseUrl) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { kid_id?: string | null; draft_data?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!body.draft_data || typeof body.draft_data !== 'object') {
    return new Response(JSON.stringify({ error: 'draft_data required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const hdrs = serviceHeaders();
  const uid  = user.id;
  const kidId = body.kid_id ?? null;

  // Check whether a draft already exists for this (user_id, kid_id)
  const kidFilter = kidId
    ? `kid_id=eq.${encodeURIComponent(kidId)}`
    : 'kid_id=is.null';

  const existing = await fetch(
    `${supabaseUrl}/rest/v1/creature_drafts?user_id=eq.${encodeURIComponent(uid)}&${kidFilter}&select=id&limit=1`,
    { headers: hdrs }
  );

  const rows: Array<{ id: string }> = existing.ok ? await existing.json() : [];

  if (rows.length) {
    // Update
    await fetch(
      `${supabaseUrl}/rest/v1/creature_drafts?id=eq.${encodeURIComponent(rows[0].id)}`,
      {
        method: 'PATCH',
        headers: { ...hdrs, Prefer: 'return=minimal' },
        body: JSON.stringify({
          draft_data: body.draft_data,
          updated_at: new Date().toISOString(),
        }),
      }
    );
  } else {
    // Insert
    await fetch(`${supabaseUrl}/rest/v1/creature_drafts`, {
      method: 'POST',
      headers: { ...hdrs, Prefer: 'return=minimal' },
      body: JSON.stringify({
        user_id:    uid,
        kid_id:     kidId,
        draft_data: body.draft_data,
        updated_at: new Date().toISOString(),
      }),
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
