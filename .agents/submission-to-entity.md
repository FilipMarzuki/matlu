# Submission to Entity Agent

Converts a creature submission from the Matlu Codex (inserted with `status = 'submitted'`)
into a complete game entity spec: expanded lore, behavior model, design notes (sprite + animations + sounds),
PixelLab asset spec, Notion lore page, and a GitHub issue to track implementation.
The agent also **balances the creature's stats** — the submission is raw input from a
kid; this agent decides HP, damage, speed, aggro radius etc. by analyzing the submission
and calibrating against existing entities. Does NOT generate sprites — only prepares
everything so the sprite-credit-burn agent can generate on the first try.

Normally triggered automatically when a submission is inserted (Supabase webhook → Edge Function
`trigger-entity-pipeline`). You can still run manually via `workflow_dispatch` for retries.
One submission per run.
Input: `SUBMISSION_ID` env var (UUID from `creature_submissions.id`).
If not set, pick the oldest row where `status = 'submitted' AND converted_at IS NULL`.

---

## STEP 1 — READ THE WORLD BIBLE AND SPECS

Read these files fully before writing anything:

1. `WORLD.md` — tone, worlds, visual aesthetic, narrative register
2. `docs/entity-spec.md` — entity schema, behavior states, animation/sound requirements
3. `src/ai/AGENTS.md` — PixelLab generation protocol (body type table, direction rules)
4. `src/entities/entity-registry.json` — **all existing entities** (learn naming, style, AND stat ranges for balancing)
5. `src/ai/asset-spec.json` — existing asset specs (learn the structure + available animation templates)

Key things to lock in before proceeding:
- The three world palettes (earth / spinolandet / vatten)
- The behavior state machine (Unaware → Alert → Tracking → Combat)
- The entity slug format: lowercase, hyphens, ASCII only (e.g. `fargglad-kordororn`)
- **Stat ranges** of existing entities — you will calibrate the new creature to fit

---

## STEP 2 — LOAD THE SUBMISSION

Query Supabase for the submission:

```sql
SELECT * FROM public.creature_submissions
WHERE id = '<SUBMISSION_ID>'
   OR (status = 'submitted' AND converted_at IS NULL AND '<SUBMISSION_ID>' = '')
ORDER BY created_at ASC
LIMIT 1;
```

Extract and hold these fields for the rest of the run:
- `creature_name`, `creator_name`, `maker_age`, `world_name`
- `kind_size`, `kind_movement`, `kind_solitary`, `kind_diet`
- `habitat_biome`, `habitat_climate`, `habitat_notes`
- `behaviour_threat`, `behaviour_notes`, `food_notes`
- `special_ability`, `lore_description`, `lore_origin`
- `visual_description`, `audio_description`
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

## STEP 5 — BALANCE STATS AND BUILD BEHAVIOR MODEL

The submission is raw creative input from a kid — "large", "aggressive", "carnivore",
"lives in forests". Your job is to turn those qualitative descriptions into concrete,
balanced game stats that fit the existing entity population.

### 5a. Analyze existing entity stats

Before picking any numbers, read every entity in `src/entities/entity-registry.json`
and build a mental model of the stat distribution:
- What HP, damage, speed, aggro ranges do existing entities use?
- How do these scale with size and threat level?
- What gaps exist in the roster that this creature could fill?

The new creature's stats must feel like they belong in the same game — not too strong,
not too weak relative to peers of similar size and threat. A kid saying "super powerful"
doesn't mean it gets 999 HP — it means it should be at the upper end of its size tier.

### 5b. Movement type

Determine primary locomotion: `flying`, `walking`, `swimming`, `burrowing`.
For flying entities: they hover at a fixed Y offset above ground — specify offset in px.

### 5c. State machine parameters

Reason from submission data (threat level, habitat, diet, solitary/group) to set:

```json
{
  "buildTree": true,
  "unaware":       true,
  "alert":         true,
  "tracking":      true,
  "combat":        true,
  "flee":          false,
  "aggroRadius":   "<px — calibrate against existing entities of similar size/threat>",
  "hearingRadius": "<px — usually 40-60% of aggroRadius>",
  "sightMemoryMs": "<ms — how long it chases after losing visual>",
  "movementType":  "<flying|walking|swimming>",
  "flyHeight":     "<px above ground, flying only — e.g. 48>",
  "speed":         "<px/s — calibrate against existing>",
  "attackRange":   "<px — melee: 48-96, ranged: 200-300>"
}
```

### 5d. Stats calibration

Use these tier guidelines as a starting point, then **cross-check against 2–3 existing
entities of similar size/threat** in the registry to ensure consistency:

**Size tier → HP and aggro baseline:**

| `kind_size`   | HP range | aggroRadius (walking) | aggroRadius (flying) | speed (px/s) |
|---------------|----------|-----------------------|-----------------------|--------------|
| Tiny          | 8–20     | 80–150                | 200–350               | 110–140      |
| Small         | 20–45    | 150–250               | 300–500               | 90–120       |
| Medium        | 45–90    | 200–350               | 400–650               | 70–100       |
| Large         | 90–180   | 300–500               | 500–800               | 50–80        |
| Huge / Apex   | 180–400  | 500–800               | 700–1000              | 40–65        |

**Threat level → damage and sightMemoryMs:**

| `behaviour_threat` | damage per hit | sightMemoryMs | flee state |
|--------------------|----------------|---------------|------------|
| friendly           | 0              | 600–1000      | true       |
| shy                | 0              | 400–800       | true       |
| neutral            | 2–6            | 800–1500      | true       |
| territorial        | 5–15           | 1200–2500     | false      |
| aggressive         | 10–25          | 2000–4000     | false      |

**Diet modifier:**
- Herbivore: –20% damage, +10% speed, flee = true unless very large
- Omnivore: no modifier
- Carnivore: +10% damage, –5% speed
- Insectivore: –10% damage, small creatures

**Solitary vs group:**
- Solitary: standard aggroRadius
- Group / pack: aggroRadius –15% (relies on pack coordination), sightMemoryMs +20%

After picking values from the tiers, **list which existing entities you compared against
and explain why the new stats are appropriate** — include this reasoning in the commit
message and GitHub issue.

Store the combat stats as a `stats` sub-object in the registry entry:

```json
"stats": {
  "hp":               "<integer>",
  "damage":           "<integer — per hit, raw>",
  "speed":            "<px/s>",
  "aggroRadius":      "<px>",
  "hearingRadius":    "<px>",
  "sightMemoryMs":    "<ms>",
  "attackRange":      "<px>",
  "attackCooldownMs": "<ms — 600–2000 depending on attack style>"
}
```

Also copy `aggroRadius`, `hearingRadius`, `sightMemoryMs`, `speed`, and `attackRange`
into the `behavior` object (step 5c) so both are consistent.

### 5e. Attack pattern

Describe the full attack loop in plain text:
- How does it transition from tracking to attack?
- What is the wind-up behavior?
- What is the attack motion?
- What happens after: retreat, circle again, or repeat?
- Any special mechanic (knockback, area denial, grab, etc.)?

### 5f. Special mechanics

List any mechanics beyond the standard state machine. Examples:
- Nesting site (returns to nest when low HP instead of fleeing the area)
- Grab mechanic (latches onto player, dealing DoT until shaken off)
- Seasonal behavior (nesting season = more aggressive)

---

## STEP 6 — WRITE DESIGN NOTES

Write the full `designNotes` object following `docs/entity-spec.md` rules.

Use the submission's `visual_description` and `audio_description` as primary sources
when available. Expand and sharpen them to meet the quality bar.

```json
"designNotes": {
  "sprite": "<2–4 sentences: body shape, size relative to 32px grid, palette, what makes it readable at a glance>",
  "animations": {
    "idle":   "<What body part moves, rhythm, frame count + fps>",
    "walk":   "<Locomotion style. Frame count + fps>",
    "attack": "<CRITICAL: wind-up (≥3 frames) → commit → recovery. Frame counts + fps>",
    "hurt":   "<2–3 frame flinch — brief, distinct from idle>",
    "death":  "<Full sequence — what happens to the body, dissolve/crumple/etc.>"
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

### Quality bar

Every description must be specific enough that:
1. A pixel artist can open Aseprite and start drawing without asking questions
2. A sound designer can search freesound.org and know immediately if a sound matches
3. Descriptions are consistent with the entity's world

**Bad** (too vague): "Makes an attacking sound when it attacks"
**Good**: "A short wet snap — like snapping a hollow reed — duration ~60ms. No reverb. The impact should feel small and precise, not meaty."

### World-specific tone

- **spinolandet**: organic, chitin, fluid, bio-horror. Clicks, wet sounds, insectoid. Jerky, twitchy movement.
- **earth**: mechanical, degraded technology, glitch. Electronic, metallic, corrupted digital. Weighted, physical movement.
- **vatten**: aquatic, flowing, jade-green. Bubbles, currents, fish-scale scrapes. Smooth, undulating movement.

---

## STEP 7 — DETERMINE REQUIRED ANIMATIONS

List all animations this creature needs, with the recommended PixelLab template for each.
Do NOT generate sprites — just document what's needed so the sprite agent can execute later.

### 7a. Choose body type and PixelLab params

Use this table:

| Creature form | body_type | template | n_directions | view |
|---|---|---|---|---|
| Upright biped / humanoid | humanoid | — | 5 | low top-down |
| Bird (walking) | humanoid | — | 5 | low top-down |
| Bird (flying) | humanoid | — | 5 | high top-down |
| Large beast | quadruped | bear or lion | 5 | low top-down |
| Small animal | quadruped | cat or dog | 5 | low top-down |
| Hoofed animal | quadruped | horse | 5 | low top-down |
| Insect / spider | quadruped | cat | 5 | low top-down |
| Fish / aquatic | humanoid | — | 4 | high top-down |
| Blob / amorphous | humanoid | — | 4 | low top-down |

### 7b. Animation manifest

For each required animation, specify:

| Animation | Template | frameDurationMs | Priority | Notes |
|-----------|----------|----------------|----------|-------|
| idle | breathing-idle | 150 | 1 (required) | What it looks like at rest |
| walk | walking-4-frames | 100 | 2 (required) | Locomotion style |
| attack | lead-jab / custom:... | 80 | 3 (combat only) | Must telegraph ≥3 frames |
| hurt | taking-punch | 80 | 4 (combat only) | Distinct from idle |
| death | falling-back-death | 80 | 5 (required) | Final sequence |
| alert | custom:... | 100 | 6 (optional) | "I see you" moment |

Rules:
- **Minimum set** (all creatures): idle, walk, death
- **Combat creatures** (territorial/aggressive): add attack + hurt
- **Passive creatures** (friendly/shy/neutral): skip attack, optionally skip hurt
- **Custom animations**: flag these as expensive (20–40 gens/direction) with a cost note
- **Flying birds**: MUST use `mode: "pro"` — note this and the higher credit cost

### 7c. Graphics difficulty rating

Score 1–5:
- 1: simple shape, 4 directions, idle+walk+death only
- 2: standard humanoid or quadruped, template animations only
- 3: quadruped with non-standard template or 5+ animations
- 4: custom animations needed, unusual body shape
- 5: flying creature (high top-down + pro mode), multiple custom animations

---

## STEP 8 — WRITE THE SOUND SPEC

For each required sound, specify:
- Filename (convention: `public/assets/audio/creatures/<slug>/<slug>-<state>-<n>.ogg`)
- Duration target in ms
- Freesound.org search query (be specific)
- Character description (one sentence)

Minimum files required:
- 3× ambient variants
- 1× aggro
- 1× attack
- 3× hurt variants
- 1× death

Produce this as a markdown table AND as the JSON structure for the registry's `sounds`
field (with `status: "pending"` for all files).

---

## STEP 9 — CREATE THE ENTITY REGISTRY ENTRY

Add a new entry to `src/entities/entity-registry.json`.

```jsonc
{
  "class": "<PascalCase from creature name>",
  "file": "src/entities/<ClassName>.ts",
  "type": "enemy",
  "world": "<assigned world>",
  "name_en": "<English name>",
  "name_sv": "<Swedish name>",
  "submissionId": "<creature_submissions UUID>",
  "submissionCreator": "<creator_name> (age <maker_age>)",
  "credits_opt_in": "<from submission>",
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
  "sounds": { "<full sounds object from step 8 with status: pending>" },
  "behavior": { "<full behavior object from step 5c>" },
  "stats": { "<full stats object from step 5d>" },
  "designNotes": { "<full designNotes from step 6>" }
}
```

Write the updated registry back to disk using Edit.

---

## STEP 10 — ADD TO ASSET SPEC

Add a new character entry to `src/ai/asset-spec.json` under `characters[]`:

```jsonc
{
  "id": "<entity-slug>",
  "name": "<creature_name> (from <creator_name>)",
  "world": "<world>",
  "faction": "enemy",
  "status": "pending",
  "pixellab": {
    "description": "<1–2 sentences: appearance from designNotes.sprite, 'top-down pixel art RPG, <world> palette'>",
    "size": 32,
    "body_type": "<from step 7a>",
    "template": "<quadruped template if applicable>",
    "n_directions": "<from step 7a>",
    "view": "<from step 7a>",
    "outline": "single color black outline",
    "shading": "basic shading",
    "detail": "medium detail"
  },
  "animations": [
    "<from step 7b — each with id, template, frameDurationMs, status: pending>"
  ],
  "outputDir": "public/assets/sprites/characters/<world>/enemies/<entity-slug>/"
}
```

Write the updated spec back to disk.

---

## STEP 11 — UPDATE SUBMISSION IN SUPABASE

Update the creature submission with enriched data:

```sql
UPDATE public.creature_submissions
SET
  visual_description = '<enriched visual description>',
  audio_description  = '<enriched audio description>',
  graphics_notes     = '<PixelLab-optimized prompt from designNotes.sprite>',
  graphics_difficulty = <1-5 from step 7c>,
  converted_at       = NOW(),
  entity_class       = '<ClassName>'
WHERE id = '<submission UUID>';
```

---

## STEP 12 — CREATE NOTION LORE PAGE

Using the NOTION_API_KEY, create a new page in the Creatures database in Notion
(database ID: `4c71181b-2842-4301-b7cf-94572b3845a9`).

Page title: `<creature_name>`

Page body (in this order):
1. H2: "In-Game Description" → lore text 4b
2. H2: "Origin" → lore text 4c
3. H2: "Encounter Note" → lore text 4d
4. H2: "Submitted By" → "{creator_name}, age {maker_age}"
5. H2: "Design Notes" → link to entity-registry.json (GitHub permalink)
6. H2: "Status" → "Entity spec complete — sprites pending"

---

## STEP 13 — CREATE GITHUB ISSUE

Create a GitHub issue in `FilipMarzuki/matlu` to track implementation.

**Title:** `Creature: implement <creature_name> (<world>)`

**Labels:** `type:feature`, `ready`, `art`, `audio`

**Body:**
```markdown
## Summary

Community creature submitted by **<creator_name>** (age <maker_age>) via the Codex.
Converted to entity spec by the submission-to-entity agent.

## Creature overview

- **Name:** <name_en> / <name_sv>
- **World:** <world>
- **Size:** <kind_size>
- **Threat:** <behaviour_threat>
- **Special:** <special_ability or "none">

## Stats

| Stat | Value | Comparable to |
|------|-------|---------------|
| HP | <hp> | <similar entity name> (<their hp>) |
| Damage | <damage> | <similar entity name> (<their damage>) |
| Speed | <speed> px/s | <similar entity name> (<their speed>) |
| Aggro radius | <aggroRadius> px | <similar entity name> (<their radius>) |
| Attack range | <attackRange> px | |
| Sight memory | <sightMemoryMs> ms | |

## Animations needed

| Animation | PixelLab template | Difficulty | Notes |
|-----------|------------------|------------|-------|
<from step 7b>

**Graphics difficulty:** <1-5> — <brief reason>

## Sounds needed

<count> sound files specified in entity-registry.json. See `designNotes.sounds` for
freesound.org search queries.

## Checklist

- [x] Entity registry entry (`src/entities/entity-registry.json`)
- [x] Asset spec (`src/ai/asset-spec.json`)
- [x] Design notes (sprite, animations, sounds)
- [x] Balanced stats (compared against <entity names>)
- [x] Notion lore page
- [ ] PixelLab sprites (run sprite-credit-burn or manual)
- [ ] Sound files (download from freesound or record)
- [ ] Entity TypeScript class (`src/entities/<ClassName>.ts`)

## Submission

- Creature: <creature_name>
- World: <world>
- Submission ID: `<UUID>`
```

Save the issue number.

---

## STEP 14 — LINK ISSUE TO SUBMISSION

Update the submission row with the GitHub issue number:

```sql
UPDATE public.creature_submissions
SET tracker_issue_number = <issue_number>
WHERE id = '<submission UUID>';
```

---

## STEP 15 — COMMIT AND PUSH

Stage and commit:
```bash
git add src/entities/entity-registry.json src/ai/asset-spec.json
git commit -m "feat(entity): add <creature_name> from community submission

Submitted by <creator_name> (age <maker_age>).
World: <world>. Submission ID: <UUID>.

Stats balanced against <entity1>, <entity2> — <brief reasoning>.
Graphics difficulty: <N>/5.

- Entity registry entry with behavior model, stats, and design notes
- PixelLab asset spec (sprites pending generation)
- Notion lore page created
- GitHub issue #<number> created

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"

git push origin main
```

---

## STEP 16 — REPORT

Print a final summary:

```
=== Creature Conversion Complete ===

Creature:    <name_en> / <name_sv>
World:       <world>
Creator:     <creator_name> (age <maker_age>)

Stats:
  HP: <hp>  |  Damage: <damage>  |  Speed: <speed> px/s
  Aggro: <aggroRadius> px  |  Attack range: <attackRange> px
  Balanced against: <entity1> (<hp1> HP), <entity2> (<hp2> HP)

Animations:  <count> (<list>)
  Difficulty: <N>/5
  Custom animations needed: <yes/no — if yes, list which>

Sounds:      <count> files specified (all pending)

GitHub issue: #<number>
Notion page:  <url if available>

Next steps:
  - Run sprite-credit-burn agent to generate sprites
  - Download/record sound files per designNotes.sounds
  - Implement entity class at src/entities/<ClassName>.ts
```
