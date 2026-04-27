#!/usr/bin/env node
/**
 * Upserts the Notion "Races" row for Dragons (#745) from races-dragons-content.mjs,
 * then run `npm run races:sync`. Requires NOTION_API_KEY.
 *
 * Sets `Allied with` → Giants (both ancient sovereign entities under the Old Accords),
 * `In tension with` → Lövfolk (Grimmvald territory contact, described as "tense but functional").
 * `Default Culture` (dragonkin-remnant) is already linked; the script preserves it.
 */
import {
  DRAGONS_PAGE_ID,
  GIANTS_RACE_PAGE_ID,
  LOVFOLK_RACE_PAGE_ID,
  pageBodyBlocks,
  pageProperties,
} from './races-dragons-content.mjs';

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
  /** @type {Record<string, unknown>} */
  const properties = { ...pageProperties };
  properties['Allied with'] = { relation: [{ id: GIANTS_RACE_PAGE_ID }] };
  properties['In tension with'] = { relation: [{ id: LOVFOLK_RACE_PAGE_ID }] };

  const patch = await fetch(`https://api.notion.com/v1/pages/${DRAGONS_PAGE_ID}`, {
    method: 'PATCH',
    headers: postHeaders,
    body: JSON.stringify({ properties }),
  });
  if (!patch.ok) {
    throw new Error(`Patch properties failed ${patch.status}: ${await patch.text()}`);
  }

  await archiveChildBlocks(DRAGONS_PAGE_ID);
  await appendBlocks(DRAGONS_PAGE_ID, pageBodyBlocks);

  const info = await fetch(`https://api.notion.com/v1/pages/${DRAGONS_PAGE_ID}`, {
    headers: baseHeaders,
  });
  const page = await info.json();
  console.log('Updated Dragons page', DRAGONS_PAGE_ID, page.url);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
