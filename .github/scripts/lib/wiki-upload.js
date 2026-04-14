#!/usr/bin/env node
// Shared PNG → matlu-wiki uploader.
// Used by generate-diagrams.js (FIL-204) and the roadmap-update agent (FIL-205).
//
// matlu is a private repo, so its raw GitHub URLs require auth — Notion image
// blocks can't load them. PNGs go to FilipMarzuki/matlu-wiki (public), giving
// stable public URLs at raw.githubusercontent.com.
//
// Programmatic:  import { pushToWiki } from './lib/wiki-upload.js'
//                const url = await pushToWiki('pipeline', '/tmp/diagrams/pipeline.png');
//
// CLI:           node wiki-upload.js <id> <path/to/file.png>
//                → prints the public raw URL to stdout on success
//                → exits 1 on failure
//
// Requires env var: MATLU_WIKI_PUSH_TOKEN (fine-grained PAT, Contents r/w on matlu-wiki)

import fs from 'fs';
import { fileURLToPath } from 'url';

const WIKI_OWNER = 'FilipMarzuki';
const WIKI_REPO  = 'matlu-wiki';

/**
 * Pushes a PNG file to FilipMarzuki/matlu-wiki/public/diagrams/<id>.png
 * via the GitHub Contents API. Creates the file on first run; updates
 * in-place (using the existing SHA) on subsequent runs.
 *
 * @param {string} id      - Diagram identifier used as filename stem (e.g. 'pipeline')
 * @param {string} pngPath - Absolute path to the PNG file to upload
 * @returns {Promise<string>} - Stable public raw.githubusercontent.com URL
 */
export async function pushToWiki(id, pngPath) {
  const token = process.env.MATLU_WIKI_PUSH_TOKEN;
  if (!token) throw new Error('MATLU_WIKI_PUSH_TOKEN is not set');

  const wikiPath = `public/diagrams/${id}.png`;
  const apiUrl = `https://api.github.com/repos/${WIKI_OWNER}/${WIKI_REPO}/contents/${wikiPath}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };

  // Fetch the existing file's SHA so we can update in-place (GitHub API requires it)
  let sha;
  const existing = await fetch(apiUrl, { headers });
  if (existing.ok) {
    sha = (await existing.json()).sha;
  }

  const content = fs.readFileSync(pngPath).toString('base64');
  const body = {
    message: `chore: update ${id} diagram [skip ci]`,
    content,
    ...(sha ? { sha } : {}),
  };

  const res = await fetch(apiUrl, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub push failed for ${id}: ${res.status} ${err}`);
  }

  // Return the stable public raw URL (usable in Notion image blocks)
  return `https://raw.githubusercontent.com/${WIKI_OWNER}/${WIKI_REPO}/main/${wikiPath}`;
}

// ── CLI entry point ───────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [id, pngPath] = process.argv.slice(2);
  if (!id || !pngPath) {
    console.error('Usage: node wiki-upload.js <id> <path/to/file.png>');
    process.exit(1);
  }
  try {
    const url = await pushToWiki(id, pngPath);
    console.log(url); // caller captures this with $(node wiki-upload.js ...)
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
