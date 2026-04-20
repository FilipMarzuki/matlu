/**
 * POST /api/creatures/approve — FIL-434 (Creatures A4).
 *
 * Body: { id: string }
 * Auth: admin_session cookie (validated server-side)
 * Key: SUPABASE_SERVICE_ROLE_KEY (never exposed to client)
 *
 * Actions:
 *   1. Fetch the creature row (service role → bypasses RLS)
 *   2. Move image from pending/<uuid>.<ext> to approved/<slug>.<ext> in Storage
 *   3. Update creature_submissions: approved=true, art_path=approved/…
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
  try {
    const body = await request.json();
    id = body.id;
    if (!id) throw new Error('missing id');
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  // ── Fetch the creature row ───────────────────────────────────────────────
  const fetchRes = await fetch(
    `${supabaseUrl}/rest/v1/creature_submissions?id=eq.${encodeURIComponent(id)}&limit=1`,
    { headers }
  );
  if (!fetchRes.ok) {
    return new Response(JSON.stringify({ error: 'Failed to fetch creature' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const rows = await fetchRes.json();
  if (!rows.length) {
    return new Response(JSON.stringify({ error: 'Creature not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const creature = rows[0];

  // ── Move image in Storage: pending/… → approved/… ───────────────────────
  let newArtPath: string | null = creature.art_path;
  if (creature.art_path?.startsWith('pending/')) {
    const ext = creature.art_path.split('.').pop() ?? 'jpg';
    // Use slug if available, else id
    const nameBase = (creature.slug ?? creature.id).replace(/[^a-z0-9-]/gi, '-');
    newArtPath = `approved/${nameBase}.${ext}`;

    // Supabase Storage copy via REST (move = copy + delete)
    const copyRes = await fetch(
      `${supabaseUrl}/storage/v1/object/move`,
      {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bucketId: 'creature-art',
          sourceKey: creature.art_path,
          destinationKey: newArtPath,
        }),
      }
    );
    if (!copyRes.ok) {
      // Move failed — approve anyway but keep old path
      newArtPath = creature.art_path;
    }
  }

  // ── Update row: approved = true, art_path, status ───────────────────────
  const updateRes = await fetch(
    `${supabaseUrl}/rest/v1/creature_submissions?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: {
        ...headers,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        approved: true,
        approved_at: new Date().toISOString(),
        art_path: newArtPath,
        status: 'approved',
      }),
    }
  );

  if (!updateRes.ok) {
    return new Response(JSON.stringify({ error: 'Failed to update creature' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
