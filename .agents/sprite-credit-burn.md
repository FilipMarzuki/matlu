# Sprite Credit-Burn Agent

You are the sprite credit-burn agent for Matlu. Your job: use remaining PixelLab credits before the monthly billing reset (9th of each month) to generate pixel art sprites for every entity that currently has none.

Credits are finite. Work in priority order. Commit after every entity so a crash or credit exhaustion never loses progress. Stop cleanly if PixelLab returns an error — that's the signal credits are exhausted.

---

## STEP 1 — READ THE STYLE GUIDE

Read `src/ai/asset-spec.json`. Internalize:
- `styleGuide` — view, outline, shading, detail, characterSize, tileSize
- `palettes` — per-world color descriptions
- `_rawNamingConvention` — how to name downloaded files
- Existing `characters[]` entries marked `status: "done"` — reference these for parameter patterns

---

## STEP 2 — BUILD THE WORK LIST

Read `src/entities/entity-registry.json`. Find every entity where `spritesheetJson` is `null`. These need sprites.

**Priority order (process in this exact sequence):**
1. `type: "enemy"`, `world: "spinolandet"` — 11 entities
2. `type: "enemy"`, `world: "earth"` — 12 entities
3. `type: "hero"`, `world: "spinolandet"` — 5 entities
4. `type: "hero"`, `world: "earth"` — 5 entities
5. `type: "summon"` — 1 entity
6. Any remaining `type: "neutral"`

Skip any entity that already has a `status: "done"` entry in `asset-spec.json` (it was generated in a previous run of this agent).

---

## STEP 3 — DERIVE THE PIXELLAB DESCRIPTION

For each entity, build the PixelLab `description` string:

**Primary source:** `entity.designNotes.sprite` — use this verbatim if it is a non-null, non-empty string. It was written by the entity-spec-fill agent specifically to be a PixelLab prompt.

**Fallback (designNotes not yet written):** Synthesize from:
- `entity.personality` — the one-line flavor text
- World palette from `asset-spec.json styleGuide.palettes[entity.world]`
- Entity type context (enemy = dangerous/threatening, hero = capable/determined)

Synthesis format:
> `{personality}, {world palette tones}, top-down pixel art RPG`

Example: *"bio-horror spider swarm queen with egg sac abdomen, chitin plating, acid green bioluminescence, deep purple carapace, top-down pixel art RPG"*

---

## STEP 4 — CHOOSE BODY TYPE AND DIRECTIONS

Use this table to set `n_directions` and `directions`:

| Entity class hint | body_type | n_directions | directions |
|------------------|-----------|-------------|-----------|
| Humanoid (upright bipeds — heroes, berserkers, golem-type) | `humanoid` | 5 | south, south-east, east, north-east, north |
| Insectoid / spider-like / multi-limbed crawlers | `quadruped` | 5 | south, south-east, east, north-east, north |
| Drone / floating blob / symmetric creature | `quadruped` | 4 | south, north, east, west |
| Swarm / amorphous | `quadruped` | 4 | south, north, east, west |

Use your judgment based on `entity.personality` and `entity.class` name. When uncertain, default to humanoid/5 for heroes, quadruped/5 for enemies.

---

## STEP 5 — CHOOSE ANIMATIONS

**Enemies** — generate these 4 animations (in order):
1. `idle` — template: `"idle"`, frameDurationMs: 150
2. `walk` — template: `"walking-4-frames"` for humanoids; `"custom-skitter like an insect"` for insectoids/spiders; `"floating"` for drones/ghosts, frameDurationMs: 100
3. `attack` — template: `"cross-punch"` for melee humanoids; `"custom-lunge forward"` for creatures; `"custom-projectile-fire"` for ranged, frameDurationMs: 80
4. `death` — template: `"falling-back-death"` for humanoids; `"custom-convulse and collapse"` for creatures, frameDurationMs: 80

**Heroes** — generate these 5 animations:
1. `idle` — template: `"fight-stance-idle-8-frames"`, frameDurationMs: 120
2. `walk` — template: `"walking-4-frames"`, frameDurationMs: 100
3. `attack` — template: `"cross-punch"` or `"lead-jab"` based on personality, frameDurationMs: 80
4. `death` — template: `"falling-back-death"`, frameDurationMs: 80
5. `hurt` — template: `"custom-flinch backwards"`, frameDurationMs: 80

**Summons / neutral** — 3 animations minimum: idle, walk/move, death.

Use `designNotes.animations` (if populated) to inform which templates to pick — it describes what each animation should look like.

---

## STEP 6 — GENERATE ONE ENTITY AT A TIME

For each entity in the work list:

### 6a. Add to asset-spec.json

Before generating, add an entry to `src/ai/asset-spec.json` in the `characters` array:

```json
{
  "id": "{entity-slug}",
  "name": "{entity.class}",
  "world": "{entity.world}",
  "faction": "{entity.type}",
  "status": "pending",
  "pixellab": {
    "description": "{description from Step 3}",
    "size": 48,
    "body_type": "{from Step 4}",
    "n_directions": {from Step 4},
    "directions": [{from Step 4}],
    "view": "low top-down",
    "outline": "single color black outline",
    "shading": "basic shading",
    "detail": "medium detail"
  },
  "animations": [{from Step 5}],
  "outputDir": "public/assets/sprites/characters/{entity.world}/{entity.type}s/{entity-slug}"
}
```

`entity-slug` = `entity.class` converted to kebab-case (e.g. `GlitchDrone` → `glitch-drone`, `RustBerserker` → `rust-berserker`).

Write the updated `asset-spec.json` back to disk.

### 6b. Create the base character

Call `create_character` with the pixellab params. **If this call fails — stop immediately.** Log which entity failed and print a summary of what was completed. Credits are likely exhausted.

Store the returned `character_id`. Immediately write it to `asset-spec.json` as `_pixellabCharacterId` so it survives a restart.

### 6c. Animate

For each animation in the entity's animation list, call `animate_character` with:
- `character_id` from 6b
- `template` from Step 5
- `directions` matching the character's direction list
- `frame_duration_ms` from Step 5

**If animate_character fails — stop.** Commit whatever was assembled so far.

Poll with `get_character(character_id)` every 15 seconds until `status === "completed"` for all animations (or until 3 minutes have passed, then move on and note it as timed out).

### 6d. Download frames

For each direction and each animation frame returned by PixelLab, save the frame to:
```
public/assets/sprites/_raw/{entity-slug}/anim_{animName}_{direction}_{frameIndex}.png
```

Use `get_character(character_id, include_animations: true)` to get all frame URLs, then download each one.

### 6e. Assemble spritesheet

```bash
npm run sprites:assemble -- --id {entity-slug}
```

This outputs:
- `{outputDir}/{entity-slug}.png` — spritesheet
- `{outputDir}/{entity-slug}.json` — Aseprite frame data

If assembly fails, log the error and continue to the next entity (don't abort the whole run).

### 6f. Update entity-registry.json

After successful assembly, update the entity's entry in `src/entities/entity-registry.json`:

```json
"spriteKey":       "{entity-slug}",
"spritesheetJson": "public/assets/sprites/characters/{entity.world}/{entity.type}s/{entity-slug}/{entity-slug}.json",
"animTags": {
  "idle":   "idle_south",
  "walk":   "walk_south",
  "attack": "attack_south",
  "hurt":   "hurt_south",
  "death":  "death_south",
  "alert":  null
}
```

Use the actual tag names from the assembled `{entity-slug}.json` (read its `meta.frameTags` array). If hurt was not generated for enemies, leave it null. Alert is always null unless it was explicitly animated.

### 6g. Commit

```bash
git add src/ai/asset-spec.json src/entities/entity-registry.json public/assets/sprites/characters/{entity.world}/{entity.type}s/{entity-slug}/
git commit -m "art({entity-slug}): generate pixel art sprite — base + {N} animations

World: {entity.world} | Type: {entity.type}
Animations: {comma-separated animation names}

Generated by sprite-credit-burn agent (PixelLab MCP).
Character ID: {character_id}"
```

Then move to the next entity.

---

## STEP 7 — CREDIT TRACKING

Track an estimated credit counter throughout the run:
- `create_character` call: +4 credits
- `animate_character` call: +4 credits per call

Log the running total after each entity:
```
[{entity.class}] done — estimated credits used this run: {N}
```

If the total exceeds 600 credits, print a warning before each new entity:
```
⚠ Approaching estimated credit limit ({N} used). Proceeding with next entity.
```

---

## STEP 8 — FINAL PUSH AND REPORT

After all entities are processed (or credits exhausted):

```bash
git push origin main
```

Print a summary:
- How many entities were generated this run
- Which entities were skipped (already had sprites)
- Which entity caused the stop (if credits exhausted)
- Estimated credits used
- Entities still needing sprites (if any remain)
- Suggestion: re-run after the 9th when credits reset

---

---

## PASS 2 — COMMUNITY CREATURE QUEUE

After completing all entity-registry work, drain the creature submission queue.
Run this pass only if credits remain.

### 2a. Fetch the queue

Query Supabase for creatures ready for spriting (service role key required):

```bash
curl -s -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  "$SUPABASE_URL/rest/v1/creature_submissions?status=eq.queued&order=queue_priority.asc&select=id,creature_name,creator_name,maker_age,world_name,lore_description,lore_origin,balance_tier,biome_affinity,graphics_difficulty,graphics_notes,approved_at,slug"
```

Process creatures in priority order (lowest `queue_priority` first).

### 2b. For each queued creature

1. **Mark as spriting** — flip the row before generating so a crash doesn't leave it queued:

```bash
curl -s -X PATCH \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  -d '{"status":"spriting"}' \
  "$SUPABASE_URL/rest/v1/creature_submissions?id=eq.{creature.id}"
```

2. **Build a stub entity-registry entry** — derive a camelCase class name and kebab-case slug from `creature.creature_name`:

```json
{
  "class":              "CamelCaseNameHere",
  "file":               "src/entities/CamelCaseNameHere.ts",
  "type":               "enemy",
  "world":              "earth",
  "source":             "community",
  "submissionId":       "{creature.id}",
  "submissionCreator":  "{creature.creator_name}{age_suffix}",
  "name_en":            "{creature.creature_name}",
  "personality":        "{first 100 chars of creature.lore_description or empty string}",
  "spriteKey":          null,
  "spritesheetJson":    null,
  "animTags":           { "idle": null, "walk": null, "attack": null, "death": null },
  "sounds":             {},
  "behavior":           {},
  "stats":              {},
  "designNotes":        null
}
```

- `age_suffix` = ` (age ${creature.maker_age})` if `maker_age` is set, else `""`.
- `world` = `creature.world_name` lowercased if recognisable (earth/spinolandet/mistheim), else `"earth"`.
- Append this entry to `src/entities/entity-registry.json`.
- `entity_slug` = class name in kebab-case (e.g. `StoneCrawler` → `stone-crawler`).

3. **Derive the PixelLab description** — if `creature.graphics_notes` is non-empty, use it verbatim. Otherwise synthesise from `creature.lore_description` and world palette (same fallback logic as STEP 3 above).

4. **Generate the sprite** using STEPS 4–6g above, with `entity_slug` as the ID.

5. **On success** — update the Supabase row:

```bash
curl -s -X PATCH \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  -d "{\"status\":\"in-game\",\"entity_id\":\"{entity_slug}\",\"shipped_at\":\"{iso_timestamp}\"}" \
  "$SUPABASE_URL/rest/v1/creature_submissions?id=eq.{creature.id}"
```

Commit the entity-registry change + spritesheet with:
```bash
git add src/entities/entity-registry.json public/assets/sprites/characters/...
git commit -m "art({entity_slug}): community creature sprite — {creature.creature_name}

Source: community submission (submitter: {creature.creator_name})
World: {world} | Difficulty: {creature.graphics_difficulty}
Animations: {comma-separated animation names}

Generated by sprite-credit-burn agent (PixelLab MCP). Closes creature #{creature.id}."
```

6. **On PixelLab failure (credits exhausted)** — reset the row back to queued:

```bash
curl -s -X PATCH \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  -d '{"status":"queued"}' \
  "$SUPABASE_URL/rest/v1/creature_submissions?id=eq.{creature.id}"
```

Remove the stub entry from `entity-registry.json` (to avoid orphaned stubs), then stop.

---

## Key rules

- **Commit after every entity** — never batch multiple entities into one commit
- **Stop cleanly on PixelLab errors** — don't retry; credits are gone
- **Never skip the registry update** — if the spritesheet exists but the registry isn't updated, `entity:audit` won't see it
- **Preserve all existing fields** in both JSON files — only add/update the fields you're touching
- **`_raw/` frames are gitignored** — never try to commit them
- **Reset to queued on failure** — if spriting a community creature fails, undo the `spriting` status so it stays in the queue for the next run
