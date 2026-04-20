/**
 * POST /api/creatures/create-lore-entry
 * Creates a Notion lore page for the creature in the "characters" database,
 * then stores lore_entry_id + lore_entry_url on the creature row and
 * transitions status → 'lore-ready'.
 *
 * Idempotent: if lore_entry_id is already set, returns { ok: true, existing: true }.
 */
export const prerender = false;
import type { APIRoute } from 'astro';
import { Client } from '@notionhq/client';
import type { CreatePageParameters } from '@notionhq/client/build/src/api-endpoints';
import { isAdminAuthenticated } from '../../../lib/adminAuth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';

// Notion "characters" database — creature lore pages are created here
const CHARACTERS_DB_ID = '751f1b85-0c99-4e1b-a0a5-c39a5422498a';

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isAdminAuthenticated(cookies)) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body: { id: string };
  try {
    body = (await request.json()) as { id: string };
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { id } = body;
  if (!id) return new Response('Missing id', { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: creature, error: fetchErr } = await supabase
    .from('creature_submissions')
    .select('creature_name, lore_description, world_name, lore_entry_id')
    .eq('id', id)
    .single();

  if (fetchErr || !creature) {
    return new Response('Creature not found', { status: 404 });
  }

  // Already has a lore page — return early without creating a duplicate
  if (creature.lore_entry_id) {
    return new Response(JSON.stringify({ ok: true, existing: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const notionKey = import.meta.env.NOTION_API_KEY;
  if (!notionKey) {
    return new Response('NOTION_API_KEY is not configured', { status: 503 });
  }

  const notion = new Client({ auth: notionKey });

  // Build the Notion page properties with the SDK's exact property union type
  const properties: CreatePageParameters['properties'] = {
    Name: { title: [{ text: { content: creature.creature_name } }] },
    'Lore Status': { select: { name: 'draft' } },
    ...(creature.lore_description
      ? { Summary: { rich_text: [{ text: { content: creature.lore_description } }] } }
      : {}),
    ...(creature.world_name
      ? { World: { select: { name: creature.world_name } } }
      : {}),
  };

  const page = await notion.pages.create({
    parent: { database_id: CHARACTERS_DB_ID },
    properties,
  });

  const pageId = page.id;
  // Notion URLs use the ID without dashes
  const pageUrl = `https://www.notion.so/${pageId.replace(/-/g, '')}`;

  const { error: updateErr } = await supabase
    .from('creature_submissions')
    .update({
      lore_entry_id: pageId,
      lore_entry_url: pageUrl,
      // Creating the lore page signals lore-readiness; trigger records history
      status: 'lore-ready',
    })
    .eq('id', id);

  if (updateErr) return new Response(updateErr.message, { status: 500 });

  return new Response(
    JSON.stringify({ ok: true, lore_entry_id: pageId, lore_entry_url: pageUrl }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
