#!/usr/bin/env node
/**
 * Creates (or updates) the `sandhari` Races page in Notion (#695).
 * Run once; after that use `npm run races:sync` to refresh the local cache.
 * Requires NOTION_API_KEY.
 */
import { RACES_DB_ID, pageProperties, pageBodyBlocks } from './races-sandhari-content.mjs';

const NOTION_VERSION = '2022-06-28';
const key = process.env.NOTION_API_KEY;
if (!key) {
  console.error('NOTION_API_KEY is not set.');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${key}`,
  'Notion-Version': NOTION_VERSION,
  'Content-Type': 'application/json',
};

async function findExistingPage() {
  const res = await fetch(`https://api.notion.com/v1/databases/${RACES_DB_ID}/query`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      filter: {
        property: 'id',
        rich_text: { equals: 'sandhari' },
      },
    }),
  });
  if (!res.ok) throw new Error(`Query failed ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.results?.[0] ?? null;
}

async function createPage() {
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      parent: { database_id: RACES_DB_ID },
      properties: pageProperties,
      children: pageBodyBlocks,
    }),
  });
  if (!res.ok) throw new Error(`Create failed ${res.status}: ${await res.text()}`);
  return res.json();
}

async function updatePage(pageId) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ properties: pageProperties }),
  });
  if (!res.ok) throw new Error(`Update props failed ${res.status}: ${await res.text()}`);

  // Replace page body: delete existing blocks then append new ones
  const listRes = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`, { headers });
  if (listRes.ok) {
    const listData = await listRes.json();
    for (const block of listData.results ?? []) {
      await fetch(`https://api.notion.com/v1/blocks/${block.id}`, {
        method: 'DELETE',
        headers,
      });
    }
  }

  const appendRes = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ children: pageBodyBlocks }),
  });
  if (!appendRes.ok) throw new Error(`Append body failed ${appendRes.status}: ${await appendRes.text()}`);
  return res.json();
}

async function main() {
  const existing = await findExistingPage();
  if (existing) {
    console.log(`Found existing sandhari page (${existing.id}), updating…`);
    await updatePage(existing.id);
    console.log('Updated.');
  } else {
    console.log('No sandhari page found, creating…');
    const page = await createPage();
    console.log(`Created: ${page.url}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
