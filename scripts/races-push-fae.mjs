#!/usr/bin/env node
/**
 * Upserts the Notion "Races" row for Fae (#743) from races-fae-content.mjs.
 * Requires NOTION_API_KEY. Run `npm run races:sync` afterward to refresh the cache.
 *
 * Resolves `Default Culture` → macro-world `crystal-resonance` (Fae Resonance Sites), or
 * `NOTION_CRYSTAL_RESONANCE_CULTURE_PAGE_ID` if set.
 */
import {
  CULTURES_DB_ID,
  FAE_PAGE_ID,
  RACE_PAGE_IDS,
  pageBodyBlocks,
  pageProperties,
} from './races-fae-content.mjs';

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

async function findCrystalResonanceCulturePageId() {
  const fromEnv = process.env.NOTION_CRYSTAL_RESONANCE_CULTURE_PAGE_ID?.trim();
  if (fromEnv) {
    console.log('Using NOTION_CRYSTAL_RESONANCE_CULTURE_PAGE_ID');
    return fromEnv;
  }
  const attempts = [
    { property: 'id', rich_text: { equals: 'crystal-resonance' } },
    { property: 'Name', title: { equals: 'Fae Resonance Sites' } },
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
  const cultureId = await findCrystalResonanceCulturePageId();
  if (!cultureId) {
    console.warn(
      'Default Culture: no crystal-resonance row found (id or Name) — set NOTION_CRYSTAL_RESONANCE_CULTURE_PAGE_ID, or add Name/id on the Culture row. Pushing without Default Culture link.'
    );
  } else {
    console.log('Default Culture: linked to crystal-resonance culture page', cultureId);
  }

  const properties = {
    ...pageProperties,
    'Allied with': {
      relation: [{ id: RACE_PAGE_IDS.lovfolk }, { id: RACE_PAGE_IDS.pandor }],
    },
  };
  if (cultureId) {
    properties['Default Culture'] = { relation: [{ id: cultureId }] };
  }

  const patch = await fetch(`https://api.notion.com/v1/pages/${FAE_PAGE_ID}`, {
    method: 'PATCH',
    headers: postHeaders,
    body: JSON.stringify({ properties }),
  });
  if (!patch.ok) {
    throw new Error(`Patch properties failed ${patch.status}: ${await patch.text()}`);
  }

  await archiveChildBlocks(FAE_PAGE_ID);
  await appendBlocks(FAE_PAGE_ID, pageBodyBlocks);

  const info = await fetch(`https://api.notion.com/v1/pages/${FAE_PAGE_ID}`, {
    headers: baseHeaders,
  });
  const page = await info.json();
  console.log('Updated Fae page', FAE_PAGE_ID, page.url);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
