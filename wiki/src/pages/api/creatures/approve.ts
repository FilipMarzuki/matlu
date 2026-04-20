/**
 * POST /api/creatures/approve
 *
 * Admin-only endpoint. Called by the admin UI (issue #338) when a moderator
 * approves a creature submission. This endpoint:
 *   1. Marks the submission as approved and assigns a URL slug.
 *   2. Creates a GitHub tracker issue so parents and kids can follow along.
 *   3. Stores the returned issue number on the row so the detail page can link to it.
 *
 * Authentication: Authorization: Bearer <ADMIN_SECRET>
 * Body: { "id": "<creature uuid>" }
 */

// This route runs on-demand (not pre-rendered) because it performs writes.
export const prerender = false;

import type { APIRoute } from 'astro';
import { createServiceClient } from '../../../lib/supabase-server';
import { createTrackerIssue } from '../../../lib/github-tracker';
import type { CreatureRow } from '../../../types/creature';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  // ── Auth ───────────────────────────────────────────────────────────────────
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || authHeader !== `Bearer ${import.meta.env.ADMIN_SECRET}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let id: string;
  try {
    const body = await request.json() as { id?: unknown };
    if (typeof body.id !== 'string' || !body.id) throw new Error('bad id');
    id = body.id;
  } catch {
    return json({ error: 'Body must be JSON with a string "id" field' }, 400);
  }

  // ── Fetch creature ─────────────────────────────────────────────────────────
  const supabase = createServiceClient();

  const { data: creature, error: fetchError } = await supabase
    .from('creature_submissions')
    .select(
      'id, creature_name, creator_name, credits_opt_in, lore_description, ' +
      'art_path, slug, status, tracker_issue_number, approved',
    )
    .eq('id', id)
    .single();

  if (fetchError || !creature) {
    return json({ error: 'Creature not found' }, 404);
  }

  const row = creature as unknown as CreatureRow;

  if (row.approved) {
    return json({ error: 'Already approved', slug: row.slug, tracker_issue_number: row.tracker_issue_number }, 409);
  }

  // ── Generate slug (ensure uniqueness with a numeric suffix if needed) ──────
  const baseSlug = slugify(row.creature_name);
  let slug = baseSlug;
  let attempt = 0;
  while (true) {
    const { data: existing } = await supabase
      .from('creature_submissions')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();
    if (!existing) break;
    attempt++;
    slug = `${baseSlug}-${attempt}`;
  }

  // ── Approve in database ────────────────────────────────────────────────────
  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from('creature_submissions')
    .update({
      approved: true,
      approved_at: now,
      slug,
      // The FSM status column (added by #339); 'approved' is the first pipeline state.
      status: 'approved',
      status_changed_at: now,
    })
    .eq('id', id);

  if (updateError) {
    return json({ error: 'Database update failed', detail: updateError.message }, 500);
  }

  // ── Create GitHub tracker issue ────────────────────────────────────────────
  const token = import.meta.env.GH_TRACKER_TOKEN;
  const wikiBase = import.meta.env.WIKI_BASE_URL ?? 'https://wiki.matlu.app';
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

  const creatorDisplay = row.credits_opt_in ? row.creator_name : 'Anonymous';
  const imageUrl = row.art_path
    ? `${supabaseUrl}/storage/v1/object/public/creature-art/${row.art_path}`
    : null;

  let trackerIssueNumber: number | null = null;
  try {
    trackerIssueNumber = await createTrackerIssue(token, {
      creatureName: row.creature_name,
      creatorDisplay,
      loreDescription: row.lore_description,
      imageUrl,
      slug,
      wikiBase,
    });

    // Store the issue number so the detail page can link to it.
    await supabase
      .from('creature_submissions')
      .update({ tracker_issue_number: trackerIssueNumber })
      .eq('id', id);
  } catch (err) {
    // Approval itself succeeded; tracker creation is best-effort.
    // Log and continue so the admin UI doesn't see a false failure.
    console.error('Tracker issue creation failed:', err);
  }

  return json({ ok: true, slug, tracker_issue_number: trackerIssueNumber });
};
