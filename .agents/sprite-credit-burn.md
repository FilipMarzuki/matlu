# Sprite Credit-Burn Agent

Use this runbook when manually triggering the **Sprite Credit Burn** workflow.

Goal: spend remaining PixelLab credits before the monthly reset by generating sprites
for all entities that still have `spritesheetJson: null`.

Work in strict priority order, commit after each entity, and stop cleanly when credits
run out (PixelLab call failure).

---

## STEP 1 — Load project sources

Read:

1. `src/ai/asset-spec.json`
2. `src/entities/entity-registry.json`

From `asset-spec.json`, use:
- `styleGuide`
- `palettes`
- existing `characters[]` entries with `status: "done"` as references

From `entity-registry.json`, gather entities where:
- `spritesheetJson === null`

---

## STEP 2 — Build queue in priority order

Process entities in this exact order:

1. `type: "enemy"` + `world: "spinolandet"`
2. `type: "enemy"` + `world: "earth"`
3. `type: "hero"` + `world: "spinolandet"`
4. `type: "hero"` + `world: "earth"`
5. `type: "summon"`
6. Any remaining `type: "neutral"`

Skip an entity if an `asset-spec.json.characters[]` entry already exists with:
- matching `id`
- `status: "done"`

---

## STEP 3 — Derive the PixelLab description

For each queued entity:

1. Primary source: `entity.designNotes.sprite` (use verbatim if non-empty)
2. Fallback source: synthesize from:
   - `entity.personality`
   - world palette (`palettes[entity.world]`)
   - role context (`enemy` / `hero` / `summon`)

Fallback format:

`{personality}, {palette tones}, top-down pixel art RPG`

---

## STEP 4 — Choose body type and directions

Use these defaults:

| Kind | body_type | n_directions | directions |
|---|---|---:|---|
| Heroes / humanoids | `humanoid` | 5 | south, south-east, east, north-east, north |
| Insectoid / spider / crawler | `quadruped` | 5 | south, south-east, east, north-east, north |
| Drone / ghost / symmetric | `quadruped` | 4 | south, north, east, west |
| Amorphous swarm | `quadruped` | 4 | south, north, east, west |

If unsure:
- heroes default to humanoid/5
- enemies default to quadruped/5

---

## STEP 5 — Choose animation set

### Enemies
Generate 4 animations:
- `idle`
- `walk`
- `attack`
- `death`

### Heroes
Generate 5 animations:
- `idle`
- `walk`
- `attack`
- `death`
- `hurt`

### Summons / neutral
Generate at least:
- `idle`
- `walk` (or movement equivalent)
- `death`

Use `entity.designNotes.animations` when present to refine template choices.

---

## STEP 6 — Process one entity at a time

For each entity, do all substeps in order.

### 6a. Add/update asset spec entry

In `src/ai/asset-spec.json` append (or refresh) a `characters[]` entry:
- `id`: kebab-case entity class
- `status`: `"pending"`
- `pixellab`: includes description/body_type/directions/style fields
- `animations`: list from STEP 5
- `outputDir`: `public/assets/sprites/characters/{world}/{type}s/{id}`

Write file before PixelLab calls.

### 6b. Create base character

Call `create_character`.

If this call fails:
- stop run immediately (likely credits exhausted)
- print stop reason and completed count

On success:
- persist returned `character_id` to `_pixellabCharacterId` in `asset-spec.json`

### 6c. Generate animations

For each animation:
- call `animate_character`
- if call fails, stop run immediately (credits exhausted)

Poll `get_character(character_id)` until all requested animations are `completed`.

### 6d. Download frames

Save frames under:

`public/assets/sprites/_raw/{id}/anim_{anim}_{direction}_{frame}.png`

### 6e. Assemble spritesheet

Run:

`npm run sprites:assemble -- --id {id}`

If assembly fails:
- log error
- continue to next entity

### 6f. Update entity registry

Edit `src/entities/entity-registry.json` entry:
- `spriteKey`
- `spritesheetJson`
- `animTags` from assembled JSON `meta.frameTags`

### 6g. Commit

Commit after each successfully assembled entity:

```bash
git add src/ai/asset-spec.json src/entities/entity-registry.json public/assets/sprites/characters/{world}/{type}s/{id}/
git commit -m "art({id}): generate pixel art sprite — base + animations"
```

---

## STEP 7 — Track estimated credit usage

Use this estimate:
- `create_character`: +4
- each `animate_character`: +4

After each entity, log:

`[{entityClass}] done — estimated credits used this run: {N}`

If `N > 600`, warn before each next entity:

`⚠ Approaching estimated credit limit ({N} used).`

---

## STEP 8 — Pass 2: community submission queue

Run Pass 2 after Pass 1 (if credits remain).

Skip Pass 2 when either env var is missing:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### 8a. Fetch queued submissions

Query:
- `creature_submissions?status=eq.queued`
- ordered by `queue_priority.asc,queued_at.asc`

If empty, print:
- `[Pass 2] No queued creatures — nothing to do.`

### 8b. For each queued creature

1. PATCH submission status to `spriting`
2. Derive a registry stub entity:
   - `class`: PascalCase from slug
   - `type`: hostile => `enemy`, else `neutral`
   - `world`: normalized from `world_name` (`earth` fallback)
3. Set attribution in this exact format:

```json
{
  "source": "community",
  "attribution": {
    "maker_name": "<creator_name only when credits_opt_in=true>",
    "creature_submission_id": "<submission UUID>"
  }
}
```

4. If `credits_opt_in=false`, omit `maker_name` key entirely
5. Set `designNotes.sprite` from `graphics_notes` (fallback synthesis if empty)
6. Run the same generation pipeline as STEP 6
7. On success:
   - update registry sprite fields
   - PATCH submission to `status: "in-game"` with `entity_id` and `shipped_at`
   - commit per creature
8. On PixelLab create failure:
   - revert submission to `queued`
   - remove partial stub/asset-spec entry
   - stop Pass 2

---

## STEP 9 — Push and report

After completion or credit exhaustion:

```bash
git push origin HEAD
```

Print summary:
- entities generated (Pass 1)
- community creatures shipped (Pass 2)
- skipped entities
- stop reason (if any)
- estimated credits used
- remaining entities/submissions

---

## Key rules

- Commit after every successful entity or community creature.
- Stop immediately on PixelLab API failures (treat as credit exhaustion).
- Keep `asset-spec.json` and `entity-registry.json` in sync with generated outputs.
- Never commit `_raw/` files.
- Preserve unrelated fields in JSON files.
