-- Migration: create_creature_submissions
-- Part of FIL-431 (Creatures A1 — Schema + Storage bucket + license page)
--
-- Creates the creature_submissions table for the kid-friendly creature wiki.
-- Storage bucket (creature-art) must be created manually via Supabase dashboard:
--   Name: creature-art | Public read: yes
--   MIME types: image/png, image/jpeg, image/webp, image/heic | Max size: 5 MB
--   Path convention: pending/<uuid>.<ext> → approved/<slug>.<ext> after moderation

-- ── Table ─────────────────────────────────────────────────────────────────────

create table if not exists public.creature_submissions (

  -- Identity
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),

  -- Creator identity
  creator_name     text not null,          -- how they want to be credited
  maker_age        smallint,               -- optional, 1–120
  contact_email    text,                   -- optional, parent/guardian only

  -- Creature core
  creature_name    text not null,
  world_name       text,                   -- which Matlu world it lives in (optional)

  -- Picture
  art_path         text,                   -- Storage path: pending/<uuid>.<ext>
  art_credit       text,                   -- who drew it (if different from creator)

  -- What kind of creature
  kind_size        text,                   -- tiny / small / medium / large / colossal
  kind_movement    text[],                 -- walks / swims / flies / burrows / slithers
  kind_diet        text,                   -- plants / animals / both / unknown / other
  kind_solitary    boolean,                -- true = lone, false = group

  -- Habitat
  habitat_biome    text[],                 -- biome names from BIOMES in biomes.ts
  habitat_climate  text,                   -- cold / temperate / hot / any
  habitat_notes    text,                   -- free text

  -- Behaviour
  behaviour_threat text,                   -- harmless / curious / defensive / aggressive
  behaviour_notes  text,

  -- Food & special
  food_notes       text,
  special_ability  text,                   -- free text description of any special trait

  -- Lore
  lore_description text,                  -- the creator's own words about the creature
  lore_origin      text,                  -- where they got the idea (optional)

  -- Completion
  completion_score smallint check (completion_score between 0 and 100),

  -- Consent & credits
  license_version  text not null,          -- e.g. 'v1-2026-04'
  license_accepted boolean not null check (license_accepted = true),
  parental_consent boolean not null check (parental_consent = true),
  credits_opt_in   boolean not null default true,

  -- Moderation
  approved         boolean not null default false,
  approved_at      timestamptz,
  rejected_at      timestamptz,
  moderation_note  text,
  slug             text unique            -- set on approval, used in /creatures/[slug]

);

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Gallery: approved creatures newest-first
create index if not exists creature_submissions_gallery_idx
  on public.creature_submissions (approved, created_at desc)
  where approved = true;

-- Credits page: approved + opted in
create index if not exists creature_submissions_credits_idx
  on public.creature_submissions (approved, credits_opt_in)
  where approved = true and credits_opt_in = true;

-- ── RLS ───────────────────────────────────────────────────────────────────────

alter table public.creature_submissions enable row level security;

-- Public can read approved submissions (gallery, detail, credits)
create policy "anon_select_approved"
  on public.creature_submissions
  for select
  to anon, authenticated
  using (approved = true);

-- Public can submit (insert) but only with approved = false
-- (service role sets approved = true during moderation)
create policy "anon_insert_pending"
  on public.creature_submissions
  for insert
  to anon, authenticated
  with check (approved = false);

-- Updates and deletes are service-role only (no policy needed — service role bypasses RLS)
