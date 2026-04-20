/**
 * POST /api/creatures/balance
 * Updates balance_tier, balance_notes, and biome_affinity for a creature.
 * Service-role client so it bypasses RLS; gated by admin session cookie.
 */
export const prerender = false;
import type { APIRoute } from 'astro';
import { isAdminAuthenticated } from '../../../lib/adminAuth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';

interface BalanceBody {
  id: string;
  balance_tier: string;
  balance_notes: string;
  biome_affinity: string[];
}

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isAdminAuthenticated(cookies)) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body: BalanceBody;
  try {
    body = (await request.json()) as BalanceBody;
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { id, balance_tier, balance_notes, biome_affinity } = body;
  if (!id) return new Response('Missing id', { status: 400 });

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('creature_submissions')
    .update({ balance_tier, balance_notes, biome_affinity })
    .eq('id', id);

  if (error) return new Response(error.message, { status: 500 });

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
