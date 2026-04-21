/**
 * POST /api/creatures/update-balance
 *
 * Saves balance fields and transitions the creature from 'approved' to 'balanced'.
 * The status transition is atomic with the field update.
 *
 * Body:
 *   id:              string
 *   balance_tier:    'trivial' | 'minor' | 'standard' | 'elite' | 'boss'
 *   balance_notes:   string (optional)
 *   biome_affinity:  string[]
 *
 * Auth: admin_session cookie
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { isAuthorized } from '../../../lib/admin-session';

const VALID_TIERS = ['trivial', 'minor', 'standard', 'elite', 'boss'] as const;

export const POST: APIRoute = async ({ request }) => {
  const cookieHeader = request.headers.get('cookie');
  if (!isAuthorized(cookieHeader)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
  const serviceKey  = import.meta.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500);

  let id: string, balance_tier: string, balance_notes: string, biome_affinity: string[];
  try {
    const body   = await request.json();
    id            = body.id;
    balance_tier  = body.balance_tier?.toString().trim() ?? '';
    balance_notes = body.balance_notes?.toString().trim() ?? '';
    biome_affinity = Array.isArray(body.biome_affinity)
      ? body.biome_affinity.map((b: unknown) => String(b).trim()).filter(Boolean)
      : [];
    if (!id) throw new Error('missing id');
    if (!(VALID_TIERS as readonly string[]).includes(balance_tier)) {
      throw new Error(`balance_tier must be one of: ${VALID_TIERS.join(', ')}`);
    }
  } catch (e) {
    return json({ error: (e as Error).message || 'Invalid request body' }, 400);
  }

  const hdrs = serviceHeaders(serviceKey);

  const updateRes = await fetch(
    `${supabaseUrl}/rest/v1/creature_submissions?id=eq.${enc(id)}`,
    {
      method:  'PATCH',
      headers: { ...hdrs, Prefer: 'return=minimal' },
      body:    JSON.stringify({
        balance_tier,
        balance_notes:  balance_notes || null,
        biome_affinity: biome_affinity.length ? biome_affinity : null,
        status:         'balanced',
      }),
    }
  );

  if (!updateRes.ok) return json({ error: 'Failed to update creature' }, 500);

  return json({ ok: true });
};

function serviceHeaders(key: string) {
  return {
    apikey:         key,
    Authorization:  `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

function enc(s: string) { return encodeURIComponent(s); }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
