# Settlement NPC Sprite Generation

Protocol for generating humanoid NPC sprites for settlement populations.
Combines four data layers — race (body), culture (clothing), archetype (pose/role) — into a PixelLab prompt.

---

## Data Sources

Macro-world data lives in **Supabase** (master) with JSON snapshots in `macro-world/` as fallback.
Query Supabase tables via the Supabase MCP tool (`execute_sql`) rather than reading JSON files.

| Supabase table | Provides | Layer |
| -------------- | -------- | ----- |
| `ancestries` (body columns) | Physical body description per ancestry — `body_plan`, `build`, `surface`, `silhouette`, `head`, `sprite_note`, `variation`, `senses`, `anatomy`, `lifespan`. Query: `SELECT * FROM ancestries WHERE slug = '<ancestry-slug>'`. | **Race (body)** |
| `fashion_styles` + `fashion_variants` | Clothing details per culture + variant. Provides silhouette, headwear, footwear, accessories, materials, palette, motifs, and real-world fashion inspiration. Join on `fashion_styles.culture_id = cultures.id`. | **Culture (clothing)** |
| `population_archetypes` + `buildings` | Which NPC roles belong to each building. Includes `fashion_variant` and `sprite_notes` (pose, body type, held items). Join on `population_archetypes.building_id = buildings.id`. Ambient archetypes have `is_ambient = true` and no building FK. | **Archetype (role/pose)** |
| `cultures` + `culture_ancestry_preferences` | Culture slug, ancestry preferences (which ancestries appear), and settlement layout traits. Join with `ancestries` for ancestry names. | **Settlement context** |
| `ancestries` | The 25 Mistheim ancestries — canonical naming reference. | **Reference** |

---

## Pipeline

### Step 1 — Pick the settlement context

Decide:
- **Culture** (from Supabase `cultures` table) — e.g. `fieldborn`, `wallborn`, `mountainhold`
- **Ancestry** (from `culture_ancestry_preferences` joined with `ancestries`, or manual pick) — e.g. human, dvergr
- **Building** (from `building-registry.json`) — e.g. `smithy`, `tavern`, `palisade-gate`

### Step 2 — Look up the ancestry body description

Query Supabase: `SELECT * FROM ancestries WHERE slug = '<ancestry-slug>'`. Key fields for the sprite description:

- `build` — height, proportions, body mass distribution (e.g. "6.5–7.5 heads tall with moderate build")
- `surface` — skin/fur/scale palette and patterning (e.g. "pale through warm olive to deep river-delta brown")
- `silhouette` — overall body shape at sprite scale (e.g. "medium vertical column with balanced shoulder-to-hip read")
- `head` — eyes, ears, nose, jaw details (e.g. "ears small-to-medium, rounded lobes — no points")
- `sprite_note` — pixel-specific art direction (e.g. "3px torso block, 2px head with round-nub ears")
- `variation` — sex/age/regional differences to pick from

**Ancestry lookup:** query `culture_ancestry_preferences` joined with `ancestries` to find which ancestries belong to a culture, then use the ancestry's body columns.

The ancestry layer provides the **body** — everything that's NOT clothing. Clothing comes from `fashion_styles` + `fashion_variants`.

### Step 3 — Look up the archetype

Query Supabase: `SELECT pa.*, b.slug as building_slug FROM population_archetypes pa LEFT JOIN buildings b ON b.id = pa.building_id WHERE b.slug = '<building-slug>'`. Each archetype has:
- `role` — e.g. `blacksmith`, `gate-guard`
- `fashion_variant` — e.g. `common`, `warrior`, `artisan`, `ceremonial`
- `sprite_notes` — visual direction for body/pose/items (NOT clothing)

Also check ambient archetypes: `SELECT * FROM population_archetypes WHERE is_ambient = true` for non-building NPCs (children, elders, wanderers).

### Step 4 — Look up the fashion

Query Supabase: `fashion_styles` (filter by `culture_id`) and `fashion_variants` (filter by `fashion_style_id`). Look up the matching variant by `role`:
- `silhouette` — overall garment shape (fitted, wrapped, flowing, armoured, etc.)
- `headwear`, `footwear`, `accessories` — specific items
- `notes` — art direction blending real-world inspiration with fantasy
- `base.materials`, `base.palette`, `base.motifs` — shared cultural visual identity

### Step 5 — Compose the PixelLab description

Combine all three layers into a single description string. Structure:

```
[Setting/genre]. [Race body from races cache — build, surface, silhouette, head features].
[Clothing from fashion variant — silhouette, key garments, materials].
[Palette from fashion base]. [Headwear]. [Footwear]. [Accessories].
[Pose/held items from archetype spriteNotes]. [Key visual detail from spriteNotes].
```

**Rules:**
- Lead with the overall impression, then specifics
- **Body** comes from `notion-races-cache.json` — build, skin tone, ear shape, proportions
- **Clothing** comes from `fashion.json` — silhouette, garments, materials
- **Pose/items** come from `population-archetypes.json` — what they're holding, how they stand
- Name the real-world inspiration influence in the clothing description (e.g. "hanbok-inspired wrapped tunic", "Byzantine-style tabard")
- Include the culture's palette colours explicitly
- For non-human races, emphasise the distinguishing body features from the race's `silhouette` and `head` fields — these are what make a Bergfolk NPC look different from a Markfolk NPC in the same culture
- Keep under ~300 characters for best PixelLab results

### Step 6 — Generate with PixelLab

```
mcp__pixellab__create_character(
  description: <composed description>,
  name: "<Culture> <Role>",
  size: 48,
  view: "low top-down",
  n_directions: 8,
  shading: "medium shading",
  detail: "medium detail",
  outline: "single color black outline",
  proportions: '{"type": "preset", "name": "default"}'
)
```

Standard settings for all settlement NPCs (consistency across the population):
- **Size:** 48px (matches existing hero sprites)
- **View:** low top-down (matches game camera)
- **Directions:** 8 (full rotation for world movement)
- **Shading:** medium (balance of detail and pixel clarity)
- **Mode:** standard (1 credit per character — use pro only for key characters)

### Step 7 — Review and iterate

Check the south-facing view. If the clothing/culture doesn't read clearly:
- Simplify the description — PixelLab works better with fewer, clearer details
- Emphasise the most distinctive element (e.g. the straw hat, the tabard colour)
- Try increasing `ai_freedom` (default 750) if the result is too generic

### Step 8 — Download and assemble

```bash
curl --fail -o south.png <south-url>
# ... repeat for all 8 directions
npm run sprites:assemble -- --id <sprite-id>
```

Or download the ZIP:
```bash
curl --fail -o character.zip <download-url>
```

---

## Example: Fieldborn Blacksmith

**Input:**
- Culture: `fieldborn` (Korean hanbok-adjacent)
- Race: Markfolk → `notion-races-cache.json` "Markfolk" entry
  - build: "6.5–7.5 heads tall with moderate build and no extreme proportions"
  - surface: "Wide palette from pale northern tones through warm olive to deep river-delta brown"
  - silhouette: "Medium vertical column with balanced shoulder-to-hip read and rounded head"
  - head: "Ears small-to-medium, rounded lobes — no points. Nose medium."
- Building: `smithy` → archetype: `blacksmith` (fashionVariant: `artisan`, but fieldborn has no artisan → fall back to `common`)
- Fashion (fieldborn/common): wrapped silhouette, wide straw hat, leather sandals, high-waist sash, wheat-gold/clay-brown palette
- Archetype spriteNotes: barrel-chested, massive forearms, holding tongs/hammer, soot-marked face, burn scars

**Composed description:**
> Medieval fantasy village blacksmith. Human male, barrel-chested with massive forearms. Wearing a clean-lined wrapped linen tunic tied at the high waist with a broad wheat-gold sash (Korean hanbok-inspired silhouette). Sun-bleached white and clay-brown colours. Heavy leather apron over the tunic, soot-stained. Simple leather sandals. Wide straw hat pushed back on head. Holding a blacksmith hammer. Soot-marked face, burn scars on forearms. Sturdy, grounded stance.

**Result:** PixelLab character ID `83e224c5-34e8-49d0-9e98-847bf4cb7ab8`

## Example: Wallborn Gate Guard

**Input:**
- Culture: `wallborn` (Byzantine civic)
- Race: Markfolk → same race cache entry as above (human baseline body)
- Building: `palisade-gate` → archetype: `gate-guard` (fashionVariant: `warrior`)
- Fashion (wallborn/warrior): armoured silhouette, full helm with visor, armoured boots, tabard over mail, shield with heraldry, red-and-grey, gold trim
- Archetype spriteNotes: standing at attention with spear/halberd, stern expression

**Composed description:**
> Medieval fantasy city gate guard. Human male, tall and stern. Full chain mail hauberk under a deep red and charcoal grey tabard with gold geometric border trim and heraldic tower silhouette on the chest (Byzantine-inspired uniform). Full helm with visor, raised to show stern face. Armoured boots with brass fittings. Holding a halberd upright, shield with heraldic device slung on back. Standing at rigid attention — disciplined, uniformed city watch. Stone-grey and deep red colour scheme with gold trim accents.

**Result:** PixelLab character ID `2f7089b1-eb05-43c6-958d-48fa38082181`

---

## Variant Fallback

If the archetype's `fashionVariant` doesn't exist for the culture (e.g. `artisan` in fieldborn), fall back in this order:
1. `common` (always exists)
2. `elder` (if the role implies seniority)

Most cultures define: `common`, `elder`, `warrior`, `ceremonial`. Some add `artisan` or `noble`.

---

## Batch Generation

For a full settlement, generate in priority order:
1. **Unique roles first** — chief, blacksmith, innkeeper, priest (1 per building)
2. **Ambient archetypes** — elders, children, wanderers (scale with tier)
3. **Generic multiples last** — villagers, soldiers, labourers (use the same sprite, vary palette)

A tier-2 hamlet needs ~5-8 unique sprites. A tier-4 town needs ~15-25.
