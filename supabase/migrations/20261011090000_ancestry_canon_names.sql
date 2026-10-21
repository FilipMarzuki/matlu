-- #1603: the seven ancestries the cultures reference take their canonical People names, per
-- docs/peoples-and-races.md (#709). The export (scripts/export-macro-world.mjs) writes these names
-- into macro-world/cultures.json (racePreferences) and race-affinities.json. Slugs stay as they are:
-- the seed scripts map canonical names onto them.
update public.ancestries set name = 'Markfolk'  where slug = 'human'       and name = 'Humans';
update public.ancestries set name = 'Bergfolk'  where slug = 'dvergr'      and name = 'Dvergr';
update public.ancestries set name = 'Lövfolk'   where slug = 'sylphari'    and name = 'Sylphari';
update public.ancestries set name = 'Giants'    where slug = 'half-giants' and name = 'Half-Giants';
update public.ancestries set name = 'Dragons'   where slug = 'draak'       and name = 'Draak';
update public.ancestries set name = 'Viddfolk'  where slug = 'steppevarg'  and name = 'Steppevarg';
update public.ancestries set name = 'Steinfolk' where slug = 'grynfolk'    and name = 'Grynfolk';
