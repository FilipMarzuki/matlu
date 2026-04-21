/**
 * POST /api/account/create-profile
 *
 * Called from /account/callback after a successful signup magic-link exchange.
 * Creates the account_profiles row (service-role, bypasses RLS).
 *
 * Body: { userId, handle, privacyPolicyVersion, licenseVersion }
 * Auth: Bearer <user JWT> — verified before write
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

  let body: {
    userId?: string;
    handle?: string;
    privacyPolicyVersion?: string;
    licenseVersion?: string;
  };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const handle = body.handle?.trim().toLowerCase();
  if (!handle || !/^[a-z0-9_-]+$/.test(handle)) {
    return new Response(JSON.stringify({ error: 'Invalid handle' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Upsert so re-clicking the same link is idempotent
  const res = await fetch(`${supabaseUrl}/rest/v1/account_profiles`, {
    method: 'POST',
    headers: {
      ...serviceHeaders(),
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify({
      user_id:                user.id,
      handle,
      privacy_policy_version: body.privacyPolicyVersion ?? '',
      license_version:        body.licenseVersion ?? '',
      parental_confirmation:  true,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    // Unique violation on handle means the handle is taken
    const error = detail.includes('unique') ? 'Handle already taken' : 'Failed to create profile';
    return new Response(JSON.stringify({ error }), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
