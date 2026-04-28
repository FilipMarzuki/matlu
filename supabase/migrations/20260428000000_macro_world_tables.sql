-- Macro-world tables: ancestries, cultures, architecture, fashion
-- Migrates data from macro-world/*.json into normalized Supabase tables
-- Issue: #793

-- ============================================================
-- Lookup tables
-- ============================================================

create table public.biomes (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  created_at  timestamptz default now()
);

create table public.geographic_features (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  created_at  timestamptz default now()
);

-- ============================================================
-- Entity tables
-- ============================================================

create table public.ancestries (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text unique not null,
  name                  text not null,
  description           text,
  elevation_ideal_min   int,
  elevation_ideal_max   int,
  elevation_tol_min     int,
  elevation_tol_max     int,
  moisture_ideal_min    int,
  moisture_ideal_max    int,
  moisture_tol_min      int,
  moisture_tol_max      int,
  clustering            text check (clustering in ('tight', 'scattered', 'sparse')),
  population_weight     numeric,
  mixing_behavior       text,
  naming_base           text,
  created_at            timestamptz default now()
);

create table public.culture_traits (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  description text not null,
  created_at  timestamptz default now()
);

create table public.cultures (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text unique not null,
  name                  text not null,
  spacing               numeric,
  organicness           numeric,
  hierarchy_scale       numeric,
  perimeter_awareness   numeric,
  facing_bias           text,
  verticality           numeric,
  preferred_shapes      text[],
  roof_style            text,
  street_pattern        text,
  created_at            timestamptz default now()
);

create table public.architecture_styles (
  id                      uuid primary key default gen_random_uuid(),
  slug                    text unique not null,
  name                    text not null,
  primary_material        text,
  construction_method     text,
  form_language           text,
  ground_relation         text,
  window_style            text,
  ornament_level          text,
  structural_principle    text,
  climate_response        text,
  description             text,
  prompt_keywords         text,
  real_world_inspiration  text,
  created_at              timestamptz default now()
);

create table public.fashion_styles (
  id                      uuid primary key default gen_random_uuid(),
  culture_id              uuid not null references public.cultures(id) on delete cascade,
  real_world_inspiration  text,
  base_materials          text[],
  base_palette            text[],
  base_motifs             text[],
  created_at              timestamptz default now(),
  unique (culture_id)
);

-- ============================================================
-- Relationship / join tables
-- ============================================================

create table public.ancestry_biome_affinities (
  ancestry_id uuid not null references public.ancestries(id) on delete cascade,
  biome_id    uuid not null references public.biomes(id) on delete cascade,
  score       numeric not null check (score between -1.0 and 1.0),
  primary key (ancestry_id, biome_id)
);

create table public.ancestry_feature_bonuses (
  ancestry_id uuid not null references public.ancestries(id) on delete cascade,
  feature_id  uuid not null references public.geographic_features(id) on delete cascade,
  bonus       numeric not null check (bonus between -1.0 and 1.0),
  primary key (ancestry_id, feature_id)
);

create table public.culture_ancestry_preferences (
  culture_id  uuid not null references public.cultures(id) on delete cascade,
  ancestry_id uuid not null references public.ancestries(id) on delete cascade,
  weight      numeric not null check (weight > 0 and weight <= 1.0),
  primary key (culture_id, ancestry_id)
);

create table public.culture_trait_assignments (
  culture_id uuid not null references public.cultures(id) on delete cascade,
  trait_id   uuid not null references public.culture_traits(id) on delete cascade,
  primary key (culture_id, trait_id)
);

create table public.culture_architecture_assignments (
  culture_id           uuid not null references public.cultures(id) on delete cascade,
  architecture_style_id uuid not null references public.architecture_styles(id) on delete cascade,
  primary key (culture_id, architecture_style_id)
);

create table public.architecture_blocks (
  id          uuid primary key default gen_random_uuid(),
  style_id    uuid not null references public.architecture_styles(id) on delete cascade,
  block_type  text not null,
  name        text not null,
  sprite_key  text,
  sort_order  int default 0
);

create table public.fashion_variants (
  id                uuid primary key default gen_random_uuid(),
  fashion_style_id  uuid not null references public.fashion_styles(id) on delete cascade,
  role              text not null,
  silhouette        text,
  headwear          text,
  footwear          text,
  accessories       text[],
  notes             text,
  unique (fashion_style_id, role)
);

-- ============================================================
-- Indexes for common queries
-- ============================================================

create index idx_ancestry_biome_aff_ancestry on public.ancestry_biome_affinities(ancestry_id);
create index idx_ancestry_biome_aff_biome on public.ancestry_biome_affinities(biome_id);
create index idx_ancestry_feature_bon_ancestry on public.ancestry_feature_bonuses(ancestry_id);
create index idx_culture_ancestry_pref_culture on public.culture_ancestry_preferences(culture_id);
create index idx_culture_trait_assign_culture on public.culture_trait_assignments(culture_id);
create index idx_culture_arch_assign_culture on public.culture_architecture_assignments(culture_id);
create index idx_arch_blocks_style on public.architecture_blocks(style_id);
create index idx_fashion_variants_style on public.fashion_variants(fashion_style_id);
create index idx_fashion_styles_culture on public.fashion_styles(culture_id);

-- ============================================================
-- RLS: anon can read, service_role can write
-- ============================================================

alter table public.biomes enable row level security;
alter table public.geographic_features enable row level security;
alter table public.ancestries enable row level security;
alter table public.culture_traits enable row level security;
alter table public.cultures enable row level security;
alter table public.architecture_styles enable row level security;
alter table public.fashion_styles enable row level security;
alter table public.ancestry_biome_affinities enable row level security;
alter table public.ancestry_feature_bonuses enable row level security;
alter table public.culture_ancestry_preferences enable row level security;
alter table public.culture_trait_assignments enable row level security;
alter table public.culture_architecture_assignments enable row level security;
alter table public.architecture_blocks enable row level security;
alter table public.fashion_variants enable row level security;

-- Read access for anon and authenticated
create policy "anon_read" on public.biomes for select using (true);
create policy "anon_read" on public.geographic_features for select using (true);
create policy "anon_read" on public.ancestries for select using (true);
create policy "anon_read" on public.culture_traits for select using (true);
create policy "anon_read" on public.cultures for select using (true);
create policy "anon_read" on public.architecture_styles for select using (true);
create policy "anon_read" on public.fashion_styles for select using (true);
create policy "anon_read" on public.ancestry_biome_affinities for select using (true);
create policy "anon_read" on public.ancestry_feature_bonuses for select using (true);
create policy "anon_read" on public.culture_ancestry_preferences for select using (true);
create policy "anon_read" on public.culture_trait_assignments for select using (true);
create policy "anon_read" on public.culture_architecture_assignments for select using (true);
create policy "anon_read" on public.architecture_blocks for select using (true);
create policy "anon_read" on public.fashion_variants for select using (true);
