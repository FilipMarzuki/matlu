-- Add normalized cognitive load metrics to the cognitive_load snapshot table.
-- load_density  = totalScore / (totalLines / 1000) — complexity per 1,000 lines
-- avg_file_load = totalScore / fileCount           — average load per file
-- total_lines   — baseline for normalisation and trend analysis

alter table cognitive_load
  add column if not exists total_lines   int,
  add column if not exists load_density  numeric(10,4),
  add column if not exists avg_file_load numeric(10,4);
