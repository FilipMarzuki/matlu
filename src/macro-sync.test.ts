/**
 * #1642: the macro-world JSON is master canon and Supabase is generated from it. These check the
 * pure JSON → SQL step (scripts/lib/macro-sync-core.mjs) on small fixtures, with no network and no
 * database: which rows a change touches, that deletes are guarded, that every write is idempotent
 * in form, and that the drift check reads the live tables the way the old export did.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  MACRO_FILES, AMBIENT, entitiesFromFiles, diffEntities, isEmptyDiff, generateSyncSql, describeDiff,
  compareEntities, exportFromRows, lit, sameValue, liveDumpQuery, LIVE_TABLES, type MacroFiles,
} from '../scripts/lib/macro-sync-core.mjs';

/** A tiny world: two ancestries, two cultures, two traits, one style, fashion and archetypes. */
function fixture(): Required<MacroFiles> {
  return {
    cultureTraits: { _doc: 'x', 'fire-centred': 'Life turns around the hearth.', 'wind-oriented': "Doors face the wind's lee." },
    raceAffinities: {
      _doc: 'x',
      _biomes: ['marine', 'taiga'],
      races: [
        {
          id: 'strandfolk', name: 'Strandfolk', description: 'Harbour humans.',
          biomeAffinity: { marine: 0.3, taiga: -0.2 },
          elevationAffinity: { ideal: [0, 20], tolerance: [0, 40] },
          moistureAffinity: { ideal: [40, 80], tolerance: [20, 95] },
          featureBonus: { coast: 0.8 }, clustering: 'tight', populationWeight: 0.4, mixingBehavior: 'welcoming', namingBase: 'norse-coast',
        },
        {
          id: 'fae', name: 'Fae', description: 'Details pending.', biomeAffinity: {},
          elevationAffinity: { ideal: [null, null], tolerance: [null, null] },
          moistureAffinity: { ideal: [null, null], tolerance: [null, null] },
          featureBonus: {}, clustering: null, populationWeight: null, mixingBehavior: null, namingBase: null,
        },
      ],
    },
    cultures: {
      _doc: 'x',
      cultures: [
        {
          id: 'coastborn', name: 'Coastborn', racePreferences: { Strandfolk: 0.9, Fae: 0.1 },
          spacing: 0.85, organicness: 0.3, hierarchyScale: 1.4, perimeterAwareness: 0.2, facingBias: 'water', verticality: 0.2,
          preferredShapes: ['longhouse', 'rectangular'], roofStyle: 'thatch', streetPattern: 'linear', traits: ['fire-centred'],
        },
        {
          id: 'windfarer-eyrie', name: 'Windfarer Eyrie', racePreferences: { Fae: 1 },
          spacing: 1.2, organicness: 0.7, hierarchyScale: 1, perimeterAwareness: 0.1, facingBias: 'wind', verticality: 0.9,
          preferredShapes: ['round'], roofStyle: 'dome', streetPattern: 'radial', traits: ['wind-oriented', 'fire-centred'],
        },
      ],
    },
    architecture: {
      _doc: 'x',
      styles: [{
        id: 'ARCH-5', name: 'Turf Longhouse', primaryMaterial: 'turf', constructionMethod: 'stacked', formLanguage: 'long',
        groundRelation: 'grounded', windowStyle: 'none', ornamentLevel: 'plain', structuralPrinciple: 'timber frame',
        climateResponse: 'insulated', description: "Grass on the roof, the hearth's smoke through it.", promptKeywords: 'turf, longhouse',
        realWorldInspiration: 'Iceland', blocks: [{ type: 'wall', name: 'Turf Wall' }, { type: 'roof', name: 'Turf Roof', sprite: 'turf-roof' }],
      }],
    },
    fashion: {
      _doc: 'x',
      fashions: [{
        cultureId: 'coastborn', realWorldFashionInspiration: 'Faroese',
        base: { materials: ['wool'], palette: ['slate-grey'], motifs: [] },
        variants: [
          { role: 'common', silhouette: 'layered', headwear: 'none', footwear: 'boots', accessories: ['rope belt'], notes: 'Knitted.' },
          { role: 'elder', silhouette: 'layered', headwear: 'storm hat', footwear: 'boots', accessories: [], notes: null },
        ],
      }],
    },
    populationArchetypes: {
      _doc: 'x',
      buildingArchetypes: [{
        buildingId: 'campfire',
        archetypes: [
          { role: 'fire-keeper', name: 'Fire Keeper', fashionVariant: 'elder', count: 1, spriteNotes: 'Seated.', animations: ['crouching'] },
          { role: 'listener', name: 'Listener', fashionVariant: 'common', count: [1, 3], spriteNotes: null },
        ],
      }],
      ambientArchetypes: [{ role: 'child', name: 'Child', fashionVariant: 'common', countPerTier: { 1: 0, 2: [1, 2] }, spriteNotes: 'Running.', animations: ['jumping-1'] }],
    },
  };
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
type Rec = Record<string, unknown>;
/** Typed access to the fixture's nested parts, so tests can edit them. */
const cultures = (f: MacroFiles) => (f.cultures as { cultures: Rec[] }).cultures;
const races = (f: MacroFiles) => (f.raceAffinities as { races: Rec[] }).races;

describe('macro-sync: JSON → entities (#1642)', () => {
  it('Given cultures.json naming Peoples, when flattened, then preferences are keyed by ancestry slug', () => {
    const { entities } = entitiesFromFiles(fixture());
    expect(entities.culture.coastborn.preferences).toEqual({ strandfolk: 0.9, fae: 0.1 });
    expect(entities.culture['windfarer-eyrie'].traits).toEqual(['fire-centred', 'wind-oriented']);
    expect(entities.architecture['arch-5']).toMatchObject({ slug: 'arch-5', name: 'Turf Longhouse' });
    expect(entities.archetypes.campfire.roles).toMatchObject({
      'fire-keeper': { count_min: 1, count_max: 1, animations: ['crouching'] },
      listener: { count_min: 1, count_max: 3, animations: null },
    });
    expect(Object.keys(entities.archetypes)).toContain(AMBIENT);
  });

  it('Given a People no ancestry is named, when flattened, then it throws instead of dropping the weight', () => {
    const f = fixture();
    cultures(f)[0].racePreferences = { Strandfolk: 0.5, Nobodies: 0.5 };
    expect(() => entitiesFromFiles(f)).toThrow(/Nobodies/);
  });

  it('Given two ancestries with one name, or an unknown trait, then it throws', () => {
    const f = fixture();
    races(f)[1].name = 'Strandfolk';
    expect(() => entitiesFromFiles(f)).toThrow(/two ancestries are named "Strandfolk"/);
    const g = fixture();
    cultures(g)[0].traits = ['no-such-trait'];
    expect(() => entitiesFromFiles(g)).toThrow(/no-such-trait/);
  });

  it('Given the real master files, then every name, trait, culture and building reference resolves', () => {
    const files = Object.fromEntries(Object.entries(MACRO_FILES).map(([k, p]) => [k, JSON.parse(readFileSync(join(__dirname, '..', p), 'utf8'))]));
    const { entities } = entitiesFromFiles(files);
    expect(Object.keys(entities.culture).length).toBeGreaterThanOrEqual(22);
    expect(entities.ancestry.markfolk).toBeDefined();
  });
});

describe('macro-sync: SQL (#1642)', () => {
  it('Given text with quotes and empty or null values, then literals are escaped and typed', () => {
    expect(lit("o'clock", 'text')).toBe("'o''clock'");
    expect(lit(null, 'int')).toBe('null::int');
    expect(lit([], 'text[]')).toBe("'{}'::text[]");
    expect(lit(['a', "b'c"], 'text[]')).toBe("array['a', 'b''c']::text[]");
    expect(lit(0.5, 'numeric')).toBe('0.5::numeric');
    expect(lit({ 1: [1, 2] }, 'jsonb')).toBe(`'{"1":[1,2]}'::jsonb`);
    expect(() => lit(1.5, 'int')).toThrow();
  });

  it('Given the JSON, when fully synced, then every table is upserted by key and guarded by "is distinct from"', () => {
    const { entities, biomes } = entitiesFromFiles(fixture());
    const sql = generateSyncSql(entities, { biomes });
    expect(sql.startsWith('-- Generated by scripts/macro-sync.mjs')).toBe(true);
    expect(sql).toMatch(/^begin;$/m);
    expect(sql.trimEnd().endsWith('commit;')).toBe(true);
    for (const table of ['culture_traits', 'ancestries', 'cultures', 'architecture_styles']) {
      expect(sql).toContain(`insert into public.${table} as t (slug,`);
    }
    expect(sql).toContain('on conflict (slug) do update set');
    expect(sql).toContain('on conflict (ancestry_id, biome_id) do update set score = excluded.score');
    expect(sql).toContain('on conflict (culture_id, trait_id) do nothing');
    expect(sql).toContain('on conflict (fashion_style_id, role) do update set');
    expect(sql).toContain('on conflict (building_id, role) do update set');
    expect(sql).toMatch(/is distinct from/);
    // Lookups are insert-only, buildings are checked, never written.
    expect(sql).toContain("insert into public.biomes (slug, name) values\n  ('marine', 'Marine'),\n  ('taiga', 'Taiga')\non conflict (slug) do nothing;");
    expect(sql).toContain("raise exception 'macro-sync: buildings missing %");
    expect(sql).not.toMatch(/insert into public\.buildings/);
    // Columns the JSON doesn't hold are never written.
    for (const col of [/\bbody_plan\b/, /\bsprite_note\b/, /\blifespan\b/, /count_per_tier = excluded/, /culture_architecture_assignments/]) {
      expect(sql).not.toMatch(col);
    }
    // People names became slugs; the "Fae" row's nulls are typed.
    expect(sql).toContain("('coastborn', 'strandfolk', 0.9::numeric)");
    expect(sql).toContain("('fae', 'Fae', 'Details pending.', null::int");
    // No deletes of parent rows in a sync without removals.
    expect(sql).not.toMatch(/delete from public\.(ancestries|cultures|culture_traits|architecture_styles) where slug/);
  });

  it('Given the same JSON twice, then the SQL is byte-identical (so --verify can compare files)', () => {
    const a = entitiesFromFiles(fixture());
    const b = entitiesFromFiles(clone(fixture()));
    expect(generateSyncSql(a.entities, { biomes: a.biomes })).toBe(generateSyncSql(b.entities, { biomes: b.biomes }));
  });

  it('Given one culture edited, when diffed, then only that culture and its children are written', () => {
    const base = entitiesFromFiles(fixture());
    const f = fixture();
    cultures(f)[1].spacing = 1.3;
    const head = entitiesFromFiles(f);
    const diff = diffEntities(base.entities, head.entities);
    expect(describeDiff(diff)).toEqual(['culture: ~windfarer-eyrie']);
    const sql = generateSyncSql(head.entities, { only: diff, biomes: head.biomes });
    expect(sql).toContain("('windfarer-eyrie', 'Windfarer Eyrie', 1.3::numeric");
    expect(sql).not.toContain("('coastborn', 'Coastborn'");
    expect(sql).not.toContain('public.ancestries as t');
    expect(sql).not.toContain('public.biomes');
    // Its preferences and traits are made exactly the JSON's: others removed, these upserted.
    expect(sql).toContain("delete from public.culture_ancestry_preferences x\nusing public.cultures p, public.ancestries c\nwhere x.culture_id = p.id and x.ancestry_id = c.id and p.slug in ('windfarer-eyrie')");
  });

  it('Given no change, then the diff is empty and no SQL is written', () => {
    const a = entitiesFromFiles(fixture());
    const d = diffEntities(a.entities, entitiesFromFiles(fixture()).entities);
    expect(isEmptyDiff(d)).toBe(true);
    expect(generateSyncSql(a.entities, { only: d })).toBe('');
  });

  it('Given an ancestry removed from the JSON, then it refuses without --allow-delete and deletes only that slug with it', () => {
    const base = entitiesFromFiles(fixture());
    const f = fixture();
    (f.raceAffinities as { races: Rec[] }).races = races(f).filter(r => r.id !== 'fae');
    for (const c of cultures(f)) delete (c.racePreferences as Rec).Fae;
    cultures(f)[1].racePreferences = { Strandfolk: 1 };
    const head = entitiesFromFiles(f);
    const diff = diffEntities(base.entities, head.entities);
    expect(diff.ancestry.removed).toEqual(['fae']);
    expect(() => generateSyncSql(head.entities, { only: diff })).toThrow(/removes ancestry: fae.*--allow-delete/);
    const sql = generateSyncSql(head.entities, { only: diff, allowDelete: true });
    expect(sql).toContain("delete from public.ancestries where slug in ('fae');");
    expect(sql.match(/delete from public\.ancestries/g)).toHaveLength(1);
    // A full sync never deletes parents, whatever the database holds beyond the JSON.
    expect(generateSyncSql(head.entities)).not.toContain('delete from public.ancestries');
  });

  it('Given ambient archetypes (no building, so no unique key), then they are matched by role: update, then insert if missing', () => {
    const { entities } = entitiesFromFiles(fixture());
    const sql = generateSyncSql(entities);
    expect(sql).toContain('where t.is_ambient and t.building_id is null and t.role = v.role');
    expect(sql).toContain('where not exists (select 1 from public.population_archetypes t where t.is_ambient and t.building_id is null and t.role = v.role)');
    expect(sql).toContain(`'{"1":0,"2":[1,2]}'::jsonb`);
  });

  it('Given an architecture style, then its blocks are replaced only when the ordered list differs', () => {
    const { entities } = entitiesFromFiles(fixture());
    const sql = generateSyncSql(entities);
    expect(sql).toContain("('arch-5', 0, 'wall', 'Turf Wall', null::text)");
    expect(sql).toContain("('arch-5', 1, 'roof', 'Turf Roof', 'turf-roof')");
    expect(sql).toContain('is distinct from (\n    select coalesce(array_agg(row(w.sort_order');
  });
});

describe('macro-sync: the drift check (#1642)', () => {
  /** The fixture as the live tables would hold it, with uuids. */
  function liveRows(): Record<string, Rec[]> {
    const id = (s: string) => `id-${s}`;
    return {
      biomes: [{ id: id('marine'), slug: 'marine' }, { id: id('taiga'), slug: 'taiga' }],
      geographic_features: [{ id: id('coast'), slug: 'coast' }],
      culture_traits: [{ id: id('fire-centred'), slug: 'fire-centred', description: 'Life turns around the hearth.' }, { id: id('wind-oriented'), slug: 'wind-oriented', description: "Doors face the wind's lee." }],
      ancestries: [
        { id: id('strandfolk'), slug: 'strandfolk', name: 'Strandfolk', description: 'Harbour humans.', elevation_ideal_min: 0, elevation_ideal_max: 20, elevation_tol_min: 0, elevation_tol_max: 40, moisture_ideal_min: 40, moisture_ideal_max: 80, moisture_tol_min: 20, moisture_tol_max: 95, clustering: 'tight', population_weight: 0.4, mixing_behavior: 'welcoming', naming_base: 'norse-coast', body_plan: 'not in the JSON' },
        { id: id('fae'), slug: 'fae', name: 'Fae', description: 'Details pending.', elevation_ideal_min: null, elevation_ideal_max: null, elevation_tol_min: null, elevation_tol_max: null, moisture_ideal_min: null, moisture_ideal_max: null, moisture_tol_min: null, moisture_tol_max: null, clustering: null, population_weight: null, mixing_behavior: null, naming_base: null },
      ],
      ancestry_biome_affinities: [{ ancestry_id: id('strandfolk'), biome_id: id('marine'), score: 0.3 }, { ancestry_id: id('strandfolk'), biome_id: id('taiga'), score: -0.2 }],
      ancestry_feature_bonuses: [{ ancestry_id: id('strandfolk'), feature_id: id('coast'), bonus: 0.8 }],
      cultures: [
        { id: id('coastborn'), slug: 'coastborn', name: 'Coastborn', spacing: 0.85, organicness: 0.3, hierarchy_scale: 1.4, perimeter_awareness: 0.2, facing_bias: 'water', verticality: 0.2, preferred_shapes: ['longhouse', 'rectangular'], roof_style: 'thatch', street_pattern: 'linear' },
        { id: id('windfarer-eyrie'), slug: 'windfarer-eyrie', name: 'Windfarer Eyrie', spacing: 1.2, organicness: 0.7, hierarchy_scale: 1, perimeter_awareness: 0.1, facing_bias: 'wind', verticality: 0.9, preferred_shapes: ['round'], roof_style: 'dome', street_pattern: 'radial' },
      ],
      culture_ancestry_preferences: [
        { culture_id: id('coastborn'), ancestry_id: id('strandfolk'), weight: 0.9 }, { culture_id: id('coastborn'), ancestry_id: id('fae'), weight: 0.1 },
        { culture_id: id('windfarer-eyrie'), ancestry_id: id('fae'), weight: 1 },
      ],
      culture_trait_assignments: [
        { culture_id: id('coastborn'), trait_id: id('fire-centred') },
        { culture_id: id('windfarer-eyrie'), trait_id: id('wind-oriented') }, { culture_id: id('windfarer-eyrie'), trait_id: id('fire-centred') },
      ],
      culture_architecture_assignments: [],
      architecture_styles: [{ id: id('arch-5'), slug: 'arch-5', name: 'Turf Longhouse', primary_material: 'turf', construction_method: 'stacked', form_language: 'long', ground_relation: 'grounded', window_style: 'none', ornament_level: 'plain', structural_principle: 'timber frame', climate_response: 'insulated', description: "Grass on the roof, the hearth's smoke through it.", prompt_keywords: 'turf, longhouse', real_world_inspiration: 'Iceland' }],
      architecture_blocks: [
        { id: 'b2', style_id: id('arch-5'), block_type: 'roof', name: 'Turf Roof', sprite_key: 'turf-roof', sort_order: 1 },
        { id: 'b1', style_id: id('arch-5'), block_type: 'wall', name: 'Turf Wall', sprite_key: null, sort_order: 0 },
      ],
      fashion_styles: [{ id: id('f-coastborn'), culture_id: id('coastborn'), real_world_inspiration: 'Faroese', base_materials: ['wool'], base_palette: ['slate-grey'], base_motifs: [] }],
      fashion_variants: [
        { fashion_style_id: id('f-coastborn'), role: 'common', silhouette: 'layered', headwear: 'none', footwear: 'boots', accessories: ['rope belt'], notes: 'Knitted.' },
        { fashion_style_id: id('f-coastborn'), role: 'elder', silhouette: 'layered', headwear: 'storm hat', footwear: 'boots', accessories: null, notes: null },
      ],
      buildings: [{ id: id('campfire'), slug: 'campfire', name: 'Campfire' }],
      population_archetypes: [
        { building_id: id('campfire'), role: 'fire-keeper', name: 'Fire Keeper', fashion_variant: 'elder', count_min: 1, count_max: 1, sprite_notes: 'Seated.', animations: ['crouching'], is_ambient: false },
        { building_id: id('campfire'), role: 'listener', name: 'Listener', fashion_variant: 'common', count_min: 1, count_max: 3, sprite_notes: null, animations: [], is_ambient: false },
        { building_id: null, role: 'child', name: 'Child', fashion_variant: 'common', count_per_tier: { 1: 0, 2: [1, 2] }, sprite_notes: 'Running.', animations: ['jumping-1'], is_ambient: true },
      ],
    };
  }

  const clean = () => Object.fromEntries(Object.keys(compareEntities(entitiesFromFiles(fixture()).entities, entitiesFromFiles(fixture()).entities)).map(k => [k, { missingLive: [], differs: [], liveOnly: [] }]));

  it('Given live tables matching the JSON, then the check finds no drift (a null weight stays null, not 0)', () => {
    const live = entitiesFromFiles(exportFromRows(liveRows())).entities;
    expect(live.ancestry.fae.population_weight).toBeNull();
    expect(compareEntities(entitiesFromFiles(fixture()).entities, live)).toEqual(clean());
  });

  it('Given a changed value, a row missing live and a live-only row, then the check names each', () => {
    const rows = liveRows();
    (rows.cultures[1] as Rec).spacing = 0.5;
    rows.culture_traits.push({ id: 'id-extra', slug: 'extra', description: 'Only live.' });
    rows.fashion_styles = [];
    rows.fashion_variants = [];
    const report = compareEntities(entitiesFromFiles(fixture()).entities, entitiesFromFiles(exportFromRows(rows)).entities);
    expect(report.culture.differs).toEqual(['windfarer-eyrie']);
    expect(report.trait.liveOnly).toEqual(['extra']);
    expect(report.fashion.missingLive).toEqual(['coastborn']);
  });

  it('Given Postgres numerics, then equality is by value', () => {
    expect(sameValue(0.5, 0.5)).toBe(true);
    expect(sameValue({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
    expect(sameValue(null, 0)).toBe(false);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
  });

  it('Given the dump query, then it reads every table the check needs and writes nothing', () => {
    const q = liveDumpQuery();
    for (const t of LIVE_TABLES) expect(q).toContain(`from public.${t} x`);
    expect(q).not.toMatch(/\b(insert|update|delete|alter|drop)\b/i);
  });
});
