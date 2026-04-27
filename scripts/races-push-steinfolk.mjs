#!/usr/bin/env node
/**
 * Upserts the Notion "Races" row for Steinfolk (#738) from races-steinfolk-content.mjs,
 * then run `npm run races:sync`. Requires NOTION_API_KEY.
 *
 * Sets Allied with: Bergfolk (Building Alliance), Markfolk (mutual respect).
 * Default Culture is already linked in Notion; this script does not overwrite it.
 */
import {
  STEINFOLK_PAGE_ID,
  RACE_PAGE_IDS,
  pageBodyBlocks,
  pageProperties,
} from './races-steinfolk-content.mjs';

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
  const properties = {
    ...pageProperties,
    'Allied with': {
      relation: [
        { id: RACE_PAGE_IDS.bergfolk },
        { id: RACE_PAGE_IDS.markfolk },
      ],
    },
  };

  const patch = await fetch(`https://api.notion.com/v1/pages/${STEINFOLK_PAGE_ID}`, {
    method: 'PATCH',
    headers: postHeaders,
    body: JSON.stringify({ properties }),
  });
  if (!patch.ok) {
    throw new Error(`Patch properties failed ${patch.status}: ${await patch.text()}`);
  }

  await archiveChildBlocks(STEINFOLK_PAGE_ID);
  await appendBlocks(STEINFOLK_PAGE_ID, pageBodyBlocks);

  const info = await fetch(`https://api.notion.com/v1/pages/${STEINFOLK_PAGE_ID}`, {
    headers: baseHeaders,
  });
  const page = await info.json();
  console.log('Updated Steinfolk page', STEINFOLK_PAGE_ID, page.url);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
