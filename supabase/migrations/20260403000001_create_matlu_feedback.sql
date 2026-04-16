create table if not exists matlu_feedback (
  id            uuid        primary key default gen_random_uuid(),
  feedback_text text        not null,
  game_version  text        not null,
  session_id    text,
  user_agent    text,
  created_at    timestamptz default now()
);

alter table matlu_feedback enable row level security;

create policy "anon read" on matlu_feedback for select using (true);
create policy "anon insert" on matlu_feedback for insert with check (true);
