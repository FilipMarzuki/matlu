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
n_directions:  character.pixellab.n_directions
view:          character.pixellab.view
outline:       character.pixellab.outline
shading:       character.pixellab.shading
detail:        character.pixellab.detail
proportions:   character.pixellab.proportions
```

**Choosing `body_type`, `template`, `n_directions`, and `view`:**

PixelLab only supports two body types and 4 or 8 directions. Map creature archetypes as follows:

| Creature archetype | `body_type` | `template` | `n_directions` | `view` | Notes |
|-------------------|-------------|------------|----------------|--------|-------|
| Human / humanoid / robot | `humanoid` | — | 8 | `low top-down` | All humanoid templates available |
| Bird on ground (raptor, walking) | `humanoid` | — | 8 | `low top-down` | Describe bird anatomy; use walking templates |
| Bird flying / soaring | `humanoid` | — | 8 | `high top-down` | **Must use `mode: "pro"` AND custom animations for ALL anim states.** Standard humanoid templates produce poor results for flying birds. Pro mode gives correct wing anatomy and flight posture. Template animations also fail — `walking-4-frames` raises wings straight up like a human arm swing, completely wrong for flight. Requires user approval (20–40 gen/direction). |
| Large quadruped (bear, boar, gorilla) | `quadruped` | `bear` | 8 | `low top-down` | Use `get_character()` after creation for available quad animations |
| Apex predator (lion, tiger, wolf) | `quadruped` | `lion` | 8 | `low top-down` | |
| Medium predator / domestic animal | `quadruped` | `dog` or `cat` | 8 | `low top-down` | `cat` = smaller/agile, `dog` = medium |
| Horse / deer / ungulate | `quadruped` | `horse` | 8 | `low top-down` | |
| Insect / spider / multi-limbed | `quadruped` | `cat` | 8 | `low top-down` | Closest template; describe extra limbs in text. Custom animations available but expensive |
| Blob / amorphous | `humanoid` | — | 4 | `low top-down` | 4 directions sufficient — radially symmetric |
| Fish / aquatic | `humanoid` | — | 4 | `high top-down` | High top-down for swimming view |

**`n_directions` is 4 or 8 — no other values are accepted.**
Use 8 for anything with distinct left/right asymmetry or complex attack directions.
Use 4 for radially symmetric or very simple creatures.

**Template animations** proceed automatically — 1 generation per direction, no approval needed.

**Custom animations** (no `template_animation_id`) and **pro mode**: cost 20–40 generations
per direction. Always call `animate_character` without `confirm_cost` first to see the
total, show the user the cost, and only re-call with `confirm_cost: true` after explicit
approval. Never queue custom/pro without approval.

After calling `create_character`, check `get_character()` — the response lists all
template animations available for that character's body type and template.
Update `asset-spec.json` with the real template IDs before queueing.

Note the `character_id` from the response. Store it as `_pixellabCharacterId` in `asset-spec.json` immediately so it survives if the session is interrupted.

Note the `character_id` from the response. Store it as `_pixellabCharacterId` in `asset-spec.json` immediately so it survives if the session is interrupted.

### 2a′. Human approval (required before animations)

**STOP and get human approval before queuing any animations.**

Base character generation costs ~4 credits. Animations cost 4 credits per animation × N animations — potentially 16–64+ credits per character. Do not spend these without approval.

1. Call `get_character(character_id, include_preview: true)`
2. Show the user the preview image — it displays all 4 directions side by side
3. Ask: *"Does this character look right? Approve to proceed with animations, or describe what to change."*
4. **If approved** → proceed to step 2b
5. **If rejected / needs changes**:
   - Note the feedback
   - Call `delete_character(character_id)` to free the slot
   - Update the description in `asset-spec.json`
   - Return to step 2a with the revised description

This step is skipped only if the user has explicitly given blanket approval ("generate everything unattended").

### 2b. Queue animations

**Quadruped characters**: Animation templates differ from humanoid. Check `get_character` after creation — the response lists all available template animations for that body type. Update `asset-spec.json` with the correct template names before queueing (replace `"TBD — check get_character after creation"` entries).

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

Once all animations show `completed`, download the character ZIP and extract it:

```bash
node scripts/extract-character.mjs --id <characterId> --zip-url <zipUrl>
```

The ZIP URL comes from `get_character()` → "Download as ZIP".

The script reads `metadata.json` inside the ZIP and maps PixelLab's internal folder
names to the project's `animId` names. It uses:
1. Known prefix patterns (e.g. `jab_attack-…` → `lead-jab` → `attack`)
2. Pixel variance fallback for generic `animating-<hash>` folders (higher variance = more motion = walk/run)

**If automatic mapping fails**, you can manually specify the mapping via `src/ai/asset-lock.json`:

```json
{
  "<character.id>": {
    "animating-<hash>": "<animId>",
    "animating-<hash2>": "<animId2>"
  }
}
```

Run with `--inspect` first to see what folder names are in the ZIP before committing to extraction.

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
