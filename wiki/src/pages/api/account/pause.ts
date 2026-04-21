/**
 * POST /api/account/pause
 *
 * Sets account_profiles.paused = true for the authenticated user (Art. 18 GDPR).
 * Paused accounts have their submissions flagged hidden and data processing halted.
 * Logs to gdpr_actions_log.
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
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

  const hdrs = serviceHeaders();
  const uid  = encodeURIComponent(user.id);

  await fetch(
    `${supabaseUrl}/rest/v1/account_profiles?user_id=eq.${uid}`,
    {
      method: 'PATCH',
      headers: { ...hdrs, Prefer: 'return=minimal' },
      body: JSON.stringify({ paused: true }),
    }
  );

  const emailHash = createHash('sha256').update(user.email).digest('hex');
  await fetch(`${supabaseUrl}/rest/v1/gdpr_actions_log`, {
    method: 'POST',
    headers: { ...hdrs, Prefer: 'return=minimal' },
    body: JSON.stringify({ user_email_hash: emailHash, action_type: 'pause', details: {} }),
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
