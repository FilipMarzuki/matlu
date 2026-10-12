/**
 * Macro-world sync: the pure half (#1642, the sync half of #1640).
 *
 * The repo's macro-world JSON is master canon (owner, 2026-10-12). Supabase is generated from it:
 * a change to the JSON becomes a migration file in supabase/migrations/, merged by PR and applied
 * after the merge. This module holds everything that doesn't touch the network or the disk, so the
 * JSON → SQL step can be unit-tested on fixtures (src/macro-sync.test.ts):
 *
 *   exportFromRows(rows)       live table rows → the JSON files' shapes (what macro:export always wrote)
 *   entitiesFromFiles(files)   the JSON files → one flat entity per row group, keyed by slug
 *   diffEntities(base, head)   which entities a change adds, changes and removes
 *   generateSyncSql(...)       those entities → an idempotent migration
 *   compareEntities(...)       drift between the repo and the live database (the check)
 *
 * The table and column mapping is scripts/export-macro-world.mjs's, in reverse. Only columns the
 * JSON carries are written: anything else on a row (ancestry body and sprite columns, biome names,
 * culture → architecture assignments, buildings) is left as it is, because the JSON doesn't hold it.
 */

// ---------------------------------------------------------------------------
// The files
// ---------------------------------------------------------------------------

/** The master files, relative to the repo root, by key. */
export const MACRO_FILES = {
  raceAffinities: 'macro-world/race-affinities.json',
  cultures: 'macro-world/cultures.json',
  cultureTraits: 'macro-world/culture-traits.json',
  fashion: 'macro-world/fashion.json',
  populationArchetypes: 'macro-world/population-archetypes.json',
  architecture: 'public/macro-world/architecture.json',
};

/** The `_doc` line each master file carries. */
export const MASTER_DOC =
  'Master canon (#1642): edit this file by PR. Supabase is generated from it: run npm run macro:sync to write the migration.';

// ---------------------------------------------------------------------------
// Live rows → JSON shapes (moved from export-macro-world.mjs)
// ---------------------------------------------------------------------------

/**
 * Postgres numeric → JSON number, keeping null as null. The old export used Number(), which
 * turned a null population_weight into 0, so the JSON said 0 where the database said nothing.
 */
const num = v => (v === null || v === undefined ? null : Number(v));

/**
 * Build the JSON files' contents from the live tables' rows.
 * `rows` holds one array per table, under the table's name.
 * Returns the six master files plus `buildingRegistry` (G3: buildings have no settled master yet).
 */
export function exportFromRows(rows, doc = MASTER_DOC) {
  const {
    ancestries, biomes, geographic_features: features, culture_traits: traits, cultures,
    architecture_styles: archStyles, architecture_blocks: archBlocks,
    fashion_styles: fashionStyles, fashion_variants: fashionVariants,
    buildings, population_archetypes: popArchetypes,
    ancestry_biome_affinities: biomeAffs, ancestry_feature_bonuses: featureBons,
    culture_ancestry_preferences: culturePref, culture_trait_assignments: traitAssign,
  } = rows;

  const biomeById = Object.fromEntries(biomes.map(b => [b.id, b.slug]));
  const featureById = Object.fromEntries(features.map(f => [f.id, f.slug]));
  const traitById = Object.fromEntries(traits.map(t => [t.id, t.slug]));
  const ancestryById = Object.fromEntries(ancestries.map(a => [a.id, a]));
  const cultureById = Object.fromEntries(cultures.map(c => [c.id, c]));
  const buildingById = Object.fromEntries(buildings.map(b => [b.id, b]));

  const raceAffinities = {
    _doc: doc,
    _biomes: biomes.map(b => b.slug),
    races: ancestries.map(a => {
      const biomeAffinity = {};
      for (const ba of biomeAffs.filter(x => x.ancestry_id === a.id)) {
        biomeAffinity[biomeById[ba.biome_id]] = Number(ba.score);
      }
      const featureBonus = {};
      for (const fb of featureBons.filter(x => x.ancestry_id === a.id)) {
        featureBonus[featureById[fb.feature_id]] = Number(fb.bonus);
      }
      return {
        id: a.slug,
        name: a.name,
        description: a.description,
        biomeAffinity,
        elevationAffinity: {
          ideal: [a.elevation_ideal_min, a.elevation_ideal_max],
          tolerance: [a.elevation_tol_min, a.elevation_tol_max],
        },
        moistureAffinity: {
          ideal: [a.moisture_ideal_min, a.moisture_ideal_max],
          tolerance: [a.moisture_tol_min, a.moisture_tol_max],
        },
        featureBonus,
        clustering: a.clustering,
        populationWeight: num(a.population_weight),
        mixingBehavior: a.mixing_behavior,
        namingBase: a.naming_base,
      };
    }),
  };

  const culturesOut = {
    _doc: doc,
    cultures: cultures.map(c => {
      const racePreferences = {};
      for (const cp of culturePref.filter(x => x.culture_id === c.id)) {
        const anc = ancestryById[cp.ancestry_id];
        if (anc) racePreferences[anc.name] = Number(cp.weight);
      }
      const traitSlugs = traitAssign
        .filter(x => x.culture_id === c.id)
        .map(x => traitById[x.trait_id])
        .filter(Boolean);
      return {
        id: c.slug,
        name: c.name,
        racePreferences,
        spacing: num(c.spacing),
        organicness: num(c.organicness),
        hierarchyScale: num(c.hierarchy_scale),
        perimeterAwareness: num(c.perimeter_awareness),
        facingBias: c.facing_bias,
        verticality: num(c.verticality),
        preferredShapes: c.preferred_shapes,
        roofStyle: c.roof_style,
        streetPattern: c.street_pattern,
        traits: traitSlugs,
      };
    }),
  };

  const traitsOut = { _doc: doc };
  for (const t of traits) traitsOut[t.slug] = t.description;

  const archOut = {
    _doc: doc,
    styles: archStyles.map(s => {
      const blocks = archBlocks
        .filter(b => b.style_id === s.id)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map(b => {
          const out = { type: b.block_type, name: b.name };
          if (b.sprite_key) out.sprite = b.sprite_key;
          return out;
        });
      return {
        id: s.slug.toUpperCase(),
        name: s.name,
        primaryMaterial: s.primary_material,
        constructionMethod: s.construction_method,
        formLanguage: s.form_language,
        groundRelation: s.ground_relation,
        windowStyle: s.window_style,
        ornamentLevel: s.ornament_level,
        structuralPrinciple: s.structural_principle,
        climateResponse: s.climate_response,
        description: s.description,
        promptKeywords: s.prompt_keywords,
        realWorldInspiration: s.real_world_inspiration,
        blocks,
      };
    }),
  };

  const fashionOut = {
    _doc: doc,
    fashions: fashionStyles.map(f => {
      const culture = cultureById[f.culture_id];
      const variants = fashionVariants
        .filter(v => v.fashion_style_id === f.id)
        .map(v => ({
          role: v.role,
          silhouette: v.silhouette,
          headwear: v.headwear,
          footwear: v.footwear,
          accessories: v.accessories ?? [],
          notes: v.notes,
        }));
      return {
        cultureId: culture?.slug ?? f.culture_id,
        realWorldFashionInspiration: f.real_world_inspiration,
        base: {
          materials: f.base_materials ?? [],
          palette: f.base_palette ?? [],
          motifs: f.base_motifs ?? [],
        },
        variants,
      };
    }),
  };

  const buildingRegistry = {
    _doc: 'Exported from Supabase. Do not edit — run npm run macro:export to regenerate.',
    buildings: buildings.map(b => {
      const out = {
        id: b.slug,
        name: b.name,
        role: b.role,
        category: b.category,
        minTier: b.min_tier,
        zone: b.zone,
        baseSizeRange: [b.base_size_min, b.base_size_max],
        heightHint: b.height_hint,
        unlockConditions: b.unlock_conditions ?? {},
        count: b.count ?? {},
        placementHints: b.placement_hints ?? [],
        loreHook: b.lore_hook,
      };
      if (b.base_depth_min != null) out.baseDepthRange = [b.base_depth_min, b.base_depth_max];
      return out;
    }),
  };

  const buildingArchetypes = [];
  const buildingGroups = {};
  for (const pa of popArchetypes.filter(a => !a.is_ambient)) {
    const bSlug = pa.building_id ? buildingById[pa.building_id]?.slug : null;
    if (!bSlug) continue;
    if (!buildingGroups[bSlug]) buildingGroups[bSlug] = [];
    buildingGroups[bSlug].push(pa);
  }
  for (const [bSlug, archetypes] of Object.entries(buildingGroups)) {
    buildingArchetypes.push({
      buildingId: bSlug,
      archetypes: archetypes.map(a => {
        const out = {
          role: a.role,
          name: a.name,
          fashionVariant: a.fashion_variant,
          count: a.count_min === a.count_max ? a.count_min : [a.count_min, a.count_max],
          spriteNotes: a.sprite_notes,
        };
        if (a.animations?.length) out.animations = a.animations;
        return out;
      }),
    });
  }
  const ambientArchetypes = popArchetypes
    .filter(a => a.is_ambient)
    .map(a => ({
      role: a.role,
      name: a.name,
      fashionVariant: a.fashion_variant,
      countPerTier: a.count_per_tier,
      spriteNotes: a.sprite_notes,
      animations: a.animations ?? [],
    }));

  return {
    raceAffinities,
    cultures: culturesOut,
    cultureTraits: traitsOut,
    architecture: archOut,
    fashion: fashionOut,
    populationArchetypes: { _doc: doc, buildingArchetypes, ambientArchetypes },
    buildingRegistry,
  };
}

// ---------------------------------------------------------------------------
// JSON files → entities
// ---------------------------------------------------------------------------

/**
 * The entity kinds, in the order a migration writes them (parents before children, so every
 * lookup by slug finds its row). Each entity is one row plus the child rows it owns.
 */
export const KINDS = ['trait', 'ancestry', 'culture', 'architecture', 'fashion', 'archetypes'];

const nullish = v => (v === undefined ? null : v);

/**
 * Flatten the six files into entities: `{ kind: { key: entity } }`. Throws when a file refers to
 * something it can't resolve (a People name no ancestry has, a duplicate slug), because a silent
 * skip would drop canon from the database.
 */
export function entitiesFromFiles(files) {
  const out = Object.fromEntries(KINDS.map(k => [k, {}]));
  const put = (kind, key, value) => {
    if (out[kind][key]) throw new Error(`duplicate ${kind} "${key}"`);
    out[kind][key] = value;
  };

  // culture-traits.json: slug → description
  for (const [slug, description] of Object.entries(files.cultureTraits ?? {})) {
    if (slug.startsWith('_')) continue;
    put('trait', slug, { slug, description });
  }

  // race-affinities.json: one ancestry each, with its biome and feature scores
  const nameToAncestry = {};
  const ra = files.raceAffinities ?? { races: [] };
  const biomes = ra._biomes ?? [];
  for (const r of ra.races ?? []) {
    if (nameToAncestry[r.name]) {
      throw new Error(`two ancestries are named "${r.name}" (${nameToAncestry[r.name]}, ${r.id}); cultures.json can't tell them apart`);
    }
    nameToAncestry[r.name] = r.id;
    put('ancestry', r.id, {
      slug: r.id,
      name: r.name,
      description: nullish(r.description),
      elevation_ideal_min: nullish(r.elevationAffinity?.ideal?.[0]),
      elevation_ideal_max: nullish(r.elevationAffinity?.ideal?.[1]),
      elevation_tol_min: nullish(r.elevationAffinity?.tolerance?.[0]),
      elevation_tol_max: nullish(r.elevationAffinity?.tolerance?.[1]),
      moisture_ideal_min: nullish(r.moistureAffinity?.ideal?.[0]),
      moisture_ideal_max: nullish(r.moistureAffinity?.ideal?.[1]),
      moisture_tol_min: nullish(r.moistureAffinity?.tolerance?.[0]),
      moisture_tol_max: nullish(r.moistureAffinity?.tolerance?.[1]),
      clustering: nullish(r.clustering),
      population_weight: nullish(r.populationWeight),
      mixing_behavior: nullish(r.mixingBehavior),
      naming_base: nullish(r.namingBase),
      biomes: { ...(r.biomeAffinity ?? {}) },
      features: { ...(r.featureBonus ?? {}) },
    });
  }

  // cultures.json: layout columns, People weights (by People name → ancestry slug), traits
  for (const c of files.cultures?.cultures ?? []) {
    const preferences = {};
    for (const [people, weight] of Object.entries(c.racePreferences ?? {})) {
      const slug = nameToAncestry[people];
      if (!slug) throw new Error(`culture "${c.id}" prefers "${people}", which no ancestry in race-affinities.json is named`);
      preferences[slug] = weight;
    }
    for (const t of c.traits ?? []) {
      if (!out.trait[t]) throw new Error(`culture "${c.id}" has trait "${t}", which culture-traits.json doesn't define`);
    }
    put('culture', c.id, {
      slug: c.id,
      name: c.name,
      spacing: nullish(c.spacing),
      organicness: nullish(c.organicness),
      hierarchy_scale: nullish(c.hierarchyScale),
      perimeter_awareness: nullish(c.perimeterAwareness),
      facing_bias: nullish(c.facingBias),
      verticality: nullish(c.verticality),
      preferred_shapes: nullish(c.preferredShapes),
      roof_style: nullish(c.roofStyle),
      street_pattern: nullish(c.streetPattern),
      preferences,
      traits: [...(c.traits ?? [])].sort(),
    });
  }

  // architecture.json: the export upper-cases the slug ("arch-1" → "ARCH-1")
  for (const s of files.architecture?.styles ?? []) {
    const slug = s.id.toLowerCase();
    put('architecture', slug, {
      slug,
      name: s.name,
      primary_material: nullish(s.primaryMaterial),
      construction_method: nullish(s.constructionMethod),
      form_language: nullish(s.formLanguage),
      ground_relation: nullish(s.groundRelation),
      window_style: nullish(s.windowStyle),
      ornament_level: nullish(s.ornamentLevel),
      structural_principle: nullish(s.structuralPrinciple),
      climate_response: nullish(s.climateResponse),
      description: nullish(s.description),
      prompt_keywords: nullish(s.promptKeywords),
      real_world_inspiration: nullish(s.realWorldInspiration),
      // Order is the block's sort_order, so it's part of the data.
      blocks: (s.blocks ?? []).map((b, i) => ({
        block_type: b.type, name: b.name, sprite_key: b.sprite || null, sort_order: i,
      })),
    });
  }

  // fashion.json: one style per culture, variants keyed by role
  for (const f of files.fashion?.fashions ?? []) {
    if (!out.culture[f.cultureId]) throw new Error(`fashion for "${f.cultureId}", which cultures.json doesn't have`);
    const variants = {};
    for (const v of f.variants ?? []) {
      if (variants[v.role]) throw new Error(`fashion "${f.cultureId}" has two "${v.role}" variants`);
      variants[v.role] = {
        role: v.role,
        silhouette: v.silhouette || null,
        headwear: v.headwear || null,
        footwear: v.footwear || null,
        accessories: v.accessories ?? [],
        notes: v.notes || null,
      };
    }
    put('fashion', f.cultureId, {
      culture: f.cultureId,
      real_world_inspiration: nullish(f.realWorldFashionInspiration),
      base_materials: f.base?.materials ?? [],
      base_palette: f.base?.palette ?? [],
      base_motifs: f.base?.motifs ?? [],
      variants,
    });
  }

  // population-archetypes.json: one entity per building (archetypes keyed by role), plus the
  // ambient ones (no building) as one entity. Buildings themselves aren't synced (G3).
  const pa = files.populationArchetypes ?? {};
  for (const g of pa.buildingArchetypes ?? []) {
    const roles = {};
    for (const a of g.archetypes ?? []) {
      if (roles[a.role]) throw new Error(`building "${g.buildingId}" has two "${a.role}" archetypes`);
      const [min, max] = Array.isArray(a.count) ? a.count : [a.count ?? 1, a.count ?? 1];
      roles[a.role] = {
        role: a.role,
        name: a.name,
        fashion_variant: nullish(a.fashionVariant),
        count_min: min,
        count_max: max,
        sprite_notes: nullish(a.spriteNotes),
        // The export leaves `animations` out when there are none.
        animations: a.animations?.length ? a.animations : null,
      };
    }
    put('archetypes', g.buildingId, { building: g.buildingId, roles });
  }
  if (pa.ambientArchetypes) {
    const roles = {};
    for (const a of pa.ambientArchetypes) {
      if (roles[a.role]) throw new Error(`two ambient "${a.role}" archetypes`);
      roles[a.role] = {
        role: a.role,
        name: a.name,
        fashion_variant: nullish(a.fashionVariant),
        count_per_tier: nullish(a.countPerTier),
        sprite_notes: nullish(a.spriteNotes),
        animations: a.animations ?? [],
      };
    }
    put('archetypes', AMBIENT, { building: null, roles });
  }

  return { entities: out, biomes };
}

/** The key the ambient archetypes go under (no building slug can contain a space). */
export const AMBIENT = '(ambient)';

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/** Deep equality on plain JSON values; numbers by value, so 0.5 from Postgres numeric matches. */
export function sameValue(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return typeof a === 'number' || typeof b === 'number' ? Number(a) === Number(b) && a !== null && b !== null : false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && sameValue(a[k], b[k]));
}

/**
 * Compare two entity sets: `{ kind: { added: [key], changed: [key], removed: [key] } }`, keys sorted.
 */
export function diffEntities(base, head) {
  const out = {};
  for (const kind of KINDS) {
    const b = base[kind] ?? {}, h = head[kind] ?? {};
    out[kind] = {
      added: Object.keys(h).filter(k => !(k in b)).sort(),
      changed: Object.keys(h).filter(k => k in b && !sameValue(b[k], h[k])).sort(),
      removed: Object.keys(b).filter(k => !(k in h)).sort(),
    };
  }
  return out;
}

/** True when a diff holds nothing. */
export function isEmptyDiff(diff) {
  return KINDS.every(k => !diff[k].added.length && !diff[k].changed.length && !diff[k].removed.length);
}

/** Compare the live database (as entities) with the repo's: what the repo has that the DB lacks, etc. */
export function compareEntities(repo, live) {
  const d = diffEntities(live, repo);
  // Phrase it from the repo's side: "added" = in the repo, missing live; "removed" = live only.
  return Object.fromEntries(KINDS.map(k => [k, { missingLive: d[k].added, differs: d[k].changed, liveOnly: d[k].removed }]));
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

/** A SQL literal for a value of a given column type. Nulls carry their type so VALUES lists resolve. */
export function lit(value, type) {
  if (value === null || value === undefined) return `null::${type}`;
  switch (type) {
    case 'text':
      return `'${String(value).replace(/'/g, "''")}'`;
    case 'numeric':
    case 'int': {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`not a number: ${JSON.stringify(value)}`);
      if (type === 'int' && !Number.isInteger(n)) throw new Error(`not an integer: ${value}`);
      return type === 'int' ? String(n) : `${n}::numeric`;
    }
    case 'text[]':
      if (!Array.isArray(value)) throw new Error(`not an array: ${JSON.stringify(value)}`);
      return value.length ? `array[${value.map(v => lit(v, 'text')).join(', ')}]::text[]` : `'{}'::text[]`;
    case 'jsonb':
      return `${lit(JSON.stringify(value), 'text')}::jsonb`;
    case 'boolean':
      return value ? 'true' : 'false';
    default:
      throw new Error(`unknown type ${type}`);
  }
}

const ANCESTRY_COLS = [
  ['name', 'text'], ['description', 'text'],
  ['elevation_ideal_min', 'int'], ['elevation_ideal_max', 'int'], ['elevation_tol_min', 'int'], ['elevation_tol_max', 'int'],
  ['moisture_ideal_min', 'int'], ['moisture_ideal_max', 'int'], ['moisture_tol_min', 'int'], ['moisture_tol_max', 'int'],
  ['clustering', 'text'], ['population_weight', 'numeric'], ['mixing_behavior', 'text'], ['naming_base', 'text'],
];
const CULTURE_COLS = [
  ['name', 'text'], ['spacing', 'numeric'], ['organicness', 'numeric'], ['hierarchy_scale', 'numeric'],
  ['perimeter_awareness', 'numeric'], ['facing_bias', 'text'], ['verticality', 'numeric'],
  ['preferred_shapes', 'text[]'], ['roof_style', 'text'], ['street_pattern', 'text'],
];
const ARCH_COLS = [
  ['name', 'text'], ['primary_material', 'text'], ['construction_method', 'text'], ['form_language', 'text'],
  ['ground_relation', 'text'], ['window_style', 'text'], ['ornament_level', 'text'], ['structural_principle', 'text'],
  ['climate_response', 'text'], ['description', 'text'], ['prompt_keywords', 'text'], ['real_world_inspiration', 'text'],
];
const FASHION_COLS = [['real_world_inspiration', 'text'], ['base_materials', 'text[]'], ['base_palette', 'text[]'], ['base_motifs', 'text[]']];
const VARIANT_COLS = [['silhouette', 'text'], ['headwear', 'text'], ['footwear', 'text'], ['accessories', 'text[]'], ['notes', 'text']];
const ARCHETYPE_COLS = [['name', 'text'], ['fashion_variant', 'text'], ['count_min', 'int'], ['count_max', 'int'], ['sprite_notes', 'text'], ['animations', 'text[]']];
const AMBIENT_COLS = [['name', 'text'], ['fashion_variant', 'text'], ['count_per_tier', 'jsonb'], ['sprite_notes', 'text'], ['animations', 'text[]']];

/** "Title Case" from a slug, the way the seed script named biomes and features. */
const titleFromSlug = s => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const tuple = (cells) => `(${cells.join(', ')})`;
const valuesBlock = (rows) => rows.map(r => `  ${tuple(r)}`).join(',\n');

/**
 * Upsert rows keyed by slug. Only updates a row when one of the synced columns differs, so a
 * re-run writes nothing.
 */
function upsertBySlug(table, cols, entities) {
  if (!entities.length) return '';
  const names = ['slug', ...cols.map(c => c[0])];
  const rows = entities.map(e => [lit(e.slug, 'text'), ...cols.map(([c, t]) => lit(e[c], t))]);
  const set = cols.map(([c]) => `${c} = excluded.${c}`).join(',\n  ');
  const distinct = `(${cols.map(([c]) => `t.${c}`).join(', ')}) is distinct from (${cols.map(([c]) => `excluded.${c}`).join(', ')})`;
  return `insert into public.${table} as t (${names.join(', ')}) values\n${valuesBlock(rows)}\non conflict (slug) do update set\n  ${set}\nwhere ${distinct};\n`;
}

/**
 * Make a parent's child rows exactly the given set: delete the parent's children not in the set,
 * then upsert the set. `parents` limits it to the entities this migration touches, so a child
 * table's rows under other parents are never read or changed.
 */
function syncChildren({ table, parentTable, parentFk, parentKey = 'slug', parents, childTable, childFk, rows, cols }) {
  if (!parents.length) return '';
  const parentList = parents.map(p => lit(p, 'text')).join(', ');
  const vNames = ['parent_slug', 'child_slug', ...cols.map(c => c[0])];
  let sql = '';
  // Delete children of these parents that the JSON no longer lists.
  if (rows.length) {
    sql += `delete from public.${table} x\nusing public.${parentTable} p, public.${childTable} c\n` +
      `where x.${parentFk} = p.id and x.${childFk} = c.id and p.${parentKey} in (${parentList})\n` +
      `  and (p.${parentKey}, c.slug) not in (values\n${valuesBlock(rows.map(r => [lit(r.parent, 'text'), lit(r.child, 'text')]))}\n  );\n`;
  } else {
    sql += `delete from public.${table} x\nusing public.${parentTable} p\nwhere x.${parentFk} = p.id and p.${parentKey} in (${parentList});\n`;
  }
  if (!rows.length) return sql;
  const values = rows.map(r => [lit(r.parent, 'text'), lit(r.child, 'text'), ...cols.map(([c, t]) => lit(r[c], t))]);
  const set = cols.map(([c]) => `${c} = excluded.${c}`).join(', ');
  const distinct = cols.length
    ? `\nwhere (${cols.map(([c]) => `t.${c}`).join(', ')}) is distinct from (${cols.map(([c]) => `excluded.${c}`).join(', ')})`
    : '';
  sql += `insert into public.${table} as t (${parentFk}, ${childFk}${cols.map(c => `, ${c[0]}`).join('')})\n` +
    `select p.id, c.id${cols.map(([c]) => `, v.${c}`).join('')}\nfrom (values\n${valuesBlock(values)}\n) as v(${vNames.join(', ')})\n` +
    `join public.${parentTable} p on p.${parentKey} = v.parent_slug\njoin public.${childTable} c on c.slug = v.child_slug\n` +
    `on conflict (${parentFk}, ${childFk}) do ${cols.length ? `update set ${set}${distinct}` : 'nothing'};\n`;
  return sql;
}

/**
 * Raise inside the migration when a slug it relies on isn't in the database, instead of letting a
 * join drop the row without a word.
 */
function assertSlugsExist(table, slugs, why) {
  if (!slugs.length) return '';
  const list = valuesBlock(slugs.map(s => [lit(s, 'text')]));
  return `do $$\ndeclare missing text;\nbegin\n  select string_agg(v.slug, ', ') into missing\n  from (values\n${list.replace(/^/gm, '  ')}\n  ) as v(slug)\n` +
    `  where not exists (select 1 from public.${table} r where r.slug = v.slug);\n` +
    `  if missing is not null then\n    raise exception 'macro-sync: ${table} missing %: ${why.replace(/'/g, "''")}', missing;\n  end if;\nend $$;\n`;
}

/**
 * Write the migration that brings the database to the head entities.
 *
 * - `only`: a diff (from diffEntities). Entities it adds or changes are written in full (the row and
 *   all its children); others aren't touched. Without it, every entity is written (a full sync).
 * - Removed entities are deleted only with `allowDelete`, by slug, and only those the diff names:
 *   rows the JSON never had are never deleted. Without `allowDelete`, removals throw, naming them.
 * - `biomes`: race-affinities.json's `_biomes`; lookup rows missing from the DB are added (never
 *   deleted or renamed: their names aren't in the JSON).
 *
 * Every statement is an upsert guarded by `is distinct from`, a delete by key, or a check, so the
 * migration can run twice and the second run changes nothing.
 */
export function generateSyncSql(head, { only = null, allowDelete = false, biomes = [], header = [] } = {}) {
  const pick = kind => {
    const keys = only ? [...only[kind].added, ...only[kind].changed] : Object.keys(head[kind]).sort();
    return keys.map(k => head[kind][k]);
  };
  const removed = only ? Object.fromEntries(KINDS.map(k => [k, only[k].removed])) : Object.fromEntries(KINDS.map(k => [k, []]));
  const removedAny = KINDS.some(k => removed[k].length);
  if (removedAny && !allowDelete) {
    const list = KINDS.filter(k => removed[k].length).map(k => `${k}: ${removed[k].join(', ')}`).join('; ');
    throw new Error(`the JSON removes ${list}. Deleting cascades to rows the JSON doesn't hold (see docs/canon.md); re-run with --allow-delete if that's meant`);
  }

  const traits = pick('trait');
  const ancestries = pick('ancestry');
  const cultures = pick('culture');
  const archs = pick('architecture');
  const fashions = pick('fashion');
  const archetypes = pick('archetypes');

  const parts = [];
  const section = (title, sql) => { if (sql) parts.push(`-- ${title}\n${sql}`); };

  // Lookup rows: biomes from _biomes, features from any featureBonus key. Insert-only.
  const featureSlugs = [...new Set(ancestries.flatMap(a => Object.keys(a.features)))].sort();
  const biomeSlugs = ancestries.length || !only
    ? [...new Set([...biomes, ...ancestries.flatMap(a => Object.keys(a.biomes))])].sort()
    : [];
  const lookup = (table, slugs) => slugs.length
    ? `insert into public.${table} (slug, name) values\n${valuesBlock(slugs.map(s => [lit(s, 'text'), lit(titleFromSlug(s), 'text')]))}\non conflict (slug) do nothing;\n`
    : '';
  section('Biomes and geographic features the ancestries score (added if missing; names aren\'t synced)', lookup('biomes', biomeSlugs) + lookup('geographic_features', featureSlugs));

  section('Culture traits (culture-traits.json)', upsertBySlug('culture_traits', [['description', 'text']], traits));

  section('Ancestries (race-affinities.json). Only these columns: body and sprite columns aren\'t in the JSON and stay as they are',
    upsertBySlug('ancestries', ANCESTRY_COLS, ancestries));
  section('Ancestry biome affinities', syncChildren({
    table: 'ancestry_biome_affinities', parentTable: 'ancestries', parentFk: 'ancestry_id', parents: ancestries.map(a => a.slug),
    childTable: 'biomes', childFk: 'biome_id', cols: [['score', 'numeric']],
    rows: ancestries.flatMap(a => Object.entries(a.biomes).sort().map(([child, score]) => ({ parent: a.slug, child, score }))),
  }));
  section('Ancestry feature bonuses', syncChildren({
    table: 'ancestry_feature_bonuses', parentTable: 'ancestries', parentFk: 'ancestry_id', parents: ancestries.map(a => a.slug),
    childTable: 'geographic_features', childFk: 'feature_id', cols: [['bonus', 'numeric']],
    rows: ancestries.flatMap(a => Object.entries(a.features).sort().map(([child, bonus]) => ({ parent: a.slug, child, bonus }))),
  }));

  section('Cultures (cultures.json)', upsertBySlug('cultures', CULTURE_COLS, cultures));
  const prefAncestries = [...new Set(cultures.flatMap(c => Object.keys(c.preferences)))].sort();
  section('Every ancestry the cultures prefer must exist', assertSlugsExist('ancestries', prefAncestries, 'cultures.json prefers a People whose ancestry is not in the database'));
  section('Culture → ancestry preferences (racePreferences, by People name → ancestry slug)', syncChildren({
    table: 'culture_ancestry_preferences', parentTable: 'cultures', parentFk: 'culture_id', parents: cultures.map(c => c.slug),
    childTable: 'ancestries', childFk: 'ancestry_id', cols: [['weight', 'numeric']],
    rows: cultures.flatMap(c => Object.entries(c.preferences).sort().map(([child, weight]) => ({ parent: c.slug, child, weight }))),
  }));
  const traitRefs = [...new Set(cultures.flatMap(c => c.traits))].sort();
  section('Every trait the cultures use must exist', assertSlugsExist('culture_traits', traitRefs, 'cultures.json uses a trait the database lacks'));
  section('Culture → trait assignments', syncChildren({
    table: 'culture_trait_assignments', parentTable: 'cultures', parentFk: 'culture_id', parents: cultures.map(c => c.slug),
    childTable: 'culture_traits', childFk: 'trait_id', cols: [],
    rows: cultures.flatMap(c => c.traits.map(child => ({ parent: c.slug, child }))),
  }));

  section('Architecture styles (public/macro-world/architecture.json)', upsertBySlug('architecture_styles', ARCH_COLS, archs));
  if (archs.length) {
    // Blocks have no natural key; the JSON's order is their sort_order. Replace each style's
    // blocks only when they differ, so a re-run (or an unchanged style) keeps its rows and ids.
    const vals = archs.flatMap(s => s.blocks.map(b => [lit(s.slug, 'text'), lit(b.sort_order, 'int'), lit(b.block_type, 'text'), lit(b.name, 'text'), lit(b.sprite_key, 'text')]));
    const styleList = archs.map(s => lit(s.slug, 'text')).join(', ');
    const want = vals.length
      ? `with want as (\n  select * from (values\n${valuesBlock(vals).replace(/^/gm, '  ')}\n  ) as v(style_slug, sort_order, block_type, name, sprite_key)\n)`
      : `with want as (\n  select null::text as style_slug, null::int as sort_order, null::text as block_type, null::text as name, null::text as sprite_key where false\n)`;
    const sql =
      `create temporary table macro_sync_blocks on commit drop as\n${want}\nselect * from want;\n` +
      `-- Styles whose blocks already match (same type, name, sprite, order) are left alone.\n` +
      `create temporary table macro_sync_block_styles on commit drop as\n` +
      `select s.id, s.slug from public.architecture_styles s\nwhere s.slug in (${styleList})\n` +
      `  and (\n    select coalesce(array_agg(row(b.sort_order, b.block_type, b.name, b.sprite_key)::text order by b.sort_order, b.block_type, b.name), '{}')\n    from public.architecture_blocks b where b.style_id = s.id\n  ) is distinct from (\n` +
      `    select coalesce(array_agg(row(w.sort_order, w.block_type, w.name, w.sprite_key)::text order by w.sort_order, w.block_type, w.name), '{}')\n    from macro_sync_blocks w where w.style_slug = s.slug\n  );\n` +
      `delete from public.architecture_blocks b using macro_sync_block_styles s where b.style_id = s.id;\n` +
      `insert into public.architecture_blocks (style_id, block_type, name, sprite_key, sort_order)\n` +
      `select s.id, w.block_type, w.name, w.sprite_key, w.sort_order\nfrom macro_sync_blocks w join macro_sync_block_styles s on s.slug = w.style_slug\norder by s.slug, w.sort_order;\n`;
    section('Architecture blocks (each style\'s list, in order)', sql);
  }

  if (fashions.length) {
    const vals = fashions.map(f => [lit(f.culture, 'text'), ...FASHION_COLS.map(([c, t]) => lit(f[c], t))]);
    const names = FASHION_COLS.map(c => c[0]);
    section('Fashion styles (fashion.json), one per culture',
      `insert into public.fashion_styles as t (culture_id, ${names.join(', ')})\n` +
      `select c.id, ${names.map(n => `v.${n}`).join(', ')}\nfrom (values\n${valuesBlock(vals)}\n) as v(culture_slug, ${names.join(', ')})\n` +
      `join public.cultures c on c.slug = v.culture_slug\n` +
      `on conflict (culture_id) do update set ${names.map(n => `${n} = excluded.${n}`).join(', ')}\n` +
      `where (${names.map(n => `t.${n}`).join(', ')}) is distinct from (${names.map(n => `excluded.${n}`).join(', ')});\n`);
    const vrows = fashions.flatMap(f => Object.values(f.variants).sort((a, b) => a.role.localeCompare(b.role))
      .map(v => [lit(f.culture, 'text'), lit(v.role, 'text'), ...VARIANT_COLS.map(([c, t]) => lit(v[c], t))]));
    const vnames = VARIANT_COLS.map(c => c[0]);
    const cultureList = fashions.map(f => lit(f.culture, 'text')).join(', ');
    let vsql = `delete from public.fashion_variants x\nusing public.fashion_styles s, public.cultures c\n` +
      `where x.fashion_style_id = s.id and s.culture_id = c.id and c.slug in (${cultureList})`;
    vsql += vrows.length
      ? `\n  and (c.slug, x.role) not in (values\n${valuesBlock(vrows.map(r => r.slice(0, 2)))}\n  );\n`
      : ';\n';
    if (vrows.length) {
      vsql += `insert into public.fashion_variants as t (fashion_style_id, role, ${vnames.join(', ')})\n` +
        `select s.id, v.role, ${vnames.map(n => `v.${n}`).join(', ')}\nfrom (values\n${valuesBlock(vrows)}\n) as v(culture_slug, role, ${vnames.join(', ')})\n` +
        `join public.cultures c on c.slug = v.culture_slug\njoin public.fashion_styles s on s.culture_id = c.id\n` +
        `on conflict (fashion_style_id, role) do update set ${vnames.map(n => `${n} = excluded.${n}`).join(', ')}\n` +
        `where (${vnames.map(n => `t.${n}`).join(', ')}) is distinct from (${vnames.map(n => `excluded.${n}`).join(', ')});\n`;
    }
    section('Fashion variants (by culture and role)', vsql);
  }

  const buildingGroups = archetypes.filter(g => g.building !== null);
  const ambient = archetypes.find(g => g.building === null);
  if (buildingGroups.length) {
    const bList = buildingGroups.map(g => g.building).sort();
    section('Every building the archetypes work in must exist (buildings aren\'t synced: docs/canon.md G3)',
      assertSlugsExist('buildings', bList, 'population-archetypes.json names a building the database lacks'));
    const rows = buildingGroups.flatMap(g => Object.values(g.roles).sort((a, b) => a.role.localeCompare(b.role))
      .map(a => [lit(g.building, 'text'), lit(a.role, 'text'), ...ARCHETYPE_COLS.map(([c, t]) => lit(a[c], t))]));
    const names = ARCHETYPE_COLS.map(c => c[0]);
    let sql = `delete from public.population_archetypes x\nusing public.buildings b\n` +
      `where x.building_id = b.id and b.slug in (${bList.map(s => lit(s, 'text')).join(', ')})`;
    sql += rows.length ? `\n  and (b.slug, x.role) not in (values\n${valuesBlock(rows.map(r => r.slice(0, 2)))}\n  );\n` : ';\n';
    if (rows.length) {
      // count_per_tier isn't in the JSON for building archetypes, so it isn't written.
      sql += `insert into public.population_archetypes as t (building_id, role, is_ambient, ${names.join(', ')})\n` +
        `select b.id, v.role, false, ${names.map(n => `v.${n}`).join(', ')}\nfrom (values\n${valuesBlock(rows)}\n) as v(building_slug, role, ${names.join(', ')})\n` +
        `join public.buildings b on b.slug = v.building_slug\n` +
        `on conflict (building_id, role) do update set is_ambient = false, ${names.map(n => `${n} = excluded.${n}`).join(', ')}\n` +
        `where (t.is_ambient, ${names.map(n => `t.${n}`).join(', ')}) is distinct from (false, ${names.map(n => `excluded.${n}`).join(', ')});\n`;
    }
    section('Population archetypes by building (population-archetypes.json)', sql);
  }
  if (ambient) {
    // Ambient archetypes have no building, so no unique key covers them: match by role.
    const rows = Object.values(ambient.roles).sort((a, b) => a.role.localeCompare(b.role))
      .map(a => [lit(a.role, 'text'), ...AMBIENT_COLS.map(([c, t]) => lit(a[c], t))]);
    const names = AMBIENT_COLS.map(c => c[0]);
    let sql = `delete from public.population_archetypes x\nwhere x.is_ambient and x.building_id is null`;
    sql += rows.length ? ` and x.role not in (${rows.map(r => r[0]).join(', ')});\n` : ';\n';
    if (rows.length) {
      const v = `(values\n${valuesBlock(rows)}\n) as v(role, ${names.join(', ')})`;
      sql += `update public.population_archetypes t set ${names.map(n => `${n} = v.${n}`).join(', ')}\nfrom ${v}\n` +
        `where t.is_ambient and t.building_id is null and t.role = v.role\n` +
        `  and (${names.map(n => `t.${n}`).join(', ')}) is distinct from (${names.map(n => `v.${n}`).join(', ')});\n`;
      sql += `insert into public.population_archetypes (building_id, role, is_ambient, ${names.join(', ')})\n` +
        `select null, v.role, true, ${names.map(n => `v.${n}`).join(', ')}\nfrom ${v}\n` +
        `where not exists (select 1 from public.population_archetypes t where t.is_ambient and t.building_id is null and t.role = v.role);\n`;
    }
    section('Ambient population archetypes (no building)', sql);
  }

  // Deletes last, children before parents. Only what the diff says the JSON removed.
  if (removedAny) {
    const del = (table, col, keys, note) => keys.length
      ? `-- ${note}\ndelete from public.${table} where ${col} in (${keys.map(k => lit(k, 'text')).join(', ')});\n`
      : '';
    let sql = '';
    const removedArchetypes = removed.archetypes.filter(k => k !== AMBIENT);
    if (removedArchetypes.length) {
      sql += `delete from public.population_archetypes x using public.buildings b\nwhere x.building_id = b.id and b.slug in (${removedArchetypes.map(k => lit(k, 'text')).join(', ')});\n`;
    }
    if (removed.archetypes.includes(AMBIENT)) sql += `delete from public.population_archetypes where is_ambient and building_id is null;\n`;
    if (removed.fashion.length) {
      sql += `delete from public.fashion_styles s using public.cultures c\nwhere s.culture_id = c.id and c.slug in (${removed.fashion.map(k => lit(k, 'text')).join(', ')});\n`;
    }
    sql += del('architecture_styles', 'slug', removed.architecture, 'Cascades to architecture_blocks, culture_architecture_assignments and building_architecture_availability');
    sql += del('cultures', 'slug', removed.culture, 'Cascades to fashion, preferences, trait and architecture assignments');
    sql += del('ancestries', 'slug', removed.ancestry, 'Cascades to biome affinities, feature bonuses and culture preferences');
    sql += del('culture_traits', 'slug', removed.trait, 'Cascades to culture_trait_assignments');
    section('Removed from the JSON (--allow-delete)', sql);
  }

  if (!parts.length) return '';
  const head_ = [
    '-- Generated by scripts/macro-sync.mjs from the macro-world JSON (master canon, #1642). Do not edit:',
    '-- change the JSON and re-run `npm run macro:sync`. Idempotent: a second run changes nothing.',
    '-- Apply after every earlier file in supabase/migrations/ (the sync assumes their rows exist).',
    ...header.map(h => `-- ${h}`),
  ];
  return `${head_.join('\n')}\n\nbegin;\n\n${parts.join('\n')}\ncommit;\n`;
}

/** One line per kind for a diff, for logs and the migration header. */
export function describeDiff(diff) {
  return KINDS.flatMap(k => {
    const d = diff[k], bits = [];
    if (d.added.length) bits.push(`+${d.added.join(', +')}`);
    if (d.changed.length) bits.push(`~${d.changed.join(', ~')}`);
    if (d.removed.length) bits.push(`-${d.removed.join(', -')}`);
    return bits.length ? [`${k}: ${bits.join(' ')}`] : [];
  });
}

/** The tables the check reads, for the live dump and the export. */
export const LIVE_TABLES = [
  'ancestries', 'biomes', 'geographic_features', 'culture_traits', 'cultures',
  'architecture_styles', 'architecture_blocks', 'fashion_styles', 'fashion_variants',
  'buildings', 'population_archetypes', 'ancestry_biome_affinities', 'ancestry_feature_bonuses',
  'culture_ancestry_preferences', 'culture_trait_assignments', 'culture_architecture_assignments',
];

/** One read-only query that returns every table the check needs, for the Supabase MCP `execute_sql`. */
export function liveDumpQuery() {
  return `select json_build_object(\n${LIVE_TABLES.map(t => `  '${t}', coalesce((select json_agg(x) from public.${t} x), '[]'::json)`).join(',\n')}\n) as dump;`;
}
