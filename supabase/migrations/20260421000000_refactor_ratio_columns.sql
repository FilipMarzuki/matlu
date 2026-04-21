-- Add refactor ratio columns to stats_weekly.
-- Tracks intentional restructuring work vs new feature shipping per week.
-- Detected by scanning merged PR titles for refactor/rewrite/cleanup keywords.

alter table stats_weekly
  add column if not exists refactor_pr_count  int,      -- PRs with refactor/rewrite/cleanup/… keywords in title
  add column if not exists total_pr_count     int,      -- total merged PRs (stored explicitly for convenience)
  add column if not exists refactor_ratio_pct numeric;  -- refactor_pr_count / total_pr_count × 100
