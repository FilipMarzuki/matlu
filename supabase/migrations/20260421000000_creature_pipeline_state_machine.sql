-- Migration: creature_pipeline_state_machine
-- Extends creature_submissions with the full post-approval production pipeline.
-- Issue: #332 — Creature pipeline: post-approval workflow, graphics difficulty rating, sprite queue priority.
--
-- This migration:
--   1. Adds pipeline columns to creature_submissions
--   2. Backfills status for already-moderated rows
--   3. Creates the creature_status_history audit table
--   4. Creates the creature_status_transition_allowed() guard function
--   5. Creates the creature_queue_priority() formula function
--   6. Creates the creature_queue_update trigger (auto-history + auto-queue fields)

-- ── 1. Pipeline columns ───────────────────────────────────────────────────────

alter table public.creature_submissions
  add column if not exists status               text not null default 'submitted',
  add column if not exists balance_notes        text,
  add column if not exists balance_tier         text,
  add column if not exists biome_affinity       text[],
  add column if not exists lore_entry_id        uuid,
  add column if not exists lore_entry_url       text,
  add column if not exists graphics_difficulty  int check (graphics_difficulty between 1 and 5),
  add column if not exists graphics_notes       text,
  add column if not exists queue_priority       int,
  add column if not exists queued_at            timestamptz,
  add column if not exists entity_id            text,
  add column if not exists shipped_at           timestamptz,
  add column if not exists status_changed_at    timestamptz default now(),
  add column if not exists tracker_issue_number int;

-- ── 2. Backfill status for pre-existing rows ──────────────────────────────────

update public.creature_submissions
  set status = 'approved'
  where approved = true and status = 'submitted';

update public.creature_submissions
  set status = 'rejected'
  where rejected_at is not null and status = 'submitted';

-- ── 3. Indexes ────────────────────────────────────────────────────────────────

create index if not exists creature_submissions_status_idx
  on public.creature_submissions (status, queue_priority asc, queued_at asc);

-- Partial index used by the sprite queue drain query
create index if not exists creature_submissions_queue_idx
  on public.creature_submissions (queue_priority asc)
  where status = 'queued';

-- ── 4. Status history table ───────────────────────────────────────────────────

create table if not exists public.creature_status_history (
  id          uuid primary key default gen_random_uuid(),
  creature_id uuid not null references public.creature_submissions(id) on delete cascade,
  from_status text,
  to_status   text not null,
  changed_at  timestamptz default now(),
  note        text
);

create index if not exists creature_status_history_creature_idx
  on public.creature_status_history (creature_id, changed_at desc);

-- ── 5. Transition guard function ──────────────────────────────────────────────
-- Returns true if moving from `from_s` to `to_s` is a permitted transition.

create or replace function public.creature_status_transition_allowed(from_s text, to_s text)
returns boolean language sql immutable as $$
  select (from_s, to_s) in (
    ('submitted',      'approved'),
    ('submitted',      'rejected'),
    ('approved',       'balanced'),
    ('approved',       'rejected'),
    ('balanced',       'lore-ready'),
    ('balanced',       'rejected'),
    ('lore-ready',     'queued'),
    ('lore-ready',     'rejected'),
    ('queued',         'spriting'),
    ('queued',         'rejected'),
    ('spriting',       'in-game'),
    ('spriting',       'queued'),   -- reset to queued on PixelLab failure
    ('in-game',        'balanced')  -- allowed reverse: redo sprite/balance
  );
$$;

-- ── 6. Priority formula function ──────────────────────────────────────────────
-- Lower value = higher priority (processed sooner by sprite-credit-burn).
--
-- Formula:
--   base          = graphics_difficulty * 1000   (easier sprites first)
--   age_bonus     = -(days since approved_at)    (older entries bubble up)
--   lore_bonus    = -50 if lore_entry_id is set
--   newcomer_bonus= -100 if this is submitter's first approved creature

create or replace function public.creature_queue_priority(c public.creature_submissions)
returns int language sql stable as $$
  select (
    coalesce(c.graphics_difficulty, 3) * 1000
    - greatest(
        0,
        floor(
          extract(epoch from (now() - coalesce(c.approved_at, c.created_at))) / 86400.0
        )::int
      )
    - case when c.lore_entry_id is not null then 50 else 0 end
    - case
        when not exists (
          select 1 from public.creature_submissions c2
          where c2.creator_name = c.creator_name
            and c2.id <> c.id
            and c2.approved = true
        ) then 100
        else 0
      end
  );
$$;

-- ── 7. Trigger function: auto-history + auto-queue fields ─────────────────────
-- Fires BEFORE UPDATE on creature_submissions.
-- On status change: inserts a creature_status_history row and refreshes timestamps.
-- Also recomputes queue_priority whenever relevant priority inputs change.

create or replace function public.creature_queue_update()
returns trigger language plpgsql as $$
begin
  -- Status changed: write audit row and refresh bookkeeping timestamps
  if old.status is distinct from new.status then
    insert into public.creature_status_history (creature_id, from_status, to_status)
    values (new.id, old.status, new.status);

    new.status_changed_at := now();

    if new.status = 'queued' then
      new.queued_at  := coalesce(new.queued_at, now());
    end if;

    if new.status = 'in-game' then
      new.shipped_at := coalesce(new.shipped_at, now());
    end if;
  end if;

  -- Recompute priority when status enters / stays in queue,
  -- or when priority inputs change while already queued.
  if new.status = 'queued' and (
       old.status is distinct from new.status
    or old.graphics_difficulty is distinct from new.graphics_difficulty
    or old.lore_entry_id       is distinct from new.lore_entry_id
    or old.approved_at         is distinct from new.approved_at
  ) then
    new.queue_priority := public.creature_queue_priority(new);
  end if;

  return new;
end;
$$;

drop trigger if exists creature_queue_update on public.creature_submissions;
create trigger creature_queue_update
  before update on public.creature_submissions
  for each row execute function public.creature_queue_update();
