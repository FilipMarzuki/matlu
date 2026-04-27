#!/usr/bin/env node
/**
 * Updates the Notion "Races" row for Goblins (#742) from races-goblins-content.mjs,
 * then run `npm run races:sync`. Requires NOTION_API_KEY.
 *
 * Resolves `Default Culture` → Goblin Warrens (`bazaar-folk`) by querying the Cultures DB
 * (`Settlement-culture id` = bazaar-folk, else Name = Goblin Warrens), or
 * `NOTION_BAZAAR_FOLK_CULTURE_PAGE_ID` if set.
 */
import {
  BERGFOLK_RACE_PAGE_ID,
  CULTURES_DB_ID,
  GOBLINS_PAGE_ID,
  MARKFOLK_RACE_PAGE_ID,
  PANDOR_RACE_PAGE_ID,
  VIDDFOLK_RACE_PAGE_ID,
  pageBodyBlocks,
  pageProperties,
} from './races-goblins-content.mjs';

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

/** @param {Record<string, unknown>} filter */
async function queryOneCulturePage(filter) {
  const res = await fetch(`https://api.notion.com/v1/databases/${CULTURES_DB_ID}/query`, {
    method: 'POST',
    headers: postHeaders,
    body: JSON.stringify({ page_size: 1, filter }),
  });
  if (!res.ok) {
    console.warn(`Culture query failed ${res.status}: ${await res.text()}`);
    return null;
  }
  const data = await res.json();
  return data.results?.[0]?.id ?? null;
}

async function findBazaarFolkCulturePageId() {
  const fromEnv = process.env.NOTION_BAZAAR_FOLK_CULTURE_PAGE_ID?.trim();
  if (fromEnv) {
    console.log('Using NOTION_BAZAAR_FOLK_CULTURE_PAGE_ID');
    return fromEnv;
  }
  let id = await queryOneCulturePage({
    property: 'Settlement-culture id',
    rich_text: { equals: 'bazaar-folk' },
  });
  if (id) return id;
  id = await queryOneCulturePage({
    property: 'Name',
    title: { equals: 'Goblin Warrens' },
  });
  if (id) return id;
  console.warn(
    'No Culture row matched bazaar-folk or Goblin Warrens; push Default Culture link manually or set NOTION_BAZAAR_FOLK_CULTURE_PAGE_ID.'
  );
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
  const defaultCultureId = await findBazaarFolkCulturePageId();
  if (!defaultCultureId) {
    console.warn(
      'Could not resolve Default Culture. Set NOTION_BAZAAR_FOLK_CULTURE_PAGE_ID ' +
        'or ensure a Culture row exists. Pushing Races properties without Default Culture link.'
    );
  }

  /** @type {Record<string, unknown>} */
  const properties = { ...pageProperties };
  properties['Allied with'] = {
    relation: [{ id: VIDDFOLK_RACE_PAGE_ID }, { id: PANDOR_RACE_PAGE_ID }],
  };
  properties['In tension with'] = {
    relation: [{ id: BERGFOLK_RACE_PAGE_ID }, { id: MARKFOLK_RACE_PAGE_ID }],
  };
  if (defaultCultureId) {
    properties['Default Culture'] = { relation: [{ id: defaultCultureId }] };
  }

  const patch = await fetch(`https://api.notion.com/v1/pages/${GOBLINS_PAGE_ID}`, {
    method: 'PATCH',
    headers: postHeaders,
    body: JSON.stringify({ properties }),
  });
  if (!patch.ok) {
    throw new Error(`Patch properties failed ${patch.status}: ${await patch.text()}`);
  }

  await archiveChildBlocks(GOBLINS_PAGE_ID);
  await appendBlocks(GOBLINS_PAGE_ID, pageBodyBlocks);

  const info = await fetch(`https://api.notion.com/v1/pages/${GOBLINS_PAGE_ID}`, {
    headers: baseHeaders,
  });
  const page = await info.json();
  console.log('Updated Goblins page', GOBLINS_PAGE_ID, page.url);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
