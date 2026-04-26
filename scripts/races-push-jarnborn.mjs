#!/usr/bin/env node
/**
 * Upserts the Notion "Races" row for jarnborn (#690) from races-jarnborn-content.mjs,
 * then you can run `npm run races:sync`. Requires NOTION_API_KEY.
 */
import {
  RACES_DB_ID,
  pageBodyBlocks,
  pageProperties,
} from './races-jarnborn-content.mjs';

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

async function findJarnbornPageId() {
  const res = await fetch(`https://api.notion.com/v1/databases/${RACES_DB_ID}/query`, {
    method: 'POST',
    headers: postHeaders,
    body: JSON.stringify({
      filter: {
        property: 'id',
        rich_text: { equals: 'jarnborn' },
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

/** Archives direct children of `pageId` so the body can be replaced. */
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
  let pageId = await findJarnbornPageId();

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
      throw new Error(`Create page failed ${res.status}: ${await res.text()}`);
    }
    const created = await res.json();
    pageId = created.id;
    console.log('Created Jarnborn page', pageId, created.url);
    return;
  }

  const patch = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: postHeaders,
    body: JSON.stringify({ properties: pageProperties }),
  });
  if (!patch.ok) {
    throw new Error(`Patch properties failed ${patch.status}: ${await patch.text()}`);
  }

  await archiveChildBlocks(pageId);
  await appendBlocks(pageId, pageBodyBlocks);

  const info = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    headers: baseHeaders,
  });
  const page = await info.json();
  console.log('Updated Jarnborn page', pageId, page.url);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
