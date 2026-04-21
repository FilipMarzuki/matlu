-- Create error_metrics table for daily Better Stack error monitor snapshots.
-- Each row is one agent run. The error_file_breakdown column (added here) stores
-- a per-filename aggregation so the AEX metrics page can show hotspot rankings.

create table if not exists error_metrics (
  id                        bigserial primary key,
  recorded_at               timestamptz not null default now(),
  window_hours              int,
  unique_errors             int,
  unique_warns              int,
  total_error_occurrences   int,
  total_warn_occurrences    int,
  linear_issues_filed       int,
  top_errors                jsonb,   -- [{message, occurrences, first_seen}]
  top_warns                 jsonb,   -- [{message, occurrences, first_seen}]
  error_file_breakdown      jsonb    -- [{filename, occurrences, error_count, warn_count}]
);

-- Public read so the AEX Vercel build (anon key) can query this table.
alter table error_metrics enable row level security;

create policy if not exists "public read error_metrics"
  on error_metrics for select
  using (true);
