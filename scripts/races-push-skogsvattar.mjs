#!/usr/bin/env node
/**
 * Upserts the Notion Races row for skogsvattar (#697). Requires NOTION_API_KEY.
 * Idempotent: creates the page if missing, otherwise updates properties and replaces page body blocks.
 */
import {
  pageBodyBlocks,
  pageProperties,
  RACES_DB_ID,
} from './races-skogsvattar-content.mjs';

const NOTION_VERSION = '2022-06-28';
const key = process.env.NOTION_API_KEY;
if (!key) {
  console.error('NOTION_API_KEY is not set.');
  process.exit(1);
}

const baseHeaders = {
  Authorization: `Bearer ${key}`,
  'Notion-Version': NOTION_VERSION,
};
const postHeaders = { ...baseHeaders, 'Content-Type': 'application/json' };

async function findPageId() {
  const res = await fetch(`https://api.notion.com/v1/databases/${RACES_DB_ID}/query`, {
    method: 'POST',
    headers: postHeaders,
    body: JSON.stringify({
      filter: { property: 'id', rich_text: { equals: 'skogsvattar' } },
    }),
  });
  if (!res.ok) throw new Error(`query failed: ${await res.text()}`);
  const data = await res.json();
  return data.results?.[0]?.id ?? null;
}

async function archiveAllChildren(pageId) {
  let start_cursor = undefined;
  do {
    const url = new URL(`https://api.notion.com/v1/blocks/${pageId}/children`);
    url.searchParams.set('page_size', '100');
    if (start_cursor) url.searchParams.set('start_cursor', start_cursor);
    const res = await fetch(url, { headers: baseHeaders });
    if (!res.ok) throw new Error(`list blocks failed: ${await res.text()}`);
    const data = await res.json();
    for (const b of data.results ?? []) {
      const del = await fetch(`https://api.notion.com/v1/blocks/${b.id}`, {
        method: 'PATCH',
        headers: postHeaders,
        body: JSON.stringify({ archived: true }),
      });
      if (!del.ok) throw new Error(`archive block failed: ${await del.text()}`);
    }
    start_cursor = data.has_more ? data.next_cursor : undefined;
  } while (start_cursor);
}

async function appendBlocks(pageId, blocks) {
  const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    method: 'PATCH',
    headers: postHeaders,
    body: JSON.stringify({ children: blocks }),
  });
  if (!res.ok) throw new Error(`append blocks failed: ${await res.text()}`);
}

async function main() {
  let pageId = await findPageId();

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
    if (!res.ok) throw new Error(`create page failed: ${await res.text()}`);
    const data = await res.json();
    pageId = data.id;
    console.log('Created Notion page', pageId);
    return;
  }

  const patch = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: postHeaders,
    body: JSON.stringify({ properties: pageProperties }),
  });
  if (!patch.ok) throw new Error(`patch page failed: ${await patch.text()}`);

  await archiveAllChildren(pageId);
  await appendBlocks(pageId, pageBodyBlocks);
  console.log('Updated Notion page', pageId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
