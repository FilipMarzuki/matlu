-- Free questions (#1575, plan #1574): every question a player asks a villager in the Artificer in
-- their own words, matched to what that person knows or not. The owner's call: the questions are
-- the value. What players ask, and what nobody can answer yet, shows how to grow the game.
--
-- Only the server touches this table, with the service-role key: RLS is on and there are no
-- policies. Questions are cleaned before they're written (src/artificer-play/questions.ts): cut to
-- 200 characters, with email addresses, links and runs of digits taken out, and one holding a
-- blocked word is kept as blocked, without its text. Nothing about the player is stored: no
-- address, no account, no game id.

create table if not exists public.artificer_questions (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  -- The question as cleaned, or null when it held a blocked word.
  question      text check (question is null or char_length(question) <= 200),
  blocked       boolean not null default false,
  -- Who was asked (a person id in src/artificer/villages.ts), and the topic it matched (a focus
  -- key such as 'material:iron'), or null when it matched nothing and they deflected.
  person        text not null,
  topic         text,
  answered      boolean not null,
  -- Their trust in the Warden when asked, 0-100.
  trust         integer not null check (trust between 0 and 100),
  game_version  text not null,
  surface       text not null check (surface in ('api', 'mcp', 'console', 'web')),
  check (blocked = (question is null))
);

create index if not exists artificer_questions_created_at on public.artificer_questions (created_at desc);

alter table public.artificer_questions enable row level security;

-- Reading them (#1575): run in the SQL editor, or from the dev site later through the server.
-- Both views run as whoever queries them (security_invoker), so the table's RLS still applies: the
-- browser keys see nothing through them either.

-- How often each person is asked, about what, and how much of it they could answer.
create or replace view public.artificer_question_counts with (security_invoker = true) as
  select person,
         topic,
         count(*)                           as questions,
         count(*) filter (where answered)   as answered,
         count(*) filter (where blocked)    as blocked,
         max(created_at)                    as latest
    from public.artificer_questions
   group by person, topic;

-- What nobody could answer: the questions that matched nothing, newest first. The list to read
-- when deciding what people should know next.
create or replace view public.artificer_questions_unmatched with (security_invoker = true) as
  select created_at, person, question, trust, surface, game_version
    from public.artificer_questions
   where topic is null and not blocked
   order by created_at desc;

revoke all on public.artificer_question_counts from anon, authenticated;
revoke all on public.artificer_questions_unmatched from anon, authenticated;
