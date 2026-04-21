/**
 * GitHub tracker helpers — FIL-333.
 *
 * Shared utilities for creating and updating the per-creature GitHub tracking
 * issue.  All calls go through the GitHub REST API using GITHUB_TOKEN, which
 * must be set in the Vercel environment (or equivalent server runtime).
 *
 * Failures are best-effort: if GitHub is unreachable or the token is missing,
 * the main DB operation still succeeds and the tracker is simply not created /
 * updated.
 */

import {
  getStatusDisplay,
  STATUS_LABEL_COLORS,
} from './supabase-creatures';

const REPO = 'FilipMarzuki/matlu';
const GITHUB_API = 'https://api.github.com';

export function makeGitHubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'User-Agent': 'matlu-codex/1.0',
  };
}

/**
 * Ensures a label exists on the repo.  Ignores 422 (already exists).
 */
export async function ensureLabel(
  headers: Record<string, string>,
  name: string,
  color: string,
  description: string = '',
): Promise<void> {
  const res = await fetch(`${GITHUB_API}/repos/${REPO}/labels`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name, color, description }),
  });
  // 422 = label already exists — not an error
  if (!res.ok && res.status !== 422) {
    // best-effort: swallow
  }
}

/**
 * Build the GitHub issue body for a newly-approved creature.
 * Privacy-aware: maker name only shown if credits_opt_in is true.
 */
export function buildTrackerIssueBody(creature: {
  creature_name: string;
  creator_name: string | null;
  credits_opt_in: boolean;
  world_name: string | null;
  kind_size: string | null;
  lore_description: string | null;
  slug: string | null;
  id: string;
}): string {
  const creatorDisplay =
    creature.credits_opt_in && creature.creator_name
      ? creature.creator_name
      : 'Anonymous';
  const slug = creature.slug ?? creature.id;
  const wikiUrl = `https://codex.corewarden.com/creatures/${slug}`;

  const lines: string[] = [
    `## 🦎 ${creature.creature_name}`,
    '',
    `**Created by:** ${creatorDisplay}`,
  ];
  if (creature.world_name) lines.push(`**World:** ${creature.world_name}`);
  if (creature.kind_size)  lines.push(`**Size:** ${creature.kind_size}`);
  lines.push('', '---', '');
  if (creature.lore_description) {
    lines.push(`### Story`, creature.lore_description, '', '---', '');
  }
  lines.push(
    `🔗 **Public page:** ${wikiUrl}`,
    '',
    '---',
    '',
    `This issue tracks **${creature.creature_name}** as it moves toward the game. Every stage will be posted here as a comment. Feel free to react or comment!`,
    '',
    '> 🌟 Current status: **Accepted!**',
  );
  return lines.join('\n');
}

/**
 * Create the GitHub tracker issue for a newly-approved creature.
 * Returns the created issue number, or null on failure.
 */
export async function createTrackerIssue(
  token: string,
  creature: Parameters<typeof buildTrackerIssueBody>[0],
): Promise<number | null> {
  const headers = makeGitHubHeaders(token);

  // Ensure labels exist before referencing them
  await Promise.all([
    ensureLabel(headers, 'creature-tracker', '0075ca', 'Tracks a community creature submission'),
    ensureLabel(headers, 'status:approved', STATUS_LABEL_COLORS['approved'] ?? '2da44e', 'Creature status: approved'),
  ]);

  const res = await fetch(`${GITHUB_API}/repos/${REPO}/issues`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: `[Creature] ${creature.creature_name} — production tracker`,
      body: buildTrackerIssueBody(creature),
      labels: ['creature-tracker', 'status:approved'],
    }),
  });

  if (!res.ok) return null;
  const data: { number: number } = await res.json();
  return data.number;
}

/**
 * Post a status-change bot comment and update labels on an existing tracker issue.
 * If the new status is `in-game`, the issue is also closed with a final comment.
 */
export async function notifyStatusChange(
  token: string,
  issueNumber: number,
  fromStatus: string,
  toStatus: string,
  entityId: string | null,
  creatureName: string,
): Promise<void> {
  const headers = makeGitHubHeaders(token);

  const fromDisplay = getStatusDisplay(fromStatus);
  const toDisplay   = getStatusDisplay(toStatus);

  const now = new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'UTC',
  });

  const commentBody =
    `🔄 Status changed: **${fromDisplay.label}** → **${toDisplay.label}**\n${now} UTC`;

  await fetch(`${GITHUB_API}/repos/${REPO}/issues/${issueNumber}/comments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ body: commentBody }),
  });

  // Swap status:* label: remove old, add new
  const labelsRes = await fetch(
    `${GITHUB_API}/repos/${REPO}/issues/${issueNumber}/labels`,
    { headers },
  );
  if (labelsRes.ok) {
    const current: Array<{ name: string }> = await labelsRes.json();
    const oldStatusLabel = current.find(l => l.name.startsWith('status:'));
    if (oldStatusLabel) {
      await fetch(
        `${GITHUB_API}/repos/${REPO}/issues/${issueNumber}/labels/${encodeURIComponent(oldStatusLabel.name)}`,
        { method: 'DELETE', headers },
      );
    }
  }

  const newLabelName = `status:${toStatus}`;
  await ensureLabel(
    headers,
    newLabelName,
    STATUS_LABEL_COLORS[toStatus] ?? 'ededed',
    `Creature status: ${toStatus}`,
  );
  await fetch(`${GITHUB_API}/repos/${REPO}/issues/${issueNumber}/labels`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ labels: [newLabelName] }),
  });

  // Close the issue when the creature ships to in-game
  if (toStatus === 'in-game') {
    const entityRef = entityId ? `\`${entityId}\`` : '_not yet assigned_';
    const finalComment = [
      `🎮 **${creatureName} is now in the game!**`,
      '',
      `Entity ID: ${entityRef}`,
      '',
      'Thank you for submitting your creature! You can find it by playing Matlu: https://corewarden.app',
      '',
      'This tracker is now closed. 🎉',
    ].join('\n');

    await fetch(`${GITHUB_API}/repos/${REPO}/issues/${issueNumber}/comments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ body: finalComment }),
    });

    await fetch(`${GITHUB_API}/repos/${REPO}/issues/${issueNumber}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ state: 'closed' }),
    });
  }
}

/**
 * Scrub a tracker issue for GDPR erasure.
 * Replaces body with "[content removed]", adds a closing comment, closes issue.
 * Called by the GDPR delete endpoint (FIL-331, not yet built).
 */
export async function scrubTrackerIssue(
  token: string,
  issueNumber: number,
): Promise<void> {
  const headers = makeGitHubHeaders(token);

  await fetch(`${GITHUB_API}/repos/${REPO}/issues/${issueNumber}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      body: '[content removed]',
      state: 'closed',
    }),
  });

  await fetch(`${GITHUB_API}/repos/${REPO}/issues/${issueNumber}/comments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ body: 'Creature withdrawn by contributor.' }),
  });
}
