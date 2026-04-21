#!/usr/bin/env node
// creature-tracker-sync.js — FIL-445 (Creatures C2)
//
// Polls creature_status_history for rows that haven't been posted to GitHub yet
// (tracker_comment_posted_at IS NULL) and, for each:
//   1. Posts a status-change comment on the tracker issue.
//   2. Swaps the status:* label on the issue.
//   3. Closes the issue if the new status is 'in-game'.
//   4. Marks tracker_comment_posted_at = now() so the row is not re-processed.
//
// Runs every 10 minutes via GitHub Actions cron (see creature-tracker-sync.yml).
// Skips rows whose creature has no tracker_issue_number.
//
// Required env vars:
//   SUPABASE_URL              — Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY — service role key (bypasses RLS)
//   GH_TRACKER_TOKEN          — fine-grained PAT, issues:write on FilipMarzuki/matlu

import { exit } from 'process';

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const GH_TRACKER_TOKEN = process.env.GH_TRACKER_TOKEN ?? '';
const REPO = 'FilipMarzuki/matlu';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  exit(1);
}
if (!GH_TRACKER_TOKEN) {
  console.error('Missing GH_TRACKER_TOKEN');
  exit(1);
}

const sbHeaders = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

const ghHeaders = {
  Authorization: `Bearer ${GH_TRACKER_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
};

// Human-readable labels used in comments and as GitHub issue labels.
const STATUS_LABEL = /** @type {Record<string,string>} */ ({
  approved:    'Approved',
  balanced:    'Balanced',
  'in-game':   'In Game',
  rejected:    'Rejected',
  'needs-work':'Needs Work',
});

function statusLabel(status) {
  return STATUS_LABEL[status] ?? status;
}

/** Supabase REST GET helper. */
async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders });
  if (!res.ok) throw new Error(`Supabase GET ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

/** Supabase REST PATCH helper. */
async function sbPatch(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { ...sbHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${path} → ${res.status} ${await res.text()}`);
}

/** GitHub REST helper. */
async function ghFetch(path, method = 'GET', body = undefined) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: ghHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${method} ${path} → ${res.status} ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

/** Remove all status:* labels from an issue and add the new one. */
async function swapStatusLabel(issueNumber, fromStatus, toStatus) {
  // Fetch current labels.
  const labels = await ghFetch(`/repos/${REPO}/issues/${issueNumber}/labels`);
  const labelNames = labels.map((l) => l.name);

  // Remove old status labels.
  for (const name of labelNames) {
    if (name.startsWith('status:')) {
      await ghFetch(
        `/repos/${REPO}/issues/${issueNumber}/labels/${encodeURIComponent(name)}`,
        'DELETE'
      );
    }
  }

  // Add new status label (ignore 422 if label doesn't exist yet in the repo).
  try {
    await ghFetch(`/repos/${REPO}/issues/${issueNumber}/labels`, 'POST', {
      labels: [`status:${toStatus}`],
    });
  } catch (err) {
    console.warn(`  ⚠ Could not add label status:${toStatus}:`, err.message);
  }
}

async function main() {
  // ── Fetch unprocessed status history rows ────────────────────────────────
  const historyRows = await sbGet(
    'creature_status_history?tracker_comment_posted_at=is.null&order=changed_at.asc'
  );

  if (!historyRows.length) {
    console.log('No unprocessed status history rows.');
    return;
  }

  console.log(`Processing ${historyRows.length} status history row(s)…`);

  for (const row of historyRows) {
    const { id: historyId, creature_id, from_status, to_status, changed_at } = row;

    try {
      // Fetch the creature to get tracker_issue_number.
      const creatures = await sbGet(
        `creature_submissions?id=eq.${encodeURIComponent(creature_id)}&select=id,creature_name,tracker_issue_number,entity_id&limit=1`
      );
      const creature = creatures[0];

      if (!creature?.tracker_issue_number) {
        // No tracker issue — mark as "posted" so we don't check again.
        await sbPatch(
          `creature_status_history?id=eq.${encodeURIComponent(historyId)}`,
          { tracker_comment_posted_at: new Date().toISOString() }
        );
        console.log(`  ↷ ${historyId}: no tracker issue, skipping.`);
        continue;
      }

      const issueNumber = creature.tracker_issue_number;
      const issuePath = `/repos/${REPO}/issues/${issueNumber}`;
      const changedAt = new Date(changed_at).toISOString();

      // ── Post status-change comment ─────────────────────────────────────
      const fromLabel = from_status ? statusLabel(from_status) : '(none)';
      const toLabel = statusLabel(to_status);

      let commentBody = `🔄 Status changed: **${fromLabel}** → **${toLabel}**\n${changedAt}`;

      if (to_status === 'in-game' && creature.entity_id) {
        commentBody += `\n\n**Entity ID:** \`${creature.entity_id}\``;
      }

      await ghFetch(`${issuePath}/comments`, 'POST', { body: commentBody });

      // ── Swap status label ──────────────────────────────────────────────
      await swapStatusLabel(issueNumber, from_status, to_status);

      // ── Close issue if shipped ─────────────────────────────────────────
      if (to_status === 'in-game') {
        await ghFetch(issuePath, 'PATCH', {
          state: 'closed',
          state_reason: 'completed',
        });
        console.log(`  ✓ ${historyId}: posted comment + closed issue #${issueNumber} (in-game).`);
      } else {
        console.log(`  ✓ ${historyId}: posted comment on issue #${issueNumber} (${fromLabel} → ${toLabel}).`);
      }

      // ── Mark as processed ──────────────────────────────────────────────
      await sbPatch(
        `creature_status_history?id=eq.${encodeURIComponent(historyId)}`,
        { tracker_comment_posted_at: new Date().toISOString() }
      );
    } catch (err) {
      console.error(`  ✗ ${historyId}: error — ${err.message}`);
      // Continue with next row; this row will be retried on the next run.
    }
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  exit(1);
});
