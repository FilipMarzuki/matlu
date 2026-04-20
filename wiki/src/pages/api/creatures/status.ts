/**
 * POST /api/creatures/status
 * Transitions a creature to a new pipeline status after validating the move
 * via the `creature_status_transition_allowed` DB function (installed by #339).
 * The DB trigger records the change in creature_status_history automatically.
 */
export const prerender = false;
import type { APIRoute } from 'astro';
import { isAdminAuthenticated } from '../../../lib/adminAuth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';

interface StatusBody {
  id: string;
  status: string;
  note?: string;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isAdminAuthenticated(cookies)) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body: StatusBody;
  try {
    body = (await request.json()) as StatusBody;
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { id, status } = body;
  if (!id || !status) return new Response('Missing id or status', { status: 400 });

  const supabase = getSupabaseAdmin();

  // Fetch current status (and creature_name for slug generation on approval)
  const { data: current, error: fetchErr } = await supabase
    .from('creature_submissions')
    .select('status, creature_name, slug')
    .eq('id', id)
    .single();

  if (fetchErr || !current) return new Response('Creature not found', { status: 404 });

  // Validate the transition using the FSM function from #339
  const { data: allowed, error: checkErr } = await supabase.rpc(
    'creature_status_transition_allowed',
    { from_s: current.status, to_s: status },
  );

  if (checkErr) return new Response(checkErr.message, { status: 500 });
  if (!allowed) {
    return new Response(
      JSON.stringify({ error: `Transition ${current.status} → ${status} is not allowed` }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Build extra fields that change alongside the status
  const extra: Record<string, unknown> = {};
  if (status === 'approved') {
    extra.approved = true;
    extra.approved_at = new Date().toISOString();
    // Set slug on first approval (never overwrite an existing one)
    if (!current.slug) {
      extra.slug = slugify(current.creature_name);
    }
  }
  if (status === 'rejected') {
    extra.rejected_at = new Date().toISOString();
  }
  if (status === 'queued') {
    extra.queued_at = new Date().toISOString();
  }
  if (status === 'in-game') {
    extra.shipped_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from('creature_submissions')
    .update({ status, ...extra })
    .eq('id', id);

  if (error) return new Response(error.message, { status: 500 });

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
