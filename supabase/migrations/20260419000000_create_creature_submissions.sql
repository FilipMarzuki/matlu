-- Kid-friendly creature submissions — the wiki page at /creatures/submit.
-- Rows land with approved=false and are hidden from anon reads until the
-- moderator flips the flag. License + parental consent are enforced by CHECK
-- constraints so no insert path can bypass them, even if the client form is
-- tampered with. See issues #329 and #332 for the full spec.

create table if not exists public.creature_submissions (
  id                  uuid        primary key default gen_random_uuid(),
  created_at          timestamptz default now(),

  -- identity
  name                text        not null,
  slug                text        unique not null,
  maker_name          text,
  maker_age           int,

  -- picture (path in `creature-art` bucket)
  image_path          text        not null,

  -- what kind of creature
  creature_type       text,
  size_category       text,
  intelligence        text,
  movement            text[],

  -- where it lives
  habitat             text[],
  climate             text,

  -- behavior
  friendliness        text,
  activity_time       text,
  social_structure    text,
  danger_level        text,

  -- food
  diet                text,
  favorite_food       text,
  hunting_style       text,

  -- special
  sounds              text,
  special_powers      text,
  weaknesses          text,

  -- lore
  story               text        not null,

  -- consent & credits
  license_accepted    boolean     not null,
  license_version     text        not null,
  parental_consent    boolean     not null,
  credit_in_game      boolean     not null default true,

  -- quality signal (from the client-side progress bar — informational)
  completion_score    int,

  -- moderation / ops
  approved            boolean     not null default false,
  moderation_note     text,
  game_ready          boolean     not null default false,
  design_notes        text,

  constraint license_must_be_accepted     check (license_accepted = true),
  constraint parental_consent_must_be_yes check (parental_consent = true),
  constraint completion_score_range       check (completion_score is null or (completion_score between 0 and 100)),
  constraint maker_age_range              check (maker_age is null or (maker_age between 1 and 120))
);

-- Gallery query: sort approved rows by created_at desc.
create index if not exists creature_submissions_approved_idx
  on public.creature_submissions (approved, created_at desc);

-- Credits page query: list opted-in makers only.
create index if not exists creature_submissions_credits_idx
  on public.creature_submissions (approved, credit_in_game, maker_name)
  where approved = true and credit_in_game = true;

alter table public.creature_submissions enable row level security;

-- anon can read only approved creatures (the public gallery + credits page).
create policy "public read approved"
  on public.creature_submissions
  for select
  using (approved = true);

-- anon can insert new submissions — always as pending. The CHECK constraints
-- above additionally enforce license + parental consent at the DB layer.
create policy "public insert pending"
  on public.creature_submissions
  for insert
  with check (approved = false);

-- Updates (approve / reject / design_notes) are service-role only. No RLS
-- policy for anon means anon updates are rejected.

comment on table public.creature_submissions is
  'Kid-submitted fantasy creatures. Hidden by default; moderator flips approved=true.';
