# Wildlife Species Pipeline

How to add a new wildlife species from concept to in-game. **One species at a time, fully complete, before starting the next.** No half-done species in the registry.

---

## Definition of Done

A species is **shipped** when ALL of these are true:

- [ ] Registry entry in `fauna-registry.json` with all fields populated
- [ ] Idle + walk sprites generated, assembled, and committed
- [ ] Animations registered and playing in-game
- [ ] Spawns in correct biomes at tuned density
- [ ] Archetype behavior works (grazer/predator/critter/flocking)
- [ ] Hunt strategy works if predator (pursuit/ambush/pack/dive)
- [ ] Foraging behavior works in correct biomes
- [ ] Activity cycle correct (diurnal/nocturnal/crepuscular)
- [ ] Flee + group flee works
- [ ] Visible in `/assets` viewer with green dot (wired)
- [ ] Playtested: looks right, feels right, doesn't break anything
- [ ] `npm run typecheck` + `npm run build` pass
- [ ] Committed with sprites + manifests together

---

## Step 1 — Design (no code yet)

Decide what this species adds to the ecosystem. Answer these before writing anything:

| Question | Why it matters |
|----------|---------------|
| What biomes does it live in? | Spawn placement, foraging |
| Is it prey, predator, or neither? | Hunt strategy, predator-prey wiring |
| What archetype? (grazer/predator/critter/flocking) | Core behavior pattern |
| Solitary or group? | Cluster config, pack hunting eligibility |
| What does it eat / forage for? | Foraging type + biomes |
| When is it active? (diurnal/nocturnal/crepuscular) | Activity cycle |
| What real-world animal is it closest to? | Guides sprite description + sounds |
| How big is it? (body w/h, scale) | Physics + visual presence |
| How does it move? (speed, flee range) | Balance tuning |

Write answers in a brief one-paragraph **personality** that goes in the registry.

---

## Step 2 — Registry entry

Add a complete entry to `public/macro-world/fauna-registry.json`. Copy an existing species that's similar and modify. Every field must be filled — no nulls except `designNotes` (filled by agent) and `foraging` (if the species doesn't forage).

```json
{
  "id": "wildcat",
  "name": "European Wildcat",
  "class": "ground",
  "world": "earth",
  "archetype": "predator",
  "activity": "nocturnal",
  "diet": "carnivore",
  "solitary": true,
  "body": { "w": 18, "h": 12 },
  "scale": 1.8,
  "fleeRange": 120,
  "fleeSpeed": 100,
  "roamSpeed": 25,
  "count": 6,
  "spawning": { ... },
  "biomes": [7, 8],
  "spawnBias": { "optimal": [0.48, 0.78], "falloff": 0.1 },
  "sprites": { ... },
  "sounds": { "flee": { ... } },
  "interactions": { "predatorOf": ["grouse", "hare"], "chaseRange": 50, "huntStrategy": "ambush" },
  "foraging": null,
  "designNotes": null
}
```

**Validate**: `npm run build` must pass with the new entry (sprites can point to placeholder keys temporarily).

---

## Step 3 — Sprites

Generate sprites via PixelLab MCP following `src/ai/AGENTS.md`.

### 3a. Standard animation set

Every wildlife species gets **8 animations**. Each maps to one or more behavior states:

| Animation | Description | Used by states | Priority |
|-----------|-------------|----------------|----------|
| **idle** | Standing still, subtle breathing/shift | roaming (stopped), alert fallback | Required |
| **walk** | Normal locomotion | roaming, pack-intercepting | Required |
| **run** | Fast/panicked movement | fleeing, chasing, pack-flushing, ambush-strike, scatter burst | Required |
| **eat** | Head down, pecking/browsing/rooting | grazing, foraging (grubbing/browsing/pecking/fishing) | Required |
| **sleep** | Lying down / curled up | sleeping (activity cycle) | Required |
| **sneak** | Low crouch-walk | stalking, ambush approach (roaming toward ambush spot) | Required for predators |
| **alert** | Head up, body tense, ears forward | alert (grazer watching player), frozen (critter) | Required for prey |
| **death** | Collapse / crumple | prey caught by predator, killNeutralAnimal | Required |

For **birds**, replace idle/walk/run/sneak with:

| Animation | Description | Used by states |
|-----------|-------------|----------------|
| **fly** | Normal flight | flying, flocking |
| **dive** | Wings tucked, plunging | diving (hunt strategy) |
| **glide** | Wings spread, circling | circling (pre-dive orbit) |

Bird full set: **fly, dive, glide, eat, sleep, alert, death** (7 animations).

### 3b. Choose PixelLab parameters

| Creature type | `body_type` | `template` | `n_directions` | `view` |
|---------------|-------------|-----------|----------------|--------|
| Small quadruped (cat, fox) | `quadruped` | `cat` or `dog` | 8 | `low top-down` |
| Large quadruped (wolf, deer) | `quadruped` | `bear` or `lion` | 8 | `low top-down` |
| Ungulate (horse, deer, stag) | `quadruped` | `horse` | 8 | `low top-down` |
| Ground bird (grouse, chicken) | `humanoid` | — | 8 | `low top-down` |
| Flying bird | `humanoid` | — | 8 | `high top-down` |
| Snake/crawler | `humanoid` | — | 4 | `high top-down` |

**PixelLab credits**: check `npm run sprites:status` first. Never spend credits without user approval (see feedback memory: pixellab_credits).

### 3c. Animation generation order — ONE AT A TIME

**Critical rule: generate one animation, wire it, verify in-game, THEN generate the next.** Never batch-generate. If the first one looks wrong, you learn before wasting credits.

| Order | Animation | Method | Wire + verify |
|-------|-----------|--------|---------------|
| 1 | **idle** | template (1 gen/dir) | Wire → see it standing in-game → confirm |
| 2 | **walk** | template (1 gen/dir) | Wire → see it roaming → confirm |
| 3 | **run** | template `fast-walk` or `running-4-frames` | Wire → startle it → confirm flee looks different from walk |
| 4 | **eat** | custom v3: `"eating from the ground, head down"` | Wire → wait for foraging/grazing → confirm head-down visible |
| 5 | **sleep** | custom v3: `"lying down, curled up sleeping"` | Wire → wait for night → confirm sleeping pose |
| 6 | **alert** | custom v3: `"standing alert, head raised, ears forward"` | Wire → approach at 1.5× flee range → confirm tense look |
| 7 | **sneak** | template `sneaking` (quad) or custom v3 | Wire → watch predator stalk → confirm low crouch |
| 8 | **death** | custom v3: `"collapsing, falling to the ground"` | Wire → let predator catch prey → confirm death visible |

Each step: generate → download PNG → update registry sprites → reload game → visually confirm the behavior looks right → THEN proceed to next.

**Stop point**: idle + walk + run is minimum shippable. The synthetic animations (framerate hacks) handle everything else acceptably until real sprites are generated.

**Quadruped template animations available**: idle, walk-4/6/8-frames, fast-walk, running-4/6/8-frames, sneaking, bark. Use templates where possible (1 gen/direction = cheap). Fall back to custom v3 for eat/sleep/alert/death (also 1 gen/direction).

### 3d. Generate and download

1. `create_character` with species description
2. Get human approval on the base character preview
3. Queue animations one at a time in the order above (3c)
4. Download PNGs to `public/assets/sprites/wildlife/<species-id>/`

### 3e. Assemble spritesheets

```bash
npm run sprites:assemble -- --id <species-id>
```

### 3f. Update the registry

Fill in the `sprites` object with actual keys, paths, frame dimensions, and frame indices for all generated animations:

```json
"sprites": {
  "idle":  { "key": "wolf-idle",  "path": "assets/sprites/wildlife/wolf/idle.png",  "frameWidth": 32, "frameHeight": 32, "frames": [0,1,2,3], "frameRate": 6 },
  "walk":  { "key": "wolf-walk",  "path": "assets/sprites/wildlife/wolf/walk.png",  "frameWidth": 32, "frameHeight": 32, "frames": [0,1,2,3,4,5], "frameRate": 8 },
  "run":   { "key": "wolf-run",   "path": "assets/sprites/wildlife/wolf/run.png",   "frameWidth": 32, "frameHeight": 32, "frames": [0,1,2,3], "frameRate": 12 },
  "eat":   { "key": "wolf-eat",   "path": "assets/sprites/wildlife/wolf/eat.png",   "frameWidth": 32, "frameHeight": 32, "frames": [0,1,2,3,4,5], "frameRate": 6 },
  "sleep": { "key": "wolf-sleep", "path": "assets/sprites/wildlife/wolf/sleep.png", "frameWidth": 32, "frameHeight": 32, "frames": [0,1,2,3], "frameRate": 4 },
  "sneak": { "key": "wolf-sneak", "path": "assets/sprites/wildlife/wolf/sneak.png", "frameWidth": 32, "frameHeight": 32, "frames": [0,1,2,3,4,5], "frameRate": 6 },
  "alert": { "key": "wolf-alert", "path": "assets/sprites/wildlife/wolf/alert.png", "frameWidth": 32, "frameHeight": 32, "frames": [0,1,2,3], "frameRate": 6 },
  "death": { "key": "wolf-death", "path": "assets/sprites/wildlife/wolf/death.png", "frameWidth": 32, "frameHeight": 32, "frames": [0,1,2,3,4,5], "frameRate": 8 }
}
```

### 3g. Wire into preload

Add `this.load.spritesheet(...)` calls to `GameScene.preload()` for the new sprite keys. Follow the existing pattern.

---

## Step 3.5 — Life stage sprites (optional, high polish)

Each species spawns in 3 life stages: **young** (25%), **adult** (60%), **elder** (15%). By default, all stages use the same sprite with scale + tint modifiers (young = 60% scale, elder = 93% + grey tint). Stage-specific sprites are optional but make a big visual difference.

### When to generate stage sprites

- **Minimum viable**: adult sprites only. Young/elder use scale + tint. Ship this first.
- **High polish**: generate young + elder variants after adult is confirmed good. Do this as a second pass, not during initial species creation.

### PixelLab rules for stage consistency

**Critical: all stages must look like the same animal.** Use `create_object_state` (not `create_character`) to derive young/elder from the adult character. This ensures consistent anatomy, palette, and style.

| Rule | Why |
|------|-----|
| **Generate adult first, always** | Adult is the reference. Young and elder are derived from it. |
| **Use the same `character_id`** for all stages | PixelLab keeps the base character consistent across states. |
| **Describe stage differences in the action_description, not the character description** | Don't create a new character for each stage. Instead, create a new animation state: `"same animal but younger/smaller, slightly rounder proportions, softer features"` |
| **Young = smaller + rounder** | Description: `"juvenile version, proportionally smaller, slightly larger head relative to body, softer features, same coloring but slightly lighter"` |
| **Elder = same size + weathered** | Description: `"older version, slightly greyed muzzle and back, thinner build, same posture but less energetic movement"` |
| **Never change the species** | A young wolf must still be recognizably a wolf, not a different animal. Same silhouette, same palette family. |
| **Match frame count and dimensions** | All stages must use the same `frameWidth`/`frameHeight` so they share animation timing. Scale difference comes from the sprite content, not the frame size. |

### Stage sprite naming convention

```
public/assets/sprites/wildlife/<species>/
  idle.png          ← adult (default)
  idle-young.png    ← young variant
  idle-elder.png    ← elder variant
  walk.png
  walk-young.png
  walk-elder.png
  ...
```

### Registry wiring for stage sprites

When stage sprites exist, add them to the registry's `sprites` object with stage-suffixed keys:

```json
"sprites": {
  "idle":       { "key": "wolf-idle",       ... },
  "idle-young": { "key": "wolf-idle-young", ... },
  "idle-elder": { "key": "wolf-idle-elder", ... },
  "walk":       { "key": "wolf-walk",       ... },
  "walk-young": { "key": "wolf-walk-young", ... },
  "walk-elder": { "key": "wolf-walk-elder", ... }
}
```

The `playAnimalAnim` helper resolves animations in this priority order:

```
{type}-{action}-v{variantId}-{stage}-anim   ← variant + stage specific
{type}-{action}-v{variantId}-anim            ← variant specific
{type}-{action}-{stage}-anim                 ← stage specific
{type}-{action}-anim                         ← base
fallback chain (run→walk, eat→idle, etc.)    ← graceful degradation
```

All levels are optional. A species with only `idle` + `walk` sprites still works for every behavior state, variant, and life stage.

### Generation order (stages + variants)

**Stages** (after adult is confirmed good):
1. Ship with adult sprites only (all stages use scale + tint)
2. Generate young idle + walk
3. Then elder idle + walk
4. Run/eat/sleep stage variants are lowest priority

**Variants** (individual markings — optional high-polish pass):
1. Ship with 1 variant (all individuals look the same, `variants: 1` or omit)
2. Add `variants: 3-5` to registry when ready to invest
3. Generate variant idle sprites first (most visible)
4. Then variant walk sprites
5. Variant × stage combinations are very low priority — the variant at base level already sells individuality

## Step 3.6 — Visual variants (optional, individual markings)

Each species can have multiple visual variants — distinctive markings that make individuals recognizable. Set `"variants": 5` in the registry to enable 5 variants (individuals get assigned `variantId` 0-4 at spawn, persists through aging).

### PixelLab rules for variant consistency

| Rule | Why |
|------|-----|
| **Same `body_type`, `template`, `size`, `view`** for all variants | They must be the same species |
| **Only change coloring/markings in the description** | `"same deer, darker back and lighter belly"` not `"a different deer"` |
| **Keep the same silhouette** | Variants differ in color/pattern, not body shape |
| **Match frame count and dimensions** | All variants share animation timing |
| **Name variants clearly** | `deer-idle-v0`, `deer-idle-v1`, etc. |

### Variant sprite naming convention

```
public/assets/sprites/wildlife/<species>/
  idle.png          ← variant 0 / base (all variantId=0 animals use this)
  idle-v1.png       ← variant 1
  idle-v2.png       ← variant 2
  idle-v1-young.png ← variant 1, young stage (highest polish level)
```

### Variant description examples (for PixelLab `action_description`)

| Variant | Deer description |
|---------|-----------------|
| v0 | (base character — standard brown coat) |
| v1 | `"same deer but with a darker brown back and lighter cream belly"` |
| v2 | `"same deer but with a distinctive white chest patch"` |
| v3 | `"same deer but with reddish-brown tone and faint spots on flanks"` |
| v4 | `"same deer but with pale blonde coat, lighter overall"` |

### Aging + variants together

Each individual has both a `variantId` (markings) and a `lifeStage` (young/adult/elder). The variant persists as the animal ages — variant 2 young deer grows into variant 2 adult deer with the same white chest patch. Aging is driven by `WorldClock.dayCount` and configured per species via `"aging": { "youngDuration": 3, "adultDuration": 12 }` (game-days).

---

## Step 4 — Sounds

Wildlife needs at minimum a **flee vocalization**. This goes in the `sounds.flee` field.

**Option A — Reuse existing**: Pick from the 5 `animal-rustle-{0-4}` files and adjust `rate` (pitch). Most species can share audio with pitch shifting. A rate of 0.4 = deep (large animal), 2.0 = high (small animal).

**Option B — New audio**: Download from freesound.org or record. Place in `public/assets/audio/animal/`. Add `this.load.audio(...)` in GameScene preload.

Update the registry `sounds.flee` with the key, volume, and rate.

---

## Step 5 — Spawn tuning

### 5a. Set cluster config

Use existing species as reference:

| Group type | clusters | perCluster | clusterR | clusterMinDist |
|------------|----------|-----------|----------|----------------|
| Large herd (deer) | [6, 9] | [5, 8] | 60 | 600 |
| Small covey (grouse) | [6, 9] | [3, 5] | 40 | 400 |
| Solitary (fox) | [1, 1] | [1, 1] | 300 | 300 |
| Pair/small group (badger) | [5, 9] | [2, 4] | 40 | 350 |

### 5b. Set spawn bias

The `optimal` range maps to the continuous terrain noise value (0–1.2):

| Terrain value | Biome |
|---------------|-------|
| < 0.25 | Open water (never spawn) |
| 0.25–0.33 | Shore |
| 0.33–0.48 | Coastal heath |
| 0.48–0.65 | Mixed forest |
| 0.65–0.85 | Dense spruce |
| 0.85+ | Highland |

### 5c. Playtest

Run `npm run dev`, observe:
- Does the species appear in the right biomes?
- Is the density reasonable (not too sparse, not overwhelming)?
- Does it interact correctly with predators/prey?
- Does the archetype behavior look natural?
- Does foraging trigger in the right terrain?

Adjust `count`, `spawning`, and `spawnBias` values until it feels right.

---

## Step 6 — Verify

Run through this checklist:

```
npm run typecheck          # No type errors
npm run build              # Builds cleanly
npm run assets:sprites     # Sprite manifest updated
```

In-game verification:
- [ ] Species spawns in correct biomes
- [ ] Idle animation plays when standing
- [ ] Walk animation plays when moving
- [ ] Flee works (player approaches → animal flees with sound)
- [ ] Group flee works (nearby same-species also bolt)
- [ ] Activity cycle works (sleeps at correct time of day)
- [ ] Archetype behavior works (grazing/territory/warren/flocking)
- [ ] Hunt strategy works if predator
- [ ] Foraging triggers in correct biomes
- [ ] No console errors
- [ ] Visit `/assets` → species shows green dot

---

## Step 7 — Commit

Commit **everything together** in one commit:
- Registry JSON update
- Sprite PNGs
- Updated sprite manifest
- GameScene preload additions
- Any sound files

Reference the GitHub issue: `Closes #NNN`

---

## Species queue

Track upcoming species here. Only the top one is in progress. Move to "Done" when shipped.

### In progress

(none)

### Backlog

| Species | Archetype | Hunt strategy | Priority | Notes |
|---------|-----------|--------------|----------|-------|
| Wolf | predator | pack | High | Tests pack hunting system |
| Wildcat | predator | ambush | High | Tests ambush hunting system |
| Hawk | predator (bird) | dive | High | Tests dive hunting system |
| Woodpecker | critter (bird) | — | Medium | Tests pecking foraging |
| Heron | critter | — | Medium | Tests fishing foraging |
| Snake | predator | ambush | Medium | Ground ambush variant |
| Rabbit (wild) | critter | — | Low | Distinct from corrupted rabbits |
| Owl | predator (bird) | dive | Low | Nocturnal dive hunter |

### Done

| Species | Issue | Date |
|---------|-------|------|
| (existing 7 ground + 2 bird species were pre-pipeline) | — | — |
