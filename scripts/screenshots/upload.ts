#!/usr/bin/env node
/**
 * Uploads local screenshots to Supabase Storage after a successful capture.
 *
 * Storage layout:
 *   screenshots/runs/<YYYY-MM-DD>/<basename>.png  — captured PNGs
 *   screenshots/runs/<YYYY-MM-DD>/manifest.json   — spec-generated manifest
 *   screenshots/latest.json                       — { date, sha } for dedup
 *
 * Same-day runs overwrite the existing folder (upsert: true). The dedup
 * check in should-run.ts uses `latest.json` to skip re-running when HEAD
 * hasn't changed.
 *
 * Exits 0 gracefully if SUPABASE_SERVICE_ROLE_KEY is missing so the
 * workflow stays green on forks that don't have the secret.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const SCREENSHOTS_DIR = resolve('screenshots');
const BUCKET = 'screenshots';

async function upload(
  supabase: ReturnType<typeof createClient>,
  storagePath: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, body, { contentType, upsert: true });

  if (error) {
    throw new Error(`Upload failed for ${storagePath}: ${error.message}`);
  }
  console.log(`  ✓ ${storagePath}`);
}

async function main(): Promise<void> {
  const supabaseUrl = process.env['SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  const currentSha = process.env['GITHUB_SHA'] ?? 'unknown';

  if (!supabaseUrl || !serviceRoleKey) {
    console.warn(
      'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — skipping upload',
    );
    return;
  }

  // Service-role key bypasses RLS — needed for writes to the screenshots bucket.
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // UTC date for the folder key, e.g. "2025-04-21"
  const date = new Date().toISOString().slice(0, 10);
  console.log(`Uploading screenshots for ${date} (sha: ${currentSha})`);

  // Upload each PNG captured by screenshot.spec.ts
  const pngFiles = readdirSync(SCREENSHOTS_DIR).filter((f) => f.endsWith('.png'));
  if (pngFiles.length === 0) {
    console.warn('No PNG files found in screenshots/ — nothing to upload');
    process.exit(1);
  }

  for (const file of pngFiles) {
    const data = readFileSync(resolve(SCREENSHOTS_DIR, file));
    await upload(supabase, `runs/${date}/${file}`, data, 'image/png');
  }

  // Upload the manifest produced by test.afterAll in screenshot.spec.ts
  const manifestData = readFileSync(resolve(SCREENSHOTS_DIR, 'manifest.json'));
  await upload(
    supabase,
    `runs/${date}/manifest.json`,
    manifestData,
    'application/json',
  );

  // Overwrite latest.json so the next dedup check can compare SHAs
  const latestData = Buffer.from(JSON.stringify({ date, sha: currentSha }));
  await upload(supabase, 'latest.json', latestData, 'application/json');

  console.log(`\nDone — ${pngFiles.length} PNGs + manifest uploaded to runs/${date}/`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
