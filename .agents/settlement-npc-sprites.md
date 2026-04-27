# Settlement NPC Sprite Generation

Protocol for generating humanoid NPC sprites for settlement populations.
Uses data from three registry files to compose a PixelLab prompt.

---

## Data Sources

| File | Provides |
| ---- | -------- |
| `macro-world/population-archetypes.json` | Which NPC roles belong to each building. Includes `fashionVariant` and `spriteNotes` (pose, body type, held items). |
| `macro-world/fashion.json` | Clothing details per culture + variant. Provides silhouette, headwear, footwear, accessories, materials, palette, motifs, and real-world fashion inspiration. |
| `macro-world/cultures.json` | Culture ID, race preferences (which Peoples appear), and settlement layout traits. |
| `docs/peoples-and-races.md` | The 15 canonical Mistheim Peoples — use for race/body description. |

---

## Pipeline

### Step 1 — Pick the settlement context

Decide:
- **Culture** (from `cultures.json`) — e.g. `fieldborn`, `wallborn`, `mountainhold`
- **Race** (from `racePreferences` on the culture, or manual pick) — e.g. Markfolk, Bergfolk
- **Building** (from `building-registry.json`) — e.g. `smithy`, `tavern`, `palisade-gate`

### Step 2 — Look up the archetype

Find the building in `population-archetypes.json`. Each building lists archetypes with:
- `role` — e.g. `blacksmith`, `gate-guard`
- `fashionVariant` — e.g. `common`, `warrior`, `artisan`, `ceremonial`
- `spriteNotes` — visual direction for body/pose/items (NOT clothing)

Also check `ambientArchetypes` for non-building NPCs (children, elders, wanderers).

### Step 3 — Look up the fashion

Find the culture in `fashion.json`. Look up the matching `fashionVariant`:
- `silhouette` — overall garment shape (fitted, wrapped, flowing, armoured, etc.)
- `headwear`, `footwear`, `accessories` — specific items
- `notes` — art direction blending real-world inspiration with fantasy
- `base.materials`, `base.palette`, `base.motifs` — shared cultural visual identity

### Step 4 — Compose the PixelLab description

Combine into a single description string. Structure:

```
[Setting/genre]. [Race] [gender], [body type from spriteNotes].
[Clothing from fashion variant — silhouette, key garments, materials].
[Palette from base]. [Headwear]. [Footwear]. [Accessories].
[Pose/held items from spriteNotes]. [Key visual detail from spriteNotes].
```

**Rules:**
- Lead with the overall impression, then specifics
- Clothing comes from `fashion.json`, NOT from spriteNotes (spriteNotes = body/pose only)
- Name the real-world inspiration influence in the clothing description (e.g. "hanbok-inspired wrapped tunic", "Byzantine-style tabard")
- Include the culture's palette colours explicitly
- Keep under ~300 characters for best PixelLab results

### Step 5 — Generate with PixelLab

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

### Step 6 — Review and iterate

Check the south-facing view. If the clothing/culture doesn't read clearly:
- Simplify the description — PixelLab works better with fewer, clearer details
- Emphasise the most distinctive element (e.g. the straw hat, the tabard colour)
- Try increasing `ai_freedom` (default 750) if the result is too generic

### Step 7 — Download and assemble

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
- Race: Markfolk (human)
- Building: `smithy` → archetype: `blacksmith` (fashionVariant: `artisan`, but fieldborn has no artisan → fall back to `common`)
- Fashion (fieldborn/common): wrapped silhouette, wide straw hat, leather sandals, high-waist sash, wheat-gold/clay-brown palette
- Archetype spriteNotes: barrel-chested, massive forearms, holding tongs/hammer, soot-marked face, burn scars

**Composed description:**
> Medieval fantasy village blacksmith. Human male, barrel-chested with massive forearms. Wearing a clean-lined wrapped linen tunic tied at the high waist with a broad wheat-gold sash (Korean hanbok-inspired silhouette). Sun-bleached white and clay-brown colours. Heavy leather apron over the tunic, soot-stained. Simple leather sandals. Wide straw hat pushed back on head. Holding a blacksmith hammer. Soot-marked face, burn scars on forearms. Sturdy, grounded stance.

**Result:** PixelLab character ID `83e224c5-34e8-49d0-9e98-847bf4cb7ab8`

## Example: Wallborn Gate Guard

**Input:**
- Culture: `wallborn` (Byzantine civic)
- Race: Markfolk (human)
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
