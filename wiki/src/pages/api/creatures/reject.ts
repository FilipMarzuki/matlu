// POST /api/creatures/reject — body { id: string; note?: string }
// Requires a valid admin session cookie.
// Writes moderation_note and rejected_at; keeps approved=false.
// The image stays in the pending/ Storage folder.
export const prerender = false;

import type { APIRoute } from 'astro';
import { ADMIN_COOKIE, verifySessionCookie } from '../../../lib/adminAuth';
import { getAdminClient } from '../../../lib/supabaseAdmin';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function json(data: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const cookieValue = cookies.get(ADMIN_COOKIE)?.value ?? '';
  const adminPassword = import.meta.env.ADMIN_PASSWORD ?? '';
  if (!adminPassword || !verifySessionCookie(cookieValue, adminPassword)) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }
  if (!isObject(body) || typeof body.id !== 'string') {
    return json({ error: 'invalid_request' }, 400);
  }

  const note =
    typeof body.note === 'string' && body.note.trim().length > 0
      ? body.note.trim()
      : 'Rejected.';

  const supabase = getAdminClient();

  const { error } = await supabase
    .from('creature_submissions')
    .update({
      moderation_note: note,
      rejected_at: new Date().toISOString(),
    })
    .eq('id', body.id)
    .eq('approved', false); // guard: never accidentally reject an approved creature

  if (error) {
    return json({ error: 'update_failed', details: error.message }, 500);
  }

  return json({ ok: true }, 200);
};
