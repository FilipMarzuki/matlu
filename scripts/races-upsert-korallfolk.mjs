#!/usr/bin/env node
/**
 * Creates or updates the Notion Races row for `korallfolk` from races-korallfolk-content.mjs.
 * Requires NOTION_API_KEY. Run before `npm run races:sync`.
 */
import {
  RACES_DB_ID,
  pageBodyBlocks,
  pageProperties,
} from './races-korallfolk-content.mjs';

const NOTION_VERSION = '2022-06-28';
const key = process.env.NOTION_API_KEY;
if (!key) {
  console.error('NOTION_API_KEY is not set — cannot upsert korallfolk.');
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
        rich_text: { equals: 'korallfolk' },
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Notion query failed ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const first = data.results?.[0];
  return first?.id ?? null;
}

async function archiveBlockTree(blockId) {
  const chRes = await fetch(
    `https://api.notion.com/v1/blocks/${blockId}/children?page_size=100`,
    { headers: baseHeaders }
  );
  if (chRes.ok) {
    const chData = await chRes.json();
    for (const child of chData.results ?? []) {
      await archiveBlockTree(child.id);
    }
  }
  await fetch(`https://api.notion.com/v1/blocks/${blockId}`, {
    method: 'PATCH',
    headers: postHeaders,
    body: JSON.stringify({ archived: true }),
  });
}

async function clearPageBody(pageId) {
  let start_cursor = undefined;
  do {
    const url = new URL(`https://api.notion.com/v1/blocks/${pageId}/children`);
    url.searchParams.set('page_size', '100');
    if (start_cursor) url.searchParams.set('start_cursor', start_cursor);
    const res = await fetch(url, { headers: baseHeaders });
    if (!res.ok) break;
    const data = await res.json();
    for (const block of data.results ?? []) {
      await archiveBlockTree(block.id);
    }
    start_cursor = data.has_more ? data.next_cursor : undefined;
  } while (start_cursor);
}

async function appendBody(pageId) {
  const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    method: 'POST',
    headers: postHeaders,
    body: JSON.stringify({ children: pageBodyBlocks }),
  });
  if (!res.ok) {
    throw new Error(`Notion append blocks failed ${res.status}: ${await res.text()}`);
  }
}

async function main() {
  let pageId = await findExistingPageId();

  if (!pageId) {
    const res = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: postHeaders,
      body: JSON.stringify({
        parent: { database_id: RACES_DB_ID },
        properties: pageProperties,
        children: pageBodyBlocks,
      }),
    });
    if (!res.ok) {
      throw new Error(`Notion create page failed ${res.status}: ${await res.text()}`);
    }
    const created = await res.json();
    pageId = created.id;
    console.log(`Created korallfolk page ${pageId}`);
    return;
  }

  const patchRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: postHeaders,
    body: JSON.stringify({ properties: pageProperties }),
  });
  if (!patchRes.ok) {
    throw new Error(`Notion patch page failed ${patchRes.status}: ${await patchRes.text()}`);
  }

  await clearPageBody(pageId);
  await appendBody(pageId);
  console.log(`Updated korallfolk page ${pageId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
