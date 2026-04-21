-- Add per-PR size averages to stats_weekly.
-- Populated by collect-stats.js from GitHub pull request details
-- (changed_files, additions, deletions fields on each merged PR).

alter table stats_weekly
  add column if not exists avg_files_changed  numeric,    -- average changed_files per merged PR
  add column if not exists avg_lines_added    numeric,    -- average additions per merged PR
  add column if not exists avg_lines_deleted  numeric;    -- average deletions per merged PR
