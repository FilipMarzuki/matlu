-- FIL-45: store the procedural generation seed alongside each run.
-- Same seed always reproduces the same map, so revisiting a run is cheap
-- (regenerate client-side, no need to store the full tile layout).
--
-- Apply via Supabase MCP: apply_migration(name='add_seed_to_runs', query=<this file>)

ALTER TABLE public.matlu_runs
  ADD COLUMN IF NOT EXISTS seed bigint;

COMMENT ON COLUMN public.matlu_runs.seed IS
  'Procedural map seed (mulberry32 input). NULL for runs created before FIL-45.';
