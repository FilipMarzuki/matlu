/**
 * POST /api/account/export
 *
 * Returns a JSON blob containing all personal data for the account (Art. 15, 20).
 * Includes: profile, kids, creature_drafts, creature_submissions (with image URLs).
 * Also writes an 'export' entry to gdpr_actions_log (Art. 5(2)).
 *
 * Uses the service-role key — never exposed to the client.
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

  // Fetch all data in parallel
  const [profileRes, kidsRes, draftsRes, submissionsRes] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/account_profiles?user_id=eq.${uid}&select=*`, { headers: hdrs }),
    fetch(`${supabaseUrl}/rest/v1/account_kids?user_id=eq.${uid}&select=*`, { headers: hdrs }),
    fetch(`${supabaseUrl}/rest/v1/creature_drafts?user_id=eq.${uid}&select=*`, { headers: hdrs }),
    fetch(`${supabaseUrl}/rest/v1/creature_submissions?user_id=eq.${uid}&select=*`, { headers: hdrs }),
  ]);

  const [profile, kids, drafts, submissions] = await Promise.all([
    profileRes.ok ? profileRes.json() : [],
    kidsRes.ok ? kidsRes.json() : [],
    draftsRes.ok ? draftsRes.json() : [],
    submissionsRes.ok ? submissionsRes.json() : [],
  ]);

  // Resolve image URLs for submissions
  const submissionsWithUrls = (submissions as Array<Record<string, unknown>>).map(s => ({
    ...s,
    image_url: s.art_path
      ? `${supabaseUrl}/storage/v1/object/public/creature-art/${s.art_path}`
      : null,
  }));

  const exportPayload = {
    exported_at: new Date().toISOString(),
    account: {
      email: user.email,
      profile: profile[0] ?? null,
      kids,
    },
    creature_drafts: drafts,
    creature_submissions: submissionsWithUrls,
  };

  // Write audit log
  const emailHash = createHash('sha256').update(user.email).digest('hex');
  await fetch(`${supabaseUrl}/rest/v1/gdpr_actions_log`, {
    method: 'POST',
    headers: { ...hdrs, Prefer: 'return=minimal' },
    body: JSON.stringify({
      user_email_hash: emailHash,
      action_type: 'export',
      details: { submission_count: submissions.length, draft_count: drafts.length },
    }),
  });

  const json = JSON.stringify(exportPayload, null, 2);
  return new Response(json, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="matlu-export-${new Date().toISOString().slice(0,10)}.json"`,
    },
  });
};
