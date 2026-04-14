# Weekly Learning — Apr 8–14, 2026

## What was built this week

This was a huge week — 38 PRs merged across game features, procedural world generation, economy systems, CI automation, and agent infrastructure.

**Procedural rivers overhauled (FIL-166–170)**
Rivers used to be hard-coded horizontal strips. This week they were completely replaced with a gradient-descent algorithm: starting from a source tile in the NW mountain zone, the algorithm walks 8-directionally toward the lowest neighbouring elevation until it reaches sea biome. A Catmull-Rom spline then smooths the raw staircase path. Bridge and ford crossings are placed where the traced path intersects the main gameplay corridor. Navigation barriers and visual sprites all follow the diagonal path.

**Animal trail generation (FIL-88)**
`generateAnimalTrails()` procedurally traces noise-jittered paths between settlements and POIs. These are injected into the same `PathSystem` as hand-authored Level 1 paths — the existing affinity system treats them as `'animal'` type segments without any changes needed elsewhere.

**Enemy variety & corruption penalty (FIL-94, FIL-106)**
Three new enemy types: corrupted foxes (30 HP contact damage), crows (25 HP only while swooping), and wisps (ranged). A corruption penalty now accumulates when you kill neutral animals — each neutral kill reduces effective cleanse gained, shown as a dark-red bar overlay on the cleanse HUD.

**Loot chests (FIL-92)**
Interactive loot chests near settlements. Each chest has a stable string ID so opened state persists in `localStorage` across page reloads. An "E: Open" prompt appears when the player is within proximity, checked in the scene update loop.

**Shop & trading (FIL-93)**
Vendor NPCs with consumable item inventories. Items are bought with gold (from the enemy drop economy). Trade UI opens via proximity, reusing the same overlay pattern as loot chests.

**Invisible XP & skill system (FIL-95)**
XP accumulates in the background without being shown to the player — skills unlock passively at thresholds. The "invisible" framing is intentional: the game rewards exploration and combat without gamifying the meta layer.

**Stats screen (FIL-86)**
Personal run history added to the stats overlay: run count, best score, and total time for the current nickname via a new `fetchPlayerRuns()` Supabase query, alongside the existing global leaderboard.

**Level arc design (FIL-143)**
Scaffold for Levels 2–5 with a `LevelRegistry` pattern. Level 2 ("The Spine Reaches") has full zone layout, collectibles, secret positions, and zone boundary markers as configuration data in `Level2.ts`. Each level is set in a different world from the lore, with its own biome and corruption type.

**Biome enrichment (FIL-172)**
Four new biome types: marsh, snow, sandy shore, and river-bank wetland — each with unique tint colours and terrain rendering logic.

**Arena testplay — AI balance simulation (PR 143)**
Playwright test (`npm run arena:testplay`) boots CombatArenaScene and fast-forwards 90 simulated seconds using Phaser's internal `sys.step(time, delta)`. This advances physics, AI, timers, and collisions without touching the WebGL render pipeline — works in headless Chrome (CI). Outputs a JSON balance report + periodic screenshots.

**Nightly per-issue agent (FIL-198)**
A full nightly CI pipeline was built: `fetch-agent-issues.js` queries Linear for Backlog issues labelled `ready`, fans them out as a GitHub Actions matrix, and spawns one Claude Code session per issue via `run-agent.js`. A triage agent runs 4 hours earlier to assess issue readiness. Many follow-up PRs fixed Linear GraphQL quirks (ID vs String types, label filter syntax, bypassPermissions, git identity for Vercel previews).

**Scheduled agent suite (PR 135, 138, 139, 141, 142)**
New GitHub Actions workflows: architecture diagram auto-generator, economy-aware settlement layout, Mermaid diagram support in weekly blog posts, weekly roadmap update agent, and cognitive load tracking in Notion.

---

## Key concepts introduced

**Gradient descent for procedural terrain features**
Instead of hard-coding where rivers go, you define a starting point and let the algorithm follow the elevation gradient. This makes rivers geographically plausible by construction and auto-adapts to any noise seed — no manual re-tuning when terrain changes.

**Catmull-Rom spline smoothing**
Gradient descent on a grid produces a staircase of 45° and 90° steps. Catmull-Rom splines produce smooth curves that pass through the control points, making the river path look natural. The pattern: generate rough data procedurally, smooth it with a spline.

**Lookup grids for spatial queries**
Rather than testing every game object against every river point each frame, `isRiverTile[]` is precomputed as a flat boolean array at scene start. This is the classic "bake once, read many times" pattern — critical for performance where hundreds of tiles are tested per frame.

**State machines for enemies via `getData/setData`**
Crow enemies only deal damage while in `'swooping'` state, stored as `getData('state')` on the game object. Phaser's `getData/setData` is an arbitrary data bag on any `GameObject` — simpler than subclasses for AI with a few distinct modes.

**`localStorage` for persistent in-session state**
Loot chest opened state survives page reloads by storing a `Set<string>` of chest IDs in `localStorage`. In a game without a backend save system, `localStorage` is the right tool for per-device progress — fast, synchronous, no auth required.

**Supabase filtered queries**
`fetchPlayerRuns()` adds `.eq('nickname', nickname)` to return only that player's rows. Supabase's JS client composes query builders — each `.eq()`, `.order()`, `.limit()` returns a new builder, nothing executes until `await`.

**`sys.step()` for headless game simulation**
`sys.step(time, delta)` is an internal Phaser method that advances one simulation frame — physics, behaviour trees, event timers — without invoking the renderer. Combined with Playwright's `page.evaluate()`, you can fast-forward a Phaser game at arbitrary speed in headless Chrome, making balance tests in CI possible.

**TypeScript `private` is compile-time only**
TypeScript's `private` keyword is erased at runtime. JavaScript objects are plain dictionaries — any property can be read. The arena testplay spec casts the scene to an `ArenaAccess` type, reads private counters directly, and patches `respawnHero` at runtime to count deaths without modifying game source code.

**LevelRegistry pattern**
Each level is a pure data module (`Level2.ts`) exporting zones, collectibles, secrets, and meeting trigger config. A `LevelRegistry` maps level numbers to these configs. This separates level content (data) from level logic (code), making it easy to add new levels without touching scene code.

---

## Worth understanding more deeply

**Catmull-Rom vs Bezier splines**
Catmull-Rom passes *through* its control points — which is why it works well for smoothing a sampled path. Bezier curves are defined by control points that pull the curve toward them without the curve necessarily passing through them. Worth understanding when to choose one vs the other.

**Phaser's physics step vs render loop**
`sys.step()` runs the update/physics tick but not the render tick. The renderer (WebGL draw calls) is entirely separate. Understanding this separation helps when building headless tests, recording replays, or implementing server-side simulation.

**Supabase Row-Level Security (RLS)**
The `matlu_runs` table uses RLS so `anon` can select and insert — not update or delete. Worth understanding how RLS policies work for the leaderboard pattern: anyone can read all scores, anyone can insert their own score, but nobody can tamper with others' records.

**Invisible progression design**
The invisible XP system is a deliberate design choice: reward skill without making the player track numbers. This pattern (sometimes called "organic progression") appears in games like Dark Souls and Minecraft. Worth reading about when to surface vs. hide progression feedback.

**GitHub Actions matrix strategy**
The nightly agent uses `strategy: matrix` to fan out across issues. `fail-fast: false` means one failing job doesn't cancel others — important when each issue is independent. `max-parallel` is a rate-limit knob, not a concurrency model.

---

## Suggested Phaser docs reading

- [Phaser.Physics.Arcade — overlap and collider](https://newdocs.phaser.io/docs/3.60.0/Phaser.Physics.Arcade.ArcadePhysics#overlap) — the foundation of all enemy collision this week
- [GameObject.getData / setData](https://newdocs.phaser.io/docs/3.60.0/Phaser.GameObjects.GameObject#setData) — how state machines are stored on Phaser objects without subclasses
- [Phaser.Scene.sys](https://newdocs.phaser.io/docs/3.60.0/Phaser.Scene#sys) — the scene systems object, including `sys.step()` used in arena testplay
- [Phaser.Math.Interpolation.CatmullRom](https://newdocs.phaser.io/docs/3.60.0/Phaser.Math.Interpolation#CatmullRom) — Phaser's built-in Catmull-Rom interpolation utility
- [Phaser.GameObjects.TileSprite](https://newdocs.phaser.io/docs/3.60.0/Phaser.GameObjects.TileSprite) — used for animated river water tiles

---

## AI usage this week

- REVIEW-BOT: $0.5982
- REVIEW-MERGE-BOT: $0.3221
- FIL-88: $0.0767
- FIL-110: $0.0412
- NONE: $0.0336
- (untracked): $0.0173
- NIGHTLY: $0.0150
- **Total: $1.1041**
