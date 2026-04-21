#!/usr/bin/env node
// Generates three Mermaid architecture diagrams from the live codebase,
// renders them to PNG, pushes PNGs to matlu-wiki (public repo) for hosting,
// and creates/updates a "Architecture Diagrams" page on the Notion dev blog.
//
// Runs via GitHub Actions (see .github/workflows/diagrams.yml).
// All credentials come from environment secrets.
//
// Diagram 1 — agent-pipeline:  nightly CI/agent pipeline flowchart
// Diagram 2 — game-arch:       Phaser scenes + systems + persistence
// Diagram 3 — entity-hierarchy: full entity class inheritance tree

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderDiagram } from './lib/mermaid-render.js';
import { pushToWiki }    from './lib/wiki-upload.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const REPO_ROOT  = path.join(__dirname, '../..');

// ── Credentials ───────────────────────────────────────────────────────────────

const NOTION_API_KEY       = process.env.NOTION_API_KEY;
const NOTION_BLOG_PAGE_ID  = process.env.NOTION_BLOG_PAGE_ID || '33f843c0-718f-8197-8972-fb2b6e44754a';
if (!NOTION_API_KEY) { console.error('Missing NOTION_API_KEY'); process.exit(1); }

// ── Paths ─────────────────────────────────────────────────────────────────────

const TMP_DIR     = '/tmp/diagrams';
const SRC_DIR     = path.join(REPO_ROOT, 'src');
const DIAGRAMS = [
  { id: 'pipeline',         label: 'Nightly Agent Pipeline' },
  { id: 'game-arch',        label: 'Game Architecture' },
  { id: 'entity-hierarchy', label: 'Entity Hierarchy' },
];

// ── Codebase scanning ─────────────────────────────────────────────────────────

/**
 * Recursively read all .ts files in a directory.
 */
function readTsFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...readTsFiles(full));
    else if (entry.name.endsWith('.ts')) results.push(full);
  }
  return results;
}

/**
 * Parse `export class Foo extends Bar` patterns from a TypeScript file.
 * Returns a map of { className → parentClass | null }.
 */
function parseClasses(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const results = {};
  // Match both `export class Foo extends Bar` and `export abstract class Foo extends Bar`
  for (const m of content.matchAll(/export(?:\s+abstract)?\s+class\s+(\w+)(?:\s+extends\s+(\w+))?/g)) {
    results[m[1]] = m[2] || null;
  }
  return results;
}

function scanEntityHierarchy() {
  const map = {};
  for (const file of readTsFiles(path.join(SRC_DIR, 'entities'))) {
    Object.assign(map, parseClasses(file));
  }
  // Also pick up AI classes used by entities
  for (const file of readTsFiles(path.join(SRC_DIR, 'ai'))) {
    Object.assign(map, parseClasses(file));
  }
  return map;
}

function scanSceneNames() {
  const scenesDir = path.join(SRC_DIR, 'scenes');
  if (!fs.existsSync(scenesDir)) return [];
  return fs.readdirSync(scenesDir)
    .filter(f => f.endsWith('.ts'))
    .map(f => f.replace('.ts', ''));
}

// ── GitHub Issues query ───────────────────────────────────────────────────────

async function getGitHubOpenCount() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(
      'https://api.github.com/search/issues?q=repo:FilipMarzuki/matlu+is:issue+is:open&per_page=1',
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
      }
    );
    const data = await res.json();
    return data.total_count ?? null;
  } catch (e) {
    console.warn('GitHub Issues query failed:', e.message);
    return null;
  }
}

// ── Mermaid generation ────────────────────────────────────────────────────────

function buildPipelineDiagram(openIssues) {
  const backlogLabel = openIssues !== null
    ? `GitHub Issues\\n${openIssues} open`
    : 'GitHub Issues';
  return `flowchart LR
    LB["${backlogLabel}"]
    TA["Triage Agent\\n22:00 UTC"]
    IA["Nightly Agent\\n02:00 UTC"]
    PR["Branch + PR"]
    CI["CI\\ntypecheck + build"]
    AM["Auto-merge"]
    VD["Vercel Deploy"]

    LB -->|nightly| TA
    TA -->|ready label| IA
    IA --> PR
    PR --> CI
    CI -->|pass| AM
    AM --> VD`;
}

function buildGameArchDiagram(sceneNames) {
  // Split scenes into primary (always shown) + overflow count
  const primary = ['GameScene', 'CombatArenaScene', 'NavScene', 'MainMenuScene'];
  const rest = sceneNames.filter(s => !primary.includes(s));
  const moreLabel = rest.length ? `...${rest.length} more` : '';

  const sceneNodes = primary
    .filter(s => sceneNames.includes(s))
    .map(s => `        ${s}[${s}]`)
    .join('\n');

  const moreNode = moreLabel ? `        more["${moreLabel}"]` : '';

  return `flowchart TD
    main["main.ts\\nPhaser game config"]

    subgraph Scenes["Scenes (${sceneNames.length})"]
${sceneNodes}
${moreNode}
    end

    subgraph World["World Systems"]
        WS[WorldState]
        WC[WorldClock]
        CF[CorruptionField]
        PS[PathSystem]
    end

    subgraph Combat["Combat / AI"]
        SK[SkillSystem]
        BT[BehaviorTree]
        AB[ArenaBlackboard]
    end

    subgraph Persist["Persistence"]
        SB[(Supabase)]
        LS[(localStorage)]
    end

    main --> Scenes
    GameScene --> World
    CombatArenaScene --> Combat
    Combat --> SK
    SK --> LS
    GameScene --> SB`;
}

function buildEntityDiagram(hierarchy) {
  const lines = ['classDiagram'];
  for (const [child, parent] of Object.entries(hierarchy)) {
    // Only include classes that have a parent in the hierarchy (skip orphans and Phaser base classes)
    if (parent && Object.keys(hierarchy).includes(parent)) {
      lines.push(`    ${parent} <|-- ${child}`);
    }
  }
  return lines.join('\n');
}

// renderDiagram and pushToWiki are imported from ./lib/ (shared with FIL-205 agent)

// ── Notion page create / update ───────────────────────────────────────────────

async function notionGet(path) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
    },
  });
  if (!res.ok) throw new Error(`Notion GET ${path} → ${res.status}`);
  return res.json();
}

async function notionPost(path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion POST ${path} → ${res.status}: ${err}`);
  }
  return res.json();
}

async function notionPatch(path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion PATCH ${path} → ${res.status}: ${err}`);
  }
  return res.json();
}

async function upsertDiagramsPage(imageUrls) {
  // List children of the dev blog to find an existing diagrams page
  const children = await notionGet(`/blocks/${NOTION_BLOG_PAGE_ID}/children?page_size=100`);
  const existing = children.results?.find(b =>
    b.type === 'child_page' && b.child_page?.title === 'Architecture Diagrams'
  );

  if (existing) {
    // Archive the old page so we replace it cleanly with a fresh one
    await notionPatch(`/pages/${existing.id}`, { archived: true });
    console.log('  Archived old Architecture Diagrams page');
  }

  // Build page content: heading + one image block per diagram
  const now = new Date().toISOString().slice(0, 10);
  const blocks = [
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: `Auto-generated ${now} from the live codebase. Updates every Monday.` } }],
      },
    },
    ...DIAGRAMS.flatMap(({ id, label }) => {
      const url = imageUrls[id];
      if (!url) return [];
      return [
        {
          object: 'block',
          type: 'heading_2',
          heading_2: { rich_text: [{ type: 'text', text: { content: label } }] },
        },
        {
          object: 'block',
          type: 'image',
          image: { type: 'external', external: { url } },
        },
      ];
    }),
  ];

  const page = await notionPost('/pages', {
    parent: { page_id: NOTION_BLOG_PAGE_ID },
    properties: {
      title: { title: [{ type: 'text', text: { content: 'Architecture Diagrams' } }] },
    },
    children: blocks,
  });

  console.log(`  Notion page: ${page.url}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Scanning codebase...');
  const entityHierarchy = scanEntityHierarchy();
  const sceneNames      = scanSceneNames();
  console.log(`  Found ${Object.keys(entityHierarchy).length} entity classes, ${sceneNames.length} scenes`);

  console.log('Querying Linear...');
  const openIssues = await getGitHubOpenCount();
  console.log(`  Open issues: ${openIssues ?? 'unavailable'}`);

  console.log('Generating Mermaid diagrams...');
  const mmdMap = {
    'pipeline':          buildPipelineDiagram(openIssues),
    'game-arch':         buildGameArchDiagram(sceneNames),
    'entity-hierarchy':  buildEntityDiagram(entityHierarchy),
  };

  console.log('Rendering diagrams to PNG...');
  const pngPaths = {};
  for (const { id } of DIAGRAMS) {
    const png = renderDiagram(id, mmdMap[id]);
    if (png) pngPaths[id] = png;
  }

  if (!Object.keys(pngPaths).length) {
    console.error('No diagrams rendered — aborting Notion update.');
    process.exit(1);
  }

  console.log('Pushing PNGs to matlu-wiki...');
  const imageUrls = {};
  for (const [id, pngPath] of Object.entries(pngPaths)) {
    try {
      imageUrls[id] = await pushToWiki(id, pngPath);
    } catch (e) {
      console.warn(`  Skipping ${id}: ${e.message}`);
    }
  }

  console.log('Updating Notion dev blog...');
  await upsertDiagramsPage(imageUrls);

  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
