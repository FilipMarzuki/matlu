#!/usr/bin/env node
/**
 * Creates or updates the Notion Races row for `sjovandrare` (#696), then you can
 * run `npm run races:sync`. Requires NOTION_API_KEY.
 */
import {
  RACES_DB_ID,
  SJOVANDRARE_RACE_ID,
  pageBodyBlocks,
  pageProperties,
} from './races-sjovandrare-content.mjs';

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

async function findExistingPageId() {
  const res = await fetch(`https://api.notion.com/v1/databases/${RACES_DB_ID}/query`, {
    method: 'POST',
    headers: postHeaders,
    body: JSON.stringify({
      filter: {
        property: 'id',
        rich_text: { equals: SJOVANDRARE_RACE_ID },
      },
    }),
  });
  if (!res.ok) throw new Error(`Notion query failed ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const first = data.results?.[0];
  return first?.id ?? null;
}

/** @param {string} blockId */
async function deleteBlockChildren(blockId) {
  const res = await fetch(
    `https://api.notion.com/v1/blocks/${blockId}/children?page_size=100`,
    { headers: baseHeaders }
  );
  if (!res.ok) return;
  const data = await res.json();
  for (const b of data.results ?? []) {
    await fetch(`https://api.notion.com/v1/blocks/${b.id}`, {
      method: 'PATCH',
      headers: postHeaders,
      body: JSON.stringify({ archived: true }),
    });
  }
}

/** @param {string} pageId */
async function setPageBody(pageId) {
  await deleteBlockChildren(pageId);
  const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    method: 'PATCH',
    headers: postHeaders,
    body: JSON.stringify({ children: pageBodyBlocks }),
  });
  if (!res.ok) throw new Error(`Notion append blocks failed ${res.status}: ${await res.text()}`);
}

async function main() {
  const existingId = await findExistingPageId();
  if (existingId) {
    const res = await fetch(`https://api.notion.com/v1/pages/${existingId}`, {
      method: 'PATCH',
      headers: postHeaders,
      body: JSON.stringify({ properties: pageProperties }),
    });
    if (!res.ok) throw new Error(`Notion patch page failed ${res.status}: ${await res.text()}`);
    await setPageBody(existingId);
    console.log(`Updated Notion page ${existingId}`);
    return;
  }

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: postHeaders,
    body: JSON.stringify({
      parent: { database_id: RACES_DB_ID },
      properties: pageProperties,
      children: pageBodyBlocks,
    }),
  });
  if (!res.ok) throw new Error(`Notion create page failed ${res.status}: ${await res.text()}`);
  const page = await res.json();
  console.log(`Created Notion page ${page.id} (${page.url})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
