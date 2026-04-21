/**
 * POST /api/creatures/approve — FIL-434 (Creatures A4) + FIL-445 (Creatures C2).
 *
 * Body: { id: string }
 * Auth: admin_session cookie (validated server-side)
 * Key: SUPABASE_SERVICE_ROLE_KEY (never exposed to client)
 *
 * Actions:
 *   1. Fetch the creature row (service role → bypasses RLS)
 *   2. Move image from pending/<uuid>.<ext> to approved/<slug>.<ext> in Storage
 *   3. Update creature_submissions: approved=true, art_path=approved/…
 *   4. (C2) Create a GitHub tracker issue and store tracker_issue_number
 *
 * GitHub token: GH_TRACKER_TOKEN (fine-grained PAT, issues:write on this repo).
 * Set via Vercel project env vars. Tracker creation is non-fatal — approval
 * succeeds even if the GitHub call fails.
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { isAuthorized } from '../../../lib/admin-session';

export const POST: APIRoute = async ({ request }) => {
  // ── Auth ────────────────────────────────────────────────────────────────
  const cookieHeader = request.headers.get('cookie');
  if (!isAuthorized(cookieHeader)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
  const serviceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Parse body ───────────────────────────────────────────────────────────
  let id: string;
  try {
    const body = await request.json();
    id = body.id;
    if (!id) throw new Error('missing id');
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  // ── Fetch the creature row ───────────────────────────────────────────────
  const fetchRes = await fetch(
    `${supabaseUrl}/rest/v1/creature_submissions?id=eq.${encodeURIComponent(id)}&limit=1`,
    { headers }
  );
  if (!fetchRes.ok) {
    return new Response(JSON.stringify({ error: 'Failed to fetch creature' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const rows = await fetchRes.json();
  if (!rows.length) {
    return new Response(JSON.stringify({ error: 'Creature not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const creature = rows[0];

  // ── Move image in Storage: pending/… → approved/… ───────────────────────
  let newArtPath: string | null = creature.art_path;
  if (creature.art_path?.startsWith('pending/')) {
    const ext = creature.art_path.split('.').pop() ?? 'jpg';
    // Use slug if available, else id
    const nameBase = (creature.slug ?? creature.id).replace(/[^a-z0-9-]/gi, '-');
    newArtPath = `approved/${nameBase}.${ext}`;

    // Supabase Storage copy via REST (move = copy + delete)
    const copyRes = await fetch(
      `${supabaseUrl}/storage/v1/object/move`,
      {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bucketId: 'creature-art',
          sourceKey: creature.art_path,
          destinationKey: newArtPath,
        }),
      }
    );
    if (!copyRes.ok) {
      // Move failed — approve anyway but keep old path
      newArtPath = creature.art_path;
    }
  }

  // ── Update row: approved = true, art_path, status ───────────────────────
  const updateRes = await fetch(
    `${supabaseUrl}/rest/v1/creature_submissions?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: {
        ...headers,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        approved: true,
        approved_at: new Date().toISOString(),
        art_path: newArtPath,
        status: 'approved',
      }),
    }
  );

  if (!updateRes.ok) {
    return new Response(JSON.stringify({ error: 'Failed to update creature' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Create GitHub tracker issue (C2) ─────────────────────────────────────
  // Non-fatal: if GH_TRACKER_TOKEN is absent or the API call fails, approval
  // still succeeds. The tracker can be created manually later if needed.
  const ghToken = import.meta.env.GH_TRACKER_TOKEN ?? '';
  let trackerIssueNumber: number | null = null;

  if (ghToken) {
    try {
      // Use credits_opt_in to decide whether to show the real name.
      const makerDisplay = creature.credits_opt_in
        ? (creature.creator_name as string)
        : 'Anonymous';

      const storyExcerpt = typeof creature.lore_description === 'string' && creature.lore_description.length > 0
        ? creature.lore_description.slice(0, 300) + (creature.lore_description.length > 300 ? '…' : '')
        : null;

      const artUrl = newArtPath
        ? `${supabaseUrl}/storage/v1/object/public/creature-art/${newArtPath}`
        : null;

      // Derive the codex base URL from the incoming request so we don't need
      // a hard-coded env var — works for both Vercel production and preview URLs.
      const reqUrl = new URL(request.url);
      const codexBase = `${reqUrl.protocol}//${reqUrl.host}`;
      const creatureSlug = (creature.slug as string | null) ?? (creature.id as string);
      const creaturePageUrl = `${codexBase}/creatures/${creatureSlug}`;

      const bodyLines: string[] = [
        `## ${creature.creature_name as string}`,
        '',
        `**Maker:** ${makerDisplay}`,
      ];
      if (artUrl) bodyLines.push(`**Art:** ![creature art](${artUrl})`);
      if (storyExcerpt) {
        bodyLines.push('');
        bodyLines.push(`> ${storyExcerpt}`);
      }
      bodyLines.push('');
      bodyLines.push(`**Creature page:** ${creaturePageUrl}`);
      bodyLines.push('');
      bodyLines.push('---');
      bodyLines.push(
        `This issue tracks **${creature.creature_name as string}** through the production pipeline. ` +
        `Subscribe (watch this issue) to get notified when its status changes — ` +
        `from approval through balancing to appearing in the game.`
      );

      const ghRes = await fetch(
        'https://api.github.com/repos/FilipMarzuki/matlu/issues',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${ghToken}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: `[Creature] ${creature.creature_name as string} — production tracker`,
            body: bodyLines.join('\n'),
            labels: ['creature-tracker', 'status:approved'],
            assignees: ['FilipMarzuki'],
          }),
        }
      );

      if (ghRes.ok) {
        const ghIssue = (await ghRes.json()) as { number: number };
        trackerIssueNumber = ghIssue.number;

        // Store tracker_issue_number on the creature row.
        await fetch(
          `${supabaseUrl}/rest/v1/creature_submissions?id=eq.${encodeURIComponent(id)}`,
          {
            method: 'PATCH',
            headers: {
              apikey: serviceKey,
              Authorization: `Bearer ${serviceKey}`,
              'Content-Type': 'application/json',
              Prefer: 'return=minimal',
            },
            body: JSON.stringify({ tracker_issue_number: trackerIssueNumber }),
          }
        );
      }
    } catch {
      // Swallow — tracker creation failure must not block the approval response.
    }
  }

  return new Response(JSON.stringify({ ok: true, tracker_issue_number: trackerIssueNumber }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
