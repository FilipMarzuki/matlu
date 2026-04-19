/**
 * Build-time Notion lore fetcher.
 *
 * Queries the four lore databases from LORE.md and returns normalized entries.
 * Gracefully returns [] when NOTION_API_KEY is unset or the query fails.
 */

import { Client } from '@notionhq/client';
import type { PageObjectResponse, PartialPageObjectResponse } from '@notionhq/client/build/src/api-endpoints';

// Database IDs from LORE.md
const DBS = {
  characters: '751f1b85-0c99-4e1b-a0a5-c39a5422498a',
  factions:   '833dd954-974b-422d-adb2-14a51f30af16',
  worlds:     '466886c8-a11c-46e7-b974-a58b8ee6647d',
  locations:  'e374f3c2-e431-4e96-ab00-0dd21a6223b5',
} as const;

export type LoreType = keyof typeof DBS;

export interface LoreEntry {
  id: string;          // Notion page ID — used as URL slug
  slug: string;        // URL-safe slug derived from id
  type: LoreType;
  title: string;
  summary: string;
  world: string | null;
  status: string;
  lastEdited: string;  // ISO 8601
}

function slugFromId(id: string): string {
  // Strip dashes for a clean URL segment
  return id.replace(/-/g, '');
}

function extractTitle(page: PageObjectResponse): string {
  // Notion always has a "Name" or "title" property
  const props = page.properties;
  for (const key of ['Name', 'name', 'Title', 'title']) {
    const p = props[key];
    if (p?.type === 'title') {
      return p.title.map((t: { plain_text: string }) => t.plain_text).join('') || '(Untitled)';
    }
  }
  return '(Untitled)';
}

function extractRichText(page: PageObjectResponse, ...keys: string[]): string {
  const props = page.properties;
  for (const key of keys) {
    const p = props[key];
    if (p?.type === 'rich_text') {
      return p.rich_text.map((t: { plain_text: string }) => t.plain_text).join('');
    }
  }
  return '';
}

function extractSelect(page: PageObjectResponse, ...keys: string[]): string | null {
  const props = page.properties;
  for (const key of keys) {
    const p = props[key];
    if (p?.type === 'select' && p.select) {
      return p.select.name;
    }
  }
  return null;
}

function isFullPage(p: PageObjectResponse | PartialPageObjectResponse): p is PageObjectResponse {
  return 'properties' in p;
}

async function queryDb(client: Client, dbId: string, type: LoreType): Promise<LoreEntry[]> {
  const response = await client.databases.query({
    database_id: dbId,
    filter: {
      and: [
        {
          property: 'Lore Status',
          select: { does_not_equal: 'deprecated' },
        },
      ],
    },
    sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
    page_size: 100,
  });

  return response.results
    .filter(isFullPage)
    .map((page) => ({
      id: page.id,
      slug: slugFromId(page.id),
      type,
      title: extractTitle(page),
      summary: extractRichText(page, 'Summary', 'Description', 'summary', 'description'),
      world: extractSelect(page, 'World', 'world'),
      status: extractSelect(page, 'Lore Status', 'Status', 'status') ?? 'draft',
      lastEdited: page.last_edited_time,
    }))
    .filter((e) => e.title !== '(Untitled)');
}

/** Returns all lore entries across all four databases, newest-first. */
export async function fetchAllLore(): Promise<LoreEntry[]> {
  const key = import.meta.env.NOTION_API_KEY;
  if (!key) return [];

  try {
    const client = new Client({ auth: key });
    const results = await Promise.all(
      (Object.entries(DBS) as [LoreType, string][]).map(([type, id]) =>
        queryDb(client, id, type).catch(() => [] as LoreEntry[])
      )
    );
    return results
      .flat()
      .sort((a, b) => new Date(b.lastEdited).valueOf() - new Date(a.lastEdited).valueOf());
  } catch {
    return [];
  }
}

/** Returns a single entry's full Markdown body using notion-to-md. */
export async function fetchLoreBody(pageId: string): Promise<string> {
  const key = import.meta.env.NOTION_API_KEY;
  if (!key) return '';

  try {
    const { NotionToMarkdown } = await import('notion-to-md');
    const client = new Client({ auth: key });
    const n2m = new NotionToMarkdown({ notionClient: client });
    const blocks = await n2m.pageToMarkdown(pageId);
    return n2m.toMarkdownString(blocks).parent;
  } catch {
    return '';
  }
}

export const TYPE_LABELS: Record<LoreType, string> = {
  characters: 'Character',
  factions:   'Faction',
  worlds:     'World',
  locations:  'Location',
};
