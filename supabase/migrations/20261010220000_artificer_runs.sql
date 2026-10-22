-- Run records (#1558): one row per finished game of the Artificer, the same shape for people and
-- AIs wherever they played (src/artificer-play/records.ts). The Records page on the Artificer site
-- and the AI page on the dev site read them live, so new runs never need a deployment.
--
-- Only the server touches this table, with the service-role key: RLS is on and there are no
-- policies. The pages read through the play API (GET /api/v1/runs), which leaves out `source_key`.
-- Nothing personal is stored: no address, no account, and a nickname of one filtered word.

create table if not exists public.artificer_runs (
  id                uuid primary key default gen_random_uuid(),
  -- Where the record came from, written once: 'game:<API game id>' or 'bench:<transcript>'. A
  -- second write for the same source (a retried request, a re-run upload) is turned away.
  source_key        text not null unique,
  created_at        timestamptz not null default now(),
  player_kind       text not null check (player_kind in ('person', 'ai')),
  -- Self-reported by the player (or the playtest's model id): shown as such, never checked.
  model             text,
  client            text,
  surface           text not null check (surface in ('api', 'mcp', 'console', 'bench', 'web')),
  game_version      text not null,
  nickname          text check (nickname is null or char_length(nickname) <= 16),
  outcome           text not null,
  grade             text,
  stage             text not null check (stage in ('reach', 'road')),
  end_day           integer not null,
  ready_day         integer,
  larder_midwinter  integer,
  shelter_tier      integer not null,
  skill_levels      integer not null,
  concept_ranks     integer not null,
  recipes           integer not null,
  milestones        integer not null,
  moves             integer not null,
  cost_usd          numeric(10, 4),
  -- One number that orders runs, bigger is better (records.ts rankKey): the best runs of all time
  -- come back from an index instead of a scan.
  rank_key          bigint not null,
  detail            jsonb not null default '{}'::jsonb
);

create index if not exists artificer_runs_created_at on public.artificer_runs (created_at desc);
create index if not exists artificer_runs_rank_key on public.artificer_runs (rank_key desc);

alter table public.artificer_runs enable row level security;

-- A game now remembers where it's being played and by whom, for its record, and the measures taken
-- while it's played (the larder at midwinter), which its end state can't show.
alter table public.artificer_games add column if not exists surface text not null default 'api';
alter table public.artificer_games add column if not exists player text not null default 'ai';
alter table public.artificer_games add column if not exists measures jsonb not null default '{}'::jsonb;
