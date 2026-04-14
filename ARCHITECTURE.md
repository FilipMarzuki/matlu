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
    │   ├── NavScene (persistent overlay — mode toggle, free-cam)
    │   ├── PauseMenuScene (overlay)
    │   ├── NpcDialogScene (modal — blocks input until choice)
    │   ├── UpgradeScene (modal shop — permanent upgrades at shrines)
    │   ├── ShopScene (modal shop — consumable items from vendor NPCs)
    │   ├── StatsScene (read-only overlay)
    │   ├── GameOverScene (overlay — shown on HP = 0)
    │   ├── LevelCompleteScene (overlay — shown on portal reach)
    │   └── EndingScene (launched on portal reach — freezes GameScene)
    │
    └── CombatArenaScene  ← infinite wave arena
        └── NavScene (persistent overlay)
```

Scenes communicate via Phaser event bus (`this.game.events`). Key events:
- `ws:alignment-updated` — NpcDialogScene → WorldState → EndingScene reads on launch
- `boss-died` — unlocks portal
- `upgrade-purchased` — GameScene deducts `playerGold`
- `shop-purchased` — ShopScene → GameScene applies consumable effect (heal / cleanse_pct)

---

## File Structure

```
src/
├── main.ts                   # Phaser game config, global plugin registration
├── scenes/                   # One file per screen/mode (see Scene Graph above)
│   ├── GameScene.ts          # Main gameplay (~6 300 lines — see Internals)
│   ├── CombatArenaScene.ts   # Infinite wave arena
│   ├── WilderviewScene.ts    # Standalone nature sim (background + menu mode)
│   ├── MainMenuScene.ts      # Entry point — orchestrates background scenes
│   ├── NavScene.ts           # Persistent HUD overlay (mode toggle, free-cam)
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
│   ├── CorruptedGuardian.ts  # Level 1 boss: 3-phase charge AI, spawns rabbits in phase 2+
│   ├── Projectile.ts         # Ranged cleanse bolt
│   ├── Bird.ts               # Atmospheric flight objects
│   ├── WildlifeAnimal.ts     # Deer, fox, hare etc. with roam/flee/chase FSM
│   └── GroundAnimal.ts       # Base for wildlife
├── environment/
│   ├── SolidObject.ts        # Colliders (mountains, barriers)
│   ├── InteractiveObject.ts  # Shrines, NPCs — trigger dialog on E
│   └── Decoration.ts         # Visual-only (trees, rocks)
├── world/
│   ├── WorldState.ts         # Shared observable state (see Data Flow)
│   ├── WorldClock.ts         # Day/night cycle, 6 phases, colour overlay
│   ├── CorruptionField.ts    # 2D noise-driven local corruption intensity
│   ├── PathSystem.ts         # Road segments — affects speed + animal routing
│   ├── AnimalTrailGen.ts     # Procedural animal trail generation between POIs (FIL-88)
│   ├── ChunkDef.ts           # Hand-authored set-piece templates (tree clusters, ruins, etc.)
│   ├── DecorationScatter.ts  # Poisson disk decoration placement (flowers, mushrooms, etc.)
│   ├── RiverData.ts          # Diagonal river paths via gradient descent (FIL-166)
│   ├── MapData.ts            # WORLD_W × WORLD_H tile grid
│   ├── Level1.ts             # Level 1 constants: zones, NPC positions, endings
│   ├── Level1Paths.ts        # Level 1 hand-authored path segments
│   ├── Level2.ts             # The Spine Reaches (Spinolandet) — scaffold
│   ├── Level3.ts             # Vattenpandalandet Mist — scaffold
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

Central shared state, one instance per GameScene run:

```
WorldState
├── cleansePercent: 0–100      → drives CorruptionPostFX intensity
├── alignment: { earth, spino, vatten }  → determines ending
├── combatActive: boolean      → used for music ducking
└── weather: clear | rain | ash
```

Alignment is adjusted by NPC dialog choices. It is intentionally hidden from the player during play — revealed only in EndingScene's bar display.

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

`scenes/GameScene.ts` is ~6 300 lines and owns the main game loop. Key responsibilities:

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
Three independent fBm noise layers (elevation, temperature, moisture), each seeded by `runSeed XOR constant`. Biome lookup via multi-level if-else in `terrainTileFrame()`. Rivers are traced by gradient descent in `RiverData.ts` and baked into an `isRiverTile[]` lookup grid before `create()` completes.

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
| CombatArenaScene | 1× | Arena fits viewport at 1:1 |
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
FOOTSTEP_INTERVAL_MS = 380
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

---

## Review Notes — 2026-04-14

### What changed this week
- **FIL-143**: `LevelRegistry.ts` + `LevelTypes.ts` scaffold for five-level arc; Level 2–5 data files added as stubs
- **FIL-93**: `ShopScene.ts` — consumable vendor shop overlay; communicates with GameScene via `shop-purchased` event
- **FIL-95**: `lib/SkillSystem.ts` — invisible XP and skill progression persisted in localStorage
- **FIL-92**: Loot containers (interactive chests) added near settlements
- **FIL-166 through FIL-170**: River system rewritten — `RiverData.ts` now uses gradient-descent path generation + Catmull-Rom spline smoothing; old horizontal `RiverBand` system deprecated (still in file)
- **FIL-172**: Four new biomes added (marsh, snow, sandy shore, river-bank wetland)
- **FIL-198 / agent infrastructure**: Multiple GitHub Actions agent workflows added (nightly per-issue, triage, architecture review, error monitor, lore, release notes, learning summary). Documented in `INFRASTRUCTURE.md`; not game-logic architecture
- `WilderviewScene`, `GameOverScene`, `LevelCompleteScene`, `SettingsScene`, `LoreScene` added to scene graph (were missing from previous doc)
- `AnimalTrailGen.ts`, `ChunkDef.ts`, `DecorationScatter.ts` extracted procedural helpers now documented in world/ structure

### Concerns
- **GameScene.ts is now ~6 300 lines** — up from the ~5 800 noted in the previous doc. It continues to grow as new systems land (shop hooks, skill XP calls, river tile grid, new biomes). No immediate crisis, but extraction opportunities exist: the procedural terrain pipeline (river tracing, biome bake, decoration scatter) is already partially extracted into world/ helpers; completing that extraction would bring GameScene closer to a pure coordinator.
- **Deprecated `RiverBand` exports still in `RiverData.ts`** — the comment says all consumers have migrated, so this is ready to delete. Leaving dead deprecated code in an active file adds noise.
- **Level 2–5 stubs have placeholder coordinates** — they compile and are registered in the registry, but they all use approximate world-space positions that haven't been playtested. When the level-switching mechanism lands, each level will need a full coordinate pass.
- **`SkillSystem` lives in `lib/` but is more game-domain than utility** — `lib/` mixes true utilities (noise, rng, i18n) with game-specific systems (SkillSystem, matluRuns). A `src/systems/` directory would be a cleaner home for SkillSystem once there are more systems like it.
