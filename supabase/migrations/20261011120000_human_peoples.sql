-- #1623: humans are their own Peoples again, and the Markfolk are the orc People.
--
-- 20261011090000_ancestry_canon_names.sql renamed ancestry `human` from 'Humans' to 'Markfolk'
-- (#709 had folded the old human race into the Markfolk). Checked read-only on 2026-10-11, that
-- one row means two things at once:
--   * its description is the humans' ("Earth arrivals... Adaptable, short-lived, numerous");
--   * its body and sprite columns (body_plan, build, surface, silhouette, head, senses, anatomy,
--     variation, sprite_note, lifespan) describe the Markfolk orcs (tusks, the Merkförbund),
--     written there by scripts/seed-macro-world-phase2.mjs from the Notion Markfolk card.
-- It is referenced by 5 culture_ancestry_preferences rows (coastborn 0.7, ridgefolk 0.5,
-- fieldborn 1.0, wallborn 0.5, harborfolk 0.6), 13 ancestry_biome_affinities rows and 3
-- ancestry_feature_bonuses rows (earth_fragment 0.6, trade_route 0.3, coast 0.2). No other
-- table references ancestries.
--
-- So the row splits, the way the Wildkin's do (`wildkin` plus one ancestry per clan):
--   1. `markfolk` (new): the Markfolk orcs, taking the orc body columns.
--   2. `riksfolk`, `strandfolk` (new): the two human Peoples (docs/peoples-and-races.md #17, #18).
--   3. `human` goes back to 'Humans', the umbrella, with the orc columns cleared (now on `markfolk`).
--   4. The five culture preferences move from `human` to the human Peoples, keeping a share for
--      the Markfolk (docs/peoples-and-races.md, the #1623 column).
-- macro-world/race-affinities.json and cultures.json already show the result, as the export
-- (scripts/export-macro-world.mjs) will write it once this is applied.
--
-- Every step is guarded, so running it twice changes nothing more.

begin;

-- 1-2. The three new ancestries, starting from the `human` row's climate and settlement columns.
insert into public.ancestries (
  slug, name, description,
  elevation_ideal_min, elevation_ideal_max, elevation_tol_min, elevation_tol_max,
  moisture_ideal_min, moisture_ideal_max, moisture_tol_min, moisture_tol_max,
  clustering, population_weight, mixing_behavior, naming_base,
  body_plan, build, surface, silhouette, head, senses, anatomy, variation,
  sprite_note, sprite_resolution, lifespan
)
select v.slug, v.name, v.description,
  h.elevation_ideal_min, h.elevation_ideal_max, h.elevation_tol_min, h.elevation_tol_max,
  h.moisture_ideal_min, h.moisture_ideal_max, h.moisture_tol_min, h.moisture_tol_max,
  v.clustering, h.population_weight, v.mixing_behavior, h.naming_base,
  -- Only the Markfolk take the orc body; the human Peoples' bodies are still to be written.
  case when v.slug = 'markfolk' then h.body_plan end,
  case when v.slug = 'markfolk' then h.build end,
  case when v.slug = 'markfolk' then h.surface end,
  case when v.slug = 'markfolk' then h.silhouette end,
  case when v.slug = 'markfolk' then h.head end,
  case when v.slug = 'markfolk' then h.senses end,
  case when v.slug = 'markfolk' then h.anatomy end,
  case when v.slug = 'markfolk' then h.variation end,
  case when v.slug = 'markfolk' then h.sprite_note end,
  case when v.slug = 'markfolk' then h.sprite_resolution end,
  case when v.slug = 'markfolk' then h.lifespan end
from public.ancestries h
cross join (values
  ('markfolk', 'Markfolk', 'Orcs of the southern plains and delta: the Merkförbund, a confederation of forty-three cities and two hundred farming communities. The best farmers and [Watermasters] on the continent, with a dry-comedy tradition about how much everyone needs their grain.', 'tight', 'integrated'),
  ('riksfolk', 'Riksfolk', 'Humans of the Realm (Riket): river lowlands and low hills on the Wildkin''s eastern border. Charters, the Landslag, and a Marshal consolidating the kingdoms. The West March and the Stone Line.', 'scattered', 'cosmopolitan'),
  ('strandfolk', 'Strandfolk', 'Humans of the harbour coast east of the delta: shipwrights, fishers and freighters. The Hamnlag, a league of free harbour towns, and storm-right.', 'tight', 'welcoming')
) as v(slug, name, description, clustering, mixing_behavior)
where h.slug = 'human'
on conflict (slug) do nothing;

-- Biome affinities: copied from `human`, with wetter delta land for the Markfolk and the sea for
-- the Strandfolk.
insert into public.ancestry_biome_affinities (ancestry_id, biome_id, score)
select n.id, a.biome_id,
  case
    when n.slug = 'markfolk' and b.slug = 'wetland' then 0.5
    when n.slug = 'strandfolk' and b.slug = 'marine' then 0.3
    else a.score
  end
from public.ancestry_biome_affinities a
join public.ancestries h on h.id = a.ancestry_id and h.slug = 'human'
join public.biomes b on b.id = a.biome_id
cross join public.ancestries n
where n.slug in ('markfolk', 'riksfolk', 'strandfolk')
on conflict (ancestry_id, biome_id) do nothing;

-- Feature bonuses: earth_fragment stays with the humans (it's tied to the "Earth arrivals"
-- description); rivers and open plain for the Markfolk, coast and islands for the Strandfolk.
insert into public.ancestry_feature_bonuses (ancestry_id, feature_id, bonus)
select n.id, f.id, v.bonus
from (values
  ('markfolk', 'river', 0.6), ('markfolk', 'open_plain', 0.4), ('markfolk', 'trade_route', 0.3),
  ('riksfolk', 'earth_fragment', 0.6), ('riksfolk', 'river', 0.4), ('riksfolk', 'hills', 0.3), ('riksfolk', 'trade_route', 0.3),
  ('strandfolk', 'earth_fragment', 0.6), ('strandfolk', 'coast', 0.8), ('strandfolk', 'archipelago', 0.5), ('strandfolk', 'island', 0.3), ('strandfolk', 'trade_route', 0.3)
) as v(ancestry, feature, bonus)
join public.ancestries n on n.slug = v.ancestry
join public.geographic_features f on f.slug = v.feature
on conflict (ancestry_id, feature_id) do nothing;

-- 3. `human` is the humans' umbrella again. Clear the orc columns only once `markfolk` holds them.
update public.ancestries h
set name = 'Humans',
    -- Canon (owner, 2026-10-11): humans are native to Mistheim; some ancestors were Earth arrivals, who all came without memory.
    description = 'Native to Mistheim, and joined by Earth arrivals: humans lived here before the worlds merged, and some of their ancestors came through with the Earth fragments, every one of them without memory of Earth, and married into the humans already here. Adaptable, short-lived, numerous. Settle anywhere. Other races find their speed of reproduction and cultural change alarming. In Mistheim they are two Peoples: the Riksfolk of the Realm and the Strandfolk of the harbour coast (#1623).',
    body_plan = null, build = null, surface = null, silhouette = null, head = null, senses = null,
    anatomy = null, variation = null, sprite_note = null, sprite_resolution = null, lifespan = null
where h.slug = 'human' and h.name = 'Markfolk'
  and exists (select 1 from public.ancestries m where m.slug = 'markfolk' and m.body_plan is not distinct from h.body_plan);

-- 4. Culture preferences: from `human` to the human Peoples and the Markfolk.
insert into public.culture_ancestry_preferences (culture_id, ancestry_id, weight)
select c.id, a.id, v.weight
from (values
  ('coastborn', 'strandfolk', 0.6), ('coastborn', 'markfolk', 0.1),
  ('harborfolk', 'strandfolk', 0.5), ('harborfolk', 'markfolk', 0.1),
  ('fieldborn', 'markfolk', 0.6), ('fieldborn', 'riksfolk', 0.4),
  ('ridgefolk', 'riksfolk', 0.3), ('ridgefolk', 'markfolk', 0.2),
  ('wallborn', 'riksfolk', 0.3), ('wallborn', 'markfolk', 0.2)
) as v(culture, ancestry, weight)
join public.cultures c on c.slug = v.culture
join public.ancestries a on a.slug = v.ancestry
-- Only cultures that still prefer `human`, so a later hand edit isn't overwritten on a re-run.
where exists (
  select 1 from public.culture_ancestry_preferences p
  join public.ancestries h on h.id = p.ancestry_id and h.slug = 'human'
  where p.culture_id = c.id
)
on conflict (culture_id, ancestry_id) do nothing;

delete from public.culture_ancestry_preferences p
using public.ancestries h, public.cultures c
where p.ancestry_id = h.id and h.slug = 'human'
  and p.culture_id = c.id and c.slug in ('coastborn', 'harborfolk', 'fieldborn', 'ridgefolk', 'wallborn');

commit;
