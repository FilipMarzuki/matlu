/**
 * Build-time GitHub Issues fetcher for FilipMarzuki/matlu.
 *
 * Used by any page that needs to display or filter the project's issue list.
 * All fetches run during `astro build` — no client-side API calls.
 *
 * Requires:
 *   GITHUB_TOKEN — personal access token or Actions token with repo:read
 *
 * Gracefully returns [] when the token is absent or any fetch fails.
 */

const REPO = 'FilipMarzuki/matlu';

/** Category labels that map to the `cluster` field. */
const CATEGORY_LABELS = new Set([
  'systems', 'art', 'lore', 'infrastructure', 'world', 'hero',
  'tech', 'ui-hud', 'ui-menus', 'audio', 'weapons', 'enemies',
  'waves', 'upgrades', 'parts', 'mobile',
]);

export interface Issue {
  number:       number;
  title:        string;
  /** First 200 chars of body, stripped of common markdown syntax. */
  bodyExcerpt:  string;
  url:          string;
  /** All label names attached to this issue. */
  labels:       string[];
  /** T-shirt size from a `size:*` label (e.g. "S", "M"), or null. */
  size:         string | null;
  /** Issue type from a `type:*` label (e.g. "feature", "bug"), or null. */
  type:         string | null;
  /** Category cluster from category labels (e.g. "systems", "art"), or null. */
  cluster:      string | null;
  state:        'open' | 'closed';
  createdAt:    string;
  closedAt:     string | null;
  /** Outcome from an `agent:*` label (e.g. "success", "partial"), or null. */
  agentOutcome: string | null;
}

function getToken(): string | null {
  return import.meta.env.GITHUB_TOKEN ?? null;
}

// Raw shape returned by the GitHub REST API.
interface GhLabel { name: string }
interface GhIssue {
  number:     number;
  title:      string;
  body:       string | null;
  html_url:   string;
  labels:     GhLabel[];
  state:      string;
  created_at: string;
  closed_at:  string | null;
  pull_request?: unknown; // present only on PRs — we skip these
}

function mapIssue(raw: GhIssue): Issue {
  const labelNames = raw.labels.map(l => l.name);

  const sizeLabel = labelNames.find(l => l.startsWith('size:'));
  const typeLabel = labelNames.find(l => l.startsWith('type:'));
  const agentLabel = labelNames.find(l => l.startsWith('agent:'));
  const clusterLabel = labelNames.find(l => CATEGORY_LABELS.has(l));

  const bodyExcerpt = (raw.body ?? '')
    .replace(/[#*`_~>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

  return {
    number:       raw.number,
    title:        raw.title,
    bodyExcerpt,
    url:          raw.html_url,
    labels:       labelNames,
    size:         sizeLabel ? sizeLabel.slice('size:'.length) : null,
    type:         typeLabel ? typeLabel.slice('type:'.length) : null,
    cluster:      clusterLabel ?? null,
    state:        raw.state === 'closed' ? 'closed' : 'open',
    createdAt:    raw.created_at,
    closedAt:     raw.closed_at,
    agentOutcome: agentLabel ? agentLabel.slice('agent:'.length) : null,
  };
}

async function fetchPage(token: string, page: number): Promise<GhIssue[]> {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/issues?state=all&per_page=100&page=${page}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  if (!res.ok) return [];
  return res.json() as Promise<GhIssue[]>;
}

/** Fetches all issues (and filters out pull requests), newest first. */
export async function fetchIssues(): Promise<Issue[]> {
  const token = getToken();
  if (!token) return [];

  try {
    const all: Issue[] = [];
    let page = 1;
    while (true) {
      const batch = await fetchPage(token, page);
      for (const raw of batch) {
        // GitHub's /issues endpoint includes PRs — skip them.
        if (raw.pull_request) continue;
        all.push(mapIssue(raw));
      }
      if (batch.length < 100) break;
      page++;
    }
    return all;
  } catch {
    return [];
  }
}
