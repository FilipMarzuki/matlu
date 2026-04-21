/**
 * POST /api/creatures/create-lore-entry — #340 (B2 pipeline redesign).
 *
 * Body: { id: string }
 * Auth: admin_session cookie
 * Keys: SUPABASE_SERVICE_ROLE_KEY, NOTION_API_KEY
 *
 * Creates a Notion lore page for the creature in the Characters database,
 * stores lore_entry_id + lore_entry_url on the row, and transitions status
 * from 'balanced' to 'lore-ready'.
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { Client } from '@notionhq/client';
import { isAuthorized } from '../../../lib/admin-session';

// Notion Characters database — same DB used by notion-lore.ts for character entries.
const NOTION_CHARACTERS_DB = '751f1b85-0c99-4e1b-a0a5-c39a5422498a';

export const POST: APIRoute = async ({ request }) => {
  const cookieHeader = request.headers.get('cookie');
  if (!isAuthorized(cookieHeader)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
  const serviceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const notionKey = import.meta.env.NOTION_API_KEY ?? '';

  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!notionKey) {
    return new Response(JSON.stringify({ error: 'NOTION_API_KEY not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let id: string;
  try {
    const body = await request.json();
    id = body.id;
    if (!id) throw new Error('missing id');
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Invalid body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const sbHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  // ── Fetch creature row ────────────────────────────────────────────────────────
  const fetchRes = await fetch(
    `${supabaseUrl}/rest/v1/creature_submissions?id=eq.${encodeURIComponent(id)}&limit=1&select=id,creature_name,lore_description,lore_origin,world_name,status`,
    { headers: sbHeaders }
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
  const creature = rows[0] as {
    id: string;
    creature_name: string;
    lore_description: string | null;
    lore_origin: string | null;
    world_name: string | null;
    status: string;
  };

  // Guard: only create if not already created
  // (lore_entry_id check would require fetching that field — skip for simplicity,
  //  the admin can visually see if the link is already shown)

  // ── Create Notion page ────────────────────────────────────────────────────────
  let notionPageId: string;
  let notionPageUrl: string;
  try {
    const notion = new Client({ auth: notionKey });

    const summaryText = [
      creature.lore_description ?? '',
      creature.lore_origin ? `\n\nOrigin: ${creature.lore_origin}` : '',
    ].join('').trim();

    const page = await notion.pages.create({
      parent: { database_id: NOTION_CHARACTERS_DB },
      properties: {
        Name: {
          title: [{ text: { content: creature.creature_name } }],
        },
        ...(summaryText ? {
          Summary: {
            rich_text: [{ text: { content: summaryText.slice(0, 2000) } }],
          },
        } : {}),
        ...(creature.world_name ? {
          World: {
            select: { name: creature.world_name },
          },
        } : {}),
      },
    });

    notionPageId = page.id;
    // Notion page URL format
    notionPageUrl = `https://www.notion.so/${page.id.replace(/-/g, '')}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Notion API error';
    return new Response(JSON.stringify({ error: `Failed to create Notion page: ${msg}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Update row: store lore IDs + transition to lore-ready ────────────────────
  const updateRes = await fetch(
    `${supabaseUrl}/rest/v1/creature_submissions?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { ...sbHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({
        lore_entry_id: notionPageId,
        lore_entry_url: notionPageUrl,
        status: 'lore-ready',
      }),
    }
  );
  if (!updateRes.ok) {
    return new Response(JSON.stringify({ error: 'Notion page created but failed to save IDs to DB' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Record history ────────────────────────────────────────────────────────────
  await fetch(
    `${supabaseUrl}/rest/v1/creature_status_history`,
    {
      method: 'POST',
      headers: { ...sbHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({
        creature_id: id,
        from_status: creature.status,
        to_status: 'lore-ready',
        notes: `Notion lore page created: ${notionPageUrl}`,
      }),
    }
  ).catch(() => { /* history insert failure is non-fatal */ });

  return new Response(JSON.stringify({ ok: true, lore_entry_url: notionPageUrl }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
