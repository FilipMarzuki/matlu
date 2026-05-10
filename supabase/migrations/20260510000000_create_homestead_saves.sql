-- Homestead cloud save (#851).
-- One row per user. Anonymous Supabase users get a real auth.users row,
-- so they save the same way real users do. When an anon user upgrades
-- via magic link, the user_id is preserved so the save row keeps working.

create table if not exists public.homestead_saves (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  state      jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.homestead_saves enable row level security;

-- Each user can only read/write their own save row. auth.uid() is null
-- for the anon role, so unauthenticated requests are blocked entirely.
create policy "users read own homestead save"
  on public.homestead_saves
  for select using (auth.uid() = user_id);

create policy "users insert own homestead save"
  on public.homestead_saves
  for insert with check (auth.uid() = user_id);

create policy "users update own homestead save"
  on public.homestead_saves
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Bump updated_at automatically so the client doesn't need to set it.
create or replace function public.tg_homestead_saves_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists homestead_saves_updated_at on public.homestead_saves;
create trigger homestead_saves_updated_at
  before update on public.homestead_saves
  for each row
  execute function public.tg_homestead_saves_updated_at();
