# Iso Combat Migration — Plan of Attack

Target scene: `src/scenes/CombatArenaScene.ts`
Reference implementations:
- World Forge — `src/scenes/BiomeInspectorScene.ts:254–444`
- Overworld — `src/scenes/GameScene.ts:1522–1599` (commit `d95d7b7`, FIL-445/456–462/468–469)
- Shared util — `src/lib/IsoTransform.ts:83–143` (`worldToIso`, `isoToWorld`, `isoDepth`, `isoInputAngleToWorld`)
- Tile catalogue — `src/world/IsoTileMap.ts` (`isoTileFrame`)

---

## Guiding principles (read before picking up any sub-issue)

These are design decisions for the whole epic. Do NOT re-litigate them per issue.

1. **Simulate in world space, render in iso.** Every body keeps `wx, wy, wz` fields in Cartesian world coordinates. `worldToIso` runs only when writing `sprite.x/y/depth`. Physics, AI, pathfinding, spawn logic never see iso coordinates.
2. **Circle colliders for dynamic entities** (hero, enemies, projectiles). Use `body.setCircle(footRadius)` sized to the sprite's foot footprint, not sprite bounds.
3. **AABB colliders for static walls**, axis-aligned in world space. Render is an iso diamond; the collision shape is not rotated. `DungeonGen` output stays the source of truth.
4. **Depth per frame**, never hardcoded. `sprite.depth = isoDepth(wx, wy, wz) + layerOffset` in one sweep each `update()`.
5. **Elevation is a third axis, not a render trick.** Reserve `wz` now (default 0) so M6 knockback/jumps plug in cleanly.
6. **No behaviour changes in M1–M3.** They are pure render/infrastructure. Visual diff only. Gameplay tuning waits for M5+.

---

## Milestone tree

```
EPIC  Iso Combat Migration
├── M1  Foundation            (no visual or gameplay change)
│   ├── 1.1  CombatPhysics module
│   ├── 1.2  updateIsoDepths helper
│   └── 1.3  Iso tileset preload in CombatArenaScene
├── M2  Static world render port
│   ├── 2.1  Floor tiles → iso
│   ├── 2.2  Walls → iso (collision still world-space AABB)
│   └── 2.3  Torches + static decor → iso depth sort
├── M3  Dynamic entity render port
│   ├── 3.1  Hero
│   ├── 3.2  Enemies
│   └── 3.3  Projectiles
├── M4  Input
│   ├── 4.1  Joystick → world vector
│   └── 4.2  Keyboard WASD → world vector
├── M5  Camera
│   ├── 5.1  Iso bounds
│   └── 5.2  Hero-follow + zoom tuning
├── M6  Collision polish
│   ├── 6.1  Swept projectile collision
│   ├── 6.2  z-axis (knockback, jump-over)
│   └── 6.3  Spatial hash broad phase (optional, perf-gated)
└── M7  QA lock-in
    ├── 7.1  Screenshot baselines
    └── 7.2  Smoke playtest
```

Dependency rule: a milestone may only start once every parent has merged. Inside a milestone, leaves may run in parallel unless noted.

---

## M1 — Foundation

### 1.1  Add `src/combat/CombatPhysics.ts`

**What**
New module exposing:
- `createEntityBody(scene, sprite, { footRadius, wx, wy, wz = 0 })` — attaches arcade circle body, stores `wx/wy/wz` on the sprite's data.
- `createWallBody(scene, group, { wx, wy, w, h })` — axis-aligned static rectangle, world-space.
- `syncSpriteToWorld(sprite)` — writes `sprite.x, sprite.y` from `wx, wy, wz` via `worldToIso`.

**Why**
Single place that owns the world↔iso boundary for bodies. Keeps `CombatArenaScene` thin.

**Acceptance**
- Module compiles, exports match above.
- `npm run typecheck` passes.
- No call sites yet — scene keeps its current logic. This is a setup-only PR.

**Scope bound**
Do not modify `CombatArenaScene.ts` in this PR. Do not wire up wall creation yet.

---

### 1.2  Add `updateIsoDepths(entities)` helper

**What**
Export from `src/combat/CombatPhysics.ts` (or a new `src/combat/IsoDepth.ts`):
```ts
export function updateIsoDepths(entities: Iterable<Phaser.GameObjects.Sprite>): void
```
Iterates entities, reads `wx, wy, wz` from their data, writes `sprite.depth = isoDepth(wx, wy, wz)`.

**Acceptance**
- Unit-testable: given a fake sprite with `{ wx: 10, wy: 20 }`, depth is set to `isoDepth(10, 20, 0)`.
- Typecheck passes.

**Scope bound**
Helper only. Not called from anywhere yet.

---

### 1.3  Load iso tileset in `CombatArenaScene.preload()`

**What**
Add `this.load.spritesheet('iso_tiles', '/assets/packs/isometric tileset/spritesheet.png', { frameWidth: 32, frameHeight: 32 })` matching World Forge (`BiomeInspectorScene.ts:124–126`). Do NOT use the asset yet.

**Acceptance**
- Asset loads without 404s in dev.
- Existing `dungeon_floor`/`dungeon_wall_*` still present — scene renders identically.

**Scope bound**
Preload only. No render change.

---

## M2 — Static world render port

Prereqs: M1 all merged.

### 2.1  Port floor rendering to iso

**What**
In `CombatArenaScene.ts` around `:744`: replace `dungeon_floor` sprite placement with iso floor tiles from `isoTileFrame('dungeon', 'floor')`. Each tile positioned via `worldToIso(tileWx, tileWy)`.

**Constraints**
- Collision is unchanged (floor has none today).
- Keep `DungeonGen` output as the source. Just transform the render.
- Use painter order: iterate tiles by ascending `wx + wy` so back-to-front sort is correct without per-tile `setDepth`.

**Acceptance**
- Floor visible in iso projection.
- Hero still walks on it (world-space physics untouched).
- Screenshot diff: floor is diamond-tiled, everything else unchanged.

---

### 2.2  Port wall rendering to iso; collision stays world-space AABB

**What**
At `:697–714`: walls now render as iso diamond sprites using `isoTileFrame('dungeon', 'wall_top' | 'wall_side')` where appropriate. **Collision body remains an axis-aligned rectangle in world space** — built via `createWallBody` from 1.1.

**Constraints**
- Do not convert wall collision shapes to diamonds. World-space AABB is intentional.
- Depth: use `isoDepth(wx, wy)` on the rendered sprite; static so compute once at creation.

**Acceptance**
- Walls render as iso diamonds.
- Hero collides with walls at the same world positions as today.
- No tunnelling at corners (same as current behaviour).

---

### 2.3  Port torches + static decor to iso depth sort

**What**
Torches placed at `:…` (grep `dungeon_torch`): each gets `wx, wy` stored, position via `worldToIso`, depth via `isoDepth`. Same for any other static decor.

**Acceptance**
- Torches sort correctly when the hero walks in front of and behind them.
- No regressions in torch flicker animation.

---

## M3 — Dynamic entity render port

Prereqs: M2 merged.

### 3.1  Hero render through iso

**What**
- Give hero `wx, wy, wz = 0` fields driven by `body.x/y` (or vice versa — pick one source of truth; recommend body owns `wx/wy`, sprite is slave).
- Replace direct `sprite.setPosition(x, y)` with `syncSpriteToWorld` each frame.
- Physics body remains circle in world space.

**Acceptance**
- Hero appears on the iso floor, feet anchored at tile centre.
- WASD still moves the hero (input port is M4; for now WASD drives world velocity directly, which will visually look off — that's expected and documented in the PR).

---

### 3.2  Enemies render through iso

**What**
Same treatment for every enemy spawn. Enemies registered in an array consumed by `updateIsoDepths(scene.enemies)` inside `update()`.

**Acceptance**
- Enemies sort correctly vs. hero and walls.
- AI behaviour unchanged.

---

### 3.3  Projectiles render through iso

**What**
Projectiles get `wx, wy` fields and iso render transform each frame. They use circle bodies in world space.

**Acceptance**
- Projectiles fly in straight world-space lines, rendered as iso.
- Hit detection unchanged.

---

## M4 — Input

Prereqs: M3 merged. These two leaves may run in parallel.

### 4.1  Joystick → world vector

**What**
At `CombatArenaScene.ts:1534–1564`: before feeding velocity to hero body, pipe the joystick angle through `isoInputAngleToWorld` so "up on the stick" maps to "up-screen" in iso space (which is diagonal in world space).

**Acceptance**
- Pushing stick up makes the hero visually walk up-screen.
- All eight cardinal/diagonal directions map visually correctly.

---

### 4.2  Keyboard WASD → world vector

**What**
Same conversion as 4.1 but for WASD. Build a cardinal vector from key state, pass through `isoInputAngleToWorld`.

**Acceptance**
- W = hero walks up-screen, A = left-screen, etc.
- Diagonal combinations (W+D) behave correctly.

---

## M5 — Camera

Prereqs: M4 merged.

### 5.1  Iso-aware camera bounds

**What**
Current `DUNGEON_ZOOM = 3.5` with physics-world bounds `(0, 0, 960, 960)` at `:688`. Compute iso bounds from the tile grid so camera clamps at the iso edges, not the world AABB.

**Acceptance**
- Panning to the far corner of the dungeon doesn't expose void outside the iso floor.

---

### 5.2  Hero-follow + zoom tuning at iso scale

**What**
Re-tune follow-zoom to keep hero centred at a readable size in iso projection. Expect zoom value to differ from 3.5 — do a pass with the screenshot tool to pick one.

**Acceptance**
- Hero is centred, visible, not cropped at any wall collision.

---

## M6 — Collision polish

Prereqs: M5 merged. Runs in parallel; all three are independent.

### 6.1  Swept projectile collision

**What**
Per-frame segment raycast for each projectile:
- Segment-vs-AABB for walls (Phaser static group).
- Segment-vs-circle for enemy bodies.

Replaces per-frame overlap check. Needed because fast projectiles can tunnel through thin walls / small enemies.

**Acceptance**
- Projectile fired at max speed point-blank cannot tunnel through a wall.
- Enemy can be hit by a projectile that would have skipped past it in one tick under the old system.

---

### 6.2  z-axis simulation

**What**
- Add `wz` to entity bodies (already reserved in M1, now actually used).
- Knockback sets `wz` velocity; gravity pulls it back to 0.
- Depth formula stays `isoDepth(wx, wy, wz)`.
- Collision vs. walls: if `wz > wallHeight`, allow pass-through (future jump-over).

**Acceptance**
- Hero knockback visibly hops instead of sliding.
- No regressions in enemy-vs-wall collision (wallHeight = high enough to always block on-ground movement).

---

### 6.3  Spatial hash broad phase (optional)

**Skip unless** a perf regression shows up in screenshot timing or dev-tools frame time during M3–M5.

**What**
Tile-keyed body lookup in `src/combat/SpatialHash.ts`. Replace quadtree-style overlap with 3×3 neighbourhood lookup keyed on the hero's tile.

---

## M7 — QA lock-in

Prereqs: M6 (or M5 if M6.3 skipped).

### 7.1  Screenshot baselines

**What**
Add iso-combat entries to `screenshots/manifest.json`. Capture golden images via `npm run screenshot`.

**Acceptance**
- Manifest lists Combat iso screenshots with captions.
- PR includes the PNGs.

---

### 7.2  Smoke playtest

**What**
Manual checklist run in dev:
- Hero spawns on iso floor.
- All 8 directions of movement feel correct on joystick and WASD.
- Hero collides with every wall edge.
- Enemy AI pathing still works (no iso-space bugs).
- Projectile hits enemies and walls.
- Hero takes a hit, knockback reads correctly (if M6.2 shipped).

**Acceptance**
- Checklist ticked in PR body.
- Screenshots attached for each step.

---

## Issue template for build agents

When converting each leaf above into a GitHub issue, include:

```
## Context
<link to this plan, milestone + leaf ID>

## What to build
<copy leaf "What" section verbatim>

## Constraints
<copy leaf "Constraints" section; include the Guiding Principles section link>

## Acceptance criteria
<copy leaf "Acceptance" section>

## Out of scope
<copy leaf "Scope bound" section if present>

## Files most likely touched
<explicit list with line ranges>

## Dependency
Requires: <list of parent leaves that must be merged first>
```

Apply labels: `systems`, `ready`, effort per M# (M1–M2 = S, M3–M4 = M, M5–M6 = L).

---

## Open design questions (resolve before M6.2)

- **Knockback z-curve shape** — parabolic arc (simple) vs. tweened with squash-and-stretch (readable but more art).
- **Wall height default** — do all walls block z-jumps? Low crates that can be hopped over come later if we want them.
- **Enemy body radius** — needs a pass against sprite sizes; likely 12–18 px world-space.

Park these here; don't block M1–M5 on them.
