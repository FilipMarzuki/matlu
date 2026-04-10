# Tile & Sprite Inventory — Procedural Map

Living document tracking what tiles and sprites exist, what's missing, and what to import or build.
Update this when adding new assets or discovering gaps.

Last reviewed: 2026-04-10

---

## Current terrain tileset

**Source**: `mystic_woods_2.2/sprites/tilesets/plains.png` (96×192 px, 6 cols × 12 rows, 16×16 px frames, rendered at 32px)

| Rows | Biome | Notes |
|------|-------|-------|
| 0–1  | Rocky shore | Wave-smoothed granite |
| 2–3  | Coastal heath | Open ground, heather |
| 4–5  | Mixed forest floor | Birch-spruce |
| 6–7  | Dense forest floor | Dark spruce interior |
| 8–9  | Highland granite | Bare rock |
| 10–11 | (unused rows) | Available for new biomes |

Water is rendered from `water-sheet.png` (animated, 4-frame cycle).

---

## What's already in the packs but NOT wired up

These cost nothing — just need code to load and use them.

### Mystic Woods 2.2 (high priority — already paid for)

| Asset | Path | Use case |
|-------|------|----------|
| Water lilies | `sprites/tilesets/water_lillies.png` | Scatter on shallow water edges |
| Water decorations | `sprites/tilesets/water_decorations.png` | Reeds, lily pads, shore detail |
| Rocks in water | `sprites/objects/rock_in_water_01-sheet.png` (+ 01–06 statics) | Scatter in water near shore |
| Decor 16×16 | `sprites/tilesets/decor_16x16.png` | Extra ground clutter (barrels, logs, stumps) |
| Decor 8×8 | `sprites/tilesets/decor_8x8.png` | Tiny detail fills |
| Grass tileset | `sprites/tilesets/grass.png` | Animated grass for heath/forest edge |
| Fences | `sprites/tilesets/fences.png` | Ruins/abandoned farm chunks |
| Chests | `sprites/objects/chest_01.png`, `chest_02.png` | Loot / secret collectibles |
| Objects sheet | `sprites/objects/objects.png` | Barrels, pots, misc props |
| Skeleton character | `sprites/characters/skeleton.png` | Wandering enemy NPC (free hostile) |
| Slime character | `sprites/characters/slime.png` | Wandering enemy NPC |

### PostApocalypse Pack v1.1.2

| Asset | Path | Use case |
|-------|------|----------|
| Stump | `Nature/Stump.png` | Scatter in logged/damaged forest areas |
| Flowers_2 | `Nature/Flowers_2.png` | More flower variety in clearings |
| Flowers_3 | `Nature/Flowers_3.png` | More flower variety |
| Stick | `Nature/Stick.png` | Ground clutter, highland debris |
| Bat character | `Character/Bat/` | Flying enemy (full spritesheet with attack/death) |

### Craftpix Top-Down Animals

| Asset | Use case |
|-------|----------|
| Deer idle + walk | Already loaded — just needs spawning in forest chunks |
| Hare idle + walk | Already loaded — just needs spawning in heath/shore |
| Fox idle + walk | Already loaded — just needs spawning in forest clearings |
| Black grouse | Already loaded — just needs spawning (dense forest biome) |

---

## What needs to be IMPORTED (free packs / purchases)

Gaps that can't be filled from current packs.

| Asset | Description | Priority | Source suggestion |
|-------|-------------|----------|-------------------|
| Marsh / swamp tiles | Murky water, muddy ground, bog floor — biome between water and forest | High | itch.io "swamp tileset" or PixelLab |
| Cliff / elevation tiles | Visual height break between highland and forest biomes — ledge shadow + rock face | High | Mystic Woods walls.png might work; test first |
| Fallen log | Large horizontal log obstacle, scatter in forest chunks | Medium | PixelLab (map object) |
| Large boulders | 2–3× size rock clusters, distinctly different from the 16px rock-grass | Medium | PixelLab (map object) |
| Campfire | Animated (3–4 frames, flickering flame), for abandoned camp chunks | Medium | itch.io "campfire" or PixelLab |
| Path / dirt track | Worn dirt tile strip, connecting chunks along the SW→NE corridor | Medium | PixelLab (topdown tileset) |
| Standing stones | Ancient monolith, 32–48px tall, for waymarker/druidic chunks | Low | PixelLab (map object) |
| Ruined wall segment | Crumbled stone wall section — expand the RUINS chunk type | Low | PixelLab (map object) |
| Snow tiles | Highland terrain variant for seasonal overlay | Low | PixelLab (topdown tileset) |
| River bank tiles | Narrow flowing water with dirt banks — for stream features | Low | itch.io or PixelLab |

---

## What needs to be BUILT with PixelLab

Assets that don't exist anywhere and need generation. Add to `asset-spec.json` when ready.

### Tilesets

| id | Description | PixelLab tool | Priority |
|----|-------------|---------------|----------|
| `marsh_floor` | Dark mossy bog ground, waterlogged patches, murky shallow water | `create_topdown_tileset` | High |
| `dirt_path` | Worn earth track tiles — straight, corners, T-junction for procedural paths | `create_topdown_tileset` | Medium |
| `highland_snow` | Snow-dusted granite, for winter overlay on rows 8–9 | `create_topdown_tileset` | Low |

Style: match `plains.png` — 16×16 tiles, `high top-down`, `basic shading`, `selective outline`, palette from world.

### Map objects (single sprites, transparent bg)

| id | Description | PixelLab tool | Size | Priority |
|----|-------------|---------------|------|----------|
| `fallen_log` | Mossy rotting log lying on ground, top-down | `create_map_object` | 48×24 | Medium |
| `boulder_large` | Cluster of 2–3 large granite rocks, earthy tones | `create_map_object` | 48×48 | Medium |
| `campfire` | Smouldering campfire with ash ring, top-down | `create_map_object` | 32×32 | Medium |
| `standing_stone` | Ancient weathered stone monolith, moss-covered | `create_map_object` | 24×48 | Low |
| `ruined_wall` | Short crumbled stone wall segment | `create_map_object` | 48×24 | Low |
| `chest_hidden` | Overgrown chest half-buried in earth, for secret areas | `create_map_object` | 24×24 | Low |

---

## What's missing from the GENERATION SYSTEM (code gaps, no new art needed)

These are improvements to the proc gen logic itself, not art.

| Gap | Description | Effort |
|-----|-------------|--------|
| Marsh biome | Add biome tier between water (0.25) and shore (0.30) using existing or new tiles | Low |
| Cliff shadow pass | Already partially implemented; extend to full ledge rendering between highland and forest | Low |
| Water edge scatter | Spawn water lilies + rocks-in-water from Mystic Woods near shoreline | Low |
| Animal spawning | Deer/hare/fox already loaded — just need spawn logic tied to biome | Low |
| More chunk types | ABANDONED_CAMP (campfire + scattered items), BOULDER_FIELD, FALLEN_TREE, STANDING_STONES | Medium |
| Biome-specific tree selection | Currently all tree types appear everywhere — filter by biome (birch on shore, spruce in dense forest) | Medium |
| Corridor path rendering | Dirt path tiles stamped along the SW→NE route to visually guide the player | Medium |
| Seasonal pass | Snow overlay on highlands based on a `season` param, changes grass tint in spring/autumn | High |
| River generation | Noise-carved narrow water channel from highland down through forest to sea | High |

---

## Priority summary

**Do now (use existing assets, just wire them up):**
1. Water edge scatter — Mystic Woods water lilies + rocks in water near shore
2. Animal spawning — deer/hare/fox already loaded, needs spawn logic
3. Stump + Flowers_2/3 — add to decoration scatter
4. More chunk types using fences/chests/decor from existing packs (RUINS variant, ABANDONED_CAMP)

**Generate with PixelLab (next credit burn):**
1. `marsh_floor` tileset — adds a proper transition biome
2. `fallen_log` + `boulder_large` map objects — expands chunk variety
3. `campfire` map object — enables ABANDONED_CAMP chunk type

**Import from itch.io / purchase:**
1. Swamp / marsh tileset (if PixelLab marsh result doesn't match style)
2. Cliff tiles (test Mystic Woods walls.png first)
