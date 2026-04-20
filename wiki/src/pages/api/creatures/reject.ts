/**
 * POST /api/creatures/reject — FIL-434 (Creatures A4).
 *
 * Body: { id: string, note?: string }
 * Auth: admin_session cookie (validated server-side)
 * Key: SUPABASE_SERVICE_ROLE_KEY (never exposed to client)
 *
 * Writes moderation_note and rejected_at; keeps approved=false.
 * Image stays in pending/ (not moved or deleted).
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { isAuthorized } from '../../../lib/admin-session';

export const POST: APIRoute = async ({ request }) => {
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
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Parse body ───────────────────────────────────────────────────────────
  let id: string;
  let note: string;
  try {
    const body = await request.json();
    id = body.id;
    note = body.note?.toString().trim() ?? '';
    if (!id) throw new Error('missing id');
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Update: moderation_note + rejected_at ────────────────────────────────
  const updateRes = await fetch(
    `${supabaseUrl}/rest/v1/creature_submissions?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        moderation_note: note || 'Rejected by moderator',
        rejected_at: new Date().toISOString(),
        status: 'rejected',
      }),
    }
  );

  if (!updateRes.ok) {
    return new Response(JSON.stringify({ error: 'Failed to reject creature' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
