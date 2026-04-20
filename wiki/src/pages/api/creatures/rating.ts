/**
 * POST /api/creatures/rating
 * Saves graphics_difficulty (1–5) and graphics_notes, then transitions the
 * creature from 'lore-ready' → 'queued' so the priority trigger fires.
 */
export const prerender = false;
import type { APIRoute } from 'astro';
import { isAdminAuthenticated } from '../../../lib/adminAuth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';

interface RatingBody {
  id: string;
  graphics_difficulty: number;
  graphics_notes: string;
}

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isAdminAuthenticated(cookies)) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body: RatingBody;
  try {
    body = (await request.json()) as RatingBody;
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { id, graphics_difficulty, graphics_notes } = body;
  if (!id) return new Response('Missing id', { status: 400 });
  if (graphics_difficulty < 1 || graphics_difficulty > 5) {
    return new Response('graphics_difficulty must be 1–5', { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Save the rating and transition to 'queued' in one update.
  // The creature_queue_update trigger recomputes queue_priority when status → 'queued'.
  const { error } = await supabase
    .from('creature_submissions')
    .update({
      graphics_difficulty,
      graphics_notes,
      status: 'queued',
      queued_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) return new Response(error.message, { status: 500 });

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
