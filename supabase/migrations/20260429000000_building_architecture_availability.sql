-- Which buildings can be built in which architecture styles
-- A village can mix styles as it grows — this maps per-building, not per-settlement

create table public.building_architecture_availability (
  building_id           uuid not null references public.buildings(id) on delete cascade,
  architecture_style_id uuid not null references public.architecture_styles(id) on delete cascade,
  primary key (building_id, architecture_style_id)
);

create index idx_baa_building on public.building_architecture_availability(building_id);
create index idx_baa_style on public.building_architecture_availability(architecture_style_id);

alter table public.building_architecture_availability enable row level security;
create policy "anon_read" on public.building_architecture_availability for select using (true);
