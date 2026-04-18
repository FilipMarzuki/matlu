# Entity Specification — Matlu

Every combat entity (enemy, hero, NPC) must satisfy this checklist before it is
considered "ship-ready". The audit script (`npm run entity:audit`) reads
`src/entities/entity-registry.json` and validates against disk automatically.

---

## The three layers

Every entity communicates through three synchronized layers. A missing layer
creates a gap the player notices even if they can't name it.

| Layer | Responsibility |
|-------|---------------|
| **Behavior** | What the entity *does* — its AI state machine |
| **Animation** | What the entity *looks like* at each state |
| **Sound** | What the entity *sounds like* at each state |

---

## Behavior states

```
Unaware → Alert → Tracking → Combat
   ↑         │        │          │
   └─────────┴────────┴──────────┘  (loses contact / dies)
```

| State | Description | Required for |
|-------|-------------|--------------|
| **Unaware** | No known threat. Patrols/wanders. | All enemies |
| **Alert** | Heard/sensed something. Investigating sound origin. | All enemies |
| **Tracking** | Confirmed visual target. Chasing. | All enemies |
| **Combat** | In attack range. Executing attack pattern. | All enemies |
| **Stunned** | Recovering from CC or knockback. | All enemies |
| **Flee** | Self-preservation escape at low HP. | Optional |
| **Dead** | Death animation playing → corpse or dissolve. | All entities |

### Detection config (required per enemy)

| Field | What it controls |
|-------|-----------------|
| `aggroRadius` | Vision range — max distance to acquire a target |
| `hearingRadius` | Sound range — max distance to receive sound events |
| `proximityRadius` | Touch range — detect regardless of LOS (default 60px) |
| `sightMemoryMs` | How long to chase a target after losing LOS |

---

## Animation states

All animations use Aseprite exported spritesheets. Tags follow the convention
`{state}_{direction}` where direction is `south`, `south-east`, `east`,
`north-east`, or `north` (west is derived by horizontal flip).

| Tag pattern | Description | Required for |
|------------|-------------|--------------|
| `idle_*` | Standing still. Subtle breathing/shuffle loop. | All entities |
| `walk_*` | Moving. Should feel distinct from idle — more energy. | All entities |
| `attack_*` | Attack. Must include **wind-up frames** before the hit frame. | All enemies |
| `death_*` | Death. Plays to last frame and holds (or transitions to corpse). | All entities |
| `hurt` | Flinch/stagger. Can be a short 2–3 frame reaction. | Strongly recommended |
| `alert` | "Noticed" moment — head raise, body tense. Plays once on aggro. | Recommended |

### Telegraph rule

The attack animation **must** have visible wind-up frames before the hit lands.
Players read these as "I have N frames to dodge." No telegraph = unfair damage.
Minimum: 3 frames of wind-up at 8fps = ~375ms warning.

---

## Sound states

Three distinct layers, played simultaneously at different volumes.

### Layer 1 — Ambient (always active while alive)

Random-interval idle vocalizations. Low volume. Multiple variants.

```ts
// In CombatEntityConfig:
ambientSounds: {
  keys:          ['sfx-{entity}-ambient-0', 'sfx-{entity}-ambient-1', 'sfx-{entity}-ambient-2'],
  intervalMinMs: 3000,   // tune per entity personality
  intervalMaxMs: 9000,
  volume:        0.20,   // low — this is background
  pitchMin:      0.90,
  pitchMax:      1.10,
}
```

**Naming convention:** `sfx-{entity-slug}-ambient-{n}.ogg`
**File location:** `public/assets/audio/creatures/{entity-slug}/`
**Minimum variants:** 3 (players notice repeating within ~8 s)

### Layer 2 — State-driven (fired on state transitions)

| Transition | Sound | Notes |
|------------|-------|-------|
| Unaware → Alert | `sfx-{entity}-alert` | Quiet, inquisitive |
| Alert → Tracking | `sfx-{entity}-aggro` | Louder — "I see you" |
| Tracking → Attack | `sfx-{entity}-attack-windup` | Telegraphs hit |
| (impact frame) | `sfx-{entity}-attack-impact` | Hit lands |
| Any → Hurt | `sfx-{entity}-hurt-{0,1,2}` | 2–3 variants |
| Any → Dead | `sfx-{entity}-death` | Distinct from hurt |

**The aggro sound is the most important.** It tells the player "I see you"
before the enemy physically reaches them — this is fair warning.

### Layer 3 — Reactive (per-action)

- Footsteps (optional for small/light enemies)
- Projectile fire / swoosh
- Special ability activation

### Volume rules

- Ambient: 0.15–0.25 (background)
- State sounds: 0.40–0.65 (noticeable)
- Reactive/impact: 0.55–0.80 (punchy)
- Distance attenuation: CombatArenaScene applies linear falloff beyond 420px

---

## Adding a new entity — checklist

Copy this block into the registry, fill in, implement in order:

```jsonc
{
  "class": "MyEnemy",
  "file": "src/entities/MyEnemy.ts",
  "type": "enemy",           // "enemy" | "hero" | "summon" | "neutral"
  "world": "spinolandet",    // which game world this belongs to
  "personality": "One-line flavor — what makes this entity feel distinct",
  "spriteKey": null,         // fill when sprite is ready
  "spritesheetJson": null,   // fill when spritesheet is exported
  "animTags": {
    "idle":   null,          // fill with tag name when spritesheet has it
    "walk":   null,
    "attack": null,
    "hurt":   null,
    "death":  null,
    "alert":  null
  },
  "sounds": {
    "ambient": null,         // { "keys": [...], "files": [...] }
    "alert":   null,
    "aggro":   null,
    "attack":  null,
    "hurt":    null,
    "death":   null
  },
  "behavior": {
    "buildTree":     false,
    "unaware":       false,
    "alert":         false,
    "tracking":      false,
    "combat":        false,
    "flee":          false,
    "aggroRadius":   null,
    "hearingRadius": null,
    "sightMemoryMs": null
  }
}
```

**Implementation order:** behavior → animations → sounds. Don't record a sound
gap as a blocker if behavior isn't implemented yet.

---

## Completeness scoring

The audit script scores each entity as `done / total` required fields:

| Category | Points |
|----------|--------|
| Behavior (unaware, alert, tracking, combat, detection config) | 7 |
| Animation (idle, walk, attack, death, hurt) | 5 |
| Sound (ambient, aggro, attack, hurt, death) | 5 |
| **Total** | **17** |

Alert animation and alert/flee sounds are bonus (not counted in the base score).
An entity needs **≥14/17 (82%)** to be considered ship-ready.
