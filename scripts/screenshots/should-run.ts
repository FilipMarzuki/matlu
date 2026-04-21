#!/usr/bin/env node
/**
 * Dedup check for the Daily Screenshots workflow.
 *
 * Fetches latest.json from Supabase Storage to compare the last stored
 * HEAD SHA against the current one. If they match, the Playwright capture
 * is skipped — no code changed, so screenshots would be identical.
 *
 * Writes `changed=true` or `changed=false` to $GITHUB_OUTPUT.
 *
 * Intentionally uses only Node.js built-ins (fetch, fs) so it can run
 * BEFORE `npm ci` — no project dependencies required.
 *
 * Exits 0 gracefully if SUPABASE_SERVICE_ROLE_KEY is missing (e.g. forks),
 * setting changed=false so the rest of the workflow no-ops.
 */

import { appendFileSync } from 'node:fs';

const BUCKET = 'screenshots';
const LATEST_PATH = 'latest.json';

interface LatestJson {
  sha: string;
  date: string;
}

function writeOutput(key: string, value: string): void {
  const outputFile = process.env['GITHUB_OUTPUT'];
  if (outputFile) {
    appendFileSync(outputFile, `${key}=${value}\n`);
  } else {
    // Not running in GitHub Actions — log for local debugging
    console.log(`[local] ${key}=${value}`);
  }
}

async function main(): Promise<void> {
  const supabaseUrl = process.env['SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  const currentSha = process.env['GITHUB_SHA'] ?? '';

  if (!supabaseUrl || !serviceRoleKey) {
    console.warn(
      'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — skipping dedup check, setting changed=false',
    );
    writeOutput('changed', 'false');
    return;
  }

  const url = `${supabaseUrl}/storage/v1/object/${BUCKET}/${LATEST_PATH}`;

  let storedSha: string | null = null;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${serviceRoleKey}` },
    });

    if (res.ok) {
      const data = (await res.json()) as LatestJson;
      storedSha = data.sha ?? null;
      console.log(`Fetched latest.json: date=${data.date}, sha=${storedSha}`);
    } else if (res.status === 404) {
      // First ever run — bucket or file not yet created
      console.log('latest.json not found — first run, treating as changed');
    } else {
      console.warn(
        `Unexpected response ${res.status} fetching latest.json — treating as changed`,
      );
    }
  } catch (err) {
    console.warn('Failed to fetch latest.json:', err, '— treating as changed');
  }

  if (storedSha !== null && storedSha === currentSha) {
    console.log(`HEAD SHA unchanged (${currentSha}) — skipping screenshot capture`);
    writeOutput('changed', 'false');
  } else {
    console.log(
      `HEAD SHA changed: stored=${storedSha ?? 'none'}, current=${currentSha || '(unknown)'}`,
    );
    writeOutput('changed', 'true');
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
