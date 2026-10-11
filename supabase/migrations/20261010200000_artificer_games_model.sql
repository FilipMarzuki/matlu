-- The Artificer's MCP server (#1556): a player says which model is playing, and every game counts
-- toward a daily cap on all games (src/artificer-play/api.ts, LIMITS.gamesPerDay).
--
-- `model` is self-reported and shown as such: nothing checks it. The MCP client's own name goes
-- in the existing `client` column.

alter table public.artificer_games add column if not exists model text;

-- The daily cap counts every game started in the last day, by anyone.
create index if not exists artificer_games_created_at on public.artificer_games (created_at);
