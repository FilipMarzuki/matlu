-- Migration: creature_pipeline_fields
-- Part of #340 (B2 — Admin editor pipeline redesign — tabs + per-stage editor panels)
--
-- Adds pipeline status and all per-stage fields (balance, lore, graphics, queue)
-- to creature_submissions, and creates creature_status_history (scoped from #339).

-- ── Pipeline columns ──────────────────────────────────────────────────────────

ALTER TABLE public.creature_submissions
  ADD COLUMN IF NOT EXISTS status              text NOT NULL DEFAULT 'submitted',
  ADD COLUMN IF NOT EXISTS balance_tier        text,          -- trivial/minor/standard/elite/boss
  ADD COLUMN IF NOT EXISTS balance_notes       text,
  ADD COLUMN IF NOT EXISTS biome_affinity      text[],        -- game biome names for enemy spawning
  ADD COLUMN IF NOT EXISTS lore_entry_id       text,          -- Notion page ID
  ADD COLUMN IF NOT EXISTS lore_entry_url      text,          -- Notion page URL
  ADD COLUMN IF NOT EXISTS graphics_difficulty smallint CHECK (graphics_difficulty BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS graphics_notes      text,
  ADD COLUMN IF NOT EXISTS queue_priority      integer;       -- lower = higher priority in Queue tab

-- Backfill status from existing approved / rejected columns so old rows
-- land in the right pipeline tab immediately.
UPDATE public.creature_submissions
  SET status = 'approved'
  WHERE approved = true AND status = 'submitted';

UPDATE public.creature_submissions
  SET status = 'rejected'
  WHERE rejected_at IS NOT NULL AND status = 'submitted';

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS creature_submissions_status_idx
  ON public.creature_submissions (status, created_at ASC);

CREATE INDEX IF NOT EXISTS creature_submissions_queue_idx
  ON public.creature_submissions (queue_priority ASC NULLS LAST)
  WHERE status = 'queued';

-- ── Status history table ──────────────────────────────────────────────────────
-- Mirrors the intent of #339 (B1 FSM + history) so transitions are auditable.

CREATE TABLE IF NOT EXISTS public.creature_status_history (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  creature_id  uuid        NOT NULL REFERENCES public.creature_submissions(id) ON DELETE CASCADE,
  from_status  text,
  to_status    text        NOT NULL,
  changed_at   timestamptz NOT NULL DEFAULT now(),
  notes        text
);

CREATE INDEX IF NOT EXISTS creature_status_history_creature_idx
  ON public.creature_status_history (creature_id, changed_at DESC);

-- No public RLS policies — service role bypasses RLS for all admin operations.
ALTER TABLE public.creature_status_history ENABLE ROW LEVEL SECURITY;
