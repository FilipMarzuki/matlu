# Asset Generation Protocol

Instructions for Claude agents generating pixel art assets overnight or on demand.
Read `src/ai/asset-spec.json` first. All generation parameters are defined there.

---

## Overview

1. Check what's pending
2. Generate characters (PixelLab MCP)
3. Generate tilesets (PixelLab MCP)
4. Assemble spritesheets (Node.js)
5. Commit

Each step is idempotent — assets with `status: "done"` in the spec are skipped by the
assembler. Re-running is safe.

---

## Step 1 — Check pending assets

```bash
npm run sprites:assemble -- --status
```

This shows what's pending, in-progress, and done. Only process assets with `status: "pending"`.

---

## Step 2 — Generate characters

For each character with `status: "pending"` in `spec.characters`:

### 2a. Create the base character

Call `create_character` using the parameters in `character.pixellab`:

```
description:   character.pixellab.description
size:          character.pixellab.size
n_directions:  character.pixellab.n_directions    (always 4)
view:          character.pixellab.view
outline:       character.pixellab.outline
shading:       character.pixellab.shading
detail:        character.pixellab.detail
proportions:   character.pixellab.proportions
```

Note the `character_id` from the response.

### 2b. Queue animations

The account has **8 concurrent job slots**. The base character uses 4 slots (one per direction),
leaving 4 slots — enough for exactly one animation at a time.

Queue one animation, wait for it to complete, then queue the next:

```
character_id:          <from step 2a>
template_animation_id: animation.template
```

After queuing each animation, poll `get_character` every 60s until that animation's
status shows `"completed"` before queuing the next one.

### 2c. Poll until ready

Call `get_character` with `include_preview: false`.
Repeat every 60 seconds until all animations in the response show status `"completed"`.
A character typically takes 5–8 minutes total.

### 2d. Download raw frames

From the `get_character` response, for each direction (south/north/east/west),
for each animation, download every frame image and save it to:

```
public/assets/sprites/_raw/[character.id]/anim_[animName]_[direction]_[frameIndex].png
```

`animName` comes from `character.animations[i].id` (not the template name).
`direction` is the direction string from PixelLab (south/north/east/west).
`frameIndex` is 0-based.

Download with curl or fetch:
```bash
curl -L -o "public/assets/sprites/_raw/skald/anim_idle_south_0.png" "[url]"
```

If PixelLab returns a ZIP URL, download and extract it, then rename files to match the
convention above. Inspect the ZIP structure first with `unzip -l` to understand filenames.

---

## Step 3 — Generate tilesets

For each tileset with `status: "pending"` in `spec.tilesets`:

### 3a. Create the tileset

Call `create_topdown_tileset` using parameters in `tileset.pixellab`:

```
lower_description:      tileset.pixellab.lower_description
upper_description:      tileset.pixellab.upper_description
transition_description: tileset.pixellab.transition_description
transition_size:        tileset.pixellab.transition_size
tile_size:              tileset.pixellab.tile_size
view:                   tileset.pixellab.view
shading:                tileset.pixellab.shading
outline:                tileset.pixellab.outline
detail:                 tileset.pixellab.detail
```

Note the `tileset_id` from the response.

### 3b. Poll until ready

Call `get_topdown_tileset` every 60s until status is `"completed"`. Takes ~2 minutes.

### 3c. Download tileset

Save the tileset PNG to:

```
public/assets/sprites/_raw/[tileset.id]/tileset.png
```

---

## Step 4 — Assemble

```bash
npm run sprites:assemble
```

This reads the raw frames and outputs:
- `[outputDir]/[id].png` — spritesheet
- `[outputDir]/[id].json` — Aseprite frame data (characters only)

It also marks each assembled asset as `status: "done"` in `asset-spec.json`.

To assemble a single asset:
```bash
npm run sprites:assemble -- --id skald
```

---

## Step 5 — Verify and commit

Run the build to check nothing is broken:
```bash
npm run typecheck
```

Commit assembled sprites and the updated spec:
```bash
git add public/assets/sprites/ src/ai/asset-spec.json
git commit -m "Generate pixel art assets: [list what was generated]"
```

Do not commit `public/assets/sprites/_raw/` — it is gitignored.

---

## Style guide

All PixelLab calls should match the project's visual style. Reference:

```json
{
  "view":    "low top-down",
  "outline": "single color black outline",
  "shading": "basic shading",
  "detail":  "medium detail",
  "characterSize": 32,
  "tileSize": 16
}
```

World palettes:
- **earth** — military greens, grays, rust orange
- **spinolandet** — deep purple, acid green, amber, bioluminescent teal
- **vatten** — jade green, teal, white, soft gold

---

## Adding new assets

Edit `src/ai/asset-spec.json`:
- Add to `characters[]` or `tilesets[]`
- Set `status: "pending"`
- Fill in `pixellab` params and `outputDir`
- For characters, define `animations[]` using template IDs from PixelLab

Available humanoid animation templates:
`breathing-idle`, `fight-stance-idle-8-frames`, `walking-4-frames`, `walking-6-frames`,
`running-4-frames`, `running-6-frames`, `scary-walk`, `lead-jab`, `cross-punch`,
`roundhouse-kick`, `falling-back-death`, `jumping-1`, `crouching`, `getting-up`
