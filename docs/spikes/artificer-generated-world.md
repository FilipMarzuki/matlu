# Spike: a generated world for the Artificer, shown as a text grid

**Ask (owner, 2026-10-10):** "We need the generated world, history, maps and settlement for the Artificer game too. However a strict top down grid with info is enough, we don't need any graphics for it."

**Short answer:** the generators exist and are already headless and seeded, so this is mostly wiring. The history engine and the settlement generator can run from the Artificer page as they are. The terrain needs one small pure module. The real work is changing the Artificer's world model: today its geography is hand-written with no coordinates, and the run's seed comes from the Warden's id.

## What exists

| Generator | Where | Headless? | Seeded? | Output |
|---|---|---|---|---|
| **History** | `storytelling/` | yes; `src/crafting/WorldFeed.ts` already runs it in the browser | yes, golden hashes in `testkit.ts` | `loadWorld(spec, seed)` + `tick()` per year → provinces (terrain, fertility, coastal/river, neighbour graph), dynasties, characters, an event log, and prose (`renderLayeredChronicle`: legend / chronicle / living memory). **Provinces have no coordinates**: geography is a graph. |
| **Settlements** | `mapgen/` | yes (no Phaser, Supabase or `src/` imports) | yes | `generateSettlement(site, name, rng, data, tier)` → purpose, tier, traits, buildings from `building-registry.json` and `cultures.json`; `placeBuildings()` → buildings and roads on a square tile grid (≈20–60 cells a side). |
| **Terrain** | inline in `GameScene.ts` (copied in MapForge, WildlifeForge) | the pieces are pure (`src/lib/noise.ts` `FbmNoise`, `src/world/biomes.ts` `tileBiomeIdx`, river and lake tracers), the assembly isn't | yes | elevation/temperature/moisture noise → 12 biomes per cell. |
| Text grid | `src/world/MapOverview.ts` `overviewCells` | yes | n/a | a categorical cell grid from a settlement map: ground, road, building, entrance… |
| Azgaar Earth export | `macro-world/scripts/` | no (Playwright + network); output is gitignored and absent | | not usable here |

The Artificer today (`src/artificer*`):
- **Geography:** three rings around camp (`exploration.ts`: Near/Far/Distant × forage, timber, stone, water, game, routes), with flat travel hours. There are four fixed camp sites.
- **The road:** one fixed route, Hollowford → Saltmere → Kestrel Gate → Mistheim (`road.ts`). Its 3 villages, 13 villagers and their lore are written by hand (`villages.ts`), and so are the quests, trade and asks tables keyed by those ids.
- **Seed:** each run's seed is `seedOf(character.id)`. No world seed is saved (`SAVE_VERSION` 7).
- **AI players:** they read the world as text. Static rules are in `observe.ts` `RULES`, which must stay byte-identical for caching; the day's view is in `observe()`.
- **Design-doc conflict:** `docs/region-exploration-design.md` says "never a surveyed tile grid". The owner's new call overrides it. The grid can still honour that doc's intent by showing only what the Warden has scouted (fog).

## Prototype (throwaway, not committed)

One script, seed 1729, using only the existing modules:

```
REGION 64×24 (12.7 ms)                       legend: ~ sea  , shore  " marsh  . heath/meadow
.~~~~~,,,...........,,,.......TT~~,.......           T forest  n granite  ^ summit  * snow
~~~~~~~~~,.........,,,,,....T,T""TTTTT....           @ camp  # settlement
~~,....T.......TTTTTTTTTTTTTTTTT..........
~,,..........TTTTTTTTTT..TTTTTT#T.........
...........nnnnnnnnT@nn**nnnn.............

HISTORY: 19 provinces, 6667 events (2574 worth telling), 3.1 s for 200 years
  The Wars for Duchy of Saltmere (1056–1079)
  The Calamities of Rivenbrook (1022–1064) …

SETTLEMENT "hollowford", tier 1, logging, 4 buildings on 20×20
....===-=AA=BB===...      A campfire · B shelter hut
..........=.........      C shelter hut · D storage shed
........CC-D........
```

What it shows:
- Terrain is instant. The biome mix needs tuning for a cold northern reach.
- History is about 3 s for the 19-province world. Since every run gets a new world, it runs at the start of each run in a Web Worker while the arrival text is read, with a shorter span or fewer provinces if that's still too slow. It never runs on reload: the result is saved, or rebuilt from the seed in the worker.
- A settlement fits on one screen as text.

## Proposed shape

A new Phaser-free module, **`src/artificer/world/`**, owned by the Artificer (it copies the few pure helpers it needs, so the planned repo split stays easy):

1. **`World`**: a new world each run. Its seed is the run's seed, already `seedOf(character.id)`, and it's saved with a generator version, so loading a mid-run save rebuilds the same land. A save made by another generator version starts fresh rather than reshaping silently.
2. **Region grid**: about 48×32 cells, where one cell is about an hour's walk. Each cell holds terrain and biome, height, water (river or lake), resources by biome (forage, timber, stone, game), and what the Warden knows of it (fog, then glimpsed, then scouted).
3. **History**:
   - Partition the grid into provinces (one per settlement seat, grown by travel cost).
   - Feed the storytelling engine a spec built from them: terrain, neighbours, cultures from `cultures.json`.
   - Run it for N years, then keep the event log and the chronicle.
   - Places, ruins, dynasties and named people come from it, and every cell or settlement can say "what happened here".
4. **Settlements**: one per province seat, made with `generateSettlement` + `placeBuildings`. The site is read off the grid: geography from biome, river or coast, adjacent resources, the province's culture. Entering one shows its building grid as text.
5. **Text renderer**: one character per cell, with a legend, and tapping a cell shows its info. The same function writes the AI's per-day observation (a window around the Warden), so humans and models read the same map.
6. **Gameplay mapping**:
   - The rings become distance bands from camp on the grid, using travel time along the terrain.
   - Domains become the resources of the cells in a band.
   - The four sites become candidate cells near camp.
   - The road becomes a route across the grid through generated settlements to Mistheim.
   - The hand-written villagers can stay as named anchors placed in generated settlements, so their quests and lore keep working.

## Phases (each its own issue)

1. **Region grid** (#1539): `src/artificer/world/terrain.ts` (seeded, tuned for the Reach) plus the text renderer and fog. Tests: determinism (a hash per seed) and biome mix bounds. No gameplay change yet; a MAP tab shows it.
2. **History** (#1540): grid → provinces → storytelling spec → chronicle, run in a worker at world creation. The MAP tab's cell info and a HISTORY view show it.
3. **Settlements** (#1541): mapgen per seat, and a settlement view as a text grid.
4. **Play on the grid** (#1542): rings, sites and the road read from the world. This also bumps the save version (world seed + generator version) and changes the AI's observation (a map window; `RULES` stays static). This is the big one; it changes balance and the playthrough tests.

## Decided (owner, 2026-10-10)

- **Scope: the Reach first.** One region grid with its settlements and the road to Mistheim. A wider Mistheim map can come later.
- **Persistence: a new world every run.** Each Warden gets a fresh map and history; nothing geographic carries over. The legacy (heirlooms, met people) still carries over as it does now.
- **Hand-written content: kept as anchors.** The 13 villagers, their quests, trade and lore are placed into generated settlements (Hollowford, Saltmere and Kestrel Gate keep their names and people), and generated people fill the rest.
