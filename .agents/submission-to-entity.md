# Submission to Entity Agent

Converts an approved creature submission from the Matlu Codex into a complete, playable
game entity: expanded lore, behavior model, design notes, PixelLab sprites, sound spec,
Notion lore page, and a Linear issue to track implementation.

Run manually via `workflow_dispatch`. One submission per run.
Input: `SUBMISSION_ID` env var (UUID from `creature_submissions.id`).
If not set, pick the oldest row where `approved = true AND converted_at IS NULL`.

---

## STEP 1 — READ THE WORLD BIBLE AND SPECS

Read these files fully before writing anything:

1. `WORLD.md` — tone, worlds, visual aesthetic, narrative register
2. `docs/entity-spec.md` — entity schema, behavior states, animation/sound requirements
3. `src/ai/AGENTS.md` — PixelLab generation protocol (required for sprite steps)
4. `src/entities/entity-registry.json` — existing entities (learn the naming and style)
5. `src/ai/asset-spec.json` — existing asset specs (learn the structure)

Key things to lock in before proceeding:
- The three world palettes (earth / spinolandet / vatten)
- The behavior state machine (Unaware → Alert → Tracking → Combat)
- The PixelLab credit budget rules (get approval before animations)
- The entity slug format: lowercase, hyphens, ASCII only (e.g. `fargglad-kordororn`)

---

## STEP 2 — LOAD THE SUBMISSION

Query Supabase for the submission:

```sql
SELECT * FROM public.creature_submissions
WHERE id = '<SUBMISSION_ID>'
   OR (approved = true AND converted_at IS NULL AND '<SUBMISSION_ID>' = '')
ORDER BY created_at ASC
LIMIT 1;
```

Extract and hold these fields for the rest of the run:
- `creature_name`, `creator_name`, `maker_age`, `world_name`
- `kind_size`, `kind_movement`, `kind_solitary`, `kind_diet`
- `habitat_biome`, `habitat_climate`, `habitat_notes`
- `behaviour_threat`, `behaviour_notes`, `food_notes`
- `special_ability`, `lore_description`, `lore_origin`
- `art_path` (storage path for the submitted image)

Derive the entity slug: lowercase the creature name, replace spaces and special chars with
hyphens, strip diacritics. E.g. "Färgglad Kordorörn" → `fargglad-kordororn`.

---

## STEP 3 — ASSIGN TO A MATLU WORLD

If `world_name` is filled in the submission, use that as a starting point.
Otherwise, reason from the submission data and WORLD.md to assign one of:

| World | When to assign |
|-------|---------------|
| `spinolandet` | Bio-horror, alien biology, organic, deep forest or tundra, predatory |
| `earth` | Post-apocalyptic, urban, industrial, mechanical or degraded |
| `vatten` | Water, coastal, jade-green, Asian fantasy, magical |

If the creature doesn't fit any existing world cleanly, assign `spinolandet` as default
(most creatures in Core Warden live there) and note the mismatch.

Pick the right world palette for all subsequent design decisions.

---

## STEP 4 — EXPAND THE LORE

The submission is written by a child. Your job: honor their original concept completely
while expanding it to meet the game's narrative bar. Do not invent contradictions —
every detail you add should feel like it was always implied.

Write four lore texts. Keep each grounded first, then strange:

### 4a. Bilingual name

Every entity needs both an English and a Swedish name. Check the submission's `creature_name`:

- If it looks Swedish (ä/ö/å, Swedish morphology): keep it as `name_sv`, generate `name_en`
- If it looks English: keep it as `name_en`, generate `name_sv`
- If ambiguous: treat the submitted name as the primary language and generate the other

Rules for generating the missing name:
- Translate meaning, don't transliterate phonetically. "Thornback" → "Törnsrygg", not "Thornbäck"
- Swedish names: use Swedish compounding freely (two nouns join without space: "Färgglad Kordorörn")
- Both names should feel like they belong in a field guide from that language — not a dictionary entry
- Store as `name_en` and `name_sv` in the registry entry

### 4b. In-game description (2–3 sentences, shown in creature codex)
The voice used for all in-game text: field-guide terse. Describes what a traveler
encounters. Use the creature's submitted traits directly.

### 4c. Lore origin (2–4 sentences)
How did this creature come to exist in the Matlu multiworld? Ground it in the world's
cosmology. If the submission included an origin story, expand it. If not, invent one
consistent with WORLD.md.

### 4d. Encounter note (1–2 sentences, shown when player first spots it)
What a seasoned warden would note. Often a warning or a curiosity.

### 4e. Internal lore note (paragraph, not shown in-game)
Design reasoning: what role this creature plays in its ecosystem, what it signals to
players narratively, how it connects to the world themes. This guides future writing.

### Writing rules
- Fix spelling and grammar silently. Never mention corrections.
- Keep the creator's original name exactly as submitted.
- If the creature is dangerous to children (as stated), treat this as a real game mechanic
  (area denial, kidnap flee state) — don't sanitize it.
- Tone: grounded, spare, specific. Not generic fantasy.

---

## STEP 5 — BUILD THE BEHAVIOR MODEL

Design the complete AI behavior for this entity. Output a JSON block that will go into
the registry's `behavior` field, plus a narrative description for the Linear issue.

### 5a. Movement type

Determine primary locomotion: `flying`, `walking`, `swimming`, `burrowing`.
For flying entities: they hover at a fixed Y offset above ground — specify offset in px.

### 5b. State machine parameters

Reason from submission data (threat level, habitat, diet, solitary/group) to set:

```json
{
  "buildTree": true,
  "unaware":       true,
  "alert":         true,
  "tracking":      true,
  "combat":        true,
  "flee":          false,
  "aggroRadius":   <px — wider for flying apex predators, ~600–900>,
  "hearingRadius": <px — aerial: lower than aggro (~200–350)>,
  "sightMemoryMs": <ms — how long it chases after losing visual>,
  "movementType":  "<flying|walking|swimming>",
  "flyHeight":     <px above ground, flying only — e.g. 48>,
  "speed":         <px/s — small/fast: 80–120, large/soaring: 50–80>,
  "attackRange":   <px — melee dive: 64–96, ranged: 200–300>
}
```

### 5c. Attack pattern

Describe the full attack loop in plain text (this becomes the Linear issue body):
- How does it transition from tracking to attack?
- What is the wind-up behavior (circling, altitude gain, hovering)?
- What is the attack motion (dive, swoop, grab, bite)?
- What happens after: retreat to altitude, circle again, or repeat?
- Any special mechanic (kidnap small player, knockback, area denial)?

### 5d. Special mechanics

List any mechanics beyond the standard state machine. Examples:
- Nesting site (returns to nest when low HP instead of fleeing the area)
- Grab mechanic (latches onto player, dealing DoT until shaken off)
- Altitude zones (only attacks while above a threshold — dives below to attack)
- Seasonal behavior (nesting season = more aggressive)

### 5e. Stats calibration

Calibrate all numerical stats so they feel realistic relative to the existing entity population.
**Read `src/entities/entity-registry.json` to see actual ranges before picking numbers.**

Use the following tier guidelines — these reflect the observed distribution in the registry:

**Size tier → HP and aggro baseline:**

| `kind_size`   | HP range | aggroRadius (walking) | aggroRadius (flying) | speed (px/s) |
|---------------|----------|-----------------------|-----------------------|--------------|
| Tiny          | 8–20     | 80–150                | 200–350               | 110–140      |
| Small         | 20–45    | 150–250               | 300–500               | 90–120       |
| Medium        | 45–90    | 200–350               | 400–650               | 70–100       |
| Large         | 90–180   | 300–500               | 500–800               | 50–80        |
| Apex / Giant  | 180–400  | 500–800               | 700–1000              | 40–65        |

**Threat level → damage and sightMemoryMs:**

| `behaviour_threat` | damage per hit | sightMemoryMs | flee state |
|--------------------|----------------|---------------|------------|
| Passive            | 0              | 600–1000      | true       |
| Cautious           | 2–6            | 800–1500      | true       |
| Defensive          | 5–12           | 1200–2500     | false      |
| Aggressive         | 10–22          | 2000–4000     | false      |
| Apex predator      | 18–40          | 3000–5500     | false      |

**Diet modifier (on top of threat):**
- Herbivore: –20% damage, +10% speed, flee = true unless very large
- Omnivore: no modifier
- Carnivore: +10% damage, –5% speed
- Apex carnivore: +20% damage, hearingRadius +30%

**Solitary vs group:**
- Solitary: standard aggroRadius
- Group / pack: aggroRadius –15% (relies on pack coordination), sightMemoryMs +20%

After picking values from the tiers, cross-check against two or three entities of similar
size/threat in the registry to make sure the numbers feel consistent, not like outliers.

Store the combat stats as a `stats` sub-object in the registry entry (alongside `behavior`):

```json
"stats": {
  "hp":            <integer>,
  "damage":        <integer — per hit, raw>,
  "speed":         <px/s>,
  "aggroRadius":   <px>,
  "hearingRadius": <px>,
  "sightMemoryMs": <ms>,
  "attackRange":   <px>,
  "attackCooldownMs": <ms — 600–2000 depending on attack style>
}
```

Also copy `aggroRadius`, `hearingRadius`, `sightMemoryMs`, `speed`, and `attackRange`
into the `behavior` object (step 5b) so both are consistent.

---

## STEP 6 — WRITE DESIGN NOTES

Write the full `designNotes` object following `docs/entity-spec.md` rules.

For the sprite description, reference the submitted artwork image at `art_path` in the
`creature-art` storage bucket — describe what you see and how to translate it to the
game's pixel art style and palette.

```json
"designNotes": {
  "sprite": "<2–4 sentences: body shape, size relative to 32px grid, palette, what makes it readable at a glance. Reference the submitted artwork colors faithfully.>",
  "animations": {
    "idle":   "<What body part moves, rhythm, frame count + fps>",
    "walk":   "<Locomotion — for flying: soaring wing cycle. Frame count + fps>",
    "attack": "<CRITICAL: wind-up (≥3 frames) → commit → recovery. For aerial: dive entry + grab/impact + ascent>",
    "hurt":   "<2–3 frame flinch — brief, distinct from idle>",
    "death":  "<Full sequence — for flying: spiral down, crash landing, settle>"
  },
  "sounds": {
    "ambient": "<Sound character + ~duration ms + freesound.org search terms>",
    "aggro":   "<'I see you' call — pitch, urgency, character + search terms>",
    "attack":  "<Wind-up cue + impact cue, timed to animation frames + search terms>",
    "hurt":    "<Pain response — short, 2–3 variant range + search terms>",
    "death":   "<Final sound — ~300–600ms, what makes it feel resolved + search terms>"
  }
}
```

---

## STEP 7 — LIST ALL ANIMATIONS NEEDED

Produce a complete animation manifest. Use 8 directions for most creatures (4 for
radially symmetric). Leave template IDs as `TBD` — confirm with `get_character()` after
creation, since available templates depend on body_type and quadruped template.

Example for a flying bird (humanoid body type, high top-down, 8 directions):

| Animation ID | PixelLab template | Notes |
|-------------|------------------|-------|
| `idle`      | `breathing-idle` | Hover/circling — slow wing beat |
| `walk`      | `walking-4-frames` | Wing-beat cycle while soaring |
| `attack`    | `jumping-1` | Dive entry; custom action may be needed for full dive+grab |
| `hurt`      | `taking-punch` | Flinch mid-air |
| `death`     | `falling-back-death` | Spiral descent + crash landing |
| `alert`     | custom: "head snapping alert, wings spreading wide" | 1-shot on aggro — custom, show cost to user first |

Example for a quadruped (bear template):
Omit the table — call `get_character()` first and list whatever templates it returns.
Quadruped animation names are not known until creation.

**Important:** template names in the asset spec are placeholders until `get_character()`
confirms what's available. Always update `asset-spec.json` before queueing animations.

---

## STEP 8 — WRITE THE SOUND SPEC

For each required sound file, specify:
- Filename (convention: `public/assets/audio/creatures/<slug>/<slug>-<state>-<n>.ogg`)
- Duration target in ms
- Freesound.org search query (be specific — terms a sound designer would use)
- Backup search query (if first returns nothing useful)
- Character description (one sentence — what it sounds like)

Produce this as a markdown table AND as the JSON structure that goes in the registry's
`sounds` field (with `status: "pending"` for all files).

Minimum files required:
- 3× ambient variants
- 1× alert
- 1× aggro
- 1× attack-windup
- 1× attack-impact
- 3× hurt variants
- 1× death

For a flying bird-type creature in Spinolandet, consider:
- Ambient: wing beats, air displacement, or beak sounds
- Aggro: a sharp raptor-like cry translated through the world's bio-filter
- Attack: wing-rush and impact thud
- Death: a descending cry cutting to silence

---

## STEP 9 — CREATE THE ENTITY REGISTRY ENTRY

Add a new entry to `src/entities/entity-registry.json`.

The entry must follow the schema in `docs/entity-spec.md`. Use these values:

```jsonc
{
  "class": "<PascalCase from creature name, e.g. FarggladeKordororn>",
  "file": "src/entities/<ClassName>.ts",
  "type": "enemy",
  "world": "<assigned world>",
  "submissionId": "<creature_submissions UUID>",
  "submissionCreator": "<creator_name> (age <maker_age>)",
  "personality": "<one-line flavor from lore — spare, specific>",
  "spriteKey": null,
  "spritesheetJson": null,
  "animTags": {
    "idle":   null,
    "walk":   null,
    "attack": null,
    "hurt":   null,
    "death":  null,
    "alert":  null
  },
  "sounds": { <full sounds object from step 8 with status: "pending"> },
  "behavior": { <full behavior object from step 5b> },
  "designNotes": { <full designNotes from step 6> }
}
```

Write the updated registry back to disk using Edit.

---

## STEP 10 — ADD TO ASSET SPEC

First, determine the correct PixelLab params using this table (full rationale in `src/ai/AGENTS.md`):

| Creature archetype | `body_type` | `template` | `n_directions` | `view` |
|-------------------|-------------|------------|----------------|--------|
| Human / humanoid / robot | `humanoid` | — | 8 | `low top-down` |
| Bird on ground (walking raptor) | `humanoid` | — | 8 | `low top-down` |
| Bird flying / soaring | `humanoid` | — | 8 | `high top-down` | **`mode: "pro"` required** — standard templates produce unusable results |
| Large quadruped (bear, boar) | `quadruped` | `bear` | 8 | `low top-down` |
| Apex predator (lion, wolf) | `quadruped` | `lion` | 8 | `low top-down` |
| Medium predator / dog-like | `quadruped` | `dog` or `cat` | 8 | `low top-down` |
| Horse / deer / ungulate | `quadruped` | `horse` | 8 | `low top-down` |
| Insect / spider / multi-limbed | `quadruped` | `cat` | 8 | `low top-down` |
| Blob / amorphous | `humanoid` | — | 4 | `low top-down` |
| Fish / aquatic | `humanoid` | — | 4 | `high top-down` |

For **flying birds**: standard humanoid templates produce poor results (tested empirically —
crow with standard = unusable, great tit with pro = good). Always use `mode: "pro"` for
the base character, and custom `action_description` for all animations. Show the user the
credit cost before queueing (20–40 gen/direction).

Add a new character entry to `src/ai/asset-spec.json` under `characters[]`:

```jsonc
{
  "id": "<entity-slug>",
  "name": "<creature_name> (from <creator_name>)",
  "world": "<world>",
  "faction": "enemy",
  "status": "pending",
  "pixellab": {
    "description": "<1–2 sentences: appearance, artwork colors, 'top-down pixel art RPG, <world> palette'>",
    "size": 32,
    "body_type": "<humanoid|quadruped — from table above>",
    "template": "<bear|cat|dog|horse|lion — quadruped only, omit for humanoid>",
    "n_directions": <8 for most, 4 for radially symmetric>,
    "view": "<low top-down|high top-down — from table above>",
    "outline": "single color black outline",
    "shading": "basic shading",
    "detail": "medium detail"
  },
  "animations": [
    { "id": "idle",   "template": "<check get_character() — e.g. breathing-idle>",     "status": "pending" },
    { "id": "walk",   "template": "<check get_character() — e.g. walking-4-frames>",   "status": "pending" },
    { "id": "attack", "template": "<check get_character() — e.g. lead-jab>",           "status": "pending" },
    { "id": "death",  "template": "<check get_character() — e.g. falling-back-death>", "status": "pending" }
  ],
  "_note": "Animation templates are placeholders — call get_character() after creation and update with real IDs",
  "outputDir": "public/assets/sprites/characters/<world>/enemies/<entity-slug>/"
}
```

Write the updated spec back to disk.

---

## STEP 11 — GENERATE SPRITES WITH PIXELLAB

Follow `src/ai/AGENTS.md` exactly. Summary:

### 11a. Create base character
Call `create_character` with the `pixellab` params from the asset spec entry.
Save the returned `character_id` to `asset-spec.json` as `_pixellabCharacterId`.

### 11b. Get approval before animations
Call `get_character(character_id, include_preview: true)`.
Display the preview to the user and ask:
> "Does [creature name] look right? Approve to queue template animations (auto, ~1 credit/direction),
> or describe what to change."

If rejected: call `delete_character`, update the description in asset-spec.json, retry.

### 11b′. Approval rules for animations
- **Template animations** (`template_animation_id` set): queue automatically after sprite approval, no extra confirmation needed.
- **Custom animations** (no template) or **pro mode**: call `animate_character` WITHOUT `confirm_cost` first to show the user the credit cost. Only proceed with `confirm_cost: true` after explicit user approval.

### 11c. Queue animations one at a time
Check `get_character` for available template IDs (body type determines what's available).
Update the animation list in asset-spec.json with the real template IDs.
Queue one animation, poll every 60s until `completed`, then queue the next.
8 concurrent slots — base uses 4, leaving 4, so queue one animation at a time.

### 11d. Download and extract
Once all animations are `completed`:
```bash
node scripts/extract-character.mjs --id <characterId> --zip-url <zipUrl>
```

### 11e. Assemble spritesheet
```bash
npm run sprites:assemble -- --id <entity-slug>
```

If assembly succeeds, update the registry entry's `spriteKey` and `spritesheetJson`.

---

## STEP 12 — SOUND SEARCH

For each sound file in the spec (step 8), perform a web search on freesound.org using
the search query. For each:

1. Search: `site:freesound.org <query> CC0`
2. If a strong match is found: note the URL, duration, license, and attribution
3. If no match: note the backup query result or mark as "needs custom recording"

Output a sound findings report as a markdown file at:
`docs/sounds/<entity-slug>-sound-report.md`

Format:
```markdown
# Sound Report: <creature_name>

## ambient-0
- **Query:** <search query>
- **Match:** <freesound.org URL or "no match">
- **Duration:** <ms>
- **Notes:** <any processing needed — pitch shift, trim, etc.>
```

Do not download or embed any audio files — just document the findings. A human or the
audio agent will do the actual download and placement.

---

## STEP 13 — CREATE NOTION LORE PAGE

Using the NOTION_API_KEY, create a new page in the Creatures database in Notion.

Page title: `<creature_name>`

Page body (in this order):
1. H2: "In-Game Description" → lore text 4b
2. H2: "Origin" → lore text 4c
3. H2: "Encounter Note" → lore text 4d
4. H2: "Submitted By" → "{creator_name}, age {maker_age}"
5. H2: "Design Notes" → link to entity-registry.json entry (GitHub link to the file)
6. H2: "Status" → "Converting — sprites pending review"

If you don't know the Creatures database ID, search Notion for a page titled "Creatures"
or similar to find it.

---

## STEP 14 — CREATE LINEAR ISSUE

Create a Linear issue in the current team to track entity implementation:

**Title:** `feat(entity): implement <creature_name> (<world>)`

**Description:**
```
Submitted by <creator_name> (age <maker_age>) via the Matlu Codex creature form.

## What to implement

<behavior model narrative from step 5c>

## Special mechanics

<special mechanics from step 5d>

## Asset status

- [ ] Sprite: pending PixelLab generation (see asset-spec.json)
- [ ] Animations: queued after sprite approval
- [ ] Sound files: see docs/sounds/<slug>-sound-report.md
- [ ] Entity class: src/entities/<ClassName>.ts (stub needed)
- [ ] Registry: ✅ added to entity-registry.json

## Files changed

- `src/entities/entity-registry.json` — registry entry added
- `src/ai/asset-spec.json` — PixelLab spec added
- `docs/sounds/<slug>-sound-report.md` — sound search report

## Submission

Creature: <creature_name>
World: <world>
Submission ID: <UUID>
```

Label: `systems`, `art`, `audio`
Estimate: M (3 points — new entity from scratch)

---

## STEP 15 — MARK SUBMISSION AS CONVERTED

Update the submission row in Supabase:

```sql
UPDATE public.creature_submissions
SET
  converted_at   = NOW(),
  entity_class   = '<ClassName>',
  linear_issue_id = '<Linear issue ID from step 14>'
WHERE id = '<submission UUID>';
```

If `converted_at`, `entity_class`, or `linear_issue_id` columns don't exist, run this
migration first:

```sql
ALTER TABLE public.creature_submissions
  ADD COLUMN IF NOT EXISTS converted_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS entity_class    TEXT,
  ADD COLUMN IF NOT EXISTS linear_issue_id TEXT;
```

---

## STEP 16 — COMMIT AND OPEN PR

Stage and commit:
```bash
git add src/entities/entity-registry.json
git add src/ai/asset-spec.json
git add docs/sounds/<slug>-sound-report.md
git commit -m "feat(entity): add <creature_name> from community submission

Submitted by <creator_name> (age <maker_age>).
World: <world>. Submission ID: <UUID>.

- Entity registry entry with full behavior model + design notes
- PixelLab asset spec (sprites pending approval)
- Sound search report at docs/sounds/<slug>-sound-report.md
- Notion lore page created

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
git push
```

Open a PR targeting `main`. PR description should include:
- The submitted artwork image (link to Supabase storage public URL)
- The in-game description (4a)
- The behavior model summary
- A checklist of what's done and what's pending (sprites, sounds, TS class)
- Credit to the submitter

---

## STEP 17 — REPORT

Print a final summary:
- Creature name and assigned world
- Behavior model summary (movement type, aggro radius, attack pattern)
- Animations queued (list which templates were used)
- Sounds needed (count) + any freesound matches found
- Notion page URL
- Linear issue URL
- PR URL
- Any decisions that needed judgment calls (world assignment, behavior choices, etc.)
