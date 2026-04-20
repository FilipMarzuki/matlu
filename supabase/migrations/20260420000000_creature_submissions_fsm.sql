-- Migration: creature_submissions_fsm
-- Adds status FSM columns to creature_submissions.
-- These columns power the B1 FSM workflow (see #339) and the lore auto-fill
-- creature pass (see #342).
--
-- Status lifecycle:
--   pending → balanced → lore-ready → queued → spriting → in-game
--   (any → rejected)
--
-- Columns added:
--   status             — current FSM state (default 'pending')
--   status_changed_at  — when status last changed (trigger-maintained)
--   lore_entry_id      — Notion page UUID written by the lore-autofill agent
--   lore_entry_url     — Notion page URL for convenience
--   graphics_difficulty — 1–5 scale; used by the sprite credit-burn queue
--   queue_priority     — computed by creature_queue_priority(); maintained by trigger
--   queued_at          — when status became 'queued'

alter table public.creature_submissions
  add column if not exists status              text        not null default 'pending',
  add column if not exists status_changed_at  timestamptz,
  add column if not exists lore_entry_id      text,       -- Notion page UUID
  add column if not exists lore_entry_url     text,       -- Notion page URL
  add column if not exists graphics_difficulty smallint   check (graphics_difficulty between 1 and 5),
  add column if not exists queue_priority     int,
  add column if not exists queued_at          timestamptz;

-- Valid status values
alter table public.creature_submissions
  add constraint creature_submissions_status_check
    check (status in ('pending','balanced','lore-ready','queued','spriting','in-game','rejected'));

-- Index: lore-autofill agent queries balanced creatures without a lore entry
create index if not exists creature_submissions_balanced_no_lore_idx
  on public.creature_submissions (status_changed_at asc)
  where status = 'balanced' and lore_entry_id is null;

-- Trigger: stamp status_changed_at whenever status changes
create or replace function public.creature_fsm_stamp()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
    if new.status = 'queued' then
      new.queued_at := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists creature_fsm_stamp_trigger on public.creature_submissions;
create trigger creature_fsm_stamp_trigger
  before update on public.creature_submissions
  for each row execute function public.creature_fsm_stamp();

-- Service role needs update permission for FSM transitions
-- (anon RLS policy only allows insert with approved = false; service role bypasses RLS)
