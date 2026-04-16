-- Engineering stats: one row per weekly run.
-- content = markdown for the wiki display page.
-- metrics = structured JSONB for future chart queries.

create table if not exists stats_weekly (
  id         uuid        primary key default gen_random_uuid(),
  week_of    date        not null unique,
  title      text        not null,
  slug       text        not null unique,
  content    text        not null,
  metrics    jsonb,
  created_at timestamptz default now()
);

alter table stats_weekly enable row level security;

-- Public read — the wiki fetches these at build time with the anon key.
create policy "public read" on stats_weekly
  for select using (true);
