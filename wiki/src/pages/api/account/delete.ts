/**
 * POST /api/account/delete
 *
 * Deletes or anonymises an account (Art. 17 GDPR — right to erasure).
 *
 * Body: { mode: 'full' | 'anonymize' }
 *
 * full:
 *   1. Delete creature_submissions (rows) + bucket images for this user
 *   2. Delete creature_drafts, account_kids, account_profiles (cascade from auth.users)
 *   3. Delete the Supabase auth user (triggers cascade deletes via FK)
 *   4. Log to gdpr_actions_log
 *
 * anonymize:
 *   1. Null out user_id, creator_name on creature_submissions; set credits_opt_in=false
 *   2. Delete creature_drafts, account_kids, account_profiles (via cascade)
 *   3. Delete the Supabase auth user
 *   4. Log to gdpr_actions_log
 *
 * Uses service-role key (never exposed to client).
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import { verifyUserToken, serviceHeaders } from '../../../lib/supabase-auth';
import { createClient } from '@supabase/supabase-js';

export const POST: APIRoute = async ({ request }) => {
  const user = await verifyUserToken(request.headers.get('Authorization'));
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
  const serviceKey  = import.meta.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let mode: 'full' | 'anonymize' = 'full';
  try {
    const body = await request.json();
    if (body.mode === 'anonymize') mode = 'anonymize';
  } catch { /* default full */ }

  const hdrs    = serviceHeaders();
  const uid     = encodeURIComponent(user.id);
  const emailHash = createHash('sha256').update(user.email).digest('hex');

  if (mode === 'full') {
    // Fetch all creature_submissions to delete bucket images
    const subRes = await fetch(
      `${supabaseUrl}/rest/v1/creature_submissions?user_id=eq.${uid}&select=id,art_path`,
      { headers: hdrs }
    );
    if (subRes.ok) {
      const subs: Array<{ id: string; art_path: string | null }> = await subRes.json();
      const paths = subs.map(s => s.art_path).filter((p): p is string => !!p);

      if (paths.length) {
        // Batch-delete bucket objects
        await fetch(`${supabaseUrl}/storage/v1/object/creature-art`, {
          method: 'DELETE',
          headers: hdrs,
          body: JSON.stringify({ prefixes: paths }),
        });
      }

      // Delete submission rows
      if (subs.length) {
        await fetch(
          `${supabaseUrl}/rest/v1/creature_submissions?user_id=eq.${uid}`,
          { method: 'DELETE', headers: hdrs }
        );
      }
    }
  } else {
    // Anonymise: null out user_id, creator_name; set credits_opt_in=false
    await fetch(
      `${supabaseUrl}/rest/v1/creature_submissions?user_id=eq.${uid}`,
      {
        method: 'PATCH',
        headers: { ...hdrs, Prefer: 'return=minimal' },
        body: JSON.stringify({ user_id: null, creator_name: null, kid_id: null, credits_opt_in: false }),
      }
    );
  }

  // Delete account_profiles, account_kids, creature_drafts via FK cascade
  // when we delete the auth user. Log first (before the cascade wipes profile).
  await fetch(`${supabaseUrl}/rest/v1/gdpr_actions_log`, {
    method: 'POST',
    headers: { ...hdrs, Prefer: 'return=minimal' },
    body: JSON.stringify({
      user_email_hash: emailHash,
      action_type: mode === 'full' ? 'delete' : 'anonymize',
      details: { user_id: user.id },
    }),
  });

  // Delete the Supabase auth user (cascades to account_profiles, account_kids, creature_drafts)
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: deleteErr } = await adminClient.auth.admin.deleteUser(user.id);
  if (deleteErr) {
    return new Response(JSON.stringify({ error: deleteErr.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
