/**
 * Supabase Edge Function: creature-status-webhook
 *
 * Triggered via a Supabase Database Webhook on INSERT into creature_status_history.
 * Every time the pipeline FSM (issue #339) writes a new history row, this function:
 *   1. Reads the creature's tracker_issue_number.
 *   2. Posts a bot comment on the tracker issue.
 *   3. Swaps the status labels (status:<from> → status:<to>).
 *   4. If the new status is "in-game", closes the tracker issue with a final comment.
 *
 * Deployment:
 *   supabase functions deploy creature-status-webhook
 *
 * Required Supabase secrets (set via `supabase secrets set`):
 *   GH_TRACKER_TOKEN  — GitHub fine-grained PAT with issues:write on FilipMarzuki/matlu
 *   WIKI_BASE_URL     — Public URL of the Matlu wiki (e.g. https://wiki.matlu.app)
 *
 * Database Webhook setup (Supabase dashboard → Database → Webhooks):
 *   Table: creature_status_history
 *   Event: INSERT
 *   URL:   https://<project>.supabase.co/functions/v1/creature-status-webhook
 *
 * Fallback cron approach: if webhooks are not yet configured, the script at
 *   .github/scripts/creature-status-sync.js can be run on a schedule instead.
 *   It polls creature_status_history for rows where tracker_notified = false.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const REPO = 'FilipMarzuki/matlu';
const API_BASE = 'https://api.github.com';
const WIKI_DEFAULT = 'https://wiki.matlu.app';

/** Human-readable labels shown in tracker comments. */
const STATUS_LABELS: Record<string, string> = {
  pending:   'Pending Review',
  approved:  'Approved',
  balancing: 'Balancing',
  balanced:  'Balanced',
  'in-game': 'In Game',
  rejected:  'Rejected',
};

interface StatusHistoryRow {
  id: string;
  creature_id: string;
  from_status: string | null;
  to_status: string;
  changed_at: string;
  note: string | null;
}

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  record: StatusHistoryRow;
}

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const ghToken = Deno.env.get('GH_TRACKER_TOKEN');
  const wikiBase = Deno.env.get('WIKI_BASE_URL') ?? WIKI_DEFAULT;
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!ghToken) {
    console.error('GH_TRACKER_TOKEN secret not set');
    return new Response('Server misconfiguration', { status: 500 });
  }

  let payload: WebhookPayload;
  try {
    payload = await req.json() as WebhookPayload;
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const history = payload.record;
  if (!history?.creature_id || !history?.to_status) {
    return new Response('Missing required fields', { status: 400 });
  }

  // Fetch the creature to get its tracker_issue_number and slug.
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const { data: creature, error } = await supabase
    .from('creature_submissions')
    .select('tracker_issue_number, slug, entity_id')
    .eq('id', history.creature_id)
    .single();

  if (error || !creature) {
    console.error('Creature not found:', history.creature_id);
    return new Response('Creature not found', { status: 404 });
  }

  if (!creature.tracker_issue_number) {
    // No tracker issue yet — nothing to do.
    return new Response('No tracker issue linked', { status: 200 });
  }

  const issueNumber: number = creature.tracker_issue_number;
  const from = history.from_status ?? 'unknown';
  const to = history.to_status;
  const fromLabel = STATUS_LABELS[from] ?? from;
  const toLabel = STATUS_LABELS[to] ?? to;

  const ghHeaders = {
    Authorization: `Bearer ${ghToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };

  // ── Post status-change comment ────────────────────────────────────────────
  const comment = `🔄 Status changed: **${fromLabel}** → **${toLabel}**\n${history.changed_at}`;
  await fetch(`${API_BASE}/repos/${REPO}/issues/${issueNumber}/comments`, {
    method: 'POST',
    headers: ghHeaders,
    body: JSON.stringify({ body: comment }),
  });

  // ── Swap status labels ────────────────────────────────────────────────────
  if (from !== 'unknown') {
    const encoded = encodeURIComponent(`status:${from}`);
    await fetch(`${API_BASE}/repos/${REPO}/issues/${issueNumber}/labels/${encoded}`, {
      method: 'DELETE',
      headers: ghHeaders,
    });
  }

  await fetch(`${API_BASE}/repos/${REPO}/issues/${issueNumber}/labels`, {
    method: 'POST',
    headers: ghHeaders,
    body: JSON.stringify({ labels: [`status:${to}`] }),
  });

  // ── Close when shipped in-game ────────────────────────────────────────────
  if (to === 'in-game') {
    const entityId: string | null = creature.entity_id ?? null;
    const slug: string | null = creature.slug ?? null;
    const entityLine = entityId ? `**Entity ID:** \`${entityId}\`` : '';
    const detailLine = slug ? `**Detail page:** ${wikiBase}/creatures/${slug}` : '';
    const closingBody = [
      '🎉 This creature has shipped and is now part of Core Warden!',
      '',
      entityLine,
      detailLine,
    ]
      .filter(Boolean)
      .join('\n');

    await fetch(`${API_BASE}/repos/${REPO}/issues/${issueNumber}/comments`, {
      method: 'POST',
      headers: ghHeaders,
      body: JSON.stringify({ body: closingBody }),
    });

    await fetch(`${API_BASE}/repos/${REPO}/issues/${issueNumber}`, {
      method: 'PATCH',
      headers: ghHeaders,
      body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
    });
  }

  return new Response('OK', { status: 200 });
});
