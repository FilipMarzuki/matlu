-- Guard the public insert on biome_comments (#325): the server sets id and created_at
-- (clients can't pin a comment to the top with a future date), and inserts are capped
-- so a script can't fill the table: at most 10 a minute and 200 an hour across the site.
create or replace function public.biome_comments_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.id := gen_random_uuid();
  new.created_at := now();
  if (select count(*) from public.biome_comments where created_at > now() - interval '1 minute') >= 10
     or (select count(*) from public.biome_comments where created_at > now() - interval '1 hour') >= 200 then
    raise exception 'biome comments: too many comments right now, try again later'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.biome_comments_guard() from public, anon, authenticated;

create trigger biome_comments_guard
  before insert on public.biome_comments
  for each row execute function public.biome_comments_guard();
