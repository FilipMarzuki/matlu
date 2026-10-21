# Spike: one world map for both games — hexes, cells, tiles (#1873)

**Ask (owner):** "An area, the area approximating a day's walk, could be represented by a hexagon. And within that hexagon, we represent everything as a 2D grid with squares."

**Fixed by the owner (not reopened here):**
- **One world map, made by the world builder, read by both games.** The world builder is the storytelling engine (provinces, history), the macro-world (cultures, Mistheim's settlements) and the geography generator (today's Reach, `src/artificer/world/reach.ts`, and `mapgen/`). Each game keeps its own state on top (seen cells, camps, corruption cleansed), never baked into the map.
- **Three levels:**
  - **hex**: an area about a day's walk across, ~30 km;
  - **cell**: today's Reach cell, ~30 min on foot, ~2 km;
  - **tile**: Core Warden's square, ~1 m.
- **Coordinates:** one world coordinate, in tiles; hex and cell are derived from it. The world is generated lazily, in chunks, from one seed.
- **Core Warden** draws tiles as 2:1 isometric diamonds but keeps its logic on the square grid.
- **The Artificer** shows hexes and cells, never tiles.
- **The start hex:** today's Reach becomes the start hex, with neighbours generated around it.
- **Words first:** the hex map is words at first. A drawn hex map unlocks once the Warden has made a map (map-learning, `src/artificer/map-learning.ts`, #1754).

**Short answer:**
- **Hex shape:** flat-top hexes, 9 cells from centre to corner (15.6 cells ≈ 31 km flat to flat, ≈ 210 cells each), in axial `(q, r)`.
- **Cells:** one global square cell lattice that every hex shares, with each cell owned by the hex its centre falls in.
- **Tiles:** a cell is 2048 × 2048 tiles.
- **Terrain:** one world-wide noise field, so hex and cell borders join by construction.
- **The Reach:** it stays byte-for-byte, as a fixed "start patch" laid over the world's noise, with world cell (x, y) = Reach cell (x, y). It is a little more than a hex: the start hex and most of its six neighbours. Everything new is additive and sits behind one rules switch, `hex-world`.

---

## What's there today (read for this spike)

| Piece | Where | What matters here |
|---|---|---|
| The Reach | `src/artificer/world/reach.ts` | 48 × 32 cells, a cell ≈ 0.5 h on open ground (`COST`). Seeded per run from `seedOf(character.id)`, each part on its own stream `seedOf(\`${seed}\|world\|${salt}\`)` (salts `height`, `moisture`, `flank`, `springs`, `camp`). Its height has a Reach-only shape term (fells north, one flank rising) in **map-normalised** coordinates (`x / w`), so it can't be sampled outside 0..1. Rivers stop at the map edge. Hashes pinned in `reach.test.ts` (`f9779a07a1a21ff9`, `585e1925ea7025e5`). |
| Rings | `src/artificer/exploration.ts` | Knowledge per ring × domain; no geometry. `reach.ts` `ringOfHours` maps walking hours from camp to rings: ≤3 h, ≤6 h, ≤9 h. |
| Directed explore | `src/artificer/directed-explore.ts` (#1839) | 8 compass sectors on the Reach, `afield` (where the Warden stands, Reach x/y) and `seenOut` (sorted Reach indices). Heading out is capped by the Reach's edge today. |
| Walking the map | `src/artificer/walk-the-map.ts` (#1876) | Trips walk real Reach squares, shortest path by `COST`; the squares walked through join `seenOut`. |
| Map-learning | `src/artificer/map-learning.ts` (#1754) | Unlock (4 nights, 4 places, 3 directions, a surface), then `mapLearned` draws the map. |
| Provinces, settlements, regions | `src/artificer/world/{provinces,settlements,regions}.ts` | About 11 provinces of ~140 cells grown on the Reach, a mapgen settlement at each seat, three hand-written anchor villages seated inside the Reach (`placeAnchors`), and crafted regions (`north-road`). |
| Core Warden terrain | `src/scenes/GameScene.ts`, `src/world/*`, `src/lib/IsoTransform.ts` | 141 × 94 tiles of `TILE_SIZE` 32 px, so 4500 × 3000 px. The seed is `Math.random()` per run (`runSeed`), with `FbmNoise` elevation/temp/moist feeding `biomes.ts` `tileBiomeIdx` (12 biomes). The isometric projection happens at draw time (`IsoTransform` 32 × 16, `BaseForgeScene` `ISO_W/ISO_H` 24 × 12 × zoom). The hand-made levels (`Level1–5.ts`, `Spinolandet.ts`) are pixel-space zones and placements. |

Measured on 200 seeds with the maths below (scratch script, not committed):
- **Cells per hex:** 204–214.
- **Camp:** always in the start hex (200/200).
- **Leaving the start hex:** from camp, the start hex's edge is 1–5.75 h away (median 3.25 h).
- **A day's reach:** 9 h from camp covers ~426 cells, about two hexes.
- **The Reach's footprint:**

  | Hex | Share of the hex inside the Reach |
  |---|---|
  | start `(0,0)` | 205/205 |
  | NW `(−1,0)` | 209/209 |
  | NE `(1,−1)` | 212/212 |
  | N `(0,−1)` | 170/214 |
  | SW `(−1,1)` | 180/212 |
  | SE `(1,0)` | 177/209 |
  | S `(0,1)` | 57/214 |
  | slivers of 8 more | |

---

## 1. Hex size, orientation, coordinates

| | Value | Why |
|---|---|---|
| Tile | 1 m | the owner's number; Core Warden's square |
| Cell | **2048 tiles** (≈ 2 km) | a power of two, so `cellOfTile` is a shift and chunks of 64 tiles nest 32 to a cell side; ≈ 0.5 h at ~4 km/h |
| Hex size `HEX_SIZE` | **9 cells**, centre to corner | about 8 h across (15.6 cells flat to flat, 18 corner to corner); matches the owner's ~30 km and the issue's "8–9 h, 16–20 cells" |
| Orientation | **flat-top** | N and S are true neighbours. The Reach's story runs north to south (the pass in the north, the road south to Mistheim, `road.ts`), so "head north / south" lands squarely in the next hex. A flat-top hex is also wider than tall, like the Reach. |
| Coordinates | **axial `(q, r)`**, with cube `s = −q − r` for rounding and distance | the standard; neighbours by 6 fixed offsets |
| Anchor | start hex `(0,0)`'s centre at the **centre of Reach cell (24, 19)** | that's camp's target (`campSite`: w/2, 0.6 h). It's the same for every seed, so the grid never depends on generation. |

The neighbour directions (y grows south, as on screen and in the Reach):

```
        N (0,-1)
 NW (-1,0)   NE (1,-1)
      [ q,r ]
 SW (-1,1)   SE (1,0)
        S (0,1)
```

Directed explore keeps its 8 compass points: a hex is never chosen by direction. You end up in whichever hex your walk ends in, so "east" lands in NE or SE by the land.

### Coordinate maths (sketch for `worldmap/coords.ts`)

```ts
/** World tile, integers (≈1 m). The one world coordinate. */
export interface Tile { tx: number; ty: number }
/** World cell, integers. Inside the Reach it IS the Reach's (x, y): world cell (0,0) = Reach cell (0,0). */
export interface CellXY { cx: number; cy: number }
/** Axial, flat-top. */
export interface Hex { q: number; r: number }

export const CELL_TILES = 2048;
export const HEX_SIZE = 9;                       // cells, centre to corner
export const HEX_ORIGIN = { x: 24.5, y: 19.5 };  // cell space: centre of Reach cell (24, 19)
const SQRT3 = Math.sqrt(3);                      // correctly rounded per ECMAScript: same in every engine

export const cellOfTile = (tx: number, ty: number): CellXY =>
  ({ cx: Math.floor(tx / CELL_TILES), cy: Math.floor(ty / CELL_TILES) });          // floor: right for negatives
export const tileInCell = (tx: number, ty: number) =>
  ({ lx: tx - Math.floor(tx / CELL_TILES) * CELL_TILES, ly: ty - Math.floor(ty / CELL_TILES) * CELL_TILES }); // 0..2047
export const cellOrigin = (c: CellXY): Tile => ({ tx: c.cx * CELL_TILES, ty: c.cy * CELL_TILES });

/** A hex's centre in cell space (continuous). */
export function hexCentre(h: Hex): { x: number; y: number } {
  return { x: HEX_ORIGIN.x + HEX_SIZE * 1.5 * h.q, y: HEX_ORIGIN.y + HEX_SIZE * SQRT3 * (h.r + h.q / 2) };
}

/** The hex a cell-space point lies in. */
export function hexOfPoint(x: number, y: number): Hex {
  const dx = (x - HEX_ORIGIN.x) / HEX_SIZE, dy = (y - HEX_ORIGIN.y) / HEX_SIZE;
  return cubeRound((2 / 3) * dx, (-1 / 3) * dx + (SQRT3 / 3) * dy);
}
/** A cell belongs to the hex its centre lies in, so a cell is never split between hexes. */
export const hexOfCell = (c: CellXY): Hex => hexOfPoint(c.cx + 0.5, c.cy + 0.5);
export const hexOfTile = (tx: number, ty: number): Hex => hexOfCell(cellOfTile(tx, ty));

export function cubeRound(q: number, r: number): Hex {
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r); const rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

export const HEX_DIRS = { n: { q: 0, r: -1 }, ne: { q: 1, r: -1 }, se: { q: 1, r: 0 }, s: { q: 0, r: 1 }, sw: { q: -1, r: 1 }, nw: { q: -1, r: 0 } } as const;
export const hexDistance = (a: Hex, b: Hex) => (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
export const hexKey = (h: Hex) => `${h.q},${h.r}`;

/** The cells a hex owns, row by row: its bounding box filtered by `hexOfCell`. 204–214 cells. */
export function cellsOfHex(h: Hex): CellXY[] {
  const c = hexCentre(h), half = (SQRT3 / 2) * HEX_SIZE;
  const out: CellXY[] = [];
  for (let cy = Math.floor(c.y - half) - 1; cy <= Math.ceil(c.y + half); cy++)
    for (let cx = Math.floor(c.x - HEX_SIZE) - 1; cx <= Math.ceil(c.x + HEX_SIZE); cx++) {
      const o = hexOfCell({ cx, cy });
      if (o.q === h.q && o.r === h.r) out.push({ cx, cy });
    }
  return out;
}

/** A world cell as one save-friendly integer (±32,768 cells ≈ ±65,000 km is plenty). */
export const packCell = (c: CellXY) => (c.cx + 32768) * 65536 + (c.cy + 32768);
export const unpackCell = (n: number): CellXY => ({ cx: Math.floor(n / 65536) - 32768, cy: (n % 65536) - 32768 });
```

**Determinism:** only `+ − × ÷`, `Math.floor/round/abs/sqrt` are used, and all of them are exactly specified, so every browser and Node agree to the bit. No `Math.sin/cos/atan2` goes into hex or cell ownership: those are allowed to differ between engines. (Directed explore's `bearingTo` uses `atan2`. That's fine inside one game, but it must not decide anything both games share.)

---

## 2. The grid inside a hex

**A covering, not a clip.**
- **One lattice:** there is one global square lattice of cells, and every cell belongs to exactly one hex, the one under its centre.
- **Inside a hex:** a hex's "grid" is just its bounding box (about 20 × 17 cells). The cells inside it that a neighbour owns are drawn as the neighbour's (dimmed, or `·`).
- **Borders line up by construction:** there's no per-hex grid to align, and a hex border is a staircase of whole cells.
- **Rejected: a per-hex grid clipped to the hexagon.** Two neighbouring hexes' grids would only line up if the hex size were a lattice multiple. Flat-top hex rows are offset by √3, so they never are. Every river or path crossing a border would then need stitching.

**Tiles inside a cell work the same way.**
- A cell is 2048 × 2048 tiles on the one tile lattice.
- Core Warden generates **chunks of 64 × 64 tiles** (32 × 32 chunks a cell) on demand.

---

## 3. Generation: world-wide fields, sampled where needed

All world-wide, all pure functions of `(seed, world position)`.

**Streams.**
- Every new stream is `seedOf(\`${seed}|hexworld|${salt}\`)`.
- The new prefix can't collide with the Reach's `|world|` salts, so the Reach's own draws stay where they are.

**Cell fields** (`worldmap/cells.ts`).
- **Height and moisture:** `height(cx, cy)` and `moist(cx, cy)` are fBm simplex noise in **world cell units** (`createNoise2D` on the new streams, like reach.ts). The frequency is about 1/16 cells, so a hex has one or two landforms.
- **Biome:** the Reach's `biomeOf(height, moist)` is reused, so both maps speak one biome list.
- **A continental trend:** a slow tilt down to the south (towards Mistheim's lowlands) and up to the north (the fells beyond the pass). It plays the part of the Reach's shape term, at world scale.

**The start patch: the Reach, exactly.**
- **Inside the Reach:** for `0 ≤ cx < 48, 0 ≤ cy < 32`, the cell is `generateReach(seed).cells[cy*48+cx]`, untouched.
- **Outside it:** a blend band of `PATCH_BLEND = 6` cells pulls the world height towards the Reach's nearest edge cell: `h = lerp(edgeHeight, worldHeight, d / 6)`. This keeps the fells rising north of the pass and the valley running out south.
- **Rivers leaving the Reach:** a river that stops at the Reach's edge (reach.ts breaks there) continues outside, traced as a spring at that edge cell.
- **The Reach is kept by construction.** Its function and tests stay as they are, and a new test pins `worldCell(seed, x, y) === reach.cells[i]` inside it.

**Rivers.**
- Each hex picks 0–3 springs from its own stream (`springs:${q},${r}`) on high cells.
- Each river is traced downhill over the world height, which is a pure function, so a trace can run into a neighbour without generating it.
- Rivers are capped at `RIVER_MAX = 60` cells.
- **The rivers of hex H** = the traces from springs in every hex within `hexDistance ≤ 3` of H that pass through H. That's a bounded, order-free rule (traces are sorted by spring cell before they're applied), so H looks the same however you reached it.

**Tiles (Core Warden)** (`worldmap/tiles.ts`).
- **Elevation, temperature, moisture:** sampled as the cell field interpolated bilinearly between cell centres, plus fine `FbmNoise` at tile scale. These feed `tileBiomeIdx`.
- **The cell keeps its character:** a cell's biome holds on most of its tiles. A tile may differ only where the fine noise passes a threshold, so a birch cell gets clearings.
- **Rivers and paths cross cell edges at an edge-keyed point:** the crossing is at `hash(seed, edgeId) % 2048`. Both cells agree without either generating the other. Hex borders are cell borders, so nothing more is needed there.

**Eager vs lazy.**

| When | What | Cost |
|---|---|---|
| World creation (eager) | the Reach patch (as today); the history over its provinces (as today, ~3 s in the worker) | unchanged |
| First hex view (eager, small) | a **hex summary** for every hex within radius 4 (61 hexes): dominant biome, height range, water, a name. It samples cell fields only, no rivers. | 61 × 210 cells ≈ 13k noise samples, ~10 ms |
| Entering or seeing into a hex (lazy) | its full cells and rivers (`cellsOfHex` + traces within radius 3), plus a settlement if it has a seat | ~2–5 ms a hex, LRU-cached like `walkFrom` |
| Core Warden, around the camera (lazy) | 64 × 64-tile chunks within view + 1 | per chunk, cached; nothing is stored |

**Where it lives.**
- **A new top-level `worldmap/`**, Phaser-free and Supabase-free, beside `mapgen/` and `storytelling/`, which both games already import (`src/artificer/world/settlements.ts` imports `../../../mapgen`). It has its own `tsconfig.json` like `mapgen/`.
- **Imports:** `simplex-noise` (already a root dependency) and a copy of the Artificer's `seedOf` and `generator` (`worldmap/rng.ts`). A test pins the copy equal to `src/artificer/rng.ts`, so the planned repo split stays easy.
- **The Reach:** `generateReach` is moved into `worldmap/reach.ts`, and `src/artificer/world/reach.ts` re-exports it. The existing hash tests prove the move changes nothing.
- **Both builds stay in the browser:** `vite build` and `build:artificer` bundle it the same way they bundle `mapgen/`.

**Seed.**
- There is one seed per world.
- **The Artificer:** the world seed is today's run seed, `seedOf(character.id)`, so there's nothing new to save.
- **Core Warden:** it takes a world seed instead of `Math.random()`, for example from the Warden being played or `?world=`, so that it can stand in the same world as an Artificer run.

---

## 4. What becomes of the three rings and directed explore

- **The rings stay, unchanged.**
  - They are walking time from camp (≤3 h / ≤6 h / ≤9 h) and knowledge per ring × domain, not geography.
  - From camp near the start hex's middle, close by stays in the start hex, half a day reaches its edge (median 3.25 h to leave it), and a day out reaches into the neighbours.
  - That's exactly the issue's picture: "heading out a day takes you to the edge of your hex and into the next one."
- **With `hex-world` on:**
  - `walkingHours` runs over a **window of world cells** around the origin (camp's hex plus ring 1 plus the band, about 70 × 60 cells) instead of the 48 × 32 Reach. A day out no longer stops at the Reach's edge.
  - `ringOfHours` and `exploration.ts` don't change.
  - Off, the window is the Reach and everything is today's.
- **Directed explore:**
  - The 8 sectors, `HEAD_OUT_HOURS` and `LOOK_HOURS` stay.
  - `afield` becomes a world cell. It already is one inside the Reach, since world cell = Reach cell. With the switch on, it may hold x < 0, ≥ 48, and so on.
  - Heading out across a hex border is just a walk that ends in another hex. The journal then says so: "…and by evening you're in the marsh country".
- **Moving camp to another hex:** camp may be made in any hex you stand in (`camp-as-action`, #1732). The rings then centre on the new camp, and the window recentres. The hex is never part of the rule; it's only a name for where you are.

---

## 5. Saves

The rule stays the same as today: **store what the Warden knows; regenerate the land from the seed.**

| Field (only written with `hex-world` on) | Type | What |
|---|---|---|
| `seenOut` | `number[]` | **unchanged**: sorted Reach indices, for cells inside the Reach |
| `seenWorld?` | `number[]` | sorted `packCell` of seen cells **outside** the Reach (so old saves and Reach-only runs never change shape) |
| `heardHexes?` | `string[]` | sorted `hexKey`s told of by people or seen on the skyline but not visited (hex-level knowledge: "the marsh country to the south") |
| `afield` | `{x, y}` | unchanged shape; may lie outside the Reach |
| `worldGen?` | `number` | the `worldmap/` generator version. A save whose version doesn't match rebuilds from its seed, but its `seenWorld` is dropped (the land changed under it). The Reach part is never versioned, because it never changes. |

- **Hex-level knowledge is derived, not stored:**
  - **seen** = it has a seen cell;
  - **visited** = the Warden stood in it;
  - **heard of** = `heardHexes`.
- **Size:** a busy run sees maybe 1,000 cells outside the Reach, so ~10 kB of numbers.
- **Core Warden's state** (cleansed corruption, killed spawners, opened chests) is keyed by tile chunk (`${cx},${cy}:${chunkX},${chunkY}`) in its **own** save. It's never written into the map, and the Artificer never reads it.

---

## 6. Views

**The hex overview, in words** (the default, before a map):
- Today's land-in-words (`descriptive-map.ts` `knownPlaces`) gets one more line block, "Further off".
- One line per known neighbouring hex, by direction and days:
  - "North, a day's walk: the high fells (you've seen into them)."
  - "South, two days: Saltmere's shore (heard of)."
- It's built from hex summaries plus the knowledge above.

**The hex overview, drawn** (after `mapLearned`, #1754):
- One glyph per hex in flat-top offset columns: each column of hexes is a text column, and odd columns are shifted half a row by interleaving rows.
- The glyphs are the hex's dominant biome from `GLYPH`, plus `#` for a seat, `@` for you, `·` for unknown and `?` for heard-of.
- A radius-3 overview is 7 columns × ~14 text rows:

```
   ·     ·
·     ^     ·        ^ fells      t birch valley   " marsh
   ^     ^           ~ lakes      # a village      @ you
?     @     t        ? heard of   · unknown
   t     "
#     ~     ·
   "     ·
```

**The cell map** for the current hex:
- `mapRows` over the hex's bounding box (~20 × 17).
- Cells owned by neighbours are shown as `·` unless seen, with a faint border.
- It replaces the Reach map only when the switch is on. Off, the Reach map is exactly today's.

**The LAND tab (#1841):** hexes are its sections ("the birch valley", "the marsh country"), and the places inside are cells.

**The AI and API:** the same text. The view would go in `observe()`. `RULES` gets one stable paragraph about hexes only when the switch is on, so cached rule text stays byte-identical for runs without it.

**Core Warden** never shows hexes in play, only on a world-map menu (exempt, later).

**Drawing:**
- Isometric projection is draw-time only: `sx = (tx − ty)·ISO_W/2`, `sy = (tx + ty)·ISO_H/2`, from **window-local** tiles (`tx − windowOrigin.tx`).
- World tiles reach millions, and the GPU's 32-bit floats would make sprites jitter at those pixel positions.

---

## 7. The world-builder link: provinces, cultures, villages

- **Inside the Reach, nothing changes:** its ~11 provinces (`provincesOf`), anchors, settlements and history stay exactly as they are, so golden and history hashes hold.
- **Outside: provinces are clusters of hexes.**
  - Seats are picked on the hex graph (each hex's best seat cell: walkable, water beside it, by the same scoring as `provinces.ts`), about one province per 3 hexes.
  - Each province grows over the hex graph by hex walking cost (the mean `COST` of a hex's cells).
  - The hex neighbour graph **is** the engine's neighbour graph, which already takes a graph with no coordinates (`storytelling/geography.ts`).
- **History over the wider world** is a separate, high-risk step.
  - The known world is radius 4 (61 hexes, ~20 provinces), about today's 19-province run in cost (~3 s, in the worker).
  - It needs either a second history beside the Reach's, which keeps the Reach's history byte-identical (preferred), or one joint history behind the switch, which needs rebaselining.
- **Cultures** (`macro-world/cultures.json`, race-agnostic, all in Mistheim):
  - A province's culture is drawn from the cultures that fit its land (climate and biome affinity), weighted by distance south towards Mistheim.
  - Beyond the known world, a coarse Voronoi of culture regions (a seeded point every ~5 hexes) names who lives there, for rumours.
- **Villages:**
  - There is one mapgen settlement at each province seat (as `settlements.ts` does), generated lazily when its hex is first seen.
  - Core Warden draws the same settlement on tiles at **`MAPGEN_TILE = 2` tiles** per mapgen grid square, so a 3 × 3 hut is 6 m and a 20–60-square village is 40–120 m.
- **The road and Mistheim:**
  - `road.ts` says 2 days between stops, 8 travel days in all, and the hexes are a day apart.
  - So on the hex map, the road leaves the start hex south, and **Mistheim sits about 8 hexes south** (`(0, 8)`), as a crafted special place.
  - The three anchor villages are seated inside the Reach today (`placeAnchors`), much closer than 2 days. Moving them out to hexes `(0,2)/(0,4)/(0,6)` would change the history's input, so it's a later, switched step, decided by the owner (see Owner decisions): behind `hex-world`.

---

## Core Warden's maps today

**The hand-made levels become special places, not replaced.**
- `Level1–5.ts`, `Spinolandet.ts` and the GameScene map (141 × 94 tiles ≈ 141 m × 94 m: a sliver of one cell) are the hand-made levels.
- A registry, `worldmap/special-places.ts`, holds them:
  ```ts
  { id, at: Tile /* world origin */, w, h /* tiles */, source: 'level1' | … }
  ```
- Inside a special place's rectangle, Core Warden draws its hand-made content, with a 16-tile blend border onto generated tiles.
- It's the same idea as the Reach patch, one level down.

**GameScene keeps working as it is** until a follow-up gives it a "world mode": a window of world tiles around a start point instead of a 4500 × 3000 px rectangle. The `Math.random()` seed goes then.

**The two biome lists differ:**
- the Reach has 10 biomes;
- Core Warden has 12 (`biomes.ts`).

A mapping table, `REACH_TO_CW_BIOME`, plus `tileBiomeIdx` on the bilinear fields reconciles them. Art decides the look, so that step is exempt.

---

## The rules switch

- **`hex-world`** (`src/artificer/features.ts`): `kind: 'rules'`, `default: false` while it's built, then `true`; `absent: false`, so old runs stay on the Reach.
- **Off:** nothing new is generated, read or written.
- **Golden hashes:**
  - The Artificer's playthrough and playtest hashes can't change with it off: no new draws touch the sim's streams (all new streams are `|hexworld|`).
  - The Reach's hashes can't change at all.
- **Core Warden has no switch registry:** its world mode is a scene option, off by default.

---

## Owner decisions on the open points

1. **The Reach is ~7 hexes of land, not one.**
   - At ~30 km a hex (9-cell size), the 48 × 32 Reach covers:
     - the start hex fully;
     - its NW and NE neighbours fully;
     - most of N, SW and SE;
     - a quarter of S.
   - **Decided:** hexes stay ~30 km. The start hex is the Reach's heart, the hex holding camp (200/200 seeds), and the rest of the Reach fills in its neighbours. Today's runs are unchanged.
2. **The road villages** are inside the Reach today but 2 days apart on the road.
   - **Decided:** with `hex-world` on, they move out onto hexes along the road, `(0,2)`, `(0,4)` and `(0,6)`.
   - With the switch off or absent, they stay where they are.
   - This is follow-up 12, now ATDD (no longer waiting on the owner).

---

## Follow-up issues (in order)

Each is one agent session.
- **ATDD** = `systems` only: Given/When/Then, one Vitest test per scenario.
- **Exempt** = has `art`, `ui-*` or `world`: screenshot or checklist.

| # | Title | Scope | Size | Depends on | Risk area | Acceptance |
|---|---|---|---|---|---|---|
| 1 | worldmap: coordinate module (tiles, cells, hexes) | `worldmap/coords.ts` + `tsconfig.json`: everything in §1 with tests (round-trips, neighbours, 204–214 cells a hex, every cell in exactly one hex, negatives) | S | — | low (new pure code) | ATDD `systems` |
| 2 | worldmap: move generateReach behind a re-export | `worldmap/reach.ts` + `worldmap/rng.ts` (a copy pinned equal to `src/artificer/rng.ts`); `src/artificer/world/reach.ts` re-exports; the hashes in `reach.test.ts` are unchanged | S | 1 | **high** (seeded RNG, golden hashes: must not move) | ATDD `systems` |
| 3 | worldmap: world-wide cell fields + the Reach start patch | `worldCell(seed, c)`: noise on `\|hexworld\|` streams, the trend, the 6-cell blend; test: identical to the Reach inside it, continuous across the band, believable across 20 seeds | M | 2 | medium (new seeded streams) | ATDD `systems` |
| 4 | worldmap: rivers across hexes | springs per hex, tracing over world height, `RIVER_MAX`, the radius-3 rule, Reach rivers continuing past the edge; test: same rivers in H whichever neighbour came first, every river cell joins water or runs on | M | 3 | medium | ATDD `systems` |
| 5 | worldmap: hex summaries and names | dominant biome, height, water, a seat cell, a seeded name ("the birch valley", "Saltmere's shore") for radius 4; LRU of full hexes | S | 3 | low | ATDD `systems` |
| 6 | Artificer: `hex-world` switch + walking window | register `hex-world` (default false); `walkingHours` over a world-cell window when on; `afield` outside the Reach; hashes unchanged with it off | M | 3, 4 | **high** (sim, saves) | ATDD `systems` |
| 7 | Artificer: seen cells and heard-of hexes in the save | `seenWorld`, `heardHexes`, `worldGen` (validated, written only when on); load/save round-trip; a version mismatch drops `seenWorld` | S | 6 | **high** (save format) | ATDD `systems` |
| 8 | Artificer: heading out crosses into the next hex | directed explore and walk-the-map on the window; the journal names the hex you end in | S | 6, 7 | medium (sim) | ATDD `systems` |
| 9 | Artificer: "Further off" — hexes in words | `knownPlaces` lists neighbour hexes by direction and days; AI `observe()` + a `RULES` paragraph only when on | S | 5, 7 | medium (AI rules caching) | ATDD `systems` |
| 10 | Artificer: drawn hex overview + current-hex cell map | text hex overview after `mapLearned`; cell map of the current hex; the LAND tab (#1841) sections | M | 9 | low | exempt `ui-hud` |
| 11 | World builder: provinces as hex clusters outside the Reach | seats on the hex graph, growth by hex cost, cultures from `cultures.json` by land fit; no history yet | M | 5 | medium | ATDD `systems` |
| 12 | World builder: the road and Mistheim on the hex map | Mistheim as a special place ~8 hexes south; road hexes; the anchor villages move to hexes `(0,2)/(0,4)/(0,6)` with `hex-world` on | S | 11 | medium (crafted content) | ATDD `systems` (anchors move behind `hex-world`) |
| 13 | World builder: history for the wider world | a second history run over the outer provinces in the worker; Reach history unchanged | L | 11 | **high** (storytelling golden hashes) | ATDD `systems` |
| 14 | worldmap: tile chunks for Core Warden | `tileChunk(seed, cell, chunk)`: bilinear fields + fine noise → `tileBiomeIdx`, edge-keyed river and path crossings, `REACH_TO_CW_BIOME` | M | 3, 4 | medium | ATDD `systems` (the pure part) |
| 15 | Core Warden: world mode in GameScene | a window of world tiles, world seed instead of `Math.random()`, window-local iso drawing, chunk streaming | L | 14 | medium (scene) | exempt `world` |
| 16 | Core Warden: hand-made levels as special places | `special-places.ts` registry; Level1 placed at a world tile with a blend border | M | 15 | low | exempt `world` |
| 17 | Core Warden: settlements from the shared world | draw the hex's mapgen settlement at `MAPGEN_TILE = 2` | M | 11, 15 | low | exempt `world`, `art` |

Steps 1–5 and 14 need no switch: they're new code nobody calls yet. Steps 6 onwards change play, behind `hex-world`.
