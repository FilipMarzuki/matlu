#!/usr/bin/env node
/**
 * Pulls the Notion "Races" database into a committed JSON cache for agents, CI, and tooling.
 * Requires NOTION_API_KEY (integration with read access to the Races database).
 *
 * @see LORE.md — Races database ID
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NOTION_VERSION = '2022-06-28';
/** @type {string} — must match LORE.md */
const RACES_DATABASE_ID = '34e843c0-718f-81a3-b4c8-c0ff6839bd21';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'lore', 'races-cache.json');

const k = process.env.NOTION_API_KEY;
if (!k) {
  console.error('sync-races: NOTION_API_KEY is not set');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${k}`,
  'Notion-Version': NOTION_VERSION,
  'Content-Type': 'application/json',
};

/** @param {unknown} page */
function titleText(page) {
  const props = page.properties;
  const t = props.Name ?? props.name;
  if (t?.type !== 'title' || !Array.isArray(t.title)) return '';
  return t.title.map((x) => x.plain_text ?? '').join('');
}

/** @param {unknown} page @param {string} key */
function richText(page, key) {
  const props = page.properties;
  const p = props[key];
  if (p?.type !== 'rich_text' || !Array.isArray(p.rich_text)) return '';
  return p.rich_text.map((x) => x.plain_text ?? '').join('');
}

/** @param {unknown} page */
function numberProp(page, key) {
  const props = page.properties;
  const p = props[key];
  if (p?.type !== 'number') return null;
  return p.number ?? null;
}

/**
 * @param {string} blockId
 * @returns {Promise<string[]>}
 */
async function blockParagraphs(blockId) {
  const lines = [];
  let cursor = undefined;
  for (;;) {
    const u = new URL(`https://api.notion.com/v1/blocks/${blockId}/children`);
    u.searchParams.set('page_size', '100');
    if (cursor) u.searchParams.set('start_cursor', cursor);
    const res = await fetch(u, { headers });
    if (!res.ok) {
      console.warn(`sync-races: could not read blocks for ${blockId}: ${res.status}`);
      break;
    }
    const data = await res.json();
    for (const b of data.results ?? []) {
      if (b.type === 'paragraph' && b.paragraph?.rich_text) {
        const line = b.paragraph.rich_text.map((x) => x.plain_text ?? '').join('');
        if (line) lines.push(line);
      } else if (b.type === 'bulleted_list_item' && b.bulleted_list_item?.rich_text) {
        const line = b.bulleted_list_item.rich_text.map((x) => x.plain_text ?? '').join('');
        if (line) lines.push(`• ${line}`);
      }
    }
    if (!data.has_more) break;
    cursor = data.next_cursor;
  }
  return lines;
}

/** @param {string} dbId */
async function queryAll(dbId) {
  const rows = [];
  let cursor = undefined;
  for (;;) {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Notion database query failed: ${res.status} ${err}`);
    }
    const data = await res.json();
    rows.push(...(data.results ?? []));
    if (!data.has_more) break;
    cursor = data.next_cursor;
  }
  return rows;
}

const pages = await queryAll(RACES_DATABASE_ID);

const races = [];
for (const page of pages) {
  const bodyLines = await blockParagraphs(page.id);
  races.push({
    notionPageId: page.id,
    notionUrl: page.url,
    name: titleText(page),
    id: richText(page, 'id'),
    bodyPlan: richText(page, 'bodyPlan'),
    spriteResolution: numberProp(page, 'spriteResolution'),
    silhouette: richText(page, 'silhouette'),
    build: richText(page, 'build'),
    surface: richText(page, 'surface'),
    head: richText(page, 'head'),
    anatomy: richText(page, 'anatomy'),
    variation: richText(page, 'variation'),
    senses: richText(page, 'senses'),
    lifespan: richText(page, 'lifespan'),
    spriteNote: richText(page, 'spriteNote'),
    pageBody: bodyLines.join('\n\n'),
  });
}

races.sort((a, b) => a.id.localeCompare(b.id));

const payload = {
  syncedAt: new Date().toISOString(),
  source: 'notion',
  databaseId: RACES_DATABASE_ID,
  races,
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`sync-races: wrote ${races.length} race(s) → ${OUT}`);
