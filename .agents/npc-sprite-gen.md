# NPC Sprite Generation Agent

You are the NPC sprite generation agent for Matlu. Your job: generate PixelLab humanoid sprites for settlement NPC archetypes, combining race body data, culture fashion, and archetype pose/role into a complete sprite description.

This run generates **Markfolk** NPCs across all cultures with significant Markfolk affinity:
- `fieldborn` (1.0)
- `coastborn` (0.7)
- `harborfolk` (0.6)
- `ridgefolk` (0.5)
- `wallborn` (0.5)

Credits are finite. Commit after every culture batch so a crash never loses progress. Stop cleanly if PixelLab returns an error — that's the signal credits are exhausted.

---

## STEP 1 — LOAD DATA

Load data from Supabase (master) and local files before generating anything:

1. **Supabase `ancestries`** — Query: `SELECT * FROM ancestries WHERE slug = 'human'` (Markfolk maps to the `human` ancestry). Extract: `build`, `surface`, `silhouette`, `head`, `sprite_note`, `variation`. This is the body baseline for ALL sprites in this run.

2. **Supabase `fashion_styles` + `fashion_variants`** — Query for the 5 target cultures. For each, note `real_world_inspiration`, `base_materials`, `base_palette`, `base_motifs`, and all variants (join `fashion_variants` on `fashion_style_id`). SQL: `SELECT fs.*, c.slug as culture_slug FROM fashion_styles fs JOIN cultures c ON c.id = fs.culture_id WHERE c.slug IN ('fieldborn','coastborn','harborfolk','ridgefolk','wallborn')` then `SELECT * FROM fashion_variants WHERE fashion_style_id IN (...)`.

3. **Supabase `population_archetypes` + `buildings`** — Query: `SELECT pa.*, b.slug as building_slug FROM population_archetypes pa LEFT JOIN buildings b ON b.id = pa.building_id`. Each has `role`, `fashion_variant`, `sprite_notes`. Ambient archetypes have `is_ambient = true`.

4. **`src/ai/asset-spec.json`** — Read `styleGuide` for standard PixelLab settings (view, outline, shading, detail).

---

## STEP 2 — BUILD THE WORK LIST

For each of the 5 cultures, collect ALL archetypes from `population-archetypes.json`:
- All `buildingArchetypes[].archetypes[]` entries
- All `ambientArchetypes[]` entries (except `stray-dog` — not humanoid)

Skip any archetype that already has a sprite file at:
`public/assets/sprites/npcs/markfolk/<culture>/<role>.png`

**Process cultures in this order:** fieldborn → coastborn → harborfolk → ridgefolk → wallborn

Within each culture, process archetypes in this order:
1. Unique single-count roles (chief, blacksmith, innkeeper, priest, etc.)
2. Ambient archetypes (elder-villager, child, wanderer)
3. Generic multi-count roles (villager, soldier, labourer, etc.)

---

## STEP 3 — COMPOSE DESCRIPTION

For each archetype, compose the PixelLab description by combining three layers:

### Layer 1: Race body (same for all sprites in this run)
From the `ancestries` row (slug: `human`), extract:
- Build/proportions (e.g. height, body type)
- Surface/skin (palette range — pick a specific tone for variety)
- Head features (ear shape, nose, jaw)
- Any relevant `spriteNote` guidance

### Layer 2: Culture fashion
Look up the archetype's `fashionVariant` in the current culture's fashion entry. If the variant doesn't exist for this culture, fall back:
1. `artisan` → `common`
2. `noble` → `elder`
3. Other missing → `common`

Extract: silhouette, headwear, footwear, accessories, notes, and the culture's base palette/materials.

### Layer 3: Archetype pose
From the archetype's `spriteNotes`: body type override, pose, held items, expression, distinguishing features.

### Compose the final description:
```
Medieval fantasy [role]. [Race description — build, skin tone]. [Clothing from fashion — silhouette, key garments, real-world inspiration hint]. [Culture palette colours]. [Headwear]. [Footwear]. [Key accessories]. [Pose/held items from spriteNotes]. [Expression/distinguishing details].
```

Keep descriptions under 350 characters. Lead with the most visually distinctive element. Mention the real-world fashion inspiration naturally (e.g. "hanbok-inspired wrapped tunic", not "Korean hanbok").

### Vary within the race:
Markfolk have a wide skin palette ("pale northern tones through warm olive to deep river-delta brown"). Vary skin tones across archetypes within a culture for visual diversity. Also vary gender — assign male/female roughly 50/50 unless the archetype notes specify otherwise.

---

## STEP 4 — GENERATE

Call `mcp__pixellab__create_character` with these standard settings:

```
size: 48
view: "low top-down"
n_directions: 8
shading: "medium shading"
detail: "medium detail"
outline: "single color black outline"
proportions: '{"type": "preset", "name": "default"}'
mode: "standard"
name: "<Culture> <Role>" (e.g. "Fieldborn Blacksmith")
```

**Rate limiting:** After queuing a character, wait for it to complete before queuing the next. Check with `get_character` — poll every 30 seconds until status is complete.

**On PixelLab error:** Stop the entire run cleanly. Do not retry failed calls — credits may be exhausted.

---

## STEP 5 — DOWNLOAD AND SAVE

For each completed character:

1. Download the south-facing rotation as the reference sprite:
```bash
mkdir -p public/assets/sprites/npcs/markfolk/<culture>/
curl --fail -o "public/assets/sprites/npcs/markfolk/<culture>/<role>.png" "<south-url>"
```

2. Download the full ZIP for later spritesheet assembly:
```bash
curl --fail -o "public/assets/sprites/npcs/markfolk/<culture>/<role>.zip" "<download-url>"
```

---

## STEP 6 — COMMIT AFTER EACH CULTURE

After completing all archetypes for a culture, commit the batch:

```bash
git add public/assets/sprites/npcs/markfolk/<culture>/
git commit -m "feat(sprites): Markfolk <culture> NPC sprites — <N> archetypes

Generated via settlement NPC pipeline:
Race: Markfolk (notion-races-cache.json)
Culture: <culture> (Supabase fashion_styles + fashion_variants)
Archetypes: <list of roles>

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

Push after each commit so partial progress is preserved:
```bash
git push origin HEAD
```

---

## STEP 7 — PROGRESS LOG

After each culture batch, print a summary:

```
=== CULTURE: <name> ===
Generated: <N> archetypes
Skipped:   <N> (already exist)
Failed:    <N> (list roles)
Credits used: ~<N> (1 per standard character)
```

At the end of the full run, print:
```
=== RUN COMPLETE ===
Cultures: <N>/5
Total sprites: <N>
Total credits: ~<N>
```

---

## IMPORTANT RULES

- **Never skip the ancestry body data.** Every description must include Markfolk body features from the `ancestries` table (slug: `human`). "Human male" is not enough — use the actual build/surface/silhouette fields.
- **Clothing comes from Supabase `fashion_styles` + `fashion_variants` only.** Never invent clothing. If the data says "wide straw hat", use "wide straw hat".
- **Pose comes from spriteNotes only** (in `population-archetypes.json`). Never invent poses. If the data says "holding tongs", use "holding tongs".
- **Commit after every culture.** Never batch multiple cultures in one commit.
- **Stop on error.** If PixelLab returns any error, commit what you have and stop.
- **Vary skin tones and gender.** Markfolk are diverse — don't make everyone the same.
