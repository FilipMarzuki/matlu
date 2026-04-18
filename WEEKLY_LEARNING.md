# Weekly Learning — Apr 11–18, 2026

## What was built this week

This was one of the largest weeks in the project's history — 46 PRs merged across five major areas:

**Audio pipeline (9 PRs):** Completed nearly the entire audio feature set. Spatial stereo pan (FIL-116) makes sounds pan left/right based on where they happen in the world. Volume sliders (FIL-115) expose Music/SFX/Ambience tracks independently. Footstep interval and volume now scale with movement speed (FIL-119). Night ambience layer (FIL-117), phase transition stingers (FIL-122), UI hover SFX (FIL-121), portal dramatic audio sequence (FIL-118), victory fanfare (FIL-120), and Tinkerer real gunshot + reload SFX (FIL-333) all landed in the same batch.

**World generation (7 PRs):** Inland lake generation (FIL-260) using BFS flood-fill distinguishes ponds from ocean. Biome boundary blend strips (FIL-177) soften hard biome edges. A full weather system (FIL-58) landed — Phaser particle rain, dark overlay, and a random scheduler. Ocean rendering was refactored into a single scrolling `TileSprite` (FIL-259) replacing hundreds of individual animated sprites. Wind sway animation added to decoration sprites (FIL-240). Grasslands decoration asset-spec with 44 sprite definitions (FIL-253).

**Enemies (8 PRs):** Earth enemies (TrackerUnit, StaticGhost, SwarmMatrix — FIL-272), Spinolandet faction (MimicCrawler, Venomantis, BroodMother, Progenitor), Water enemy DryShade (FIL-304), Bonehulk with timed invincibility window (FIL-322), Thornvine grab mechanic (FIL-325), Velcrid death animation + corpse persistence (FIL-335). BurrowHole now spawns enemies on a timer with crawl-out animation (FIL-292/293).

**Heroes (8 PRs):** TheLivingSea Tier 5 Water hero (wave-bar rendering + Sea Remembers reflect mechanic), MajaLind/TorstenKraft Tier 1–2 Earth heroes (FIL-266), Rampart/KRONOS Tier 4–5 Earth heroes (FIL-270), Bao/Master Fen (FIL-314) and TheTorrent/StormSovereign (FIL-315) wired into GameScene, Tinkerer Tier 2 proximity mine gadget (FIL-229).

**Visual polish & UI:** Dungeon rooms switched to dark stone floor + wall depth tiles + torch sprites (FIL-339). P1/P2 HP bars added to arena HUD (FIL-245). Hero death linger + enemy fade-out + full arena reset (combat death sequence). World Dev panel layer toggles for Decor + Animals (FIL-331).

---

## Key concepts introduced

**BFS flood-fill for terrain classification**
`LakeData.ts` seeds a BFS queue from every border tile whose elevation is below the water threshold, then floods all ocean-reachable water in 4-connectivity (N/E/S/W, no diagonal). Any water tile not visited is inland — therefore a lake. The result is a `Uint8Array` (one byte per tile) so scene code can query `isLakeTile[ty * tilesX + tx]` in O(1). This is a classic grid-BFS pattern that will reappear in pathfinding, zone detection, and any "which connected component is this?" problem.

**Stereo pan via Phaser SoundConfig**
Phaser's `sound.play(key, { pan: value })` maps directly to the Web Audio API's `StereoPannerNode`. The formula used:

```ts
(sourceX - (cam.scrollX + cam.width / 2)) / (scale.width / 2)
```

converts a world-space X position into a [-1, 1] pan value relative to the screen centre. Using the *screen width* (not the map width) as the denominator makes the effect feel strong regardless of map size.

**Phaser particle emitters and `scrollFactor(0)`**
`scene.add.particles(x, y, textureKey, config)` creates a `ParticleEmitter`. Range objects (`{ min, max }`) in the config give each particle a slightly different speed, angle, scale, and lifetime — organic variation without extra code. Setting `setScrollFactor(0)` pins the emitter to screen-space so it stays fixed in the camera viewport regardless of where the player walks. This is the standard technique for HUD elements and full-screen effects like rain.

**`Phaser.Time.TimerEvent` with `loop: true`**
BurrowHole's periodic spawning uses `scene.time.addEvent({ loop: true, delay: intervalMs, callback })`. The critical detail: Phaser timers **pause with the scene** and clean up with the scene's time manager. A plain `setInterval` does neither — it keeps firing even if the scene pauses or transitions, leading to ghost ticks after destroy. Always prefer Phaser's timer for in-game scheduling; call `.remove()` in cleanup to cancel it.

**Tween-based animation vs per-frame `Math.sin`**
TheLivingSea's wave bars use `yoyo: true, repeat: -1` tweens with staggered `delay` offsets instead of computing `Math.sin` in `update()`. The tween engine handles interpolation, pauses with the scene, and frees the update loop from per-entity math. `Back.easeOut` (used for the Velcrid crawl-out scale tween) adds a brief overshoot that reads as a physical "pop" — useful for any reveal animation.

**`GameSystem` interface pattern**
The weather system implements a `GameSystem` interface (`systemId`, `update(delta)`, `destroy()`) and registers with `WorldState`. The scene's `update()` delegates all ticks through `WorldState.update(delta)`, so adding a new world-level system requires zero changes to the scene class. A clean separation of concerns that scales well.

**Event-driven entity coupling**
BurrowHole emits `'hole-spawned'` (carrying the new `CombatEntity`) and `'hole-destroyed'` so the scene handles physics wiring and reference tracking without the entity knowing about the scene. This mirrors the existing `'projectile-spawned'` event and keeps arena-level state management out of individual entities.

**Wang tilesets and depth layering**
The dungeon floor upgrade (FIL-339) introduced Wang tilesets: a 4×4 grid of pre-composited corner/edge variations where the same frame index maps to the same tile configuration across different texture sets (colosseum vs. dungeon floor). Depth layering with `setDepth()`: floor (-1) → boundary walls (0) → entities (~0–100) → torches (2) → HUD (200+).

---

## Worth understanding more deeply

**`Uint8Array` vs `boolean[]` for large grids.** `Uint8Array` uses 1 byte per element instead of ~8 bytes for a JS boolean. For a 200×200 tile grid that's 40 KB vs 320 KB — and it's faster to iterate due to memory locality. The pattern appears in `isLakeTile`, `riverGrid`, `oceanGrid`. Worth understanding typed arrays before the map grows larger.

**Phaser tween chain vs `delayedCall`.** BurrowHole uses `scene.time.delayedCall(800, fn)` for the pre-spawn warning delay. For sequences with more steps, tween `onComplete` callbacks or `scene.tweens.chain()` can be cleaner. Both patterns appear across the codebase — worth knowing when to choose each.

**Entity/scene boundary and event contracts.** The `'hole-spawned'`/`'hole-destroyed'` event pattern is now used in three places (projectiles, holes, enemies). As more entities use it, consider whether a typed event bus would help avoid typo bugs in event name strings.

**Particle system performance budgets.** The rain and leaves emitters run on top of animated water sprites capped at 3000 instances. No formal GPU budget has been written down. Worth profiling on the target Android tablet (Chrome) once visual density reaches its peak.

---

## Suggested Phaser docs reading

- [**Particle Emitter**](https://newdocs.phaser.io/docs/3.87.0/Phaser.GameObjects.Particles.ParticleEmitter) — covers the `{ min, max }` range syntax, lifespan, gravity config used in the weather system
- [**TileSprite**](https://newdocs.phaser.io/docs/3.87.0/Phaser.GameObjects.TileSprite) — explains `tilePositionX`/`tilePositionY` scrolling used in the ocean refactor (FIL-259)
- [**Tween config reference**](https://newdocs.phaser.io/docs/3.87.0/Phaser.Types.Tweens.TweenBuilderConfig) — `yoyo`, `repeat`, `delay`, `ease` all in one place
- [**scene.time.addEvent**](https://newdocs.phaser.io/docs/3.87.0/Phaser.Time.Clock#addEvent) — `TimerEvent` API including `loop`, `remove()`, and pause behaviour
- [**Sound config (pan)**](https://newdocs.phaser.io/docs/3.87.0/Phaser.Types.Sound.SoundConfig) — full list of per-play options including `pan`, `volume`, `detune`

---

## AI usage this week

- FIL-88: $0.08
- FIL-110: $0.04
- REVIEW-BOT: $0.60
- REVIEW-MERGE-BOT: $0.32
- NIGHTLY: $0.02
- NONE: $0.03
- Untagged sessions: $0.38
- **Total: $1.47**
