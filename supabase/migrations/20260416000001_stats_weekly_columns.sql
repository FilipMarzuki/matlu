-- Add individual typed columns to stats_weekly so metrics can be queried
-- directly without JSONB path expressions.
-- The existing metrics JSONB column is kept for backwards compatibility.

alter table stats_weekly
  -- Delivery
  add column if not exists prs_merged           int,
  add column if not exists human_prs            int,
  add column if not exists agent_prs            int,
  add column if not exists avg_pr_size          numeric,    -- lines changed (additions + deletions)
  add column if not exists issues_completed     int,
  add column if not exists active_days          int,        -- days with at least one commit (0–7)
  add column if not exists total_commits        int,

  -- Velocity
  add column if not exists avg_merge_time_hours numeric,    -- PR open → merged, hours
  add column if not exists avg_cycle_time_days  numeric,    -- Linear issue created → completed, days

  -- Quality
  add column if not exists ci_pass_rate_pct     numeric,    -- % of workflow runs that succeeded
  add column if not exists fix_revert_count     int,        -- PRs with "fix" or "revert" in title
  add column if not exists fix_revert_pct       numeric,
  add column if not exists any_count            int,        -- occurrences of `as any` in src/
  add column if not exists ts_ignore_count      int,        -- occurrences of @ts-ignore
  add column if not exists todo_count           int,        -- TODO / FIXME / HACK occurrences
  add column if not exists test_file_count      int,
  add column if not exists lines_added          int,        -- net lines added in src/ this week
  add column if not exists lines_deleted        int,

  -- Automation (agent PRs)
  add column if not exists agent_pr_share_pct   numeric,    -- agent PRs as % of all merged
  add column if not exists agent_success_rate_pct numeric,  -- agent PRs merged / agent PRs closed

  -- Rework
  add column if not exists rework_rate_pct      numeric,    -- % of touched files also changed in prior 3 wks
  add column if not exists rework_file_count    int,
  add column if not exists new_file_count       int,
  add column if not exists total_files_changed  int,
  add column if not exists top_rework_file      text,
  add column if not exists top_rework_hits      int,

  -- Cognitive load (per-file score = lines × branches / 1000)
  add column if not exists cognitive_load_total int,        -- sum across all src/ .ts files
  add column if not exists cognitive_load_top_file  text,
  add column if not exists cognitive_load_top_score int,
  add column if not exists ts_file_count        int,        -- number of .ts files in src/
  add column if not exists cognitive_load_top10 jsonb,      -- [{file, lines, branches, score}]

  -- AI usage (Claude Code sessions this week)
  add column if not exists ai_sessions          int,
  add column if not exists ai_total_tokens      bigint,
  add column if not exists ai_total_cost_usd    numeric(10,4),
  add column if not exists ai_input_tokens      bigint,
  add column if not exists ai_output_tokens     bigint,
  add column if not exists ai_cache_read_tokens bigint,
  add column if not exists ai_cache_write_tokens bigint,

  -- Bundle size (from Vite build output)
  add column if not exists bundle_js_kb         numeric,    -- total JS, uncompressed
  add column if not exists bundle_css_kb        numeric,
  add column if not exists bundle_gzip_kb       numeric,    -- JS after gzip
  add column if not exists bundle_total_kb      numeric,    -- JS + CSS

  -- Vercel deployments
  add column if not exists deploys_this_week    int,
  add column if not exists deploys_last_week    int,

  -- PixelLab
  add column if not exists pixellab_balance_usd numeric(10,2);
