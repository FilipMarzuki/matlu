-- Migration: creature_tracker_sync
-- Part of FIL-445 (Creatures C2) — GitHub tracker issue auto-create + status sync.
--
-- Adds tracker_comment_posted_at to creature_status_history so the polling
-- script can pick up unprocessed rows without double-posting.

alter table public.creature_status_history
  add column if not exists tracker_comment_posted_at timestamptz;

-- Index so the polling query (WHERE tracker_comment_posted_at IS NULL) is fast.
create index if not exists creature_status_history_unposted_idx
  on public.creature_status_history (changed_at)
  where tracker_comment_posted_at is null;
