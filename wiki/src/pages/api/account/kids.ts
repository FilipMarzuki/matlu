/**
 * GET  /api/account/kids  — list kids for the authenticated user
 * POST /api/account/kids  — add a new kid
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { verifyUserToken, serviceHeaders } from '../../../lib/supabase-auth';

export const GET: APIRoute = async ({ request }) => {
  const user = await verifyUserToken(request.headers.get('Authorization'));
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
  const res = await fetch(
    `${supabaseUrl}/rest/v1/account_kids?user_id=eq.${encodeURIComponent(user.id)}&select=id,kid_name,kid_age&order=created_at.asc`,
    { headers: serviceHeaders() }
  );

  if (!res.ok) {
    return new Response(JSON.stringify({ error: 'Failed to fetch kids' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  const rows = await res.json();
  return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

export const POST: APIRoute = async ({ request }) => {
  const user = await verifyUserToken(request.headers.get('Authorization'));
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';

  let body: { name?: string; age?: number | null };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const kidName = body.name?.trim();
  if (!kidName) {
    return new Response(JSON.stringify({ error: 'Name required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Derive a slug from the name (lowercase, replace spaces/special chars with -)
  const baseSlug = kidName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const slug     = `${baseSlug}-${Date.now().toString(36)}`;

  const res = await fetch(`${supabaseUrl}/rest/v1/account_kids`, {
    method: 'POST',
    headers: { ...serviceHeaders(), Prefer: 'return=representation' },
    body: JSON.stringify({
      user_id:  user.id,
      kid_name: kidName,
      kid_slug: slug,
      kid_age:  body.age ?? null,
    }),
  });

  if (!res.ok) {
    return new Response(JSON.stringify({ error: 'Failed to add kid' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  const rows = await res.json();
  return new Response(JSON.stringify(rows[0]), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
