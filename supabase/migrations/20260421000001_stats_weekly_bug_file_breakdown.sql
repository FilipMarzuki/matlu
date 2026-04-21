-- Add bug_file_breakdown to stats_weekly.
-- Populated by collect-stats.js: scans merged bug PRs (last 4 weeks) and
-- counts how many bug PRs touched each file.
-- Shape: [{file: string, bug_pr_count: number}], ordered by bug_pr_count desc.

alter table stats_weekly
  add column if not exists bug_file_breakdown jsonb;
