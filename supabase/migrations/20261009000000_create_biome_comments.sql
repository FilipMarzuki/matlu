create table if not exists biome_comments (
  id          uuid        primary key default gen_random_uuid(),
  biome_slug  text        not null,
  author      text,
  body        text        not null,
  created_at  timestamptz default now()
);

alter table biome_comments enable row level security;

create policy "public read"  on biome_comments for select using (true);
create policy "public write" on biome_comments for insert with check (true);
