-- Migration: creature_accounts_gdpr
-- Issue #331 — Creature accounts: parent/guardian sign-in, cross-device drafts,
--             creator profiles, GDPR compliance.
--
-- Prerequisites:
--   • 20260419000000_create_creature_submissions.sql already applied
--   • Supabase project must be in an EU region (e.g. eu-central-1). Verify in
--     Settings → General before applying this migration. If in a US region,
--     migrate first — EU data residency is required for Art. 44 compliance.
--
-- New tables:
--   account_profiles   — one row per parent/guardian Supabase auth user
--   account_kids       — children on an account (name/age only, no email)
--   creature_drafts    — cloud-synced form drafts (GDPR 90-day retention)
--   gdpr_actions_log   — audit log for data-subject rights actions (Art. 5(2))
--
-- Extensions to creature_submissions:
--   user_id, kid_id — link approved creatures back to their account/kid
--   creator_name made nullable — needed for anonymise-on-delete mode (Art. 17)
--
-- RLS is enabled on every new table. All policies restrict access to the row
-- owner or, for gdpr_actions_log, service-role only.

-- ── account_profiles ──────────────────────────────────────────────────────────
-- One row per parent/guardian. Supabase auth.users holds email + auth metadata;
-- this table holds the wiki-specific profile data.

create table if not exists public.account_profiles (
  user_id                uuid        primary key references auth.users(id) on delete cascade,
  handle                 text        unique not null,           -- public slug /creators/<handle>
  created_at             timestamptz not null default now(),
  privacy_policy_version text        not null,
  license_version        text        not null,
  parental_confirmation  boolean     not null,
  last_active_at         timestamptz not null default now(),
  paused                 boolean     not null default false,    -- Art. 18 restrict processing
  constraint must_confirm_parental check (parental_confirmation = true)
);

create index if not exists account_profiles_handle_idx
  on public.account_profiles (handle);

alter table public.account_profiles enable row level security;

create policy "own profile select"
  on public.account_profiles for select
  using (auth.uid() = user_id);

create policy "own profile insert"
  on public.account_profiles for insert
  with check (auth.uid() = user_id);

create policy "own profile update"
  on public.account_profiles for update
  using (auth.uid() = user_id);

-- ── account_kids ──────────────────────────────────────────────────────────────
-- One row per child on an account. No email or surname collected (data
-- minimisation, Art. 5(1)(c)). A parent can have multiple kids.

create table if not exists public.account_kids (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  kid_name    text        not null,  -- first name or nickname only
  kid_slug    text        not null,
  kid_age     int,
  created_at  timestamptz not null default now(),
  unique (user_id, kid_slug)
);

alter table public.account_kids enable row level security;

create policy "own kids"
  on public.account_kids for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── creature_drafts ───────────────────────────────────────────────────────────
-- Cloud-synced drafts. Replaces/supplements the localStorage draft when signed in.
-- Retention: unsubmitted drafts older than 90 days are deleted by gdpr-retention.yml.

create table if not exists public.creature_drafts (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  kid_id      uuid        references public.account_kids(id) on delete set null,
  draft_data  jsonb       not null,   -- serialised form state
  updated_at  timestamptz not null default now()
);

create index if not exists creature_drafts_user_kid_idx
  on public.creature_drafts (user_id, kid_id);

alter table public.creature_drafts enable row level security;

create policy "own drafts"
  on public.creature_drafts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── gdpr_actions_log ─────────────────────────────────────────────────────────
-- Audit log for data-subject rights exercises (Art. 5(2) accountability).
-- user_email_hash is SHA-256 of the email so the log survives account deletion
-- without retaining plaintext personal data.

create table if not exists public.gdpr_actions_log (
  id               uuid        primary key default gen_random_uuid(),
  user_email_hash  text        not null,
  action_type      text        not null,  -- 'export'|'delete'|'anonymize'|'pause'|'resume'
  details          jsonb,
  occurred_at      timestamptz not null default now()
);

-- No anon read policy — service-role only (service role bypasses RLS).
alter table public.gdpr_actions_log enable row level security;

-- ── Extend creature_submissions ───────────────────────────────────────────────
-- Link submissions to an account and a specific kid.
-- on delete set null so account deletion anonymises (not removes) approved
-- creatures by default. Full-delete mode explicitly deletes rows + bucket files.

alter table public.creature_submissions
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists kid_id  uuid references public.account_kids(id) on delete set null;

create index if not exists creature_submissions_user_idx
  on public.creature_submissions (user_id)
  where user_id is not null;

-- Allow creator_name to be null so the anonymise path can clear it (Art. 17).
alter table public.creature_submissions
  alter column creator_name drop not null;
