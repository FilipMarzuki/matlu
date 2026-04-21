-- Add code churn columns to stats_weekly.
-- total_lines_added / total_lines_deleted aggregate additions and deletions
-- across all PRs merged in the given week (full-repo, PR-level granularity,
-- as reported by the GitHub API). This differs from the existing lines_added /
-- lines_deleted columns which are scoped to src/ via git log.

alter table stats_weekly
  add column if not exists total_lines_added   int,   -- sum of PR additions merged this week
  add column if not exists total_lines_deleted int;   -- sum of PR deletions merged this week
