-- Buildings, population archetypes, and ancestry body/sprite columns
-- Completes the macro-world Supabase migration (#793)

-- ============================================================
-- Buildings table
-- ============================================================

create table public.buildings (
  id                  uuid primary key default gen_random_uuid(),
  slug                text unique not null,
  name                text not null,
  role                text,
  category            text,
  min_tier            int,
  zone                text,
  base_size_min       int,
  base_size_max       int,
  base_depth_min      int,
  base_depth_max      int,
  height_hint         text,
  unlock_conditions   jsonb,
  count               jsonb,
  placement_hints     text[],
  lore_hook           text,
  created_at          timestamptz default now()
);

create index idx_buildings_category on public.buildings(category);
create index idx_buildings_min_tier on public.buildings(min_tier);

-- ============================================================
-- Population archetypes table
-- ============================================================

create table public.population_archetypes (
  id                  uuid primary key default gen_random_uuid(),
  building_id         uuid references public.buildings(id) on delete cascade,
  role                text not null,
  name                text not null,
  fashion_variant     text,
  count_min           int default 1,
  count_max           int default 1,
  count_per_tier      jsonb,
  sprite_notes        text,
  animations          text[],
  is_ambient          boolean default false,
  created_at          timestamptz default now(),
  unique (building_id, role)
);

create index idx_pop_arch_building on public.population_archetypes(building_id);
create index idx_pop_arch_ambient on public.population_archetypes(is_ambient) where is_ambient = true;

-- ============================================================
-- Ancestry body/sprite columns
-- ============================================================

alter table public.ancestries
  add column body_plan         text,
  add column build             text,
  add column surface           text,
  add column silhouette        text,
  add column head              text,
  add column senses            text,
  add column anatomy           text,
  add column variation         text,
  add column sprite_note       text,
  add column sprite_resolution int,
  add column lifespan          text;

-- lore_status already exists conceptually via Notion sync;
-- add it if missing (idempotent check not needed for fresh migration)

-- ============================================================
-- RLS
-- ============================================================

alter table public.buildings enable row level security;
alter table public.population_archetypes enable row level security;

create policy "anon_read" on public.buildings for select using (true);
create policy "anon_read" on public.population_archetypes for select using (true);
