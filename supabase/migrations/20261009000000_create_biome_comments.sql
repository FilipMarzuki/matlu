-- Per-biome comments on the Codex's /biomes page (#325). Public and login-free like the
-- playtest form: anyone may read and add a comment. Length limits keep a spammed row small.
create table if not exists public.biome_comments (
  id          uuid        primary key default gen_random_uuid(),
  biome_slug  text        not null check (char_length(biome_slug) between 1 and 64),
  author      text                 check (author is null or char_length(author) <= 80),
  body        text        not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);

create index if not exists biome_comments_slug_created_idx
  on public.biome_comments (biome_slug, created_at desc);

alter table public.biome_comments enable row level security;

create policy "public read"  on public.biome_comments for select to anon, authenticated using (true);
create policy "public write" on public.biome_comments for insert to anon, authenticated with check (true);
