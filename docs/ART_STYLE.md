# Matlu Pixel Art Style Guide

## Tile & Sprite Scale

| Asset type | Canvas size | Notes |
| -- | -- | -- |
| World tiles (ground, walls) | 16×16px | Base unit for all environment |
| Characters (player, NPCs) | 16×32px | 2-tile tall, 1-tile wide |
| Enemies (small) | 16×16px | Fits 1 tile |
| Enemies (large) | 32×32px | Fits 2×2 tiles |
| Items / pickups | 16×16px | Centred in tile |
| HUD icons | 8×8px or 16×16px | Crisp at any scale |

All sprites are designed at **1× (native px)** and scaled up in Phaser via `setScale()`.
**Never design at 2× or 4×** — world size never affects art resolution.

## Palette

Use a **restricted palette of 32 colours max** across the entire game.

### Palette categories

| Category | Colour count | Role |
| -- | -- | -- |
| Skin / character tones | 4–6 | Player, NPCs, enemies |
| Environment tones | 6–8 | Grass, dirt, stone, water |
| Corruption tones | 4 | Dark purple/grey — enemies, corrupted zones |
| Cleanse / light tones | 4 | Bright greens, whites — healing FX, portal |
| UI tones | 4 | HP red, cleanse green, neutral grey, off-white |
| Accent / item tones | 4–6 | Loot, pickups, highlights |

### Hard rules

* No pure `#000000` — use very dark desaturated purple (e.g. `#1a1025`)
* No pure `#ffffff` — use warm off-white (e.g. `#f0ead6`)
* Every sprite uses **only colours from the shared palette**
* Palette exported as `docs/matlu-palette.png` and `docs/matlu-palette.hex`

## Pixel Art Rules

* **No anti-aliasing** — hard pixel edges only
* **No sub-pixel rendering** — whole pixel coordinates only
* **Consistent light source** — top-left for all sprites
* **Max 4 shades per colour ramp** — base, highlight, shadow, deep shadow
* **Outline rule** — 1px dark outline on characters and enemies; no outline on environment tiles
* **No dithering on characters** — limited dithering allowed on large environment surfaces only

## Animation Standards

| Asset | Frame count | FPS |
| -- | -- | -- |
| Player idle | 2–4 frames | 6 fps |
| Player walk | 4–6 frames | 8 fps |
| Player attack | 3–5 frames | 12 fps |
| Enemy idle | 2–4 frames | 6 fps |
| Enemy death | 4–6 frames | 10 fps |
| FX (particles, arcs) | 4–8 frames | 12–16 fps |

All animations exported as **horizontal sprite sheets**.

## File Naming Convention

```
public/assets/sprites/
  player/
  enemies/
  environment/
  items/
  ui/
```

Rules:
* All lowercase, hyphen-separated
* Category folder first, then asset name
* No spaces, no underscores, no version suffixes

## Phaser Integration

```ts
this.load.spritesheet('player-walk', 'assets/sprites/player/player-walk.png', {
  frameWidth: 16,
  frameHeight: 32
});
sprite.setScale(3); // scale at render time, never resize source files
```

## Tools

| Tool | Role |
| -- | -- |
| Aseprite | Primary authoring (preferred) |
| Libresprite | Free Aseprite alternative |
| LDtk | Level/tilemap editor |
| Kenney CC0 packs | Placeholder assets (prototype only) |
