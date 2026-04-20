/**
 * GitHub API helpers for the creature tracker.
 *
 * Each approved creature gets a GitHub issue in FilipMarzuki/matlu so parents
 * and kids can subscribe and get notified as the creature moves through the
 * production pipeline. This module handles creating, commenting on, and
 * closing those issues.
 */

const REPO = 'FilipMarzuki/matlu';
const REPO_OWNER = 'FilipMarzuki';
const API_BASE = 'https://api.github.com';

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

export interface CreateTrackerOptions {
  creatureName: string;
  creatorDisplay: string; // already resolved to "Anonymous" if credits_opt_in=false
  loreDescription: string | null;
  imageUrl: string | null;
  slug: string;
  wikiBase: string;
}

/** Creates a tracker issue on approval. Returns the new issue number. */
export async function createTrackerIssue(
  token: string,
  opts: CreateTrackerOptions,
): Promise<number> {
  const loreBlock = opts.loreDescription
    ? `> ${opts.loreDescription.slice(0, 400)}`
    : '_No story excerpt provided._';

  const imageBlock = opts.imageUrl
    ? `![${opts.creatureName}](${opts.imageUrl})`
    : '_No image submitted._';

  const body = [
    `## ${opts.creatureName}`,
    '',
    `**Creator:** ${opts.creatorDisplay}`,
    '',
    '**Story excerpt:**',
    loreBlock,
    '',
    imageBlock,
    '',
    `**Detail page:** ${opts.wikiBase}/creatures/${opts.slug}`,
    '',
    '---',
    '',
    "This issue tracks the creature's progress through the Matlu production pipeline.",
    'Subscribe (watch this issue) to get notified each time its status changes.',
    'The issue will be closed automatically when the creature ships in-game.',
  ].join('\n');

  const res = await fetch(`${API_BASE}/repos/${REPO}/issues`, {
    method: 'POST',
    headers: ghHeaders(token),
    body: JSON.stringify({
      title: `[Creature] ${opts.creatureName} — production tracker`,
      body,
      labels: ['creature-tracker', 'status:approved'],
      assignees: [REPO_OWNER],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub issue creation failed (${res.status}): ${text}`);
  }

  const data = await res.json() as { number: number };
  return data.number;
}

/** Posts a status-change comment and updates labels on the tracker issue. */
export async function postStatusComment(
  token: string,
  issueNumber: number,
  fromLabel: string,
  toLabel: string,
  fromStatus: string,
  toStatus: string,
): Promise<void> {
  const date = new Date().toISOString();
  const comment = `🔄 Status changed: **${fromLabel}** → **${toLabel}**\n${date}`;

  await fetch(`${API_BASE}/repos/${REPO}/issues/${issueNumber}/comments`, {
    method: 'POST',
    headers: ghHeaders(token),
    body: JSON.stringify({ body: comment }),
  });

  // Swap status labels: remove old, add new
  await removeLabel(token, issueNumber, `status:${fromStatus}`);
  await addLabels(token, issueNumber, [`status:${toStatus}`]);
}

/** Posts a final comment and closes the issue when the creature ships. */
export async function closeTrackerIssue(
  token: string,
  issueNumber: number,
  entityId: string | null,
  wikiBase: string,
  slug: string,
): Promise<void> {
  const entityLine = entityId ? `**Entity ID:** \`${entityId}\`` : '';
  const detailLine = `**Detail page:** ${wikiBase}/creatures/${slug}`;
  const body = [
    '🎉 This creature has shipped and is now part of Core Warden!',
    '',
    entityLine,
    detailLine,
  ]
    .filter(Boolean)
    .join('\n');

  await fetch(`${API_BASE}/repos/${REPO}/issues/${issueNumber}/comments`, {
    method: 'POST',
    headers: ghHeaders(token),
    body: JSON.stringify({ body }),
  });

  await fetch(`${API_BASE}/repos/${REPO}/issues/${issueNumber}`, {
    method: 'PATCH',
    headers: ghHeaders(token),
    body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
  });
}

/** Scrubs a tracker issue body and closes it (GDPR erasure). */
export async function scrubTrackerIssue(
  token: string,
  issueNumber: number,
): Promise<void> {
  await fetch(`${API_BASE}/repos/${REPO}/issues/${issueNumber}`, {
    method: 'PATCH',
    headers: ghHeaders(token),
    body: JSON.stringify({ body: '[content removed]' }),
  });

  await fetch(`${API_BASE}/repos/${REPO}/issues/${issueNumber}/comments`, {
    method: 'POST',
    headers: ghHeaders(token),
    body: JSON.stringify({ body: 'Creature withdrawn by contributor.' }),
  });

  await fetch(`${API_BASE}/repos/${REPO}/issues/${issueNumber}`, {
    method: 'PATCH',
    headers: ghHeaders(token),
    body: JSON.stringify({ state: 'closed', state_reason: 'not_planned' }),
  });
}

async function removeLabel(token: string, issueNumber: number, label: string): Promise<void> {
  const encoded = encodeURIComponent(label);
  await fetch(`${API_BASE}/repos/${REPO}/issues/${issueNumber}/labels/${encoded}`, {
    method: 'DELETE',
    headers: ghHeaders(token),
  });
  // 404 is fine — label may not exist
}

async function addLabels(token: string, issueNumber: number, labels: string[]): Promise<void> {
  await fetch(`${API_BASE}/repos/${REPO}/issues/${issueNumber}/labels`, {
    method: 'POST',
    headers: ghHeaders(token),
    body: JSON.stringify({ labels }),
  });
}
