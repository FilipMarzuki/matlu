-- The Artificer's play API (#1555): games played from outside the page, by people or their AIs.
-- See docs/spikes/artificer-play-api.md and src/artificer-play/.
--
-- Only the server touches this table, with the service-role key: RLS is on and there are no
-- policies, so the publishable and anon keys can neither read nor write it. A row's `session`
-- holds the game's seed, which must never reach a player (it would let anyone run the world
-- ahead), and `ip_key` is a salted hash of the address that started it, for the daily limit.

create table if not exists public.artificer_games (
  id          uuid primary key,
  version     text not null,
  session     text not null,
  moves       jsonb not null default '[]'::jsonb,
  -- The number of moves, kept beside them so an update can say "only if still N moves":
  -- two moves sent at once on one game must not both apply to the same state.
  move_count  integer not null default 0,
  phase       text not null,
  name        text not null,
  client      text,
  ip_key      text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- The daily limit counts one address's games started in the last day.
create index if not exists artificer_games_ip_key_created_at on public.artificer_games (ip_key, created_at);

alter table public.artificer_games enable row level security;

-- Moves per address per UTC day, for the daily move limit. Counted by whoever sends the move,
-- across all their games. One row per address per day.
create table if not exists public.artificer_play_usage (
  ip_key  text not null,
  day     date not null,
  moves   integer not null default 0,
  primary key (ip_key, day)
);

alter table public.artificer_play_usage enable row level security;

-- Count one move and return the day's total, in one statement so two moves at once both count.
create or replace function public.artificer_count_move(p_ip_key text, p_day date)
returns integer
language sql
set search_path = ''
as $$
  insert into public.artificer_play_usage as u (ip_key, day, moves)
  values (p_ip_key, p_day, 1)
  on conflict (ip_key, day) do update set moves = u.moves + 1
  returning u.moves;
$$;

-- Functions in public are callable by everyone through the API by default: only the server may.
revoke execute on function public.artificer_count_move(text, date) from public, anon, authenticated;
grant execute on function public.artificer_count_move(text, date) to service_role;
