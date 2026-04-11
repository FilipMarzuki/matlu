# Weekly Learning — 4 Apr – 11 Apr 2026

## What was built this week

This was a remarkable week — the game went from an early prototype to a rich, living world. Here's everything that shipped:

**World architecture.** Entity base classes (`Entity`, `LivingEntity`, `WildlifeAnimal`, `Enemy`) established a proper hierarchy for every object in the game. `WorldState` and `MapData` became the central contracts that all other systems read and write. `WorldClock` tracks a full 18-minute day cycle through six phases (dawn → morning → midday → afternoon → dusk → night), driving visual and audio changes.

**Procedural terrain.** The flat, hand-coded map was replaced with a procedural terrain generator. Simplex noise replaced an earlier value-noise implementation. Then fractional Brownian motion (fBm) layered multiple noise octaves for realistic detail. Domain warping added organic, tendril-shaped biome edges and corruption geography. A temperature × moisture matrix (two independent noise axes) meant that the same elevation could produce a dark spruce forest *or* a rocky heath depending on position — just like Minecraft's biome system. The world geometry was reshaped into a diagonal SW→NE corridor inspired by Sweden's Höga Kusten.

**Living wildlife.** Animals now spawn in species-appropriate clusters using Poisson disk sampling — deer in herds, hares in warrens, foxes as lone hunters. Biome-aware spawning means eagles appear over mountains and herons near water. Foxes chase hares (which flee from foxes the same way they flee from the player), creating a visible ecosystem. Butterflies and bees were added as ambient micro-wildlife.

**Visual polish.** Static terrain tiles were replaced with textured sprites. Water tiles animate at 4 fps using live `Sprite` objects layered over the baked terrain. Grass tufts sway with sine-eased tweens staggered by position so no two are in sync. Biome borders blend via dithered transitions (a classic 16-bit RPG technique). Phase-gated particle effects kick in and out across the day: falling leaves at dawn/dusk, pollen motes in the morning, fireflies at night.

**Settlements.** A five-phase system built up from data model → dotted map markers → territory fill → building footprints with collision → sprite-based buildings from Pixel Crawler → NPCs with night lighting and interaction.

**Audio.** Forest ambience fades up and down with the day phase (silent at night, full birdsong at midday). Footsteps play different sounds depending on the terrain under the player — the noise value that generated the tile is sampled again to identify the surface type. All sounds duck by 50% when any overlay (pause, settings) opens.

**Scene and UI.** The game gained a full UI shell: main menu, settings (audio mute, language selector), credits, pause menu, death screen, and win condition. All strings are translated via a `t()` helper with English, Swedish, and Polish catalogs stored in JSON files.

**Combat mechanics.** A dash/dodge mechanic with invincibility frames was added (Shift or joystick double-tap). Difficulty zones scale enemy aggression by area. A ranged cleanse attack gave the player a second combat tool.

**Rivers.** Two rivers cut across the world as bands of water tiles. Bridges and wading fords are the only crossings; the player slows to 0.55× speed when wading.

**Testing and performance.** Playwright end-to-end tests run in CI — a smoke test checks that the canvas renders without errors, and a bot test verifies that holding W actually moves the player. A performance pass removed hot-loop allocations: double-pass array filters replaced with single-pass partitioning, per-frame O(n) counters replaced with O(1) cached values, and Phaser's `setText` guarded against redundant texture rebuilds.

---

## Key concepts introduced

- **Arcade Physics: static vs dynamic bodies.** Phaser's arcade physics has two body types. *Dynamic* bodies (like the player) move, respond to velocity, and get pushed by collisions. *Static* bodies (`this.physics.add.staticGroup()`) never move — they block dynamic bodies but have zero update cost per frame. Solid obstacles, walls, and building footprints all use static bodies. This is why you can have hundreds of impassable objects without any physics overhead.

- **8-directional movement and vector normalisation.** Moving diagonally by adding two unit vectors (e.g. right = `(1, 0)`, down = `(0, 1)`) gives a combined vector of length √2 ≈ 1.41 — the player would move 41% faster diagonally. Normalising divides the vector by its own length, always producing length 1 regardless of direction. This is fundamental to any movement system that allows diagonal input.

- **Phaser scene management.** Phaser games can run multiple scenes simultaneously. The main pattern here is *scene overlay*: `scene.pause('GameScene')` freezes the game world while `scene.launch('PauseMenuScene')` runs the overlay on top. When the overlay closes, `scene.resume('GameScene')` picks up exactly where it left off. Camera fades (`cameras.main.fadeOut(400)` + the `FADE_OUT_COMPLETE` event) make transitions feel smooth.

- **Simplex noise vs value noise.** Value noise samples a random value at each grid corner and interpolates between them. The regular grid introduces subtle horizontal and vertical streaks — your eye picks up the axis alignment. Simplex noise uses a skewed triangular grid instead, which eliminates the axis bias and produces more natural-looking results. Both are O(n) but simplex just looks better for terrain.

- **Fractional Brownian Motion (fBm).** A single noise sample at one frequency gives a flat, blob-shaped result. fBm layers multiple noise samples at doubling frequencies (octaves) with halving amplitudes. Low frequencies set the large-scale landscape; high frequencies add fine detail. The balance between octaves is controlled by *persistence* (how fast amplitude decays) and *lacunarity* (how fast frequency increases).

- **Domain warping.** Instead of sampling noise at `(x, y)`, you first compute two displacement values from a *second* noise pass, then sample at `(x + dx, y + dy)`. This folds smooth biome boundaries back on themselves, creating the ragged fjords, tendril-shaped corruption fields, and irregular forest edges that plain noise can't produce. Described in detail by Inigo Quilez, whose article the code cites directly.

- **Temperature × moisture biome matrix.** Using a single noise value to decide biome type produces a 1D spectrum (more forested ↔ less forested). Adding two independent noise axes — temperature and moisture — creates a 2D space: the same elevation can be a hot dry heath *or* a cold wet spruce forest. This is the same system Minecraft uses for biomes, and it's why the landscape feels varied rather than striped.

- **Poisson disk sampling.** Random scatter produces clumps and gaps — sometimes ten deer in one patch, sometimes none for a kilometre. Poisson disk sampling (Bridson's 2007 algorithm) guarantees a minimum distance between every pair of output points, while still placing points randomly. The result looks natural because it matches how animals actually spread out to avoid competition for food. The whole algorithm runs in O(n) using a background grid for O(1) neighbour lookups.

- **Finite state machines for AI.** Each animal (and enemy) has a current state — `idle`, `roaming`, `fleeing`, `sleeping`, `chasing` — and a timer. Every frame, the `update()` method checks conditions and switches state if needed. The fox/hare chase is entirely emergent: fox FSM has a "chase nearest hare if within range" rule; hare FSM has an existing "flee from threats" rule. The ecosystem behaviour falls out of these two simple rules running together.

- **RenderTexture for terrain baking.** Drawing 200,000 individual tiles every frame would be catastrophically slow. A `RenderTexture` is a GPU texture you can draw into once and then display as a single quad. All the terrain tiles — grass, stone, water shores — are drawn into the RT during `create()` and never redrawn unless the world changes. This reduces 200k draw calls to 1. The trade-off: you can't animate tiles that are baked in. That's why animated water uses live `Sprite` objects layered on top at depth 0.5.

- **Phaser Tweens.** A `Tween` interpolates a value over time using an easing function. `ease: 'Sine.easeInOut'` gives the smooth acceleration and deceleration of a sine wave. `yoyo: true` reverses the tween when it completes, creating a pendulum effect without extra keyframes. Using world position to compute each grass tuft's `delay` and `duration` means adjacent tufts are never in sync — which is what wind actually looks like.

- **Phaser particle emitters.** `this.add.particles(x, y, textureKey, config)` creates a stream of short-lived sprites with randomised velocity, alpha, scale, and lifespan. `Graphics.generateTexture('key', w, h)` bakes a programmatic drawing (like a soft circle for a firefly glow) into a named texture — no external image file needed. `setScrollFactor(0)` pins an emitter to screen space so fireflies follow the camera rather than floating over world coordinates.

- **Parallel scene pattern for overlays.** The pause menu, settings screen, and credits all use the same structure: freeze the calling scene, launch a new scene as an overlay, and pass the calling scene's key so the overlay knows who to resume when it closes. This means the overlay code doesn't need to know anything about what it's pausing — it just calls `scene.resume(callerKey)`.

- **Terrain-aware systems via shared noise.** The `baseNoise` instance that drew terrain tiles is a scene field. Any system that needs to know "what terrain is under the player?" can sample the same noise at the player's tile coordinates — no separate data structure needed. The footstep sound system uses this to pick the right audio clip; the speed multiplier system uses it to slow the player on water.

- **Audio ducking.** When the pause menu or settings overlay opens, all background audio drops to 50% volume via a short tween. When the overlay closes, volume tweens back up. This is a standard game audio technique — the sound cue that "something modal is happening" without a jarring cut.

- **Dithered biome transitions.** When two adjacent tiles belong to different biomes, a transition tile is drawn at the midpoint. Instead of a special "forest-to-heath blend" tile, a hash of the tile coordinates picks one of the two biome textures — on a pixel level, the boundary alternates rather than cutting hard. This is the same technique that 16-bit RPGs used to save tile memory, and it still looks natural at game resolution.

---

## Worth understanding more deeply

1. **What do fBm octaves, persistence, and lacunarity actually control?** The terrain generator uses `fbm(x, y, octaves=4, persistence=0.5)`. Changing any of these produces a completely different landscape. What happens if you raise persistence to 0.8? Lower octaves to 2? Try sketching the math — it reveals why mountains look sharp and plains look smooth.

2. **What is domain warping doing geometrically?** The corruption field uses `noise(x + noise(x,y), y + noise(x,y))` to create irregular tendrils. Draw it on paper: imagine a grid of sample points, then push each point by a random amount before measuring. The smooth blobs in the undisplaced noise get stretched and folded. Why does this produce tendrils specifically? What happens as you increase the warp amplitude?

3. **Why does a RenderTexture reduce draw calls so dramatically?** A GPU draw call has a significant fixed overhead — state changes, shader binding, buffer uploads. Drawing 200,000 tiny sprites each frame means 200,000 draw calls. Baking them into a RenderTexture turns that into one draw call (displaying the baked texture). Understanding this is key to building any performant 2D game: batch wherever you can.

4. **How does Phaser's scene graph work, and what is "depth"?** Objects in Phaser have a `depth` value that controls draw order. Water is baked into the terrain RT at depth 0; animated water sprites sit at depth 0.5; the player is at depth 1; UI is at depth 10. What would happen if you set the player's depth to 0? What does it mean for performance when you mix objects at many different depths?

5. **What makes Poisson disk sampling feel "natural" where pure random doesn't?** Human vision is sensitive to regularity — a perfect grid and pure random scatter both look wrong. Poisson disk output has the *statistical feel* of organic placement because it matches minimum-exclusion-zone patterns seen in nature (trees competing for sunlight, animals defending territory). This is worth exploring: compare a screenshot with and without the Poisson pass.

---

## Suggested Phaser docs reading

- [Arcade Physics overview](https://docs.phaser.io/phaser3/how-to/physics/arcade-physics) — explains static vs dynamic bodies, colliders, and overlap callbacks; directly relevant to how all the obstacles, buildings, and river barriers work
- [Scene Manager](https://docs.phaser.io/phaser3/how-to/scene-management) — covers `launch`, `pause`, `resume`, and `sleep`; the parallel-scene overlay pattern used by every menu in the game
- [Tweens](https://docs.phaser.io/phaser3/how-to/tweens) — easing functions, `yoyo`, `repeat`, and chaining; understand this and grass sway + day/night fade become easy to extend
- [Particle Emitters](https://docs.phaser.io/phaser3/how-to/particles) — the Phaser 3.60+ API (which this project uses); covers emitter config, `setScrollFactor`, and how `generateTexture` creates emitter textures without external assets
