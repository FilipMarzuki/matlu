# Macro World Generation

Procedural world architecture for Core Warden. One macro map in Azgaar combining Mistheim geography with Earth landmasses baked in. Earth ruins scattered as discoverable infrastructure. Sinaria caves generated on-demand at runtime.

## World Lore Context

The worlds merged in sequence: **Mistheim first, then Sinaria, then Earth**. But time was destroyed in the process — Earth fragments arrived from different eras and different regions, scattered across Mistheim's timeline. Greek ruins sit frozen in glacial valleys. A motorway cuts through ancient taiga. A crashed moon base half-buried in volcanic ash.

**Geography imported, people didn't.** Earth infrastructure — buildings, roads, technology, ruins — transferred intact but empty. No bodies, no explanation. Just silent structures from across human history. Meanwhile, Earth people are arriving in the new world through some other mechanism. No one knows why.

This means exploration uncovers Earth ruins anywhere: under swamps, in caves, on unexplored continents, deep in Sinaria. The *absence* of people in otherwise intact structures is the horror.

## Architecture

```
The Macro Map (one Azgaar file):
  Mistheim geography (base) + Earth landmasses (merged into heightmap)
  Australia's outline warped into a southern continent.
  Scandinavia jutting from an alien archipelago.
  Mediterranean basin filled with glacial runoff.
  Azgaar simulates climate, rivers, cultures across the combined terrain.

Earth Fragment Catalog (JSON):
  Discoverable ruins placed on the macro map.
  Era-tagged: prehistoric → near-future.
  Infrastructure only — no people, no living cultures.
  Placed where Earth geography was merged, or scattered randomly.

Sinaria (runtime procedural):
  Cave networks generated on-demand from parameters.
  No macro map needed — fragmented and disorienting by design.
  Connected to surface via rifts at specific map locations.
```

## How the Map is Built

### Step 1 — Generate Mistheim Base

Generate a procedural world in Azgaar with a chosen seed. Tune for extreme geography: high mountains, vast glaciers, volcanic rifts, dense taiga. This is the alien base layer.

### Step 2 — Merge Earth Landmasses

Open the Mistheim map in Azgaar's heightmap editor. Import recognizable Earth landmasses from a real heightmap PNG and paste them into the Mistheim terrain:

- Warp, rotate, scale to fit — they shouldn't be perfectly recognizable, just echo-like
- A player looking at the world map might think "that looks like Australia collided with something"
- The geography remembers Earth, but the climate is Mistheim's

Sources for Earth heightmaps:
- [Natural Earth III](https://www.shadedrelief.com/natural3/pages/extra.html) — grayscale DEM
- [Tangram Heightmapper](https://tangrams.github.io/heightmapper/) — browser-based, exports PNGs

### Step 3 — Re-run Generators

After merging the heightmap, re-run Azgaar's climate, river, biome, and culture generators. They simulate naturally across the combined geography — the Scandinavian peninsula gets Mistheim weather, rivers flow across the seams, Mistheim races spread into the imported terrain.

### Step 4 — Export

One map, one export. The result is a single world that looks alien but has recognizable Earth shapes baked in. No seam management needed — Azgaar handles it.

### Step 5 — Place Earth Fragments

Layer Earth ruins onto the map via the fragment catalog. Place era-appropriate structures where Earth geography was merged (a Greek temple where Mediterranean coastline was imported) or scatter them elsewhere for surprise discovery.

## Pipeline

```
1. Define races + affinity rules            → macro-world/race-affinities.json
2. Generate Mistheim base (Azgaar)          → macro-world/azgaar.map
3. Merge Earth landmasses (heightmap edit)  → macro-world/azgaar.map (updated)
4. Export merged world                      → macro-world/azgaar-export.json
5. Race assignment script (automatic)       → macro-world/culture-map.json
6. Place Earth fragments                    → macro-world/fragment-catalog.json
7. Lore agents flesh out cultures+fragments → Notion + region-overrides.json
8. Region specs regenerate (script)         → macro-world/regions/*.json
9. Local map gen consumes specs             → runtime (src/world/)
```

Steps 4-8 are re-runnable. Edit the map in Azgaar, re-export, everything downstream regenerates. Lore agents notice empty cultures and unfleshed fragments and fill them overnight.

## File Layout

```
macro-world/
  azgaar.map                    # The merged world map (Mistheim + Earth geography)
  azgaar-export.json            # Full JSON export from Azgaar
  earth-fragments.json          # Which Earth landmasses were used, where, at what scale
  fragment-catalog.json         # Earth ruins/structures placed on the map
  race-affinities.json          # Race → geographic preference rules
  culture-map.json              # Azgaar culture ID → game race/sub-culture
  sinaria-params.json           # Cave generation parameters by depth tier
  region-overrides.json         # Per-region game data (threats, corruption, lore)
  regions/                      # Generated region specs (build output)
    valtheim-reach.json
    shattered-coast.json
    ...
```

## Earth Fragments

### Geography Record

Documents which Earth landmasses were merged into the heightmap, so the merge is reproducible:

```jsonc
// macro-world/earth-fragments.json
{
  "fragments": [
    {
      "source": "australia",
      "placement": "southern-continent",
      "rotation": 15,
      "scale": 0.8,
      "note": "Merged with Ashfall archipelago, coastline warped by volcanic activity"
    },
    {
      "source": "scandinavia",
      "placement": "northern-archipelago",
      "rotation": -30,
      "scale": 1.0,
      "note": "Fjords intact, connected to Mistheim ice shelf"
    },
    {
      "source": "mediterranean-basin",
      "placement": "central-lowlands",
      "rotation": 0,
      "scale": 0.6,
      "note": "Basin filled with glacial runoff, now a frozen lake system"
    }
  ]
}
```

### Fragment Catalog — Discoverable Ruins

Earth infrastructure placed on the map. No people — just silent, empty structures from across human history. The fragment catalog feeds into region specs and the lore pipeline.

```jsonc
// macro-world/fragment-catalog.json
{
  "fragments": [
    {
      "id": "frag-e001",
      "name": null,                         // unnamed until discovered by player
      "era": "classical-greek",
      "earthRegion": "mediterranean",
      "placement": {
        "region": "frostmere-basin",        // which game region it sits in
        "locationType": "submerged-swamp",  // how it sits in Mistheim landscape
        "visibility": "hidden"              // hidden | partially-exposed | landmark
      },
      "structures": ["temple-ruins", "aqueduct-fragment", "amphora-cache"],
      "loot": ["ancient-scroll", "bronze-weapon"],
      "loreHooks": [
        "inscriptions in unknown script",
        "preserved olive grove frozen in ice"
      ]
    },
    {
      "id": "frag-e002",
      "name": null,
      "era": "near-future",
      "earthRegion": "northern-europe",
      "placement": {
        "region": "ashfall-plateau",
        "locationType": "half-buried-volcanic",
        "visibility": "partially-exposed"
      },
      "structures": ["research-station", "solar-array-wreckage", "sealed-lab"],
      "loot": ["data-core", "composite-armor-shard"],
      "loreHooks": [
        "emergency logs cut off mid-sentence",
        "lights still flickering on backup power"
      ]
    }
  ]
}
```

### Era Tags

| Era | Period | Typical structures |
|-----|--------|-------------------|
| `prehistoric` | Before civilization | Cave paintings, megaliths, bone tools, standing stones |
| `ancient-egyptian` | ~3000-300 BCE | Pyramids, obelisks, underground tombs, irrigation canals |
| `classical-greek` | ~800-146 BCE | Temples, amphitheatres, marble columns, aqueducts |
| `roman` | ~500 BCE-476 CE | Roads, forts, baths, aqueducts, colosseums |
| `medieval` | ~500-1500 CE | Castles, cathedrals, plague villages, watchtowers |
| `industrial` | ~1760-1914 | Factories, rail tunnels, mines, smokestacks, bridges |
| `modern` | ~1914-2030 | Concrete bunkers, highways, power plants, subway stations |
| `near-future` | ~2030-2100 | Research stations, moon base debris, orbital wreckage, sealed labs |

## Sinaria — Runtime Cave Generation

No macro map. Sinaria is subterranean, fragmented, and disorienting — it should feel like discovering piecemeal, not traversing a known map. Cave regions are defined by parameters and generated at runtime.

```jsonc
// macro-world/sinaria-params.json
{
  "depthTiers": [
    {
      "depth": "shallow",
      "caveTypes": ["crystal", "fungal"],
      "connectivity": [0.5, 0.8],
      "stability": [0.6, 0.9],
      "waterTable": true,
      "corruption": { "type": "spore", "intensity": [0.1, 0.3] },
      "earthFragments": true,
      "note": "Near-surface caves. Earth ruins occasionally break through ceilings."
    },
    {
      "depth": "mid",
      "caveTypes": ["crystal", "flooded", "fungal"],
      "connectivity": [0.3, 0.6],
      "stability": [0.4, 0.7],
      "waterTable": true,
      "corruption": { "type": "crystal", "intensity": [0.2, 0.5] },
      "earthFragments": true,
      "note": "Underground rivers and lakes. Sinaria native structures appear."
    },
    {
      "depth": "deep",
      "caveTypes": ["lava", "void", "crystal"],
      "connectivity": [0.1, 0.4],
      "stability": [0.2, 0.5],
      "waterTable": false,
      "corruption": { "type": "void", "intensity": [0.4, 0.8] },
      "earthFragments": false,
      "note": "Extreme. Lava tubes, void pockets. No Earth fragments reach this deep."
    },
    {
      "depth": "abyssal",
      "caveTypes": ["void"],
      "connectivity": [0.05, 0.2],
      "stability": [0.1, 0.3],
      "waterTable": false,
      "corruption": { "type": "void", "intensity": [0.7, 1.0] },
      "earthFragments": false,
      "note": "Near the source of corruption. Barely navigable."
    }
  ]
}
```

The local generator uses cellular automata or BSP to carve cave layouts at runtime. Each playthrough gets different tunnels, but the parameters keep the feel consistent for a given depth. Earth ruins can appear in shallow/mid Sinaria caves — a subway tunnel breaking into a crystal cavern.

## Azgaar Integration

[Azgaar's Fantasy Map Generator](https://github.com/Azgaar/Fantasy-Map-Generator) is an open-source browser-based tool. No CLI/headless mode exists, but it has a Playwright test suite we can reuse.

### Automation via Playwright

```
1. Launch FMG in headless Chromium: /?seed=X&width=W&height=H
2. page.evaluate() to trigger generation + export
3. Capture Full JSON export
4. Seeds are deterministic: same seed + size = same world
```

The heightmap merge (step 2-3 of the pipeline) is currently manual in Azgaar's editor. Could potentially be automated via Playwright `page.evaluate()` calls to the heightmap API, but manual editing gives better artistic control for now.

### What Azgaar Exports (per cell)

| Field | Description |
|-------|-------------|
| `h` | Elevation (0-100, 20+ = land) |
| `biome` | Biome index (12 types: tundra, taiga, savanna, etc.) |
| `culture` | Culture assignment |
| `state` | State/country |
| `religion` | Religion |
| `r` | River ID (0 = none) |
| `pop` | Population (x1000) |
| `burg` | Settlement ID |
| `c` | Adjacent cell IDs (neighbors) |

Grid cells add `temp` (Celsius) and `prec` (precipitation/moisture).

### Azgaar Biome Types (12)

Marine, Hot desert, Cold desert, Savanna, Grassland, Tropical seasonal forest, Temperate deciduous forest, Tropical rainforest, Temperate rainforest, Taiga, Tundra, Glacier, Wetland.

These map to our game biomes defined in `src/world/biomes.ts`.

## Race Affinity System

With 12-24 races and potentially hundreds of cultures, manual placement doesn't scale. Instead, define geographic affinities per race and let a script assign races to Azgaar cultures based on where they settled.

Races are Mistheim-native. Earth has no living cultures on the merged map — only empty infrastructure. Humans arrive separately through an unknown mechanism.

### Race Affinity Schema

```jsonc
// macro-world/race-affinities.json
{
  "races": [
    {
      "id": "dvergr",
      "name": "Dvergr",
      "description": "Mountain dwellers, master smiths",
      "affinity": {
        "elevation": [60, 100],
        "biome": ["taiga", "tundra", "cold_desert"],
        "moisture": [0, 50]
      },
      "avoids": {
        "biome": ["tropical_rainforest", "savanna"]
      },
      "clustering": "tight",
      "populationWeight": 0.6,
      "namingBase": "old-norse-mineral"
    },
    {
      "id": "sylphari",
      "name": "Sylphari",
      "description": "Forest enclaves, nature-bound",
      "affinity": {
        "biome": ["temperate_deciduous", "temperate_rainforest"],
        "moisture": [50, 100],
        "elevation": [20, 60]
      },
      "clustering": "scattered",
      "populationWeight": 0.3,
      "namingBase": "elvish-botanical"
    }
  ]
}
```

### Assignment Algorithm

1. For each Azgaar culture, compute average elevation, dominant biome, moisture, and geographic spread from its cells.
2. Score each race's affinity against the culture's geography.
3. Assign the best-matching race. Ties broken by `populationWeight`.
4. `clustering: "tight"` races prefer contiguous territories; `"scattered"` allows enclaves.
5. Output `culture-map.json` mapping Azgaar culture IDs to game races + generated sub-culture names.

### Sub-Cultures

Within each race, individual Azgaar cultures become sub-cultures — clans, city-states, dialects. A race like Dvergr might have 8-15 sub-cultures across the world, each with different settlements, trade routes, and local customs. Lore agents fill in the details.

## Region Spec Format

The local map generator consumes region specs. Each spec is generated by merging Azgaar geography + race assignment + fragment placement + manual overrides.

```jsonc
// macro-world/regions/valtheim-reach.json
{
  "id": "valtheim-reach",
  "name": "Valtheim Reach",
  "azgaarCells": [4521, 4522, 4523, 4498],
  "biome": "boreal",
  "elevation": "highland",
  "temperature": -5,
  "moisture": "moderate",
  "features": ["river-tributary", "cliff-edge"],
  "race": "dvergr",
  "culture": "Ironpeak Clans",
  "state": "Valtheim Protectorate",
  "religion": "Ancestor Forge",
  "settlements": [
    { "name": "Grindvik", "type": "town", "population": 2400 }
  ],
  "earthFragments": [],
  "corruption": {
    "type": "stone",
    "intensity": 0.6
  },
  "threats": ["corruption-high", "wolf-pack"],
  "neighbors": ["frostmere-basin", "ashfall-plateau"],
  "underground": null,
  "loreHooks": ["ancient forge beneath Grindvik", "sealed mine entrance"]
}
```

```jsonc
// macro-world/regions/shattered-coast.json — region with Earth ruins + Sinaria access
{
  "id": "shattered-coast",
  "name": "The Shattered Coast",
  "azgaarCells": [1204, 1205, 1206],
  "biome": "temperate_coast",
  "elevation": "lowland",
  "temperature": 8,
  "moisture": "high",
  "features": ["river-mouth", "cliff-edge"],
  "race": "human-settlers",
  "culture": "Driftborn",
  "settlements": [
    { "name": "Strandvik", "type": "fishing-village", "population": 800 }
  ],
  "earthFragments": ["frag-e001", "frag-e003"],
  "corruption": {
    "type": "thermal",
    "intensity": 0.7
  },
  "threats": ["corruption-high", "frost-wraith"],
  "neighbors": ["frostmere-basin", "elder-woods"],
  "underground": {
    "sinariaAccess": true,
    "depth": "shallow",
    "caveType": "crystal",
    "connectivity": 0.4
  },
  "loreHooks": [
    "Greek temple half-submerged in Mistheim swamp",
    "Sinaria crystal vein surfacing through temple floor"
  ]
}
```

## Integration with Existing Systems

### Lore Pipeline

The existing lore agents (`lore-autofill`, `lore-features`) gain geographic context:
- Instead of inventing cultures from nothing, agents reference the region spec
- `WORLD.md` (world bible) provides tone and themes
- `docs/WORLD_LORE.md` provides corruption mechanics
- Region specs provide the geographic and cultural specifics
- Earth fragment lore hooks feed into discovery/exploration narrative

### Local Map Generator (src/world/)

The current procedural terrain uses three fBm noise layers (elevation, temperature, moisture) seeded per run. With macro worldgen:
- Noise parameters are *constrained* by the region spec (e.g., elevation range, biome type)
- River placement is guided by macro river data
- Enemy spawns match the region's race, threats, and corruption type
- Earth fragments become discoverable POIs placed in the local tilemap
- The noise still provides per-playthrough variety within those constraints

### Biome Mapping

Azgaar's 12 biomes → game biomes (`src/world/biomes.ts`):

| Azgaar | Game biome |
|--------|-----------|
| Tundra | Dry Heath / Mountains (cold) |
| Taiga | Forest (boreal) |
| Temperate deciduous | Forest (temperate) |
| Grassland | Meadow |
| Savanna | Dry Heath (warm) |
| Wetland | Marsh/Bog |
| ... | (to be completed) |

## Precedents and Best Practices

Games that use similar world generation approaches:

**Dwarf Fortress** — the gold standard. Generates full world history (geology, erosion, civilizations rising and falling, migrations) before you play. Macro world sim → local "embark site" is the same pattern as our macro → local layers.

**Caves of Qud** — procedural cultures layered on fixed geography. Each faction has generated rituals, naming, and history. Cultures feel unique because they're constrained by biome (jungle factions vs. salt desert factions) — the same principle as our race affinity system.

**Rimworld** — world map tiles, each with biome/temperature/rainfall. Player picks a tile, game generates a local map matching those constraints. Very close to our region spec → local gen model.

**No Man's Sky** — planet-scale biome from parameters, local terrain from noise. Proved that "constraints + noise = infinite variety with consistency" works at massive scale.

**Key principle across all of these:** the macro layer should be *opinionated but sparse* — enough to set the vibe and constraints, not so detailed that the local generator has no creative room. Region specs should define biome + elevation + moisture + features + culture, leaving layout, exact placement, and micro-detail to the local noise.

## Iterative Workflow

**Changing geography:** Re-open `azgaar.map` in FMG, edit visually, re-export. Race assignment re-runs. `region-overrides.json` and `fragment-catalog.json` are preserved — only geography updates, not your game annotations.

**Changing races:** Edit `race-affinities.json`, re-run assignment. Cultures redistribute based on new rules.

**Adding Earth fragments:** Add entries to `fragment-catalog.json`. Lore agents can also generate fragments — they notice regions with Earth-origin geography and suggest era-appropriate ruins.

**Adding lore:** Lore agents write to Notion and `region-overrides.json`. These persist across re-exports.

**Adding a new continent:** Edit the map in Azgaar (optionally merging another Earth landmass), re-export. New cells get auto-assigned races. New region specs are generated with empty lore hooks. Lore agents pick them up overnight.

**Tuning Sinaria:** Edit `sinaria-params.json` to adjust cave parameters by depth tier. No re-export needed — changes take effect at runtime on next playthrough.
