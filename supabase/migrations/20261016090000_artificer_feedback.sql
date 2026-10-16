-- Feedback reports from the Artificer (#1773, epic #1772): what a player writes in the 💬 panel,
-- a bug, an idea or anything else, with the context they left ticked and up to three screenshots.
--
-- Only the server touches this table and the bucket below, with the service-role key
-- (src/artificer-play/api.ts, POST /api/v1/feedback): RLS is on and there are no policies, so the
-- browser's keys can't read or write either. What's kept (src/artificer-play/feedback.ts):
-- - The text as written, for everyone (the owner's call on #1772), with only control and invisible
--   characters dropped, up to 2000 characters.
-- - The Warden's id always, and the run's record id once the run was sent to the records.
-- - The context, structured; the save only if the player ticked it, without the Warden's name.
-- - The images' paths in the private bucket `artificer-feedback`. The page downscales them and
--   re-encodes them through a canvas, which drops EXIF and GPS.
-- - `contact_email`: only if the player wants an answer. It lives in this column alone: never in
--   `context`, never in the API's answer or a log, and triage (#1776) writes "contact: yes/no".
-- - `ip_week_hash`: the address hashed with a server secret and the ISO week, for the rate limit
--   only (10 an hour), so it can't follow anyone from one week to the next.

create table if not exists public.artificer_feedback (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  -- The reference the player is shown ("FB-2Q7K"), to quote when following up.
  ref            text not null unique check (ref ~ '^FB-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$'),
  kind           text not null check (kind in ('bug', 'idea', 'other')),
  text           text not null check (char_length(text) between 1 and 2000),
  -- The Warden's id (`w-…`, or the weekly world's id), and the run's game id in artificer_runs.
  warden_id      text not null check (char_length(warden_id) <= 80),
  run_id         text check (run_id is null or char_length(run_id) <= 80),
  -- The attached context: { build?, where?, journal? }, each part only if the player left it ticked.
  context        jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  -- What the player pointed at (#1774): up to five { text, role, path, rect, tab }. Empty until then.
  picks          jsonb not null default '[]'::jsonb check (jsonb_typeof(picks) = 'array'),
  -- The game state, without the Warden's name; null unless the player ticked it.
  save           jsonb check (save is null or jsonb_typeof(save) = 'object'),
  -- Object paths in the `artificer-feedback` bucket ("2026-10-16/<uuid>.webp"), at most three.
  images         text[] not null default '{}' check (cardinality(images) <= 3),
  contact_email  text check (contact_email is null or char_length(contact_email) <= 254),
  surface        text not null check (surface in ('web', 'console', 'api', 'mcp')),
  -- The commit the page was built from, or 'unknown'.
  build          text not null,
  ip_week_hash   text not null
);

create index if not exists artificer_feedback_created_at on public.artificer_feedback (created_at desc);
-- The rate limit's count: one address's reports in the last hour.
create index if not exists artificer_feedback_ip_week_hash on public.artificer_feedback (ip_week_hash, created_at desc);

alter table public.artificer_feedback enable row level security;
revoke all on public.artificer_feedback from anon, authenticated;

-- The images' bucket: private (no public URLs; the owner opens them through signed URLs), images
-- only, at most 1 MB each. storage.objects has RLS on already and this adds no policy, so only the
-- service role can put or read anything in it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('artificer-feedback', 'artificer-feedback', false, 1000000, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;
