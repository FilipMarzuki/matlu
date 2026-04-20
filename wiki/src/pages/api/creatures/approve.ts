// POST /api/creatures/approve — body { id: string }
// Requires a valid admin session cookie.
// Sets approved=true, moves the image from pending/ to approved/ in Storage,
// updates art_path and slug.
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

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
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

  const supabase = getAdminClient();

  const { data: submission, error: fetchError } = await supabase
    .from('creature_submissions')
    .select('id, creature_name, art_path, approved')
    .eq('id', body.id)
    .single();

  if (fetchError || !submission) {
    return json({ error: 'not_found' }, 404);
  }
  if (submission.approved) {
    return json({ error: 'already_approved' }, 409);
  }

  const slug = slugify(submission.creature_name);
  let newArtPath = submission.art_path;

  // Move the image from pending/ to approved/ in the creature-art Storage bucket.
  // Only attempt the move if the path starts with pending/ — guards against
  // double-processing or manually-set paths.
  if (submission.art_path?.startsWith('pending/')) {
    const ext = submission.art_path.split('.').pop() ?? 'bin';
    const destPath = `approved/${slug}.${ext}`;
    const { error: moveError } = await supabase.storage
      .from('creature-art')
      .move(submission.art_path, destPath);
    if (moveError) {
      return json({ error: 'storage_move_failed', details: moveError.message }, 500);
    }
    newArtPath = destPath;
  }

  const { error: updateError } = await supabase
    .from('creature_submissions')
    .update({
      approved: true,
      approved_at: new Date().toISOString(),
      slug,
      art_path: newArtPath,
    })
    .eq('id', body.id);

  if (updateError) {
    return json({ error: 'update_failed', details: updateError.message }, 500);
  }

  return json({ ok: true, slug }, 200);
};
