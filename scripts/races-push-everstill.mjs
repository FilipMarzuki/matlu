#!/usr/bin/env node
/**
 * Upserts the Notion "Races" row for Everstill (#746) from races-everstill-content.mjs,
 * then run `npm run races:sync`. Requires NOTION_API_KEY.
 *
 * Resolves `Default Culture` to the Cultures DB row for `waterstead` (Pandor Watersteads)
 * when present; skips the relation if not found (e.g. schema differences).
 */
import {
  EVERSTILL_PAGE_ID,
  RACE_PAGE_IDS,
  pageBodyBlocks,
  pageProperties,
} from './races-everstill-content.mjs';

const CULTURES_DB_ID = '2928281c-057d-4632-8834-98cd2d873912';

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

/** Best-effort lookup for macro-world `waterstead` — archive-adjacent settlement culture. */
async function findWatersteadCulturePageId() {
  const attempts = [
    { property: 'id', rich_text: { equals: 'waterstead' } },
    { property: 'Name', title: { equals: 'Pandor Watersteads' } },
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
  const cultureId = await findWatersteadCulturePageId();
  if (!cultureId) {
    console.warn(
      'Default Culture: no waterstead row found (id or Name) — set manually in Notion if needed.'
    );
  } else {
    console.log('Default Culture: linked to waterstead culture page', cultureId);
  }

  const properties = {
    ...pageProperties,
    'Allied with': {
      relation: [
        { id: RACE_PAGE_IDS.pandor },
        { id: RACE_PAGE_IDS.lovfolk },
        { id: RACE_PAGE_IDS.deepwalkers },
      ],
    },
    'In tension with': { relation: [{ id: RACE_PAGE_IDS.bergfolk }] },
  };
  if (cultureId) {
    properties['Default Culture'] = { relation: [{ id: cultureId }] };
  }

  const patch = await fetch(`https://api.notion.com/v1/pages/${EVERSTILL_PAGE_ID}`, {
    method: 'PATCH',
    headers: postHeaders,
    body: JSON.stringify({ properties }),
  });
  if (!patch.ok) {
    throw new Error(`Patch properties failed ${patch.status}: ${await patch.text()}`);
  }

  await archiveChildBlocks(EVERSTILL_PAGE_ID);
  await appendBlocks(EVERSTILL_PAGE_ID, pageBodyBlocks);

  const info = await fetch(`https://api.notion.com/v1/pages/${EVERSTILL_PAGE_ID}`, {
    headers: baseHeaders,
  });
  const page = await info.json();
  console.log('Updated Everstill page', EVERSTILL_PAGE_ID, page.url);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
