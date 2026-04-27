#!/usr/bin/env node
/**
 * Upserts the Notion "Races" row for Merfolk (#741) from races-merfolk-content.mjs.
 * Requires NOTION_API_KEY. Run `npm run races:sync` afterward to refresh the cache.
 *
 * Sets `Default Culture` → reefborn (Merfolk Reefs) via Cultures DB query, or
 * `NOTION_REEFBORN_CULTURE_PAGE_ID` if set.
 * Sets `In tension with` → Deepwalkers (overlapping deep-channel authority per WORLD.md).
 */
import {
  CULTURES_DB_ID,
  DEEPWALKERS_RACE_PAGE_ID,
  MERFOLK_PAGE_ID,
  pageBodyBlocks,
  pageProperties,
} from './races-merfolk-content.mjs';

const NOTION_VERSION = '2022-06-28';
const key = process.env.NOTION_API_KEY;
if (!key) {
  console.error('NOTION_API_KEY is not set');
  process.exit(1);
}

const baseHeaders = {
  Authorization: `Bearer ${key}`,
  'Notion-Version': NOTION_VERSION,
};
const postHeaders = { ...baseHeaders, 'Content-Type': 'application/json' };

/** @param {Record<string, unknown>} filter */
async function queryOneCulturePage(filter) {
  const res = await fetch(`https://api.notion.com/v1/databases/${CULTURES_DB_ID}/query`, {
    method: 'POST',
    headers: postHeaders,
    body: JSON.stringify({ page_size: 1, filter }),
  });
  if (!res.ok) {
    console.warn(`Culture query failed ${res.status}: ${await res.text()}`);
    return null;
  }
  const data = await res.json();
  return data.results?.[0]?.id ?? null;
}

async function findReefbornCulturePageId() {
  const fromEnv = process.env.NOTION_REEFBORN_CULTURE_PAGE_ID?.trim();
  if (fromEnv) {
    console.log('Using NOTION_REEFBORN_CULTURE_PAGE_ID');
    return fromEnv;
  }
  let id = await queryOneCulturePage({
    property: 'Settlement-culture id',
    rich_text: { equals: 'reefborn' },
  });
  if (id) return id;
  id = await queryOneCulturePage({
    property: 'Name',
    title: { equals: 'Merfolk Reefs' },
  });
  if (id) return id;
  console.warn(
    'Default Culture: no reefborn / Merfolk Reefs row found — set NOTION_REEFBORN_CULTURE_PAGE_ID. Pushing without Default Culture link.'
  );
  return null;
}

async function archiveChildBlocks(pageId) {
  for (;;) {
    const res = await fetch(
      `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`,
      { headers: baseHeaders }
    );
    if (!res.ok) throw new Error(`List blocks failed ${res.status}`);
    const data = await res.json();
    const blocks = data.results ?? [];
    if (!blocks.length) break;
    for (const b of blocks) {
      const del = await fetch(`https://api.notion.com/v1/blocks/${b.id}`, {
        method: 'PATCH',
        headers: postHeaders,
        body: JSON.stringify({ archived: true }),
      });
      if (!del.ok) throw new Error(`Archive block failed ${del.status}: ${await del.text()}`);
    }
  }
}

async function appendBlocks(pageId, blocks) {
  const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    method: 'PATCH',
    headers: postHeaders,
    body: JSON.stringify({ children: blocks }),
  });
  if (!res.ok) {
    throw new Error(`Append blocks failed ${res.status}: ${await res.text()}`);
  }
}

async function main() {
  const cultureId = await findReefbornCulturePageId();
  if (cultureId) {
    console.log('Default Culture: linked to reefborn culture page', cultureId);
  }

  const properties = {
    ...pageProperties,
    'In tension with': { relation: [{ id: DEEPWALKERS_RACE_PAGE_ID }] },
  };
  if (cultureId) {
    properties['Default Culture'] = { relation: [{ id: cultureId }] };
  }

  const patch = await fetch(`https://api.notion.com/v1/pages/${MERFOLK_PAGE_ID}`, {
    method: 'PATCH',
    headers: postHeaders,
    body: JSON.stringify({ properties }),
  });
  if (!patch.ok) {
    throw new Error(`Patch properties failed ${patch.status}: ${await patch.text()}`);
  }

  await archiveChildBlocks(MERFOLK_PAGE_ID);
  await appendBlocks(MERFOLK_PAGE_ID, pageBodyBlocks);

  const info = await fetch(`https://api.notion.com/v1/pages/${MERFOLK_PAGE_ID}`, {
    headers: baseHeaders,
  });
  const page = await info.json();
  console.log('Updated Merfolk page', MERFOLK_PAGE_ID, page.url);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
