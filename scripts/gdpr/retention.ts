/**
 * GDPR Retention Cleanup — scripts/gdpr/retention.ts
 *
 * Enforces Art. 5(1)(e) storage-limitation principle by deleting:
 *   1. Creature drafts not updated in > 90 days.
 *   2. Rejected creature submissions older than > 30 days (rows only; see note).
 *   3. (Future) Inactive accounts — 24-month warning email, 30-day grace, then delete.
 *
 * Run: npx tsx scripts/gdpr/retention.ts
 * Requires: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars.
 *
 * NOTE: Deleting rejected submission rows orphans their artwork files in the
 * creature-art Storage bucket. Full bucket cleanup requires additional Storage API
 * calls; that enhancement is left as a TODO once file paths are confirmed stable.
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Service-role client bypasses RLS — required for cross-user cleanup
const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

async function deleteStaleDrafts(): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

  const { data, error } = await supabase
    .from('creature_drafts')
    .delete()
    .lt('updated_at', cutoff.toISOString())
    .select('id');

  if (error) {
    console.error('Draft deletion error:', error.message);
    return 0;
  }

  return (data ?? []).length;
}

async function deleteRejectedSubmissions(): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  const { data, error } = await supabase
    .from('creature_submissions')
    .delete()
    .eq('approved', false)
    .not('rejected_at', 'is', null)
    .lt('rejected_at', cutoff.toISOString())
    .select('id');

  if (error) {
    console.error('Rejected submission deletion error:', error.message);
    return 0;
  }

  const count = (data ?? []).length;

  if (count > 0) {
    // TODO: delete corresponding artwork files from the creature-art bucket.
    // Each row has an art_path like "pending/<uuid>.ext". Fetch the paths before
    // deletion in a future pass once the Storage cleanup API is wired in.
    console.warn(`  ⚠ ${count} rejected submission(s) deleted — artwork files in creature-art bucket NOT cleaned up yet.`);
  }

  return count;
}

async function flagInactiveAccounts(): Promise<number> {
  // 24-month inactivity check — flag only (email sending not implemented yet).
  // A full implementation would: query accounts with last_active_at < 24 months ago,
  // send warning emails via Supabase Auth's email hook or Resend, and schedule
  // deletion after 30 days of no response.
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 24);

  const { data, error } = await supabase
    .from('account_profiles')
    .select('user_id, handle, last_active_at')
    .lt('last_active_at', cutoff.toISOString())
    .eq('paused', false);

  if (error) {
    console.error('Inactive account check error:', error.message);
    return 0;
  }

  const count = (data ?? []).length;
  if (count > 0) {
    console.warn(`  ⚠ ${count} account(s) inactive for 24+ months — email warning NOT sent (not implemented yet).`);
    for (const row of data ?? []) {
      const r = row as { user_id: string; handle: string; last_active_at: string };
      console.warn(`    - handle: ${r.handle}, last_active: ${r.last_active_at}`);
    }
  }

  return count;
}

async function main() {
  console.log('GDPR Retention Cleanup —', new Date().toISOString());
  console.log('');

  const draftCount = await deleteStaleDrafts();
  console.log(`Stale drafts deleted (>90 days): ${draftCount}`);

  const rejectedCount = await deleteRejectedSubmissions();
  console.log(`Rejected submissions deleted (>30 days): ${rejectedCount}`);

  const inactiveCount = await flagInactiveAccounts();
  console.log(`Inactive accounts flagged (>24 months): ${inactiveCount}`);

  console.log('');
  console.log('Done.');
}

main().catch((err: unknown) => {
  console.error('Retention script failed:', err);
  process.exit(1);
});
