#!/usr/bin/env node
/**
 * Pulls every row from the Notion "Races" database into a committed JSON cache
 * so agents and tooling can read race anatomy/sprite fields without live Notion calls.
 *
 * Env: NOTION_API_KEY (required), NOTION_RACES_DATABASE_ID (optional; defaults to LORE.md id).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NOTION_VERSION = '2022-06-28';
const DEFAULT_RACES_DB = '34e843c0-718f-81a3-b4c8-c0ff6839bd21';
const OUT_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'macro-world',
  'races-cache.json',
);

const key = process.env.NOTION_API_KEY ?? '';
const databaseId = process.env.NOTION_RACES_DATABASE_ID ?? DEFAULT_RACES_DB;

if (!key) {
  console.error('sync-races: NOTION_API_KEY is not set');
  process.exit(1);
}

/** @param {import('node:fs').PathLike} dir */
function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

/**
 * @param {unknown} prop
 * @returns {string}
 */
function richTextPlain(prop) {
  if (!prop || typeof prop !== 'object' || !('rich_text' in prop)) return '';
  const rt = /** @type {{ rich_text?: Array<{ plain_text?: string }> }} */ (prop).rich_text;
  if (!Array.isArray(rt)) return '';
  return rt.map((t) => t.plain_text ?? '').join('');
}

/**
 * @param {unknown} prop
 * @returns {string}
 */
function titlePlain(prop) {
  if (!prop || typeof prop !== 'object' || !('title' in prop)) return '';
  const tt = /** @type {{ title?: Array<{ plain_text?: string }> }} */ (prop).title;
  if (!Array.isArray(tt)) return '';
  return tt.map((t) => t.plain_text ?? '').join('');
}

/**
 * @param {string} path
 * @param {RequestInit} init
 */
async function notionFetch(path, init = {}) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Notion ${res.status} ${path}: ${errBody.slice(0, 500)}`);
  }
  return /** @type {Promise<unknown>} */ (res.json());
}

/** @typedef {{ id: string; Name: string; bodyPlan: string; spriteResolution: number | null; silhouette: string; build: string; surface: string; head: string; anatomy: string; variation: string; senses: string; lifespan: string; spriteNote: string; notionPageId: string; lastEditedTime: string }} RaceRow */

async function queryAllPages() {
  /** @type {unknown[]} */
  const results = [];
  let cursor = undefined;
  do {
    /** @type {Record<string, unknown>} */
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const json = await notionFetch(`/databases/${databaseId}/query`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const j = /** @type {{ results?: unknown[]; has_more?: boolean; next_cursor?: string | null }} */ (
      json
    );
    if (Array.isArray(j.results)) results.push(...j.results);
    cursor = j.has_more ? j.next_cursor ?? undefined : undefined;
  } while (cursor);

  /** @type {RaceRow[]} */
  const rows = [];
  for (const page of results) {
    const p = /** @type {{ id?: string; properties?: Record<string, unknown>; last_edited_time?: string }} */ (
      page
    );
    if (!p.id || !p.properties) continue;
    const props = p.properties;
    const slug = richTextPlain(props.id);
    rows.push({
      id: slug,
      Name: titlePlain(props.Name),
      bodyPlan: richTextPlain(props.bodyPlan),
      spriteResolution:
        props.spriteResolution &&
        typeof props.spriteResolution === 'object' &&
        'number' in props.spriteResolution &&
        typeof /** @type {{ number?: unknown }} */ (props.spriteResolution).number === 'number'
          ? /** @type {{ number: number }} */ (props.spriteResolution).number
          : null,
      silhouette: richTextPlain(props.silhouette),
      build: richTextPlain(props.build),
      surface: richTextPlain(props.surface),
      head: richTextPlain(props.head),
      anatomy: richTextPlain(props.anatomy),
      variation: richTextPlain(props.variation),
      senses: richTextPlain(props.senses),
      lifespan: richTextPlain(props.lifespan),
      spriteNote: richTextPlain(props.spriteNote),
      notionPageId: p.id,
      lastEditedTime: p.last_edited_time ?? '',
    });
  }

  rows.sort((a, b) => a.id.localeCompare(b.id));
  return rows;
}

const rows = await queryAllPages();
const payload = {
  syncedAt: new Date().toISOString(),
  notionDatabaseId: databaseId,
  races: rows,
};

ensureDir(dirname(OUT_FILE));
writeFileSync(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`sync-races: wrote ${rows.length} race(s) to ${OUT_FILE}`);
