#!/usr/bin/env node
/**
 * Pulls every row from the Notion "Races" database and writes a JSON cache for
 * agents, codex, and tooling. Requires NOTION_API_KEY; set NOTION_RACES_DATABASE_ID
 * to override the default (see LORE.md).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RACES_DB_ID } from './races-vindfarare-content.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'data', 'notion-races-cache.json');

const NOTION_VERSION = '2022-06-28';
const dbId = process.env.NOTION_RACES_DATABASE_ID?.trim() || RACES_DB_ID;
const key = process.env.NOTION_API_KEY;
if (!key) {
  console.error('NOTION_API_KEY is not set — cannot sync Races.');
  process.exit(1);
}

const baseHeaders = {
  Authorization: `Bearer ${key}`,
  'Notion-Version': NOTION_VERSION,
};

const postHeaders = { ...baseHeaders, 'Content-Type': 'application/json' };

/** @param {Array<{ plain_text?: string }> | undefined} rich */
function richToPlain(rich) {
  if (!rich?.length) return '';
  return rich.map((r) => r.plain_text ?? '').join('');
}

/** @param {Record<string, unknown>} prop */
function propertyToValue(prop) {
  if (!prop || typeof prop !== 'object' || !('type' in prop)) return null;
  const p = /** @type {{ type: string } & Record<string, unknown>} */ (prop);
  switch (p.type) {
    case 'title':
      return richToPlain(/** @type {{ title: Array<{ plain_text?: string }> }} */ (prop).title);
    case 'rich_text':
      return richToPlain(/** @type {{ rich_text: Array<{ plain_text?: string }> }} */ (prop).rich_text);
    case 'number':
      return /** @type {{ number: number | null }} */ (prop).number;
    case 'select':
      return /** @type {{ select: { name: string } | null }} */ (prop).select?.name ?? null;
    case 'url':
      return /** @type {{ url: string | null }} */ (prop).url;
    default:
      return null;
  }
}

async function fetchAllDatabasePages() {
  const results = [];
  let start_cursor = undefined;
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: postHeaders,
      body: JSON.stringify({ page_size: 100, start_cursor }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Notion query failed ${res.status}: ${err}`);
    }
    const data = await res.json();
    results.push(...(data.results ?? []));
    start_cursor = data.has_more ? data.next_cursor : undefined;
  } while (start_cursor);
  return results;
}

/** Fetches one level of page body blocks; concatenates plain text. */
async function fetchPageBodyPlain(pageId) {
  const res = await fetch(
    `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`,
    { headers: baseHeaders }
  );
  if (!res.ok) return '';
  const data = await res.json();
  const lines = [];
  for (const b of data.results ?? []) {
    if (b.type === 'paragraph' && b.paragraph?.rich_text) {
      const line = richToPlain(b.paragraph.rich_text).trim();
      if (line) lines.push(line);
    } else if (b.type === 'heading_1' && b.heading_1?.rich_text) {
      const line = richToPlain(b.heading_1.rich_text).trim();
      if (line) lines.push(`# ${line}`);
    } else if (b.type === 'heading_2' && b.heading_2?.rich_text) {
      const line = richToPlain(b.heading_2.rich_text).trim();
      if (line) lines.push(`## ${line}`);
    } else if (b.type === 'heading_3' && b.heading_3?.rich_text) {
      const line = richToPlain(b.heading_3.rich_text).trim();
      if (line) lines.push(`### ${line}`);
    }
  }
  return lines.join('\n\n');
}

async function main() {
  const pages = await fetchAllDatabasePages();
  const entries = [];

  for (const page of pages) {
    if (!('properties' in page) || !page.properties) continue;
    const props = page.properties;
    const row = { pageId: page.id, url: page.url };
    for (const [k, v] of Object.entries(props)) {
      row[k] = propertyToValue(/** @type {Record<string, unknown>} */ (v));
    }
    row.pageBody = await fetchPageBodyPlain(page.id);
    entries.push(row);
  }

  entries.sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? '')));

  const output = {
    syncedAt: new Date().toISOString(),
    databaseId: dbId,
    entryCount: entries.length,
    entries,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${OUT} (${entries.length} row(s))`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
