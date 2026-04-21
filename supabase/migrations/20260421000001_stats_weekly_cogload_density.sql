-- Add normalized cognitive load metrics to stats_weekly so metrics.astro
-- can overlay load_density alongside the raw cognitive_load_total.

alter table stats_weekly
  add column if not exists cognitive_load_total_lines   int,
  add column if not exists cognitive_load_density       numeric(10,4),
  add column if not exists cognitive_load_avg_file_load numeric(10,4);
