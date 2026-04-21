-- Migration: creature_tracker — FIL-333
--
-- Adds tracker_issue_number column (if the pipeline migration from #332 has not
-- yet applied it), creates a lookup index for tracker issue numbers, and grants
-- anon SELECT access to creature_status_history so the wiki can render the
-- public-facing status timeline at build time.

-- ── tracker_issue_number column ───────────────────────────────────────────────
-- Safe to run even if already present (added by the #332 pipeline migration).
alter table public.creature_submissions
  add column if not exists tracker_issue_number int;

-- ── Lookup index ──────────────────────────────────────────────────────────────
-- Allows fast lookup of a creature by its GitHub tracker issue number.
create index if not exists creature_tracker_idx
  on public.creature_submissions (tracker_issue_number)
  where tracker_issue_number is not null;

-- ── Public read access to status history ──────────────────────────────────────
-- The history table contains only status transitions (no personal data), so it
-- is safe to expose to anon.  The wiki reads it at build time to render the
-- timeline on /creatures/[slug].
alter table public.creature_status_history enable row level security;

create policy if not exists "anon_select_history"
  on public.creature_status_history
  for select
  to anon, authenticated
  using (true);
