# Core Warden UI Style Guide

**Style name**: Tech-Rune
**Direction**: Anime tech meets fantasy — CrossCode's digital precision blended with Octopath's ornamental warmth
**Primary platform**: Android tablet (800x600 landscape)

## Art direction

The UI should feel like a runic interface powered by ancient technology — clean geometric lines and glowing teal accents (the "tech") combined with warm gold ornamental touches and organic materials (the "fantasy"). Think enchanted control panels, not medieval parchment and not sterile sci-fi.

Every panel should look like it belongs in the game world: something a Tinkerer would build, something a Skald would inscribe.

**Not this**: pure gritty medieval (Skyrim), sterile flat UI (mobile apps), neon cyberpunk (too cold)
**Yes this**: CrossCode's digital HUD + Octopath's gold luxury + Eastward's warmth

## Colour palette

### Core colours

| Role | Hex | Swatch | Name |
|------|-----|--------|------|
| Panel background | `#0d0e1a` | ![#0d0e1a](https://placehold.co/20/0d0e1a/0d0e1a) | Deep Void |
| Panel bg (warm) | `#141210` | ![#141210](https://placehold.co/20/141210/141210) | Dark Ember |
| Outer border | `#2a2c3e` | ![#2a2c3e](https://placehold.co/20/2a2c3e/2a2c3e) | Slate Edge |
| Inner border (tech) | `#4dd4f0` | ![#4dd4f0](https://placehold.co/20/4dd4f0/4dd4f0) | Rune Teal |
| Inner border (fantasy) | `#c8922a` | ![#c8922a](https://placehold.co/20/c8922a/c8922a) | Amber Gold |

### Text colours

| Role | Hex | Name |
|------|-----|------|
| Primary text | `#f0f0e8` | Warm White |
| Secondary text | `#9090a8` | Muted Grey |
| Interactive / buttons | `#ffe066` | Button Gold |
| Hover state | `#ffffff` | Pure White |
| Disabled | 40% opacity | — |

### Semantic colours

| Role | Hex | Name |
|------|-----|------|
| HP | `#e03030` | Blood Red |
| Stamina | `#40c0a0` | Teal Green |
| Essence / mana | `#aa66ff` | Spirit Purple |
| Positive / success | `#88ff88` | Fresh Green |
| Warning | `#ffaa33` | Amber |
| Danger / error | `#ff4444` | Alert Red |
| Gold / currency | `#ffe066` | Button Gold |

### Slot colours

| Role | Hex | Name |
|------|-----|------|
| Slot background | `#1a1c2e` | Slot Dark |
| Slot border | `#3a3c52` | Slot Edge |
| Slot selected | `#4dd4f0` | Rune Teal |
| Slot hover | `#222438` | Slot Hover |

### Item rarity border colours

| Rarity | Hex | Name |
|--------|-----|------|
| Common | `#9090a8` | Muted Grey |
| Uncommon | `#40c0a0` | Teal Green |
| Rare | `#4488dd` | Sky Blue |
| Epic | `#aa66ff` | Spirit Purple |
| Legendary | `#c8922a` | Amber Gold |

## Panel frames

### Construction

All panels use **nine-slice** sprites for scalability. Phaser's built-in `NineSlice` game object handles this natively.

### Border language

**Double border** — the signature visual element of Tech-Rune style:

```
+--[Slate Edge outer, 1px]--+
| +--[Accent inner, 1px]--+ |
| |                        | |
| |    Panel content       | |
| |                        | |
| +------------------------+ |
+----------------------------+
```

- **Outer border**: 1px, Slate Edge (`#2a2c3e`)
- **Inner border**: 1px, either Rune Teal (`#4dd4f0`) for tech/system panels or Amber Gold (`#c8922a`) for fantasy/lore/shop panels
- **Corner radius**: 2px
- **Panel fill**: Deep Void (`#0d0e1a`) at 92-96% opacity
- **1px gap** between outer and inner border (creates the double-border depth effect)

### Panel variants

| Variant | Inner border | Use case |
|---------|-------------|----------|
| System | Rune Teal | Pause menu, settings, HUD panels, crafting |
| Fantasy | Amber Gold | Shop, lore, NPC dialog, main menu |
| Tooltip | Rune Teal (dimmer, 60% opacity) | Item tooltips, hover info |
| Alert | Alert Red | Warnings, confirmations |

### Decorative corners (optional, Phase 2+)

Small 5x5px ornamental pixel art at panel corners — a tiny rune glyph or geometric flourish. Adds the Octopath-inspired luxury touch. Only on major panels (main menu, crafting), not on tooltips or small overlays.

## Buttons

### Anatomy

```
+--[1px border]--+
|  [8px padding]  |
|   BUTTON TEXT   |
|  [8px padding]  |
+-----------------+
```

- Minimum touch target: 48px tall (Android guideline: 48dp)
- Horizontal padding: 14px minimum
- Text centred, ALL-CAPS for primary actions

### States

| State | Fill | Border | Text | Effect |
|-------|------|--------|------|--------|
| Default | `#1a1c2e` | `#3a3c52` 1px | `#ffe066` | — |
| Hover | `#222438` | `#4dd4f0` 1px | `#ffffff` | Border glows teal |
| Pressed | `#161828` | `#4dd4f0` 1px + inner glow | `#ffffff` | Slight darken + 1px inner bright edge |
| Disabled | `#1a1c2e` 40% | `#3a3c52` 40% | `#9090a8` 40% | Everything faded |

### Button types

- **Primary**: as above (gold text, teal hover)
- **Danger**: same layout but hover border = Alert Red, text = `#ff4444`
- **Ghost**: no fill, border only, more subtle — for secondary actions
- **Tab**: wider, shorter. Active = filled bg + coloured underline. Inactive = transparent + grey text

## Inventory slots

### Size and spacing

- **Slot size**: 56x56px (generous touch target for tablet thumbs)
- **Grid gap**: 4px between slots
- **Icon size**: 32x32px centred within the 56px slot (12px padding each side)

### States

| State | Fill | Border | Extra |
|-------|------|--------|-------|
| Empty | `#1a1c2e` | `#3a3c52` 1px | — |
| Filled | `#1a1c2e` | `#3a3c52` 1px | Item icon centred |
| Hover | `#222438` | `#4dd4f0` 1px | Slight brighten |
| Selected | `#1a2838` | `#4dd4f0` 2px | Teal glow border |
| Locked | `#121218` | `#2a2c3e` 1px | Lock icon overlay, 60% dim |

### Stack count

- Position: bottom-right corner of slot
- Font: pixel font, 8px
- Colour: `#f0f0e8` with 1px `#000000` drop shadow
- Only shown when quantity > 1

### Rarity indicator

The slot border colour changes based on item rarity (see rarity table above). The border widens to 2px for Rare and above.

## Health and resource bars

### Construction

```
+--[1px dark border]--+
| [fill ██████░░░░░░] |
+---------------------+
```

- **Width**: 120-160px (scales with available space)
- **Height**: 12px (bar) + 2px (border top/bottom) = 16px total
- **Fill direction**: left to right
- **Border**: 1px Dark Void (`#0d0e1a`)
- **Background (empty)**: `#1a1c2e`

### Segmentation (CrossCode style)

Thin 1px vertical lines at 25% intervals within the bar, colour = border colour at 40% opacity. These "pip marks" help players gauge remaining resources at a glance without reading numbers.

### Raised-glow effect

The middle pixel row of the fill is 20% brighter than the rest — creates a subtle "lit from above" 3D illusion that costs zero extra sprites.

### Bar types

| Bar | Fill colour | Icon (optional) |
|-----|------------|-----------------|
| HP | `#e03030` | Heart or + symbol |
| Stamina | `#40c0a0` | Lightning bolt |
| Essence | `#aa66ff` | Diamond/crystal |
| XP/Progress | `#4dd4f0` | — |

### Auto-fade (Breath of the Wild approach)

When all resource bars are full AND the player hasn't taken damage or spent resources for 5 seconds, fade HUD to **30% opacity** (never fully hidden). Restore to 100% instantly on any resource change (damage, item use, stamina spend).

Why 30% and not 0%: Core Warden has crafting/gathering where players glance at resources mid-exploration. Full hide forces a tap just to check. 30% means bars are visible if you look for them but don't dominate the 800x600 view. BotW, Elden Ring, and HLD all use some form of auto-fade — the difference is whether you fade to transparent or near-transparent. For a resource-management game, near-transparent is safer.

## Typography

### Fonts

| Context | Font | Size | Style |
|---------|------|------|-------|
| Scene titles | Silkscreen (pixel font) | 20-24px | ALL-CAPS, bold |
| Section headers | Silkscreen | 14-16px | ALL-CAPS |
| Tab labels | Silkscreen | 12-13px | ALL-CAPS |
| Body text / labels | System sans-serif | 11-13px | Normal |
| Button text | Silkscreen | 13-15px | ALL-CAPS |
| Small labels / counts | System sans-serif | 9-10px | Normal |
| Tooltips | System sans-serif | 11px | Normal |

**Why Silkscreen over Press Start 2P**: Silkscreen is narrower and cleaner — better for tab labels and buttons where horizontal space is tight. Press Start 2P is blocky/wide and eats too much space. Both are free (Google Fonts). Silkscreen at larger sizes (14px+) is crisp and mechanical, reinforcing the tech aesthetic. Body text stays system sans-serif for readability at arm's length on tablet.

### Drop shadow rule

**All light text on dark backgrounds gets a 1px drop shadow** in `#000000` at 80% opacity, offset (1, 1). This is non-negotiable for legibility — every reference game does it.

### Colour by context

- Titles: Warm White `#f0f0e8`
- Interactive labels: Button Gold `#ffe066`
- Inactive / secondary: Muted Grey `#9090a8`
- Success messages: Fresh Green `#88ff88`
- Warnings: Amber `#ffaa33`
- Errors: Alert Red `#ff4444`

## HUD layout (800x600 landscape)

```
+--------------------------------------------------+
|                               [Minimap]  [Pause]  |
|                                                    |
|                                                    |
|                                                    |
|                    GAME WORLD                      |
|                                                    |
|                                                    |
|                                                    |
| [HP ████████░░]                                    |
| [ST ██████░░░░]   [ 1 ][ 2 ][ 3 ][ 4 ][ 5 ][ 6 ] |
| [ES ████░░░░░░]          Quick-slot hotbar         |
+--------------------------------------------------+
```

- **Resource bars**: bottom-left stack (HP, Stamina, Essence)
- **Quick-slot hotbar**: bottom-centre, 6 slots in thumb zone
- **Minimap**: top-right corner (if implemented)
- **Pause button**: top-right
- **Gold counter**: below minimap or beside pause button
- **Auto-hide**: bars + hotbar fade when full + idle

## Reference inspirations

| Element | Inspired by | Specific takeaway |
|---------|-------------|-------------------|
| Double border | CrossCode | Teal inner line on dark = instant tech feel |
| Gold accents | Octopath Traveler | Warm gold on dark = luxury fantasy |
| Nine-slice panels | All 8 games | Industry standard, Phaser supports natively |
| 56px slots | Stardew (48) + size bump | Extra generous for tablet thumbs |
| Rarity borders | Terraria | Colour-coded borders = zero learning curve |
| Tab navigation | Terraria (mobile) | Tabs > density on touch screens |
| Auto-fade HUD | BotW + HLD hybrid | Fade to 30% when idle, never fully hide |
| Segmented bars | CrossCode | Pip marks at 25% for quick visual reading |
| Warmth/restraint | Eastward | Don't overload — every element earns its space |
| Dual-context UI | Moonlighter | Combat HUD and menus can have different personalities |

## Implementation notes

- **Phaser NineSlice**: `this.add.nineslice(x, y, texture, frame, width, height, leftWidth, rightWidth, topHeight, bottomHeight)`
- **Shared UI factory**: create `src/ui/UIFactory.ts` with `makePanel()`, `makeButton()`, `makeSlot()`, `makeBar()` — replaces the copy-pasted per-scene code
- **Pilot scene**: CraftingMenuScene (most complex UI, validates the system works for everything)
- **Sprite sheet**: all UI elements in one atlas for efficient GPU batching
- **Touch targets**: enforce 56px minimum for slots, 48px minimum for buttons — warn in dev mode if violated
