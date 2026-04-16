# Wind Animation System — Design Document

**Issue:** FIL-239  
**Date:** 2026-04-16  
**Status:** Approved for implementation

---

## Summary

This document resolves the design questions for Matlu's wind animation system
before any code is written. It covers approach, per-biome behavior, performance
budget, audio integration, and flora asset requirements feeding into the
FIL-176 asset matrix.

---

## 1. Chosen Approach: Hybrid Noise + Shader (Fragment UV Warp)

### Options evaluated

| Approach | Pros | Cons |
|---|---|---|
| **Shader-based wave** (fragment UV warp) | GPU-efficient, follows existing `ShimmerFilter` / `CorruptionFilter` pattern, no extra sprites needed | Distortion-only — can't truly displace vertices; looks best on layered sprites |
| **Runtime vector field** | Full directional control, good for complex wind shadows | Memory overhead for per-tile vectors, harder to author |
| **Hybrid: FBM noise field + shader** | Reuses `src/lib/noise.ts` FBM already in the project, consistent with corruption filter's FBM, good visual quality | Slightly more GPU cost than a pure sine wave |

### Decision: Hybrid FBM noise + fragment UV warp

**Rationale:**  
The `CorruptionFilter.ts` and `ShimmerFilter.ts` shaders already use FBM noise
in GLSL for organic motion. The same pattern — a `uTime`-driven FBM distortion
applied to UV coordinates — can animate vegetation convincingly with minimal
new code. The `src/lib/noise.ts` FBM implementation can supply a CPU-side
wind-direction value per chunk for audio sync and wake calculations, while the
GPU shader handles the per-pixel animation.

**Architecture (two tiers):**

1. **Dense vegetation (grass, reeds, heath)** — apply a `WindSwayFilter`
   (a `Phaser.Filters.Controller` following the same pattern as
   `CorruptionFilter`) to a dedicated "vegetation" tilemap layer. The fragment
   shader distorts only the upper ~40% of each tile's UV so roots stay fixed.

2. **Sparse vegetation (trees, bushes in `Decoration.ts`)** — drive Phaser
   tweens from a CPU-side FBM sample taken once per second. Pool up to 50 active
   tweened objects within 2× the visible screen bounds.

A **precomputed obstacle distance mask** (Float32Array per chunk, written once
at scene init) provides the wind-shadow multiplier: 0.0 next to buildings/roads,
linearly ramping to 1.0 over 2–3 tiles.

---

## 2. Wind Behavior by Biome / Zone Type

| Zone | Amplitude (0–1) | Frequency (Hz) | Notes |
|---|---|---|---|
| **Plains / coastal heath** | 0.60 | 0.80 | Open terrain, full wind exposure |
| **Sandy shore** | 0.55 | 0.70 | Coastal grasses sway smoothly |
| **Marsh / bog** | 0.50 | 0.55 | Reeds sway slowly, heavier stems |
| **Mixed forest** | 0.25 | 0.40 | Canopy shelter, understory minimal |
| **Dense spruce** | 0.15 | 0.30 | Very sheltered; mainly upper boughs |
| **Granite / highland** | 0.70 | 1.00 | Exposed rock, sparse tundra plants |
| **Klipptoppen / snow summit** | 0.90 | 1.20 | Strong gusts, minimal vegetation |
| **Road / building shadow** | 0.0 → 0.20 | N/A → base | Distance-mask lerp from 0 at edge |
| **Corrupted zones** | 0.80 | chaotic | See section 4 |
| **Water** | N/A | N/A | Water surface uses a separate shader |

Wind direction is a slow-drifting world vector updated once per 30 s using FBM
noise seeded from the map seed, giving gradual, natural shifts rather than a
constant direction.

---

## 3. Road / Structure Behavior

**Decision: Wind shadow (stillness) near structures, mild funneling along roads.**

- **Buildings/walls:** Dead-calm zone within 1.5 tiles of a solid obstacle
  (obstacle distance mask = 0). This matches real-world aerodynamics where
  wake turbulence occurs *behind* a building, not on its sides — kept simple
  by defaulting the wake zone to stillness rather than turbulence for now.
- **Roads:** The obstacle mask reduces amplitude to ~20% at road edges. A
  slight axial bias (±15°) is added to wind direction along road corridors to
  simulate funneling, but this is a low-priority polish pass and can be deferred.
- Revisit funneling in a dedicated ticket once the base system ships.

---

## 4. Corruption Integration

**Decision: Chaotic/broken wind in corrupted zones; cleansing restores smooth flow.**

The `WorldState.corruption` value (0.0–1.0, already exposed) drives a
`uChaos` uniform in the wind shader, mirroring how `CorruptionFilter` uses
`uCorruption`.

At high corruption:
- Amplitude spikes to 0.80 regardless of biome baseline.
- Direction reverses rapidly (period cut from 30 s to 2–4 s).
- FBM octave count increases from 3 → 5 for more irregular fractal noise.
- A visible "hair-static" artefact (small bright sparks, identical technique
  to the corruption flicker) appears on vegetation in deep corruption.

On cleansing: lerp `uChaos` → 0 over 3 s to match the visual and audio
cleansing restoration already in the game.

---

## 5. Player Wake

**Decision: Yes — vehicle movement creates a visible grass wake.**

The vehicle passes through grass at speed; a trailing "parted" wake should
be visible for ~2 s behind it.

**Implementation:**
- Each frame, record player world position if biome is grass/heath/marsh.
- Maintain a circular buffer of the last 8 positions (sampled every 80 ms).
- For each Decoration grass sprite within 1.5 tiles of any wake point,
  apply a short tween: rotate +/−20° away from the wake vector, then spring
  back over 1.8 s.
- Reuse tweens from a pool to avoid garbage-collector pressure on mobile.
- Wake effect is disabled at vehicle speeds < 30 px/s (slow crawl through grass
  looks odd with a wake).

---

## 6. Audio Sync

**Decision: Wind visual intensity drives existing `sfx-wind` volume globally, plus a new `sfx-wind-grass` ambient layer for open biomes.**

Current state: `sfx-wind` fades in only at mountain biome ≥ 0.81.

Proposed change:
- Replace the hard biome threshold with a continuous `windIntensity` value
  (amplitude × frequency for current player biome, 0.0–1.0).
- Map `windIntensity` → `sfx-wind` volume: `0.05 + windIntensity * 0.18`
  (range: 0.05 silence floor → 0.23 max, matching current mountain max).
- Add `sfx-wind-grass` (a softer rustling loop, CC0 source TBD) for plains/marsh.
  Its volume is `windIntensity * 0.12` and muted in forest / summit.
- Corruption chaos (`uChaos > 0.5`) adds a subtle high-frequency whine
  layered over `sfx-wind`.
- All volumes pass through the existing `duckAudio()` ducking path so the
  system respects overlay-open silencing automatically.

---

## 7. Season Tie-in

**Decision: Tie wind intensity to `WeatherCondition` now; hook seasonal modifier when a Season enum is added.**

The game currently has `WeatherCondition = 'clear' | 'rain' | 'ash'` in
`WorldState.ts`. No explicit season enum exists yet.

**Weather modifiers (multiply base amplitude):**

| Weather | Wind multiplier | Notes |
|---|---|---|
| `clear` | 1.0× | Baseline |
| `rain` | 1.35× | Stormy, higher amplitude |
| `ash` | 0.90× | Heavy particle suppresses obvious sway |

**Season hook (placeholder):** When a `Season` type is added to `WorldState`,
wire in these modifiers:

| Season | Multiplier |
|---|---|
| `summer` | 0.70× (calm) |
| `autumn` | 1.00× (moderate) |
| `winter` | 1.30× (strong) |
| `spring` | 1.10× (gusty) |

Until seasons exist, the season multiplier defaults to 1.0.

---

## 8. Performance Budget

**Target platform:** Android tablet (Chrome 120), 60 fps, 16.7 ms/frame total.

| Sub-system | GPU budget | CPU budget |
|---|---|---|
| `WindSwayFilter` (vegetation layer shader) | ≤ 0.8 ms | — |
| Decoration tween updates (≤ 50 objects, 30 fps throttle) | — | ≤ 0.3 ms |
| FBM noise sampling for audio/wake (1 Hz) | — | < 0.1 ms |
| Obstacle distance mask (precomputed, read-only) | — | < 0.05 ms |
| **Total wind system** | **≤ 0.8 ms GPU** | **≤ 0.45 ms CPU** |

**Budget rules:**
- Animate only vegetation within 2× the camera viewport (frustum cull).
- Cap active tweened decoration objects at 50 (pool and reuse, oldest evicted).
- Tween updates throttled to 30 fps max (skip every other `update()` call).
- If `FPS < 50` for 3 consecutive seconds, halve the active-tween cap and
  reduce shader FBM octave count from 3 → 2.

---

## 9. Flora Asset Requirements (for FIL-176 Asset Matrix)

The wind animation system requires animated vegetation frames. The following
additions feed into the FIL-176 biome/elevation/season asset matrix.

### New asset entries required

| Asset ID | Type | Biome | Frames | Notes |
|---|---|---|---|---|
| `grass-plains-wind` | Tileset tile (16 px) | Plains, coastal heath | 4-frame loop | Wind sway cycle, neutral → left → neutral → right |
| `reed-marsh-wind` | Tileset tile (16 px) | Marsh/bog | 4-frame loop | Slower, wider arc than grass |
| `heath-shrub-wind` | Decoration sprite (16 px) | Coastal heath | 4-frame loop | Low scrub, subtle sway |
| `tree-mixed-wind` | Decoration sprite (32 px) | Mixed forest | 4-frame loop | Upper canopy only, roots fixed |
| `spruce-dense-wind` | Decoration sprite (32 px) | Dense spruce | 2-frame loop | Minimal bough movement |
| `tundra-grass-wind` | Tileset tile (16 px) | Granite/highland | 4-frame loop | Short, stiff highland grass |
| `corrupted-grass-wind` | Tileset tile (16 px) | Corrupted zones | 6-frame loop | Chaotic, includes corruption-spark frames |

### Style notes for PixelLab generation

- All vegetation assets: 16 px tiles / 32 px decoration sprites, matching
  existing tileset scale.
- Palette: use biome-appropriate palette from `docs/matlu-palette.hex` plus
  the corruption violet (`#7B2FBE`) for corrupted variants.
- Wind sway should be expressed via pixel-shift (1–2 px tip offset), not
  full-sprite rotation, to preserve the low top-down pixel art look.
- Frame 0 = neutral upright; frames 1–3 = sway cycle; frame 0 also = loop end.

---

## Implementation Notes

- New file: `src/shaders/WindSwayFilter.ts` — follows the exact pattern of
  `CorruptionFilter.ts` (BaseFilterShader, uTime + uAmplitude + uFrequency +
  uChaos uniforms, FBM-based UV warp clamped to top 40% of each tile).
- New file: `src/systems/WindSystem.ts` — manages CPU-side wind state:
  current direction vector, per-biome params, decoration tween pool,
  player wake trail buffer, audio sync output.
- `GameScene.ts` wires both: creates `WindSystem` in `create()`, calls
  `windSystem.update(delta, playerPos, biome, weather, corruption)` in
  `update()`.
- No changes to existing shaders or audio volumes outside the wind system.
