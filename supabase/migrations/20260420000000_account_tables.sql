-- Migration: account_tables
-- Part of #331 (Creature accounts — parent/guardian sign-in, GDPR-compliant)
--
-- Creates the account layer for the Matlu Codex: parent/guardian profiles,
-- kids linked to an account, cloud-synced creature drafts, and a GDPR audit log.
--
-- GDPR notes:
--   • Only parent/guardian emails are collected (no child email addresses).
--   • RLS ensures every row is owner-scoped; gdpr_actions_log is insert-only for owners.
--   • account_profiles has a public SELECT policy (handles are public creator slugs).
--   • Cascading deletes on all child tables enforce the right-to-erasure flow.
--
-- Supabase project MUST be in an EU region (eu-central-1 or eu-west-2) for Art. 44
-- data-residency compliance. Verify in Supabase dashboard → Settings → General
-- before enabling sign-ups.

-- ── account_profiles ──────────────────────────────────────────────────────────
-- One row per parent/guardian. auth.users holds email + auth metadata;
-- this table holds wiki-specific profile data.

create table if not exists public.account_profiles (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  handle                 text unique not null,            -- public slug for /creators/<handle>
  created_at             timestamptz not null default now(),
  privacy_policy_version text not null,                   -- e.g. 'v1-2026-04'
  license_version        text not null,                   -- e.g. 'v1-2026-04'
  parental_confirmation  boolean not null default false,
  last_active_at         timestamptz not null default now(),
  paused                 boolean not null default false,  -- Art. 18 restrict-processing flag
  constraint must_confirm_parental check (parental_confirmation = true)
);

-- ── account_kids ──────────────────────────────────────────────────────────────
-- One row per child on an account. First name / nickname only — no surnames,
-- photos, school, or location (Art. 5(1)(c) data minimisation).

create table if not exists public.account_kids (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kid_name   text not null,    -- first name or nickname
  kid_slug   text not null,    -- url-safe version of kid_name, unique per parent
  kid_age    smallint,         -- optional; used only for credits display
  created_at timestamptz not null default now(),
  unique (user_id, kid_slug)
);

-- ── creature_drafts ───────────────────────────────────────────────────────────
-- Cloud-synced draft that supplements the localStorage draft when signed in.
-- Retention: auto-deleted after 90 days by the gdpr-retention workflow.

create table if not exists public.creature_drafts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kid_id     uuid references public.account_kids(id) on delete set null,
  draft_data jsonb not null,   -- serialised form state from the submit page
  updated_at timestamptz not null default now()
);

-- ── gdpr_actions_log ──────────────────────────────────────────────────────────
-- Append-only audit log for data-subject actions (Art. 5(2) accountability).
-- user_email_hash is sha-256 of the email so it survives account deletion.

create table if not exists public.gdpr_actions_log (
  id               uuid primary key default gen_random_uuid(),
  user_email_hash  text not null,    -- sha-256 hex; never plaintext
  action_type      text not null,    -- 'export' | 'delete' | 'anonymize' | 'pause' | 'resume'
  details          jsonb,            -- row counts, affected tables, etc.
  occurred_at      timestamptz not null default now()
);

-- ── Extend creature_submissions (from #329) ───────────────────────────────────
-- Link submissions back to the account that created them.
-- on delete set null so account deletion anonymises rather than removes approved creatures
-- (the account/delete page offers a full-delete mode that explicitly removes rows).

alter table public.creature_submissions
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists kid_id  uuid references public.account_kids(id) on delete set null;

create index if not exists creature_submissions_user_idx
  on public.creature_submissions (user_id)
  where user_id is not null;

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Find all drafts for a user + kid quickly (autosave key)
create index if not exists creature_drafts_user_kid_idx
  on public.creature_drafts (user_id, kid_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────

alter table public.account_profiles  enable row level security;
alter table public.account_kids      enable row level security;
alter table public.creature_drafts   enable row level security;
alter table public.gdpr_actions_log  enable row level security;

-- account_profiles: anyone can read (handles are public creator slugs shown on profile pages)
create policy "public read profiles"
  on public.account_profiles for select
  to anon, authenticated
  using (true);

-- account_profiles: owners can insert and update their own row
create policy "own profile insert"
  on public.account_profiles for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "own profile update"
  on public.account_profiles for update
  to authenticated
  using (auth.uid() = user_id);

-- account_profiles: owners can delete (triggers cascade to kids + drafts)
create policy "own profile delete"
  on public.account_profiles for delete
  to authenticated
  using (auth.uid() = user_id);

-- account_kids: owner-scoped all operations
create policy "own kids"
  on public.account_kids for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- creature_drafts: owner-scoped all operations
create policy "own drafts"
  on public.creature_drafts for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- gdpr_actions_log: authenticated users can INSERT their own actions (audit trail)
-- No SELECT for non-service-role — admins use service-role to read the log.
create policy "own log insert"
  on public.gdpr_actions_log for insert
  to authenticated
  with check (true);

-- creature_submissions: owners can delete their own (full-delete mode in account/delete)
create policy "own submissions delete"
  on public.creature_submissions for delete
  to authenticated
  using (auth.uid() = user_id);
