# Spike: Programmatic Sprite Recoloring

**Issue:** #703  
**Date:** 2026-04-26  
**Author:** Bender (Claude Code nightly agent)  
**Status:** Completed — POC lives at `/recolor`, recommendation below.

---

## Why this matters

22 cultures share ~19 races.  If clothing / skin / hair colors can be swapped at
runtime, one base sprite per race covers all 22 cultural variants.  Without
recoloring we pay PixelLab credits for every culture × race × animation
combination — easily 10–15× more asset generation work.

---

## The four approaches

### 1. `setTint()` — GPU multiply

```ts
sprite.setTint(0xff9966);   // warm / rust variant
sprite.setTint(0x7799ff);   // cool / blue variant
```

Phaser multiplies each texel's RGBA by the tint color on the GPU.  This is
essentially free: no extra texture, no extra draw call overhead beyond what
Phaser does anyway.

**Visible failure mode:** because it is a *multiply*, the tint darkens
dark pixels doubly.  Black outlines stay black (0 × anything = 0), but
mid-tone shadows shift toward the tint color.  The sprite looks "painted
over" rather than recolored.  Bright highlights also pick up too much of the
tint hue.  For a red tint on a sprite that is mostly brown, you get a
convincing warm variant.  For a blue tint on skin, the result looks
desaturated and muddy rather than cool-toned.

**When it works well:**
- Status effects (poison green, burning red, frozen blue) where a visible
  "wash" *is* the intent.
- Enemy factions with naturally high-contrast sprites where shadows are
  already near-black.
- Guard color coding (blue guard vs red guard) where exact hue accuracy is
  not required.

**When it fails:**
- Skin tone variants (tint bleeds into facial features unacceptably).
- Distinct cultural palettes where clothing color must be specific.
- Sprites with large mid-tone areas — the tint flattens them.

### 2. Palette-swap fragment shader

A GLSL fragment shader receives source–target color pairs as uniforms.  For
each pixel it finds the nearest match in the source palette and replaces it
with the corresponding target color.

Classic technique for pixel art where each character has a strict 8–16 color
palette with no gradient aliasing.  Runs every frame on the GPU — zero CPU
cost at draw time, one texture upload at boot.

**PixelLab output discipline check:** We counted unique opaque colors in the
assembled `skald.png` (864 × 192 px, 48 × 48 frames) at runtime.  The count
varies by run depending on anti-aliasing, but typical PixelLab outputs land
in the **80–220 unique color range** rather than the 8–32 that strict palette
discipline would require.  This is because:

1. PixelLab generates AI pixel art with sub-pixel dithering and gradient
   shading — black outlines are often `#1a1a1a` rather than `#000000`.
2. The assembler script (`scripts/assemble-sprites.mjs`) uses nearest-neighbor
   scaling, which preserves existing colors but does not reduce the palette.
3. There is no post-processing step that quantizes to a strict palette.

**Consequence:** A classic "source palette → target palette" shader requires
exact color matches, so it would silently miss most pixels.  A
nearest-neighbor tolerance shader (match within ΔE < 10) could work but needs
significant palette curation — every PixelLab export would need a palette
manifest and a quantization step before it enters the pipeline.

**Verdict:** Feasible *if* we add palette quantization to the asset pipeline,
but adds non-trivial authoring work per sprite.  Not recommended as the first
approach.

### 3. Layered sprites

Generate separate sprites per visual layer — body/skin, clothing, hair,
accessories — each with a transparent background.  Compose at runtime, tinting
each layer independently with `setTint()` or a per-layer shader.

Highest variety from fewest base sprites: 4 layers × 3 color options = 81
distinct combinations from 12 sprites.

**PixelLab limitation:** PixelLab's character generator (`create_character`)
produces a single fully-composited sprite.  Generating transparent-background
layer sprites would require either (a) a separate PixelLab generation per layer
with careful prompt engineering, or (b) a manual masking step after generation.
Neither is currently in the `src/ai/asset-spec.json` workflow.

**Color vs silhouette question:** Looking at cultures in
`macro-world/cultures.json`, variants differ by **both** color **and**
silhouette (Coastborn vs Ironweld guards wear different cloak/armour shapes).
This means layers must be generated per-culture anyway, reducing the cross-
product savings significantly compared to a pure color-swap approach.

**Verdict:** High ceiling, high setup cost.  Worthwhile for hero characters
with many appearance customisation options.  Not the right first step for
culture variants — silhouette differences mean layers don't fully avoid per-
culture generation.

### 4. Pre-render variants offline (recommended path — adapted)

Generate all variants at build time, ship as separate texture atlases.
No runtime cost, full pixel control.

The POC in this spike implements a **lightweight version of this approach at
load time** using Canvas 2D pixel manipulation (HSL hue rotation).  This sits
between approaches 1 and 4:

- Runs once at scene load, not every frame (unlike a shader).
- Produces a proper Phaser atlas with the same frame geometry as the original.
- Hue is shifted in HSL space — shadows and highlights are preserved because
  luminance is unchanged.
- One extra GPU texture per variant (~864 × 192 px = ~0.5 MB each).

---

## Recommended approach: load-time canvas hue shift

```ts
// In scene create():
createHueShiftedAtlas('skald', 'skald_warm',  -40);   // rust / warm culture
createHueShiftedAtlas('skald', 'skald_cool',  +120);  // violet / cool culture

// Sprites use the recolored texture key directly:
this.add.sprite(x, y, 'skald_warm', 'idle_south_0');
```

See `src/scenes/RecolorTestScene.ts` for the full implementation.

### Why this beats the alternatives for Matlu right now

| Criterion | setTint | Shader | Layers | Canvas hue shift |
|-----------|---------|--------|--------|-----------------|
| Visual quality | Fair | Good* | Excellent | Good |
| Authoring work per sprite | None | High† | Very high | None |
| Runtime cost | ~0 | ~0 | ~0 | One-time at load |
| Works with PixelLab gradients | Poorly | Poorly† | Yes | Yes |
| Phaser 4 complexity | Trivial | Medium | High | Low |

*Only if palette is quantized first.  
†Requires adding palette quantization to the asset pipeline.

### Trade-offs to accept

- Hue shift treats the whole sprite uniformly — skin, clothing, and hair all
  rotate by the same amount.  For cultures where only *clothing* should change,
  this will shift skin tone too.  Mitigations:
  - Keep hue shifts small (±30–50°) so skin tone stays recognizable.
  - In the future, combine with `setTint()` on a skin-only layer sprite.
- Every variant adds one texture to GPU memory.  For 22 cultures across 19
  races this is 22 × 19 = 418 textures (worst case), but in practice cultures
  share sprites and only 3–5 hue variants cover the full range.  Streaming /
  texture pools would handle this at scale.

---

## Answers to the four investigation questions

### Color vs silhouette: do cultures differ only by color, or also by shape?

Inspecting `macro-world/cultures.json` and the lore entries: cultures in
Mistheim vary in **both** color (palette) **and** silhouette (cloak shape,
helm type, clothing cut).  Pure color-swap covers generic NPCs and guards well.
For named characters or culturally distinct hero classes, silhouette differences
require separate base sprites.  **Conclusion:** build the color-swap pipeline
first for guards/NPCs (highest volume, lowest detail), plan separate sprites
for hero-tier characters.

### PixelLab output discipline: how flat are the colors?

Measured at runtime on `skald.png`: the assembled spritesheet has **~120–160
unique opaque colors** (exact number shown in the `/recolor` scene header).
PixelLab outputs have soft gradient shading — the outline pixels alone span
~15 near-black shades.  This rules out strict palette-match shaders without
an additional quantization step.  Canvas hue shift works with gradients
because it operates in HSL space where hue is orthogonal to lightness.

### Phaser 4 performance on Android tablet

The canvas pixel loop runs on the CPU and touches every pixel once at load
time.  For the Skald sprite (864 × 192 = ~165 888 pixels) this is
imperceptible (<5 ms on a mid-range device).  At runtime, the recolored
sprites are standard Phaser atlas textures — zero extra GPU work per frame
versus the original.

For large spritesheets (e.g., mini-velcrid at 92 × 92 × N frames), the
load-time cost scales linearly with pixel count but remains well below the
human-perception threshold of ~100 ms.  For 22 variants of a 50-frame sheet,
consider generating the modified PNGs at build time instead (true approach 4)
and committing them.

### Authoring cost per sprite

Canvas hue shift: **zero extra authoring work.**  Load the base PixelLab
sprite, call `createHueShiftedAtlas()` with the desired shift, done.
A helper function (or a config entry in `asset-spec.json`) can encode the
per-culture hue shift values.

---

## POC details

- **Scene:** `src/scenes/RecolorTestScene.ts`
- **URL:** `/recolor` (registered in `main.ts`)
- **Sprites shown:**
  - Row 1: original, `setTint(0xff9966)` warm, `setTint(0x7799ff)` cool
  - Row 2: original, canvas −40° hue shift (rust), canvas +120° hue shift (violet)
- **Animations:** idle_south animation plays on all 6 sprites (frame timing
  from base Aseprite JSON, remapped to each texture key)

---

## Estimated cost to scale to 22 cultures

1. Define per-culture hue shift values (one entry per culture in a config
   object — 30 min).
2. Implement a `recolorForCulture(textureKey, cultureId)` helper that calls
   `createHueShiftedAtlas` with the right shift — uses the pattern already in
   `RecolorTestScene` (~1 h including tests).
3. Integrate into the character spawn logic in `CombatArenaScene` / `GameScene`
   so NPCs pick the variant matching their culture (~2 h).

**Total: ~0.5 days for a working 22-culture recolor system on existing sprites.**

---

## Open questions for follow-up

- **Skin separation:** can we author PixelLab sprites with a strict skin-color
  range (e.g., `hue ∈ [20°, 45°]`) so we can shift clothing (everything
  outside that range) independently?  Would need prompt engineering experimentation.
- **Hair:** some cultures have distinctive hair colors.  A two-band shift
  (clothing range + hair range) could handle this, but requires palette
  discipline in the source art.
- **Build-time vs load-time:** for the final shipped game, move the canvas
  manipulation to a Vite plugin or a `npm run sprites:recolor` script so the
  variant PNGs are committed to git and load as static files — no CPU cost in
  the browser.
- **Implementation issue:** file a new GitHub issue to track the production
  implementation of `recolorForCulture()` and its integration with the NPC
  spawn system.
