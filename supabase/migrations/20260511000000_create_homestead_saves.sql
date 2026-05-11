create table public.homestead_saves (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.homestead_saves enable row level security;

create policy "users read own save"
  on public.homestead_saves
  for select
  using (auth.uid() = user_id);

create policy "users insert own save"
  on public.homestead_saves
  for insert
  with check (auth.uid() = user_id);

create policy "users update own save"
  on public.homestead_saves
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
