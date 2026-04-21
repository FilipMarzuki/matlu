/**
 * POST /api/creatures/create-lore-page
 *
 * Creates a draft Notion lore entry for the creature, stores the returned
 * page ID and URL on the row, then transitions status from 'balanced' to
 * 'lore-ready'.
 *
 * Body: { id: string }
 * Auth: admin_session cookie
 * Env:  NOTION_API_KEY, VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { isAuthorized } from '../../../lib/admin-session';

// Notion Creatures database — same ID used by lore-autofill and lore-features agents
const NOTION_CREATURES_DB = '4c71181b-2842-4301-b7cf-94572b3845a9';

export const POST: APIRoute = async ({ request }) => {
  const cookieHeader = request.headers.get('cookie');
  if (!isAuthorized(cookieHeader)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
  const serviceKey  = import.meta.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const notionKey   = import.meta.env.NOTION_API_KEY ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500);
  if (!notionKey) return json({ error: 'NOTION_API_KEY not configured' }, 500);

  let id: string;
  try {
    const body = await request.json();
    id          = body.id;
    if (!id) throw new Error('missing id');
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const hdrs = serviceHeaders(serviceKey);

  // ── Fetch creature ────────────────────────────────────────────────────────
  const fetchRes = await fetch(
    `${supabaseUrl}/rest/v1/creature_submissions?id=eq.${enc(id)}&limit=1`,
    { headers: hdrs }
  );
  if (!fetchRes.ok) return json({ error: 'Failed to fetch creature' }, 500);

  const rows: CreatureRow[] = await fetchRes.json();
  if (!rows.length) return json({ error: 'Creature not found' }, 404);

  const c = rows[0];
  if (c.lore_entry_id) {
    // Page already created — return existing URL
    return json({ ok: true, url: c.lore_entry_url, existed: true });
  }

  // ── Build Notion page content ─────────────────────────────────────────────
  const contentBlocks: NotionBlock[] = [];

  if (c.lore_description) {
    contentBlocks.push(heading('Story'));
    contentBlocks.push(paragraph(c.lore_description));
  }

  if (c.lore_origin) {
    contentBlocks.push(heading('Origin'));
    contentBlocks.push(paragraph(c.lore_origin));
  }

  if (c.balance_notes) {
    contentBlocks.push(heading('Balance notes (internal)'));
    contentBlocks.push(paragraph(c.balance_notes));
  }

  if (c.balance_tier) {
    contentBlocks.push(paragraph(`Tier: ${c.balance_tier}`));
  }

  if (c.biome_affinity?.length) {
    contentBlocks.push(paragraph(`Biomes: ${c.biome_affinity.join(', ')}`));
  }

  contentBlocks.push(paragraph(`Submitted by: ${c.creator_name}${c.maker_age ? ` (age ${c.maker_age})` : ''}`));
  contentBlocks.push(paragraph(`_Draft created from admin pipeline — #332_`));

  // ── Create Notion page ────────────────────────────────────────────────────
  const notionRes = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      Authorization:    `Bearer ${notionKey}`,
      'Content-Type':   'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({
      parent:     { database_id: NOTION_CREATURES_DB },
      properties: {
        Name: {
          title: [{ text: { content: c.creature_name } }],
        },
        // Lore Status property exists in the Notion Creatures DB (used by lore agents)
        'Lore Status': {
          select: { name: 'draft' },
        },
      },
      children: contentBlocks,
    }),
  });

  if (!notionRes.ok) {
    const errBody = await notionRes.text().catch(() => 'unknown error');
    return json({ error: `Notion API error: ${errBody}` }, 502);
  }

  const notionPage: { id: string; url: string } = await notionRes.json();
  const pageUrl = notionPage.url;

  // ── Store Notion ID + URL on creature row, transition to lore-ready ───────
  const updateRes = await fetch(
    `${supabaseUrl}/rest/v1/creature_submissions?id=eq.${enc(id)}`,
    {
      method:  'PATCH',
      headers: { ...hdrs, Prefer: 'return=minimal' },
      body:    JSON.stringify({
        lore_entry_id:  notionPage.id,
        lore_entry_url: pageUrl,
        status:         'lore-ready',
      }),
    }
  );

  if (!updateRes.ok) {
    // Notion page was created but DB update failed — return partial success
    return json({ ok: true, url: pageUrl, warning: 'Notion page created but DB update failed' });
  }

  return json({ ok: true, url: pageUrl });
};

// ── Type helpers ──────────────────────────────────────────────────────────────

interface CreatureRow {
  id: string;
  creature_name: string;
  creator_name: string;
  maker_age: number | null;
  lore_description: string | null;
  lore_origin: string | null;
  lore_entry_id: string | null;
  lore_entry_url: string | null;
  balance_notes: string | null;
  balance_tier: string | null;
  biome_affinity: string[] | null;
}

interface NotionBlock {
  object: 'block';
  type: 'heading_3' | 'paragraph';
  heading_3?: { rich_text: Array<{ type: 'text'; text: { content: string } }> };
  paragraph?: { rich_text: Array<{ type: 'text'; text: { content: string } }> };
}

function heading(text: string): NotionBlock {
  return {
    object: 'block',
    type:   'heading_3',
    heading_3: { rich_text: [{ type: 'text', text: { content: text } }] },
  };
}

function paragraph(text: string): NotionBlock {
  return {
    object: 'block',
    type:   'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: text } }] },
  };
}

function serviceHeaders(key: string) {
  return {
    apikey:         key,
    Authorization:  `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

function enc(s: string) { return encodeURIComponent(s); }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
