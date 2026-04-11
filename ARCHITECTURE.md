# Matlu — Code Architecture

Top-down exploration game. Phaser 3 + TypeScript, procedural world, corruption shader, four branching endings.

---

## Scene Graph

```
MainMenuScene
├── CombatArenaScene (background preview)
├── CreditsScene (overlay)
└── [user picks mode]
    │
    ├── GameScene  ← main gameplay (wilderview)
    │   ├── NavScene (persistent overlay — mode toggle, free-cam)
    │   ├── PauseMenuScene (overlay)
    │   ├── NpcDialogScene (modal — blocks input until choice)
    │   ├── UpgradeScene (modal shop)
    │   ├── StatsScene (read-only overlay)
    │   └── EndingScene (launched on portal reach — freezes GameScene)
    │
    └── CombatArenaScene  ← infinite wave arena
        └── NavScene (persistent overlay)
```

Scenes communicate via Phaser event bus (`this.game.events`). Key events:
- `ws:alignment-updated` — NpcDialogScene → WorldState → EndingScene reads on launch
- `boss-died` — unlocks portal
- `upgrade-purchased` — GameScene deducts `playerGold`

---

## File Structure

```
src/
├── main.ts                   # Phaser game config, global plugin registration
├── scenes/                   # One file per screen/mode (see Scene Graph above)
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
│   ├── Level1.ts             # Level constants: zones, NPC positions, endings
│   └── MapData.ts            # WORLD_W × WORLD_H tile grid
├── ai/
│   ├── BehaviorTree.ts       # BtSelector / BtSequence / BtCondition / BtAction / BtCooldown
│   └── ArenaBlackboard.ts    # Inter-entity coordination (dive cooldowns, scout flags)
├── shaders/
│   ├── CorruptionPostFX.ts   # Post-FX pipeline on main camera (distortion, desaturation, vignette)
│   └── ShimmerPostFX.ts      # Arena floor shimmer
└── lib/
    ├── noise.ts              # FbmNoise — fractal Brownian motion (terrain + corruption)
    ├── rng.ts                # mulberry32 PRNG, Poisson disk sampling
    ├── i18n.ts               # t(key) translation function
    ├── logger.ts             # Better Stack integration
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

---

## GameScene Internals

`scenes/GameScene.ts` is ~5 800 lines and owns the main game loop. Key responsibilities:

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
Three independent fBm noise layers (elevation, temperature, moisture), each seeded by `runSeed XOR constant`. Biome lookup via multi-level if-else in `terrainTileFrame()`.

**Projectiles** — tracked in array, filter-each-frame lifetime management (no pooling currently)

**Noise seeding**
```ts
baseNoise ^ 0x74656d70  // temperature
baseNoise ^ 0x6d6f6973  // moisture
baseNoise ^ 0xdeadbeef  // corruption
```

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
