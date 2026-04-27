#!/usr/bin/env node
/**
 * Upserts the Notion "Races" row for Deepwalkers (#740) from races-deepwalkers-content.mjs.
 * Resolves Default Culture → Cultures DB `coastborn` (Coastborn). Requires NOTION_API_KEY.
 * Run `npm run races:sync` afterward to refresh data/notion-races-cache.json.
 */
import {
  CULTURES_DB_ID,
  DEEPWALKERS_PAGE_ID,
  MERFOLK_RACE_PAGE_ID,
  PANDOR_RACE_PAGE_ID,
  pageBodyBlocks,
  pageProperties,
} from './races-deepwalkers-content.mjs';

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

async function findCoastbornCulturePageId() {
  const fromEnv = process.env.NOTION_COASTBORN_CULTURE_PAGE_ID?.trim();
  if (fromEnv) {
    console.log('Using NOTION_COASTBORN_CULTURE_PAGE_ID');
    return fromEnv;
  }
  const attempts = [
    { property: 'id', rich_text: { equals: 'coastborn' } },
    { property: 'Name', title: { equals: 'Coastborn' } },
  ];
  for (const filter of attempts) {
    const res = await fetch(`https://api.notion.com/v1/databases/${CULTURES_DB_ID}/query`, {
      method: 'POST',
      headers: postHeaders,
      body: JSON.stringify({ page_size: 1, filter }),
    });
    if (!res.ok) continue;
    const data = await res.json();
    const first = data.results?.[0];
    if (first?.id) return first.id;
  }
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
  const cultureId = await findCoastbornCulturePageId();
  if (!cultureId) {
    console.warn(
      'Default Culture: no coastborn row found (id or Name) — set NOTION_COASTBORN_CULTURE_PAGE_ID, or add the Coastborn culture. Pushing without Default Culture link.'
    );
  } else {
    console.log('Default Culture: linked to coastborn / Coastborn', cultureId);
  }

  const properties = {
    ...pageProperties,
    'Allied with': { relation: [{ id: PANDOR_RACE_PAGE_ID }] },
    'In tension with': { relation: [{ id: MERFOLK_RACE_PAGE_ID }] },
  };
  if (cultureId) {
    properties['Default Culture'] = { relation: [{ id: cultureId }] };
  }

  const patch = await fetch(`https://api.notion.com/v1/pages/${DEEPWALKERS_PAGE_ID}`, {
    method: 'PATCH',
    headers: postHeaders,
    body: JSON.stringify({ properties }),
  });
  if (!patch.ok) {
    throw new Error(`Patch properties failed ${patch.status}: ${await patch.text()}`);
  }

  await archiveChildBlocks(DEEPWALKERS_PAGE_ID);
  await appendBlocks(DEEPWALKERS_PAGE_ID, pageBodyBlocks);

  const info = await fetch(`https://api.notion.com/v1/pages/${DEEPWALKERS_PAGE_ID}`, {
    headers: baseHeaders,
  });
  const page = await info.json();
  console.log('Updated Deepwalkers page', DEEPWALKERS_PAGE_ID, page.url);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
