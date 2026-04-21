#!/usr/bin/env node
/**
 * GDPR Retention script — run weekly by gdpr-retention.yml.
 *
 * Enforces the retention policy documented in /privacy:
 *
 *   1. Unsubmitted drafts older than 90 days → deleted.
 *   2. Rejected submissions older than 30 days → rows deleted + bucket images removed.
 *   3. Accounts inactive for >24 months → email warning sent, then deleted 30 days later
 *      if still inactive (tracked via account_profiles.last_active_at).
 *
 * All operations use the service-role key and bypass RLS.
 * Requires env vars:
 *   SUPABASE_URL              — project API URL
 *   SUPABASE_SERVICE_ROLE_KEY — service role secret key
 */

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const hdrs = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

async function rest(path, options = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers: hdrs, ...options });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`REST ${options.method ?? 'GET'} ${path} → ${res.status}: ${text}`);
  }
  return res.headers.get('content-type')?.includes('application/json') ? res.json() : null;
}

async function run() {
  const now = new Date();

  // ── 1. Delete creature drafts older than 90 days ────────────────────────
  const draftCutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const oldDrafts = await rest(
    `creature_drafts?updated_at=lt.${encodeURIComponent(draftCutoff)}&select=id`,
  );
  console.log(`Drafts older than 90 days: ${oldDrafts.length}`);
  if (oldDrafts.length) {
    await rest(
      `creature_drafts?updated_at=lt.${encodeURIComponent(draftCutoff)}`,
      { method: 'DELETE' }
    );
    console.log(`  Deleted ${oldDrafts.length} draft(s).`);
  }

  // ── 2. Delete rejected submissions older than 30 days ───────────────────
  const rejectedCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const rejected = await rest(
    `creature_submissions?approved=eq.false&rejected_at=not.is.null&rejected_at=lt.${encodeURIComponent(rejectedCutoff)}&select=id,art_path`,
  );
  console.log(`Rejected submissions older than 30 days: ${rejected.length}`);
  if (rejected.length) {
    // Delete bucket images
    const paths = rejected.map(r => r.art_path).filter(Boolean);
    if (paths.length) {
      const delRes = await fetch(`${url}/storage/v1/object/creature-art`, {
        method: 'DELETE',
        headers: hdrs,
        body: JSON.stringify({ prefixes: paths }),
      });
      if (delRes.ok) {
        console.log(`  Deleted ${paths.length} image(s) from storage.`);
      } else {
        console.warn(`  Storage delete failed: ${await delRes.text()}`);
      }
    }

    // Delete rows
    await rest(
      `creature_submissions?approved=eq.false&rejected_at=not.is.null&rejected_at=lt.${encodeURIComponent(rejectedCutoff)}`,
      { method: 'DELETE' }
    );
    console.log(`  Deleted ${rejected.length} submission row(s).`);
  }

  // ── 3. Warn accounts inactive for 23.5 months (warn-window: 30 days) ────
  //       Delete accounts inactive for ≥24 months with no activity after warning.
  //
  // Phase A: warn — accounts inactive between 23.5 and 24 months
  //   (We can't send email from here without an email provider. Instead we log
  //    the user IDs and a corresponding GitHub Action or Supabase Edge Function
  //    should handle sending the warning email. For now we log the accounts.)
  //
  // Phase B: delete — accounts where last_active_at is older than 24 months
  //   These are accounts that received the warning and didn't log in.

  const inactiveCutoff24m = new Date(now.getTime() - 24 * 30 * 24 * 60 * 60 * 1000).toISOString();
  const staleAccounts = await rest(
    `account_profiles?last_active_at=lt.${encodeURIComponent(inactiveCutoff24m)}&select=user_id,handle,last_active_at`,
  );
  console.log(`Accounts inactive ≥24 months: ${staleAccounts.length}`);

  if (staleAccounts.length) {
    console.log('  Accounts to delete (inactive ≥24 months):');
    for (const acct of staleAccounts) {
      console.log(`    handle=${acct.handle}  last_active=${acct.last_active_at}`);
    }
    // NOTE: Actual deletion requires calling the Supabase admin.deleteUser API.
    // This script logs the accounts for operator review. A follow-up automated
    // deletion can be added once an email-warning system is in place.
    // TODO: integrate with an email provider to send the 30-day warning, then
    //       schedule a second pass that deletes if still inactive after 30 days.
    console.log('  Action: manual review required — email warning not yet automated.');
  }

  console.log('Retention run complete.');
}

run().catch(err => {
  console.error('Retention script failed:', err);
  process.exit(1);
});
