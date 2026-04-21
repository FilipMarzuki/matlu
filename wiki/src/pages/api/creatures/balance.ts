/**
 * POST /api/creatures/balance — #340 (B2 pipeline redesign).
 *
 * Body: { id: string, balance_tier: string, balance_notes?: string, biome_affinity?: string[] }
 * Auth: admin_session cookie
 * Key:  SUPABASE_SERVICE_ROLE_KEY
 *
 * Saves balance fields. Does NOT transition status — that goes through /api/creatures/status.
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { isAuthorized } from '../../../lib/admin-session';

const VALID_TIERS = new Set(['trivial', 'minor', 'standard', 'elite', 'boss']);

export const POST: APIRoute = async ({ request }) => {
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

  let id: string;
  let balance_tier: string;
  let balance_notes: string;
  let biome_affinity: string[];
  try {
    const body = await request.json();
    id = body.id;
    balance_tier = body.balance_tier ?? '';
    balance_notes = body.balance_notes?.toString().trim() ?? '';
    biome_affinity = Array.isArray(body.biome_affinity) ? body.biome_affinity : [];
    if (!id) throw new Error('missing id');
    if (balance_tier && !VALID_TIERS.has(balance_tier)) throw new Error('invalid balance_tier');
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Invalid body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const patch: Record<string, unknown> = { balance_notes, biome_affinity };
  if (balance_tier) patch.balance_tier = balance_tier;

  const res = await fetch(
    `${supabaseUrl}/rest/v1/creature_submissions?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(patch),
    }
  );

  if (!res.ok) {
    return new Response(JSON.stringify({ error: 'Failed to save balance data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
