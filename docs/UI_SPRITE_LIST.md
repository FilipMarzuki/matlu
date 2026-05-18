# UI Sprite List — Core Warden Tech-Rune System

Complete inventory of sprites needed for the UI art system (#870 Phase 2).
Organized by sprite type. Each entry lists the sprite, its size, required states, and which scenes use it.

## Naming convention

All sprites go in `public/assets/sprites/ui/` with the pattern:
```
ui-{type}-{variant}-{state}.png
```
Example: `ui-panel-system-normal.png`, `ui-btn-primary-hover.png`

Nine-slice sprites include a `-9s` suffix: `ui-panel-system-9s.png`

---

## 1. Nine-slice panels

These are the most impactful sprites — they replace every `add.rectangle()` + `strokeRect()` panel in the game. All use the Tech-Rune double-border language.

| Sprite | Size (source) | Nine-slice margins | Inner border accent | Used in |
|--------|--------------|-------------------|-------------------|---------|
| `ui-panel-system-9s` | 48×48 | 6px all sides | Rune Teal `#4dd4f0` | Pause, Settings, Stats, Crafting, Inventory HUD, Deployable HUD |
| `ui-panel-fantasy-9s` | 48×48 | 6px all sides | Amber Gold `#c8922a` | Main Menu, Shop, NPC Dialog, Lore, Discovery |
| `ui-panel-tooltip-9s` | 32×32 | 4px all sides | Rune Teal (dimmer, 60%) | Item tooltips, hover info |
| `ui-panel-danger-9s` | 48×48 | 6px all sides | Alert Red `#ff4444` | Game Over, confirmation dialogs |
| `ui-panel-success-9s` | 48×48 | 6px all sides | Fresh Green `#88ff88` | Level Complete |
| `ui-panel-sub-9s` | 32×32 | 4px all sides | Slate Edge `#2a2c3e` (subtle) | Sub-panels: recipe detail, concept detail, forge summary |

**States**: 1 each (panels don't have hover/active states)
**Total sprites**: 6

---

## 2. Buttons

### 2a. Primary button (nine-slice)

The main interactive button used across all menus.

| Sprite | Size (source) | States | Notes |
|--------|--------------|--------|-------|
| `ui-btn-primary-9s-default` | 32×32 | Fill: Slot Dark, border: Slot Edge | Gold text `#ffe066` |
| `ui-btn-primary-9s-hover` | 32×32 | Border brightens to Rune Teal, bg lightens | White text |
| `ui-btn-primary-9s-pressed` | 32×32 | Inner glow edge, bg darkens | White text |
| `ui-btn-primary-9s-disabled` | 32×32 | 40% opacity of default | Muted Grey text |

**Nine-slice margins**: 4px all sides
**Minimum height**: 48px (touch target)
**Used in**: MainMenu, Pause, GameOver, LevelComplete, Shop (secondary), Dialog choices

### 2b. Inverted / accent button (nine-slice)

Gold-filled button for primary actions (Buy, Craft).

| Sprite | Size (source) | States | Notes |
|--------|--------------|--------|-------|
| `ui-btn-accent-9s-default` | 32×32 | Fill: Amber Gold, border: darker gold | Dark text `#111111` |
| `ui-btn-accent-9s-hover` | 32×32 | Fill brightens, border brightens | Dark text |
| `ui-btn-accent-9s-pressed` | 32×32 | Fill darkens slightly | Dark text |
| `ui-btn-accent-9s-disabled` | 32×32 | Desaturated, 40% opacity | Muted text |

**Used in**: Shop (Buy), Crafting (Craft), Crafting (Forge)

### 2c. Danger button (nine-slice)

For destructive or warning actions.

| Sprite | Size (source) | States | Notes |
|--------|--------------|--------|-------|
| `ui-btn-danger-9s-default` | 32×32 | Fill: dark red-tinted, border: `#553333` | Red text `#ff4444` |
| `ui-btn-danger-9s-hover` | 32×32 | Border brightens to Alert Red | Brighter red text |
| `ui-btn-danger-9s-pressed` | 32×32 | Inner glow red | White text |
| `ui-btn-danger-9s-disabled` | 32×32 | 40% opacity | Muted text |

**Used in**: Confirmation dialogs, reset actions

### 2d. Close button (X)

Small square button for dismissing overlays.

| Sprite | Size | States |
|--------|------|--------|
| `ui-btn-close-default` | 24×24 | Subtle X glyph, muted colour |
| `ui-btn-close-hover` | 24×24 | X brightens, slight glow |

**Used in**: Every overlay scene (Crafting, Shop, Settings, Stats, Lore, Upgrades)

### 2e. Arrow buttons

For pagination and navigation.

| Sprite | Size | States |
|--------|------|--------|
| `ui-btn-arrow-left-default` | 24×24 | Left chevron, gold |
| `ui-btn-arrow-left-hover` | 24×24 | Brightened |
| `ui-btn-arrow-left-disabled` | 24×24 | Dimmed, 25% opacity |
| `ui-btn-arrow-right-default` | 24×24 | Right chevron, gold |
| `ui-btn-arrow-right-hover` | 24×24 | Brightened |
| `ui-btn-arrow-right-disabled` | 24×24 | Dimmed |

**Used in**: Lore (page nav), Discovery (world selector)

**Total button sprites**: 4+4+4+2+6 = **20**

---

## 3. Tabs

### 3a. Tab button (nine-slice)

| Sprite | Size (source) | States |
|--------|--------------|--------|
| `ui-tab-9s-active` | 32×24 | Filled bg, bright text, coloured underline |
| `ui-tab-9s-inactive` | 32×24 | Transparent bg, muted text, no underline |
| `ui-tab-9s-hover` | 32×24 | Slight bg tint, text brightens |

**Nine-slice margins**: 4px left/right, 3px top/bottom
**Used in**: Crafting (Mind/Concepts/Recipes/Pack), Settings (language selector)

### 3b. Tab underline accent

| Sprite | Size | Variants |
|--------|------|----------|
| `ui-tab-underline` | 4×3 (stretchable) | Coloured per tab via tint |

**Total tab sprites**: 3 + 1 = **4**

---

## 4. Inventory slots

| Sprite | Size | States | Notes |
|--------|------|--------|-------|
| `ui-slot-empty` | 56×56 | Default empty slot | Slot Dark fill, Slot Edge border |
| `ui-slot-hover` | 56×56 | Pointer over | Lightened bg, Rune Teal border |
| `ui-slot-selected` | 56×56 | Currently selected | Rune Teal 2px border glow |
| `ui-slot-locked` | 56×56 | Unavailable | Darkened, lock icon overlay |
| `ui-slot-drag-target` | 56×56 | Valid drop zone during drag | Pulsing teal highlight |

### Rarity border overlays

Drawn on top of the base slot sprite via tint or separate overlay.

| Sprite | Size | Rarity |
|--------|------|--------|
| `ui-slot-rarity-uncommon` | 56×56 | Teal Green border |
| `ui-slot-rarity-rare` | 56×56 | Sky Blue border, 2px |
| `ui-slot-rarity-epic` | 56×56 | Spirit Purple border, 2px |
| `ui-slot-rarity-legendary` | 56×56 | Amber Gold border, 2px, subtle glow |

**Used in**: Crafting (Pack tab), Inventory HUD, Shop, future equipment screen

**Total slot sprites**: 5 + 4 = **9**

---

## 5. Resource bars

### 5a. Bar track (nine-slice)

| Sprite | Size (source) | Notes |
|--------|--------------|-------|
| `ui-bar-track-9s` | 32×16 | Dark fill, 1px border, pip marks at 25% |

**Nine-slice margins**: 4px left/right, 2px top/bottom

### 5b. Bar fill (nine-slice, tinted per type)

| Sprite | Size (source) | Notes |
|--------|--------------|-------|
| `ui-bar-fill-9s` | 28×12 | White/neutral base — tinted red/green/purple at runtime |

Has the 1px brighter centre row (raised-glow effect) baked in.

### 5c. Bar icons (optional, beside bars)

| Sprite | Size | Type |
|--------|------|------|
| `ui-icon-heart` | 16×16 | HP indicator |
| `ui-icon-lightning` | 16×16 | Stamina indicator |
| `ui-icon-crystal` | 16×16 | Essence/mana indicator |

### 5d. Boss bar track

| Sprite | Size (source) | Notes |
|--------|--------------|-------|
| `ui-bar-boss-track-9s` | 48×18 | Wider, darker purple tint, slightly ornamental |
| `ui-bar-boss-fill-9s` | 44×14 | Purple fill base |

**Total bar sprites**: 2 + 1 + 3 + 2 = **8**

---

## 6. Tinker Tray elements (Crafting — Mind tab)

| Sprite | Size | States/variants | Notes |
|--------|------|----------------|-------|
| `ui-tray-slot-primary` | 240×38 (nine-slice) | Empty, occupied, drag-over | Blue-tinted, prominent |
| `ui-tray-slot-secondary` | 240×38 (nine-slice) | Empty, occupied, drag-over | Slightly dimmer |
| `ui-tray-slot-background` | 240×38 (nine-slice) | Empty, occupied, drag-over | Much dimmer, grey border |
| `ui-tray-slot-degraded` | 240×38 (nine-slice) | Empty, occupied | Dimmest, static-line overlay |
| `ui-tray-progress-track` | 32×20 (nine-slice) | — | Dark track with border |
| `ui-tray-progress-fill` | 28×16 (nine-slice) | — | Blue fill, tinted |
| `ui-chip-concept` | 24×28 (nine-slice) | Normal | Green-tinted rounded rect |
| `ui-chip-material` | 24×28 (nine-slice) | Normal | Brown-tinted rounded rect |

**Total tray sprites**: **8**

---

## 7. Concept node elements (Crafting — Concepts tab)

| Sprite | Size | States | Notes |
|--------|------|--------|-------|
| `ui-node-ring-locked` | 52×52 | — | Grey border, very dim |
| `ui-node-ring-unlocked` | 52×52 | — | Category-colour border (tinted at runtime) |
| `ui-node-ring-mastered` | 52×52 | — | Gold border, slight glow |
| `ui-node-lock-icon` | 12×12 | — | Small padlock |

Actual node content (patch icon sprites) already exist — these are just the decorative rings around them.

**Total node sprites**: **4**

---

## 8. Forge view cards (Crafting — Recipes tab)

| Sprite | Size | State | Notes |
|--------|------|-------|-------|
| `ui-forge-card-have` | 90×50 (nine-slice) | Has enough resources | Green-tinted |
| `ui-forge-card-craftable` | 90×50 (nine-slice) | Can craft now | Gold/amber-tinted |
| `ui-forge-card-missing` | 90×50 (nine-slice) | Missing raw materials | Red-tinted |
| `ui-forge-card-blocked` | 90×50 (nine-slice) | Blocked dependency | Grey/muted |

**Total forge sprites**: **4**

---

## 9. Decorative elements

| Sprite | Size | Notes |
|--------|------|-------|
| `ui-divider-h` | 4×1 (stretchable) | Horizontal divider line, semi-transparent |
| `ui-divider-ornament` | 64×3 | Decorative divider with centre flourish |
| `ui-corner-ornament-tl` | 8×8 | Top-left rune glyph for major panels |
| `ui-corner-ornament-tr` | 8×8 | Top-right (mirror) |
| `ui-corner-ornament-bl` | 8×8 | Bottom-left (mirror) |
| `ui-corner-ornament-br` | 8×8 | Bottom-right (mirror) |
| `ui-star-filled` | 16×16 | Gold star (level complete, mastery) |
| `ui-star-empty` | 16×16 | Grey/outline star |
| `ui-icon-gold` | 16×16 | Gold coin icon for currency display |

**Total decorative sprites**: **9**

---

## 10. HUD elements

| Sprite | Size | States | Notes |
|--------|------|--------|-------|
| `ui-btn-pause` | 32×32 | Normal, hover | Pause icon (⏸) |
| `ui-joystick-base` | 80×80 | — | Translucent circle |
| `ui-joystick-thumb` | 28×28 | — | Solid circle |
| `ui-btn-action` | 56×56 | In-range, out-of-range | Circle with "E" or interaction icon |
| `ui-btn-craft-shortcut` | 44×44 | Normal | Circle with "C" or hammer icon |
| `ui-hud-badge-bg` | 40×40 | — | InventoryHUD badge background |

**Total HUD sprites**: **6**

---

## 11. Building toolbar (Homestead)

| Sprite | Size | States | Notes |
|--------|------|--------|-------|
| `ui-build-slot-normal` | 40×40 | Default | Dark green fill, subtle border |
| `ui-build-slot-selected` | 40×40 | Active building | Gold border highlight |
| `ui-btn-cancel-build` | 60×22 | Normal | Red-tinted cancel button |

**Total building sprites**: **3**

---

## 12. Deployable slots (combat HUD)

| Sprite | Size | States | Notes |
|--------|------|--------|-------|
| `ui-deploy-slot-ready` | 36×36 | Ability ready | Dark green fill |
| `ui-deploy-slot-cooldown` | 36×36 | On cooldown | Dark grey, for radial sweep overlay |
| `ui-deploy-slot-cap` | 36×36 | At capacity flash | Dark red, brief flash |
| `ui-deploy-sweep` | 36×36 | — | Black pie-chart mask for cooldown animation |

**Total deployable sprites**: **4**

---

## Summary

| Category | Count |
|----------|-------|
| Nine-slice panels | 6 |
| Buttons | 20 |
| Tabs | 4 |
| Inventory slots | 9 |
| Resource bars | 8 |
| Tinker Tray | 8 |
| Concept nodes | 4 |
| Forge cards | 4 |
| Decorative | 9 |
| HUD elements | 6 |
| Building toolbar | 3 |
| Deployable slots | 4 |
| **Total** | **85** |

## Priority order for implementation

1. **Nine-slice panels** (6) — biggest visual impact, replaces every menu backdrop
2. **Primary + accent buttons** (8) — used in every scene
3. **Inventory slots** (5 base) — Pack tab, Shop, InventoryHUD
4. **Resource bars** (3 track+fill) — HP, stamina, essence
5. **Close button + arrows** (4) — every overlay needs these
6. **Tabs** (4) — Crafting scene tabs
7. **Decorative** (stars, dividers, corners) — polish layer
8. **Everything else** — tray slots, forge cards, concept rings, deployable slots, building toolbar
