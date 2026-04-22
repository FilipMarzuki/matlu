/**
 * Build-time GitHub Issues fetcher for FilipMarzuki/matlu.
 *
 * Imported by wiki and dev pages at Astro build time — never runs in the browser.
 * Uses a single GraphQL round-trip with cursor-based pagination.
 *
 * Usage:
 *   const issues = await fetchIssues({ token: import.meta.env.GITHUB_TOKEN ?? '' });
 *
 * Cache: writes .cache/issues.json after each fetch for debugging.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO_OWNER = 'FilipMarzuki';
const REPO_NAME  = 'matlu';

export interface Issue {
  number:      number;
  title:       string;
  /** First 200 chars of body, stripped of common markdown syntax. */
  bodyExcerpt: string;
  url:         string;
  labels:      string[];
  size:        'xs' | 's' | 'm' | 'l' | 'xl' | null;
  type:        'feature' | 'bug' | 'refactor' | 'perf' | 'infra' | 'docs' | 'spike' | null;
  /** Category cluster derived from CLUSTER_BY_LABEL. Defaults to 'other'. */
  cluster:     string;
  state:       'open' | 'closed';
  createdAt:   string;
  closedAt:    string | null;
  agentOutcome: 'success' | 'partial' | 'failed' | 'wrong-interpretation' | null;
}

/**
 * Maps category labels to cluster names. Priority order: first match wins.
 * Single source of truth shared by wiki and dev — do not diverge these files.
 */
const CLUSTER_BY_LABEL: Record<string, string> = {
  world:            'worlds',
  hero:             'heroes-combat',
  weapons:          'heroes-combat',
  'systems:combat': 'heroes-combat',
  enemies:          'creatures',
  lore:             'lore',
  waves:            'gameplay',
  upgrades:         'gameplay',
  parts:            'gameplay',
  art:              'art',
  audio:            'art',
  'ui-hud':         'art',
  'ui-menus':       'art',
  mobile:           'art',
  systems:          'engine',
  'systems:render': 'engine',
  tech:             'engine',
  infrastructure:   'engine',
};

/** Returns the cluster for the first label in `labels` that appears in CLUSTER_BY_LABEL. */
export function deriveCluster(labels: string[]): string {
  for (const label of labels) {
    const cluster = CLUSTER_BY_LABEL[label];
    if (cluster !== undefined) return cluster;
  }
  return 'other';
}

// ─── GraphQL plumbing ────────────────────────────────────────────────────────

const VALID_SIZES  = new Set<string>(['xs', 's', 'm', 'l', 'xl']);
const VALID_TYPES  = new Set<string>(['feature', 'bug', 'refactor', 'perf', 'infra', 'docs', 'spike']);
const VALID_AGENTS = new Set<string>(['success', 'partial', 'failed', 'wrong-interpretation']);

interface GhNode {
  number:    number;
  title:     string;
  body:      string | null;
  url:       string;
  state:     'OPEN' | 'CLOSED';
  createdAt: string;
  closedAt:  string | null;
  labels:    { nodes: { name: string }[] };
}

interface GhPageInfo { hasNextPage: boolean; endCursor: string | null }

interface GhResponse {
  data: {
    repository: {
      issues: { nodes: GhNode[]; pageInfo: GhPageInfo };
    };
  };
}

const QUERY = `
  query($owner: String!, $name: String!, $states: [IssueState!], $after: String) {
    repository(owner: $owner, name: $name) {
      issues(
        first: 100
        states: $states
        after: $after
        orderBy: { field: CREATED_AT, direction: DESC }
      ) {
        nodes {
          number title body url state createdAt closedAt
          labels(first: 20) { nodes { name } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

function mapNode(raw: GhNode): Issue {
  const labelNames = raw.labels.nodes.map(l => l.name);

  const sizeRaw  = labelNames.find(l => l.startsWith('size:'))?.slice('size:'.length).toLowerCase();
  const typeRaw  = labelNames.find(l => l.startsWith('type:'))?.slice('type:'.length).toLowerCase();
  const agentRaw = labelNames.find(l => l.startsWith('agent:'))?.slice('agent:'.length).toLowerCase();

  const bodyExcerpt = (raw.body ?? '')
    .replace(/[#*`_~>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

  return {
    number:      raw.number,
    title:       raw.title,
    bodyExcerpt,
    url:         raw.url,
    labels:      labelNames,
    size:        VALID_SIZES.has(sizeRaw ?? '')  ? (sizeRaw  as Issue['size'])  : null,
    type:        VALID_TYPES.has(typeRaw ?? '')  ? (typeRaw  as Issue['type'])  : null,
    cluster:     deriveCluster(labelNames),
    state:       raw.state === 'CLOSED' ? 'closed' : 'open',
    createdAt:   raw.createdAt,
    closedAt:    raw.closedAt,
    agentOutcome: VALID_AGENTS.has(agentRaw ?? '') ? (agentRaw as Issue['agentOutcome']) : null,
  };
}

async function fetchPage(
  token:  string,
  states: string[],
  after:  string | null,
): Promise<{ nodes: GhNode[]; pageInfo: GhPageInfo }> {
  const res = await fetch('https://api.github.com/graphql', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: QUERY,
      variables: { owner: REPO_OWNER, name: REPO_NAME, states, after },
    }),
  });
  if (!res.ok) return { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
  const json = (await res.json()) as GhResponse;
  return json.data.repository.issues;
}

/**
 * Fetches issues via GitHub GraphQL, paginating 100 at a time.
 * Returns [] if the token is missing or any network error occurs.
 * Writes a debug cache to .cache/issues.json (non-fatal if write fails).
 */
export async function fetchIssues(opts: {
  token: string;
  state?: 'open' | 'all';
}): Promise<Issue[]> {
  if (!opts.token) return [];

  // GitHub GraphQL IssueState enum uses uppercase.
  const states = opts.state === 'open' ? ['OPEN'] : ['OPEN', 'CLOSED'];

  try {
    const all: Issue[] = [];
    let cursor: string | null = null;

    do {
      const page = await fetchPage(opts.token, states, cursor);
      for (const node of page.nodes) all.push(mapNode(node));
      if (!page.pageInfo.hasNextPage) break;
      cursor = page.pageInfo.endCursor;
    } while (true);

    // Write cache for debugging / build inspection — non-fatal on failure.
    try {
      mkdirSync('.cache', { recursive: true });
      writeFileSync(join('.cache', 'issues.json'), JSON.stringify(all, null, 2));
    } catch {
      // Intentionally swallowed — cache write should never break the build.
    }

    return all;
  } catch {
    return [];
  }
}
