# Spike: Programmatic sprite recoloring (#703)

## Executive summary

Runtime recoloring is **partially** viable for Matlu today: **`setTint`** is free and good for uniform effects (status, cheap faction cues), but it cannot swap “cloak stays blue while skin stays warm.” **Limited-slot palette remapping** in a small fragment shader can do that **only when** key garment/skin tones sit in tight RGB clusters. Current PixelLab-assembled sprites (example: **Skald**) use **many** distinct colours per frame because of shading gradients, so a production culture system needs either **art discipline** (flat fills + locked palette), **layered sprites** (body / cloth / hair drawn separately), or **offline variants** in the atlas.

**Recommendation:** adopt a **two-tier plan**:

1. **Ship `setTint` immediately** for whole-sprite variants (guards, debuffs, simple “team colour” reads).
2. **Pilot palette-slot remapping** on **one** hero pipeline after constraining source art (≤8 swap targets per layer, no noisy gradients in swappable regions). If silhouettes must differ by culture (hats, cloaks), combine tier 1 with **extra attachment layers** or accept **atlas rows per silhouette family**, not per culture×race.

**POC:** `SpriteRecolorSpikeScene` — navigate to **`/recolor`**. Shows Skald `idle_south_0` as base, two `setTint` examples, and two **three-slot palette** shader variants.

---

## Questions from the issue

### 1. Color vs silhouette (cultures)

Settlement **cultures** in `macro-world/settlement-cultures.json` differ strongly in **architecture** (roof style, footprint shapes, fortified vs open). That does not automatically define NPC costume rules, but it signals that **visual identity is not “hue swap only.”** For heroes and guards, expect **some** cultures to need different **silhouettes** (cloak vs tabard, headgear), not just palette. When silhouette differs, **layered sprites** or **separate baked frames** win; pure `setTint` or palette shader cannot add a missing hat.

### 2. PixelLab output discipline (measured)

**Asset:** `public/assets/sprites/characters/earth/heroes/skald/skald.png` (full sheet).

| Scope | Unique RGB colours (alpha ≥ 8) |
| ----- | -------------------------------- |
| Full 864×192 sheet | **253** |
| Single frame `idle_south_0` (48×48) | **39** |

Interpretation: colours are **not** “8-index GBA palette” flat; AI shading introduces many near-neighbours. A **3-slot** distance-based remap (POC) hits the most frequent garment tones but **misses** gradient mid-tones unless thresholds are widened (which then risks bleeding into skin or outlines). Production palette swap needs **quantization** in the art pipeline or hand-picked ramps per material.

### 3. Phaser performance on Android tablet (palette shader)

- **`setTint`:** no extra cost — still the default batch path.
- **Custom `GameObjects.Shader`:** each instance is a **standalone render** (batch break + draw call). A few dozen NPCs with **individual** palette shaders is usually fine on modern tablets at 800×600-class resolution; hundreds of unique shader quads per frame would hurt.
- **Better long-term:** a **single** batched custom `RenderNode` / shared material with per-instance uniforms, or remap in a **sprite sheet preprocess** so runtime stays on the default pipeline.

**Verdict:** 60 fps is realistic for **tens** of palette-swapped sprites, not a reason to avoid the technique at Matlu’s current scale — but batching matters if every villager gets a unique shader object.

### 4. Authoring cost (fresh PixelLab → chosen pipeline)

| Approach | Rough manual effort per entity |
| -------- | ------------------------------ |
| `setTint` only | **Zero** — set in data. |
| Palette remap (3–8 slots) | **Low–medium** — pick source RGBs (eyedropper or histogram), tune thresholds; re-test all animations for bleed. |
| Layered (body/cloth/hair) | **High** — split exports, align pivots, possibly separate normal maps if lighting applies. |
| Offline bake 22 culture variants | **Medium CPU, high disk** — automate in build; artist reviews combinatorial explosion. |

---

## Four approaches (viability for Matlu)

| Approach | Viable? | Notes |
| -------- | ------- | ----- |
| **`sprite.setTint()`** | **Yes** | Whole-sprite multiply. Fails when you need independent regions (skin vs cloth). Great for poisoned / frozen / “elite” hue shift. |
| **Palette-swap fragment shader** | **Yes, conditional** | Classic pixel-art technique. Needs flat or quantized regions. PixelLab output today is **gradient-heavy**; doable after art constraints or offline posterization. |
| **Layered sprites** | **Yes** | Best visual variety; each layer can tint independently. Requires generation/packing discipline and more draw calls or atlasing. |
| **Pre-render variants offline** | **Yes** | Predictable quality; cost moves to build size and CI time. Good fallback if runtime complexity is unwanted. |

---

## Scaling estimate (22 cultures)

This is **order-of-magnitude**, not a quote:

- **`setTint` only:** ~**1×** base asset; culture = data (tint + optional attachment list).
- **Palette shader with 6 slots:** ~**1×** base texture + **~22 small JSON** palette records (if silhouette shared); **1–3 dev weeks** tooling + one art pass to validate all animations.
- **Layered:** ~**3–5×** texture area per character class + rigging time; best when silhouettes differ.
- **Offline 22 variants:** ~**22×** raster footprint for that character **per** pose set — usually unacceptable for heroes with many animations.

---

## Open questions (follow-up issues)

1. **Art contract:** will culture variants share **exact** silhouette for tier-1 NPCs? If yes, palette or tint may suffice; if no, plan layers or bakes.
2. **Quantization pass:** should `sprites:assemble` optionally **reduce** swappable layers to N colours (lossy)?
3. **Lighting:** if normal-mapped heroes land broadly, do palette swaps need to run **before** lighting in shader graph?
4. **Batching:** is a shared palette material worth engineering once NPC counts exceed ~50 on screen?

---

## Code references

- Scene: `src/scenes/SpriteRecolorSpikeScene.ts`
- GLSL strings: `src/shaders/spriteRecolorPaletteGlsl.ts`
- Route registration: `src/main.ts` (`/recolor`)
