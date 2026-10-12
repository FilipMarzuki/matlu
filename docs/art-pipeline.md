# The Artificer's art pipeline

**Issue:** #1673 · **Epic:** #1672 · **Written:** 2026-10-12

What art the Artificer needs, how it gets made, and the rules that keep it looking like one game. The machine-readable halves are [`src/artificer/content/art-style.json`](../src/artificer/content/art-style.json) (the style guide) and [`src/artificer/content/art-briefs.json`](../src/artificer/content/art-briefs.json) (a visual brief per item). `src/artificer/art-briefs.test.ts` keeps them honest.

The owner's decisions (2026-10-12, #1672): **pixel art**, **made with PixelLab** through the burn pipeline, **start with the stores and inventory** (icons in place of emoji) and inspect cards for crafted items, **keep the old Homestead icons that match**, and **concept art is the reference, not the source**.

## Tiers: by how much the player looks at a thing

| Tier | For | Art | Size | Issue |
| --- | --- | --- | --- | --- |
| **0, everything** | every material, item, tool and recipe result | an icon, from the item's visual brief | 32 px | #1674 (generate), #1675 (show) |
| **1, notable** | heirlooms, key tools, finished crafts, the manuals | an inspect card, made **first**; the icon is then redrawn to match it | ~128 px card + 32 px icon | #1676 |
| **2, the world** | the Peoples, the road's named people, places, creatures, big events | concept art first; portraits, vignettes, markers and icons follow from it; the Codex uses it too | concept: free size | #1677 |

Two kinds of art sit beside the tiers:

- **Animated action icons** (#1678): one small loop per camp action (wood, fish, gather, quarry, water, build, craft, scout…), 4–8 frames at 32 px (48 px if 32 doesn't read). Frame 0 is the idle frame and doubles as the action's static icon, replacing today's emoji (`ICON` in `src/artificer-app/main.ts`). It plays while the action runs on the real-time timer (#1669), and `prefers-reduced-motion` holds it on frame 0. One spritesheet per action, animated with CSS `steps()`.
- **JRPG talking portraits** (#1679): when the Warden talks to someone on the road (asks, free questions, people encounters), a pixel-art bust (64 px, shown scaled up with crisp pixels) beside a typed-out text box with a name plate. The mouth loops through 2–3 frames while text types; optional expressions (neutral, wary, warm, caught out) follow the answer. **Portraits are drawn from the person's tier-2 concept art**, so a road person gets a concept piece before a portrait; until then, a silhouette in their People's look. The Warden's lines use the chosen portrait (`src/artificer-app/portraits.ts`).

Which items are tier 1 is set per item in `art-briefs.json`. Today: every crafted tool and piece of gear (they can all become heirlooms, `legacy.ts`), the scout's three signature tools (Mora knife, fire steel, map and compass) and the two manuals. Shelters and the cold pit are tier 0: they live in the camp, not the pack; a bigger picture of a camp belongs with the tier-2 places.

## The rule: concept art is a reference, not a source

A smaller asset is **redrawn** to match the bigger one, never shrunk from it. A 128 px card scaled to 32 px is mush; a 32 px icon drawn with the card as PixelLab's reference image reads as the same object. So:

- Tier 1: the card first, then the icon with the card as its reference. A kept or generated icon on a tier-1 item is provisional until its card exists.
- Tier 2: the concept piece first, then portraits, vignettes, markers and icons, each made with the concept as the reference image.
- Never downscale art to make a smaller tier.

## The flow

```
brief (art-briefs.json) ──▶ PixelLab burn ──▶ public/assets/sprites/… ──▶ npm run assets:sprites ──▶ /assets viewer ──▶ wired into the app
         ▲ style (art-style.json)                                                                          (icon path in the brief)
```

1. **Brief.** The item's entry in `art-briefs.json`: `brief`, `tier`, and `icon` once it has one.
2. **Generate.** The Artificer icon pass in `scripts/pixellab-queue-generate.mjs` (#1674) queues every item without an icon, with the brief as the prompt (plus `art-style.json` › `pixellab.promptSuffix`), the style's size, outline, shading and detail, and the reference icons as style images. `npm run pixellab:burn -- --artificer-icons` runs just that pass **serially**, per the PixelLab rules in `CLAUDE.md`: one `create_image_pixflux` job at a time (1 generation each, the generator the kept icons came from). Pixflux takes no style images, only a forced palette, so the style's 32 colours (extracted from the reference icons) are what carry the look. The burn saves each icon and sets its `icon` in the brief.
3. **Save.** Icons go to `public/assets/sprites/icons/items/<id>.png`. Review the new set as a contact sheet at 1× and 4× (`npm run art:sheet` → `docs/art/contact-sheet-items.png`); regenerate any that don't read at 32 px (delete the PNG and its `icon`, then burn again).
4. **Catalogue.** `npm run assets:sprites` regenerates `public/assets/sprite-manifest.json`.
5. **Record.** Set the item's `icon` in `art-briefs.json` (a URL under `public/`, e.g. `/assets/sprites/icons/items/stone-knife.png`). The test checks the file exists and is 32 px.
6. **Check in `/assets`.** The sprite shows a green dot. Note that the manifest marks a sprite wired when any file under `src/` names it, so the briefs file alone turns it green; the real wiring is the store and pack UI (#1675).
7. **Commit** the PNGs, the briefs file and the manifest together.

## Where files live

| What | Where |
| --- | --- |
| Style guide (machine-readable) | `src/artificer/content/art-style.json` |
| Visual briefs, tiers, icon paths | `src/artificer/content/art-briefs.json` |
| Item icons (tier 0) | `public/assets/sprites/icons/items/<id>.png` (old Homestead icons keep their `item-<name>.png` names) |
| Concept badges | `public/assets/sprites/icons/concepts/patch-<name>.png`, named from `src/artificer/content/concepts.json` › `icon` |
| Inspect cards (tier 1) | `public/assets/sprites/cards/items/<id>.png` |
| Action icons | `public/assets/sprites/icons/actions/<action>.png` (horizontal strip, frame 0 first) |
| Portraits | `public/assets/sprites/portraits/<person-id>/` (bust, mouth frames, expressions) |
| Concept art (tier 2) | `public/assets/concept/<kind>/<id>.png` (kind: `peoples`, `people`, `places`, `creatures`), linked from its canon entry |

The cards, actions, portraits and concept folders don't exist yet; the issue that makes the first one creates it.

## How a new item gets its art

1. Add the item to the Artificer's code (a recipe in `region1.ts`, a kit item in `kit.ts`, a manual in `techniques.ts`, a good in `trade.ts`…). The Artificer is the master for items (#1531); don't add them to the Homestead registries.
2. `npm run unit:src` now fails in `art-briefs.test.ts`: the item has no brief.
3. Add its entry to `art-briefs.json`: one sentence or two, under 220 characters, saying **silhouette; material; colour; one telling detail**, in that order. Example: *"A short knife, a knapped flint blade lashed into a wooden handle; grey flint, brown wood, tan sinew wrapping; the flaked scallops along the edge."* Pick `tier` 0 or 1 (above). Describe the object as it looks out here, not what it does.
4. If an existing 32 px icon really is that object, set `icon`; otherwise leave it out and the next burn makes one.
5. A removed item fails the test the other way (a brief for an item that's gone): delete its entry.

## Style guide

All of it is in `art-style.json`; the generator reads that file, so change it there.

- **Sizes:** icon 32 px; card 128 px; action icon 32 px, 4–8 frames; portrait bust 64 px.
- **Outline:** 1 px, dark (`#171113`, PixelLab's "single color outline"), round the whole silhouette.
- **Light:** from the top left. **Background:** transparent. **View:** front, with a slight three-quarter tilt for objects with depth.
- **Shading / detail:** PixelLab "basic shading", "medium detail" (what the kept icons were made with, `src/ai/asset-spec.json`).
- **Look:** hand-made, worn, earthy: wood, hide, stone, fibre, and the scout kit's few bright synthetic colours (a red knife handle, an orange sit pad) as accents. No metal-age fantasy gear in Region 1.

### Palette (32 colours)

Extracted from 36 of the old item icons that already fit the Artificer (the natural materials, food, hide, rope and wood ones) by k-means clustering, so new icons sit beside the kept ones. Dark to light:

`#171113` `#2a1f1e` `#502214` `#721c20` `#593423` `#374138` `#713c2c` `#8f3e1e`
`#565c65` `#a94d29` `#84573b` `#cb4435` `#c56201` `#a36c39` `#a47251` `#489520`
`#797e83` `#d76f4a` `#c57c27` `#b7834b` `#e4970f` `#cd9a62` `#a5a2a1` `#8eb0bc`
`#e6a574` `#e5ac37` `#5ccbf5` `#e3bd8c` `#f6d673` `#dce2df` `#f5e3b7` `#f9f8f4`

Mostly warm browns, leather and bone, with two greens, two water blues and four greys. It is not `docs/matlu-palette.hex` (the Core Warden UI palette, purple-led); the Artificer's icons have always been warmer.

### Reference icons

Passed to PixelLab as style images with every icon request:

| Icon | Why |
| --- | --- |
| `/assets/sprites/icons/items/item-wood-log.png` | wood and end-grain, the clean outline and top-left light |
| `/assets/sprites/icons/items/item-ration.png` | cloth and string, a soft wrapped shape |
| `/assets/sprites/icons/items/item-berries.png` | organic colour on a dark base, a lot read in 32 px |
| `/assets/sprites/icons/items/item-rope.png` | fibre texture, a simple strong silhouette |
| `/assets/sprites/icons/items/item-raw-fish.png` | a creature-made material, the cool side of the palette |

## Audit of the old icons

The Homestead left 93 item icons (`icons/items/`) and 32 concept badges (`icons/concepts/`). The Artificer has 55 items (the test builds the list from its code).

### Kept: matched to an Artificer item (7)

| Item id | Icon |
| --- | --- |
| `water` | `item-freshwater.png` (a bowl of stream water) |
| `firewood` | `item-wood-log.png` |
| `rations` | `item-ration.png` |
| `stone` | `item-stone.png` |
| `hides` | `item-hide-raw.png` |
| `trap-snare` | `item-trap-snare.png` (tier 1: provisional until its card) |
| `cord` | `item-rope.png` |

### Close, but not kept

- `item-ledger-book.png` for `tally-book`: the right idea, but it's 48 px (21 of the old item icons are) and too fine (brass corners) for a trapper's book. Tier 1, so its card comes first anyway.
- `item-raw-meat.png`, `item-raw-fish.png`, `item-berries.png` for `rawFood`: each is one food; the Artificer's raw food is the hunt, the catch and the gathering together.
- `item-plant-fiber.png` for `materials`: materials are sticks, fibre and flint together.
- `item-hide-cloak.png` for `hide-parka`: a cloak, not a hooded parka.
- `item-bandage.png` for `first-aid-kit`, `item-torch.png` for `headlamp`, `item-flint.png` for `fire-steel`, `item-fishing-net.png` for `fishing-rod`: different objects.

The other old item icons (metals, ores, weapons, alchemy, farming) have no Artificer item yet. They stay on disk for the Homestead; if the Artificer adds one of those things, check the icon first.

### To generate (48)

- **Tier 0 (30):** `rawFood`, `materials`, `cold-pit`, `shelter-leanto`, `shelter-hut`, `shelter-timber`, `shelter-stone`, `matches`, `first-aid-kit`, `water-bottle`, `kasa`, `thermos`, `sleeping-bag`, `sleeping-pad`, `sit-pad`, `wool-underlayer`, `hat-mittens`, `rain-gear`, `spare-socks`, `headlamp`, `whistle`, `tarp`, `trangia`, `weekend-food`, `sweets`, `notebook`, `toilet-paper`, `phone`, `comic`, `pillow`.
- **Tier 1, card first (18):** `stone-knife`, `skinning-knife`, `waterskin`, `bedroll`, `crude-shovel`, `fishing-rod`, `pouch`, `basket`, `backpack`, `harness`, `sled`, `cold-gear`, `hide-parka`, `mora-knife`, `fire-steel`, `map-compass`, `tally-book`, `forester-notes`.

### Concept badges

Concepts aren't items, so none of the 32 badges maps to an item id. They are already the Artificer's concept icons: `concepts.json` names one per concept (`icon`), and they stay. Found while auditing:

- `patch-pressure` and `patch-gear-train` are named in `concepts.json` but have no file.
- `patch-caliper.png` and `patch-dissolve.png` are the same image (identical bytes): `precision` and `dissolution` look alike.
- `patch-crystal-grow.png` is square where the others are round badges, and 14 of the 32 are 48 px rather than 32.

These go with the icon generation (#1674) if the concept board shows them.
