create table if not exists matlu_runs (
  id          uuid        primary key default gen_random_uuid(),
  nickname    text        not null default 'anonymous',
  score       int         not null default 0,
  duration_ms bigint,
  created_at  timestamptz default now()
);

alter table matlu_runs enable row level security;

create policy "anon read" on matlu_runs for select using (true);
create policy "anon insert" on matlu_runs for insert with check (true);
