/**
 * POST /api/creatures/status — #340 (B2 pipeline redesign).
 *
 * Body: { id: string, status: string }
 * Auth: admin_session cookie
 * Key:  SUPABASE_SERVICE_ROLE_KEY
 *
 * Validates that the requested transition is legal per the pipeline FSM,
 * writes the new status, and records a row in creature_status_history.
 * (In production #339 adds a DB trigger that also records history; this
 *  route inserts history explicitly so the table is populated without that trigger.)
 *
 * Legal transitions:
 *   submitted  → approved | rejected
 *   approved   → balanced
 *   balanced   → lore-ready   (only when lore_entry_id is already set)
 *   lore-ready → queued       (only when graphics_difficulty is already set)
 *   queued     → spriting
 *   spriting   → in-game
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { isAuthorized } from '../../../lib/admin-session';

type StatusValue =
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'balanced'
  | 'lore-ready'
  | 'queued'
  | 'spriting'
  | 'in-game';

const LEGAL: Record<string, StatusValue[]> = {
  submitted:  ['approved', 'rejected'],
  approved:   ['balanced'],
  balanced:   ['lore-ready'],
  'lore-ready': ['queued'],
  queued:     ['spriting'],
  spriting:   ['in-game'],
};

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
  let toStatus: string;
  try {
    const body = await request.json();
    id = body.id;
    toStatus = body.status;
    if (!id || !toStatus) throw new Error('missing id or status');
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Invalid body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const sbHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  // ── Fetch current row ─────────────────────────────────────────────────────────
  const fetchRes = await fetch(
    `${supabaseUrl}/rest/v1/creature_submissions?id=eq.${encodeURIComponent(id)}&limit=1&select=id,status,balance_tier,lore_entry_id,graphics_difficulty`,
    { headers: sbHeaders }
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
  const creature = rows[0] as {
    id: string;
    status: string;
    balance_tier: string | null;
    lore_entry_id: string | null;
    graphics_difficulty: number | null;
  };

  const fromStatus = creature.status;

  // ── Validate transition ───────────────────────────────────────────────────────
  const allowed = LEGAL[fromStatus] ?? [];
  if (!allowed.includes(toStatus as StatusValue)) {
    return new Response(
      JSON.stringify({ error: `Transition ${fromStatus} → ${toStatus} is not allowed` }),
      { status: 422, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Additional pre-condition guards
  if (toStatus === 'balanced' && !creature.balance_tier) {
    return new Response(
      JSON.stringify({ error: 'Save a balance_tier before marking balanced' }),
      { status: 422, headers: { 'Content-Type': 'application/json' } }
    );
  }
  if (toStatus === 'lore-ready' && !creature.lore_entry_id) {
    return new Response(
      JSON.stringify({ error: 'Create the Notion lore entry first' }),
      { status: 422, headers: { 'Content-Type': 'application/json' } }
    );
  }
  if (toStatus === 'queued' && !creature.graphics_difficulty) {
    return new Response(
      JSON.stringify({ error: 'Set a graphics rating before queuing' }),
      { status: 422, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Build extra fields for certain transitions
  const extra: Record<string, unknown> = {};
  if (toStatus === 'approved') {
    extra.approved = true;
    extra.approved_at = new Date().toISOString();
  }
  if (toStatus === 'rejected') {
    extra.rejected_at = new Date().toISOString();
  }

  // ── Patch status ──────────────────────────────────────────────────────────────
  const patchRes = await fetch(
    `${supabaseUrl}/rest/v1/creature_submissions?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { ...sbHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ status: toStatus, ...extra }),
    }
  );
  if (!patchRes.ok) {
    return new Response(JSON.stringify({ error: 'Failed to update status' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Record history ────────────────────────────────────────────────────────────
  await fetch(
    `${supabaseUrl}/rest/v1/creature_status_history`,
    {
      method: 'POST',
      headers: { ...sbHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ creature_id: id, from_status: fromStatus, to_status: toStatus }),
    }
  ).catch(() => { /* non-fatal */ });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
