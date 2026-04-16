-- Add agent outcome columns to stats_weekly.
-- These are populated by collect-stats.js from Linear labels applied by the
-- per-issue nightly agent after each run.

alter table stats_weekly
  -- Total issues the nightly agent processed this week
  add column if not exists agent_issues_processed   int,

  -- Outcome counts
  add column if not exists agent_outcome_success    int,
  add column if not exists agent_outcome_partial    int,
  add column if not exists agent_outcome_failed     int,
  add column if not exists agent_outcome_wrong_interp int,

  -- (failed + wrong-interp) / processed, as a percentage
  add column if not exists agent_failure_rate_pct   numeric,

  -- Per-category breakdown: { systems: {success,partial,failed,wrong_interp,total}, ... }
  add column if not exists agent_outcome_by_type    jsonb;
