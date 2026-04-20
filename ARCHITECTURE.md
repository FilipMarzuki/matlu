# Matlu — Code Architecture

Top-down exploration game. Phaser 3 + TypeScript, procedural world, corruption shader, four branching endings.

---

## Scene Graph

```
MainMenuScene
├── WilderviewScene (background nature sim — slow camera pan over animals)
├── CombatArenaScene (background preview)
├── CreditsScene (overlay)
├── SettingsScene (overlay — audio mute, language selector)
├── LoreScene (overlay — lore entries)
└── [user picks mode]
    │
    ├── GameScene  ← main gameplay (wilderview)
    │   ├── NavScene (persistent overlay — mode toggle, free-cam, dev layer toggles)
    │   ├── PauseMenuScene (overlay)
    │   ├── NpcDialogScene (modal — blocks input until choice)
    │   ├── UpgradeScene (modal shop — permanent upgrades at shrines)
    │   ├── ShopScene (modal shop — consumable items from vendor NPCs)
    │   ├── StatsScene (read-only overlay)
    │   ├── GameOverScene (overlay — shown on HP = 0)
    │   ├── LevelCompleteScene (overlay — shown on portal reach)
    │   └── EndingScene (launched on portal reach — freezes GameScene)
    │
    └── CombatArenaScene  ← infinite wave arena (~1 300 lines)
        └── NavScene (persistent overlay)
```

Scenes communicate via Phaser event bus (`this.game.events`). Key events:
- `ws:alignment-updated` — NpcDialogScene → WorldState → EndingScene reads on launch
- `ws:weather-changed` — WorldState → WeatherSystem applies visual effects
- `boss-died` — unlocks portal
- `upgrade-purchased` — GameScene deducts `playerGold`
- `shop-purchased` — ShopScene → GameScene applies consumable effect (heal / cleanse_pct)
- `nav-toggle-decor` / `nav-toggle-animals` — NavScene dev panel → GameScene toggles layer visibility
- `nav-decor-changed` / `nav-animals-changed` — GameScene → NavScene updates button state

---

## File Structure

```
src/
├── main.ts                   # Phaser game config, global plugin registration
├── scenes/                   # One file per screen/mode (see Scene Graph above)
│   ├── GameScene.ts          # Main gameplay (~7 450 lines — see Internals)
│   ├── CombatArenaScene.ts   # Infinite wave arena with dungeon rooms
│   ├── WilderviewScene.ts    # Standalone nature sim (background + menu mode)
│   ├── MainMenuScene.ts      # Entry point — orchestrates background scenes
│   ├── NavScene.ts           # Persistent HUD overlay (mode toggle, free-cam, dev toggles)
│   ├── NpcDialogScene.ts     # Modal dialog with path choices
│   ├── UpgradeScene.ts       # Permanent upgrade shrine shop
│   ├── ShopScene.ts          # Consumable vendor shop (FIL-93)
│   ├── PauseMenuScene.ts     # Pause overlay
│   ├── GameOverScene.ts      # HP-zero overlay
│   ├── LevelCompleteScene.ts # Portal-reached overlay
│   ├── EndingScene.ts        # Final ending — freezes game, shows alignment bar
│   ├── StatsScene.ts         # Read-only personal records / run history
│   ├── LoreScene.ts          # Lore entry viewer
│   ├── SettingsScene.ts      # Audio mute + language selector
│   └── CreditsScene.ts       # Credits overlay
├── entities/
│   ├── Entity.ts             # Abstract base: position + lifecycle (extends Phaser.Container)
│   ├── LivingEntity.ts       # Adds HP + death events
│   ├── Enemy.ts              # Adds aggro radius, speed, attack
│   ├── CombatEntity.ts       # Arena enemies: behaviour tree, dash, separation forces
│   │                         # Subtypes: Tinkerer, SporeHusk, AcidLancer, BruteCarapace,
│   │                         # ParasiteFlyer, WarriorBug, Skald, Spider, Skag, Crow
│   ├── Velcrid.ts            # VelcridJuvenile (orbit+hop) + VelcridAdult (burrow+surface)
│   ├── BurrowHole.ts         # Stationary entity that timed-spawns enemies in dungeon rooms
│   ├── CorruptedGuardian.ts  # Level 1 boss: 3-phase charge AI, spawns rabbits in phase 2+
│   ├── EarthHero.ts          # Base class for Earth faction heroes (signature ability interface)
│   ├── EarthEnemies.ts       # Field-control Earth enemies: Signal Jammer, Infected APC, Scrap Golem
│   ├── Blightfrog.ts         # Root-and-leap enemy; Spinolandet faction
│   ├── CrackedGolem.ts       # Death-burst enemy; Mistheim faction
│   ├── Dustling.ts           # Swarm enemy; Mistheim faction
│   ├── PackStalker.ts        # Coordinated flanking trio; Spinolandet faction
│   ├── SporeDrifter.ts       # Area-denial poison cloud enemy
│   ├── Spineling.ts          # Fast fragile swarmer; Spinolandet faction
│   ├── SwarmBrain.ts         # Stateless Reynolds boids calculator (separation/alignment/cohesion)
│   ├── heroes/               # Arena hero classes (playable in CombatArenaScene)
│   │   ├── Lund.ts           # Tier 1 humanoid hero
│   │   ├── SymbiontKarin.ts  # Tier 2 humanoid hero
│   │   ├── Chimera.ts        # Tier 3 hero — multi-strike ability
│   │   ├── Apex.ts           # Tier 4 hero — Primal Roar
│   │   └── Overmind.ts       # Tier 5 swarm hero — Redistribute mechanic
│   ├── Projectile.ts         # Ranged cleanse bolt
│   ├── Bird.ts               # Atmospheric flight objects
│   ├── WildlifeAnimal.ts     # Deer, fox, hare etc. with roam/flee/chase FSM
│   ├── GroundAnimal.ts       # Base for wildlife
│   └── index.ts              # Barrel export for all entities
├── environment/
│   ├── SolidObject.ts        # Colliders (mountains, barriers)
│   ├── InteractiveObject.ts  # Shrines, NPCs — trigger dialog on E
│   └── Decoration.ts         # Visual-only (trees, rocks)
├── world/
│   ├── WorldState.ts         # Shared observable state + GameSystem registry (see Data Flow)
│   ├── WorldClock.ts         # Day/night cycle, 6 phases, colour overlay
│   ├── SeasonSystem.ts       # 5-season cycle (spring/rainy/summer/autumn/winter) with tint blending
│   ├── WeatherSystem.ts      # Random rain/ash scheduling + screen-space particle effects
│   ├── CorruptionField.ts    # 2D noise-driven local corruption intensity
│   ├── PathSystem.ts         # Road segments — affects speed + animal routing
│   ├── AnimalTrailGen.ts     # Procedural animal trail generation between POIs (FIL-88)
│   ├── ChunkDef.ts           # Hand-authored set-piece templates (tree clusters, ruins, etc.)
│   ├── DecorationScatter.ts  # Poisson disk decoration placement (flowers, mushrooms, etc.)
│   ├── RiverData.ts          # Diagonal river paths via gradient descent (FIL-166)
│   ├── LakeData.ts           # BFS flood-fill classifier — ocean vs inland lake tiles (FIL-260)
│   ├── BiomeBlend.ts         # Biome-boundary detection for feathered transition strips (FIL-177)
│   ├── CliffSystem.ts        # Elevation quantization + south/east-facing cliff-face detection
│   ├── DungeonGen.ts         # Procedural dungeon: Bowyer-Watson + MST + loop edges + CA (~785 lines)
│   ├── BuildingCatalogue.ts  # Economy-aware building vocabulary per settlement type
│   ├── SettlementLayout.ts   # Radial ring building placement via rejection sampling
│   ├── Spinolandet.ts        # Level 3 faction wave definitions (Spineling, Blightfrog, PackStalker)
│   ├── MapData.ts            # WORLD_W × WORLD_H tile grid
│   ├── Level1.ts             # Level 1 constants: zones, NPC positions, endings
│   ├── Level1Paths.ts        # Level 1 hand-authored path segments
│   ├── Level2.ts             # The Spine Reaches (Spinolandet) — scaffold
│   ├── Level3.ts             # Mistheim Mist — scaffold
│   ├── Level4.ts             # The Seam (convergence) — scaffold
│   ├── Level5.ts             # The Source (ground zero) — scaffold
│   ├── LevelRegistry.ts      # Index of all 5 levels; getLevelConfig(n) accessor (FIL-143)
│   └── LevelTypes.ts         # Shared interfaces: LevelConfig, ZoneBase, etc.
├── ai/
│   ├── BehaviorTree.ts       # BtSelector / BtSequence / BtCondition / BtAction / BtCooldown
│   └── ArenaBlackboard.ts    # Inter-entity coordination (dive cooldowns, scout flags)
├── shaders/
│   ├── CorruptionPostFX.ts   # Post-FX pipeline on main camera (distortion, desaturation, vignette)
│   └── ShimmerPostFX.ts      # Arena floor shimmer
├── i18n/
│   ├── en.json               # English translations
│   ├── pl.json               # Polish translations
│   └── sv.json               # Swedish translations
└── lib/
    ├── noise.ts              # FbmNoise — fractal Brownian motion (terrain + corruption)
    ├── rng.ts                # mulberry32 PRNG, Poisson disk sampling
    ├── i18n.ts               # t(key) translation function — reads from src/i18n/*.json
    ├── logger.ts             # Better Stack integration
    ├── SkillSystem.ts        # Invisible XP + skill progression (FIL-95)
    └── supabaseClient.ts     # Leaderboard browser client
```

---

## Data Flow

### WorldState (world/WorldState.ts)

Central shared state, one instance per GameScene run. Also acts as a **system registry** — any class implementing `GameSystem` can register itself and receive `update(delta)` calls each frame, plus optional `destroy()` on scene stop.

```
WorldState
├── cleansePercent: 0–100      → drives CorruptionPostFX intensity
├── alignment: { earth, spino, vatten }  → determines ending
├── combatActive: boolean      → used for music ducking
├── weather: clear | rain | ash
└── systems: GameSystem[]      → WeatherSystem, SeasonSystem, etc. auto-ticked here
```

#### GameSystem interface

```ts
interface GameSystem {
  readonly systemId: string;
  update(delta: number): void;
  destroy?(): void;
}
```

`WeatherSystem` and `SeasonSystem` both implement this. Registration is idempotent (duplicate `systemId` is silently ignored). This is the preferred pattern for new systems that need per-frame ticks but don't belong inside GameScene's `update()`.

### Ending Determination (EndingScene.ts:41–52)

```
if cleanse < 40%                        → silence   (corruption wins)
else if all scores within ±20 AND ≥50%  → weaving   (balanced, most hopeful)
else if earth dominant AND cleanse ≥60% → restoration (earth separatist)
else                                    → wound     (fragile stability)
```

### Corruption: Two separate systems

| System | Purpose | File |
|---|---|---|
| `CorruptionField` | Game logic — path degradation, spawn biasing | `world/CorruptionField.ts` |
| `CorruptionPostFX` | Visual only — camera post-processing | `shaders/CorruptionPostFX.ts` |

Decoupled deliberately. Field can be sampled at any (x, y) without touching the shader.

### Water: Two separate tile types

| Type | Animation | File |
|---|---|---|
| River tiles | `river-anim` spritesheet | `world/RiverData.ts` |
| Ocean tiles | `ocean-anim` spritesheet | `world/LakeData.ts` classifies edge-connected water |

`LakeData.buildLakeTileGrid()` runs a BFS from all border tiles to classify every sub-0.25-elevation tile as ocean (edge-reachable) or inland lake (not reached). Lakes use river-anim; ocean uses ocean-anim.

### SkillSystem (lib/SkillSystem.ts)

Invisible progression stored in localStorage. Four skills map to stat multipliers:

| Skill | Gained by | Affects |
|---|---|---|
| `combat` | Killing enemies | Gold drops |
| `running` | Moving | Movement speed |
| `cleansing` | Swipe attacks | Swipe range |
| `throwing` | Firing bolts | Bolt travel range |

Level = floor(sqrt(xp / 50)), capped at 50. Multiplier = 1 + level × 0.01 (max 1.5×). Designed to be unnoticeable — no UI, no level-up message.

---

## GameScene Internals

`scenes/GameScene.ts` is ~7 450 lines and owns the main game loop. Key responsibilities:

**Lifecycle**
- `preload()` — loads sprites, audio, tilesets; registers CorruptionPostFX pipeline; loads rex-joystick plugin
- `create()` — builds map, spawns entities, wires input, launches NavScene overlay
- `update(time, delta)` — player movement, projectile ticks, path degradation, shader updates, day/night overlay

**Player systems**
- Movement: joystick (primary) or WASD/arrows; speed modified by PathSystem (road affinity)
- Swipe melee: 120px arc, 400ms cooldown
- Ranged bolt: 250px range, 1200ms cooldown
- Dash: 520px/s for 180ms, 600ms cooldown, i-frames, 4 afterimage ghosts
- Idle attract: after 5s stillness, camera pans to nearby entities

**Procedural terrain**
Three independent fBm noise layers (elevation, temperature, moisture), each seeded by `runSeed XOR constant`. Biome lookup via multi-level if-else in `terrainTileFrame()`. Rivers are traced by gradient descent in `RiverData.ts`; lakes are classified by BFS in `LakeData.ts`; biome boundaries are feathered by `BiomeBlend.detectBoundaries()`; cliff faces are detected by `CliffSystem`. All grids are baked before `create()` completes.

**Projectiles** — tracked in array, filter-each-frame lifetime management (no pooling currently)

**Noise seeding**
```ts
baseNoise ^ 0x74656d70  // temperature
baseNoise ^ 0x6d6f6973  // moisture
baseNoise ^ 0xdeadbeef  // corruption
```

---

## LevelRegistry and Arc Design (FIL-143)

Five levels are scaffolded in `world/Level*.ts` and indexed in `LevelRegistry.ts`. Currently only Level 1 is wired into GameScene. The registry is forward infrastructure — it provides a typed `getLevelConfig(n)` accessor so a future level-selection or transition mechanism can switch levels without importing all five files.

Level 2–5 files are stubs: they export the full `LevelConfig` shape with placeholder coordinates. They will be fleshed out as the level arc is implemented.

`world/Spinolandet.ts` holds the wave definitions for Level 3's faction (Spineling, Blightfrog, PackStalker). This is not a LevelConfig stub — it is live, wired into `CombatArenaScene`.

---

## Behaviour Tree System (ai/)

Lightweight, no framework. Nodes are plain objects; each tick receives a `CombatContext` snapshot.

```
BtSelector   — OR:  first child that doesn't fail wins
BtSequence   — AND: first child that fails stops the sequence
BtCondition  — leaf: evaluate predicate → success/failure
BtAction     — leaf: run work → success/failure/running
BtCooldown   — decorator: gate child behind a timer
```

`CombatContext` carries position, HP, opponent snapshot, and action closures (`moveToward`, `attack`, `orbitAround`, `dash`, etc.). This avoids circular imports — BT nodes never import entity classes.

`ArenaBlackboard` is a singleton shared across all arena entities for coordination signals (e.g. `flyerDiveCooldown` prevents simultaneous diver spam).

---

## Camera Setup

| Scene | Zoom | Notes |
|---|---|---|
| GameScene | 3× | Follows player; UI elements use `setScrollFactor(0)` |
| NavScene | 1× | Overlay — own camera so zoom doesn't affect HUD |
| CombatArenaScene | 1× | Dungeon rooms; live zoom slider in dev HUD |
| WilderviewScene | 1× | Slow pan across 1200×900 world; independent of GameScene |

---

## Key Tuning Constants

```
WORLD_W = 4500, WORLD_H = 3000  (SW→NE diagonal corridor)
TILE_SIZE = 32

PLAYER_SPEED = 180 px/s
DASH_SPEED = 520, DASH_DURATION_MS = 180, DASH_COOLDOWN_MS = 600
SWIPE_RANGE = 120, SWIPE_COOLDOWN_MS = 400
RANGED_RANGE = 250, RANGED_COOLDOWN_MS = 1200

RABBIT_COUNT = 25, CHASE_RANGE = 200, FLEE_SPEED = 120
FOOTSTEP_INTERVAL_MS = 380 (base; scaled by movement speed — FIL-119)
```

---

## Non-Obvious Decisions

**Joystick from CDN** — rex-virtual-joystick is registered as a global Phaser plugin in `main.ts`, loaded in `preload()` via `this.plugins.get(REX_VIRTUAL_JOYSTICK_PLUGIN_KEY)`. TypeScript types come from `phaser3-rex-plugins` package.

**Shader guard pattern** — `if (this.currentShader)` before every `set1f()` call. The shader can be unbound before the first render pass; without the guard the scene crashes on boot.

**Double-tap dash** — tracks `joystickReleasedAt` timestamp; two releases within 250ms triggers dash. Works alongside Shift key.

**`playerLastDir` caching** — direction only updates when actually changed, preventing animation thrashing every frame.

**Drop tables** — `DROP_TABLES[entityKey]` config object; `spawnGoldDrops()` looks up range. Balance changes touch config only, not kill logic.

**Deprecated `RiverBand` in RiverData.ts** — the legacy horizontal-band river system exports (`RiverBand`, `RIVER_BANDS`, `RIVER_BRIDGE_POSITIONS`) are kept in the file while consumers migrate, but all consumers have now moved to `DiagonalRiver` + `traceRiverPath`. They can be deleted in a cleanup pass once `RIVER_BRIDGE_POSITIONS` is confirmed unreferenced.

**ShopScene vs UpgradeScene** — two separate shop overlays on purpose: UpgradeScene handles permanent upgrades (localStorage-persisted, bought once) from shrines; ShopScene handles consumable items (immediate effect, rebuyable) from vendor NPCs. Same overlay pattern, different data model.

**SkillSystem is invisible by design** — no XP bar, no level-up toast. Showing numbers would make players optimise rather than play naturally. The system biases combat/speed/range slightly over time; the player notices the difference organically.

**LevelRegistry is forward infrastructure** — Levels 2–5 are scaffolded but not yet wired into GameScene. The registry exists so a future transition mechanism can call `getLevelConfig(n)` without knowing the individual file names. GameScene still hard-codes Level 1 for now.

**WeatherSystem implements GameSystem** — registered with WorldState and auto-ticked each frame; GameScene's `update()` does not call it directly. The scheduler alternates clear ↔ rain with randomised gap (30–120 s) and duration (10–30 s). Rain audio is commented out pending the asset file.

**BurrowHole event-based spawn wiring** — the hole emits `'hole-spawned'` carrying the new `CombatEntity`; `CombatArenaScene` is the listener that calls `addPhysics()`, `setOpponent()`, and pushes into `aliveEnemies`. This keeps physics wiring out of the entity and follows the same boundary used by NpcDialogScene (no scene imports in entities).

**BiomeBlend follows CliffSystem pattern** — pure detection pass in a `world/` module; rendering in `GameScene.drawBiomeBlendStrips()`. The same split was used for cliff faces (`CliffSystem.ts` + `GameScene.drawCliffEdges()`). New terrain features should follow this pattern: pure data-transform in `world/`, render call-site in GameScene.

**NavScene world dev panel** — Decor and Animals layer toggle buttons are visible only in WilderView dev mode (`/world` route). They emit `nav-toggle-decor` / `nav-toggle-animals` on the global event bus; GameScene handles them and fires `nav-decor-changed` / `nav-animals-changed` back with the new boolean state so NavScene can update button labels.

**`entities/heroes/` subdirectory** — arena hero classes are kept separate from arena enemies to make the hero tier list browsable. All heroes extend `CombatEntity` and implement a signature ability triggered by the hero's key binding in CombatArenaScene.

---

## Review Notes — 2026-04-17

### What changed this week
- **FIL-58**: `WeatherSystem.ts` extracted as a standalone `GameSystem` — random rain/ash scheduling, screen-space particle streaks and dark overlay; registered with WorldState, not ticked by GameScene directly
- **FIL-177**: `BiomeBlend.ts` — biome-boundary detection for feathered transition strips; follows the same module + call-site pattern as CliffSystem
- **FIL-260**: `LakeData.ts` — BFS flood-fill from map borders to classify ocean vs inland lake tiles; enables split water animation (river-anim for lakes, ocean-anim for sea)
- **FIL-258**: Water rendering split into `river-anim` and `ocean-anim` animation tracks in GameScene
- **FIL-292/293**: `BurrowHole.ts` entity — stationary dungeon spawn point with 4 visual states (idle pulse, pre-spawn glow, HP cracks, collapse); placed 2–3 per wave in dungeon rooms; emits `hole-spawned` event for scene-level physics wiring
- **FIL-331**: NavScene World Dev panel — Decor and Animals layer toggle buttons added; panel name corrected from "WilderView" to "World Dev"
- **fix**: attract overlay and HUD suppressed in `/world` dev mode
- **Audio pass**: night ambience layer, phase-transition music stingers, UI hover SFX, portal-reveal audio sequencing (duck → jingle → swell), victory fanfare before ambient loop, footstep interval/volume scaled with movement speed
- **Hero death linger**: 3 s dead-pause, enemies fade out, then full reset in CombatArenaScene
- Architecture doc updated to include previously undocumented files: `CliffSystem`, `SeasonSystem`, `DungeonGen`, `BuildingCatalogue`, `SettlementLayout`, `Spinolandet`, all new entity types, `heroes/` subdirectory

### Concerns
- **GameScene.ts is now ~7 450 lines** — grew by ~1 150 lines since the last review three days ago, now significantly above the 6 300 noted then. This is the most urgent structural concern. The procedural terrain pipeline (river tracing, lake BFS, biome blend, cliff detection, decoration scatter) is already partially extracted into `world/` modules, but the call sites, grid allocations, and rendering loops for each are still added directly to GameScene. A `TerrainBaker` coordinator in `world/` that owns all grid bake steps and returns a result object to GameScene could meaningfully reduce the scene.
- **Deprecated `RiverBand` exports still in `RiverData.ts`** — carried over from last week; still ready to delete.
- **`Spinolandet.ts` placement** — faction wave definitions live in `world/` but are not terrain or world-state data; they are arena content. A `src/arena/` or `src/factions/` directory would be a more honest home as more level-specific wave files accumulate.
- **`SkillSystem` and `matluRuns` in `lib/`** — `lib/` continues to mix true utilities (noise, rng, i18n) with game-domain code. Not an immediate problem, but worth splitting into `src/systems/` and `src/db/` in a future pass.
- **No unit tests on pure data modules** — `LakeData.ts`, `BiomeBlend.ts`, `DungeonGen.ts`, and `CliffSystem.ts` are all pure TypeScript with no Phaser dependency. They are exactly the kind of code that is easy to unit-test. Adding even a handful of tests would catch regressions before they reach the rendered game.

---

## Web Layer — Three Deployable Sites

The repo contains three independently deployed Vercel projects. Each has its own `package.json` and root directory setting in Vercel.

| Directory | Vercel project | URL | Stack | Purpose |
|---|---|---|---|---|
| `/` (root) | `matlu` | matlu.vercel.app | Phaser 3 + Vite SPA | The game |
| `wiki/` | `matlu-codex` | matlu-codex.vercel.app | Astro 6 static | Player-facing community hub — lore, biomes, creatures, playtest feedback |
| `dev/` | `agentic-experiments` | agentic-experiments.vercel.app | Astro 6 static | Internal dev log — metrics dashboard, agent performance, architecture notes, blog |

**Shared infrastructure**
- All three are in one GitHub repo and share `.github/` workflows.
- `collect-stats.js` (runs Sunday 08:00 UTC) writes to Supabase `stats_weekly`, then fires `VERCEL_DEPLOY_HOOK` to rebuild `agentic-experiments` so the metrics dashboard picks up the new row.
- The `wiki/` and `dev/` Astro sites use the same `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY` env vars already set on the main game project in Vercel.

**dev/ page map**
```
/             index.astro          — landing + 4 metric cards (stats_weekly latest row)
/metrics      metrics.astro        — 6 Chart.js charts + complexity hotspots table
/blog         blog/index.astro     — dev blog (content collections, Markdown)
/architecture architecture.astro  — renders ARCHITECTURE.md
/agents       agents.astro         — agent outcome table (Linear agent:* labels)
```

**wiki/ page map**
```
/             index.astro (scaffold)
/lore         lore/index.astro     — Notion-driven lore entries
/biomes       biomes/index.astro   — biome cards
/creatures    creatures/           — gallery + submission form
/playtest     playtest.astro       — playtest feedback form
```
