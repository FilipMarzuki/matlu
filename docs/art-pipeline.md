# The Artificer's art pipeline

**Issue:** #1673 · **Epic:** #1672 · **Written:** 2026-10-12

What art the Artificer needs, how it gets made, and the rules that keep it looking like one game. The machine-readable halves are [`src/artificer/content/art-style.json`](../src/artificer/content/art-style.json) (the style guide) and [`src/artificer/content/art-briefs.json`](../src/artificer/content/art-briefs.json) (a visual brief per item). `src/artificer/art-briefs.test.ts` keeps them honest. How the interface's look changes across the game's three eras is [Era looks](#era-looks) (#1718).

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
6. **Check in `/assets`.** The sprite shows a green dot. Note that the manifest marks a sprite wired when any file under `src/` names it, so the briefs file alone turns it green; the real wiring is the store and pack UI (#1675): `src/artificer-app/item-icons.ts` reads each brief's `icon`, so an icon recorded here shows in the stores, the pack, trade lists and craft ingredients with no other change (an item without one keeps its emoji or plain text).
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

## Era looks

**Issue:** #1718 · **Epic:** #1717 · **Written:** 2026-10-15

The owner (2026-10-15): the game's look should change as the Warden grows, "fluid but noticeable", from scout and cartographer, to steampunk, to rune tech. Three eras of three steps each make **nine looks**. This section is the framework; the palettes and their contrast test are #1693, the theme engine that swaps them is #1719, each era's art is #1720–#1722, the triggers and the age-up moment are #1723, and history staying visible is #1724.

An era look is the **interface's frame**: panel colours, paper and backgrounds, borders, dividers, corner pieces, buttons and the small ornaments around them. It is not the item art. An icon draws its object as that object looks (the style guide above) whatever era the frame is in, so a stone knife stays flint and wood in a brass frame, and "no metal-age fantasy gear in Region 1" still holds for Region 1's items.

Only the scout era is in play today. The steampunk and rune-tech looks are built and previewed in dev mode, and their triggers wait for those eras' content.

### The nine looks

| Step | Scout and cartographer | Steampunk | Rune tech |
| --- | --- | --- | --- |
| **1** | **Field journal:** pencil on parchment, muted greens | **Tinkerer's bench:** dark wood, first copper | **Etched slate:** runes carved but not lit |
| **2** | **Cartographer:** inked lines, compass-rose details, warmer paper | **Brass engine:** brass rims, rivets, gauges | **Waking runes:** cyan glow in edges |
| **3** | **Surveyor:** richer colour, first hints of brass | **Soot and steam:** darker, a faint rune glint | **Full rune tech:** violet and cyan glow on dark |

### Each step: mood, motifs, ornament

**Scout and cartographer**: a person on foot, learning the land by walking it and writing it down.

- **1. Field journal.** *Mood:* quiet, careful, a little cold; the first notes of someone new here. *Motifs:* graphite pencil, smudges, parchment grain, pressed leaves, muted greens and greys. *Ornament:* almost none; a pencil rule under a heading, a smudge in a corner. Borders are sketched, never inked.
- **2. Cartographer.** *Mood:* confident, curious; the land starts to make sense. *Motifs:* ink lines over the pencil, compass roses, scale bars, contour hatching, a warmer, yellower paper. *Ornament:* a small compass rose on panel corners, inked borders with a thin double rule, hatching as a divider.
- **3. Surveyor.** *Mood:* settled, capable, the land measured. *Motifs:* fuller colour washes on the paper, survey marks and triangulation lines, brass instrument edges. *Ornament:* the first brass, a small rivet or brass corner on the main panels only. This step **foreshadows steampunk**.

**Steampunk**: the Warden starts building machines, and the camp starts to sound like a workshop.

- **1. Tinkerer's bench.** *Mood:* warm, cluttered, hopeful; the first machine on a wooden bench. *Motifs:* dark oiled wood and its grain, the first copper (wire, a pipe, a kettle), lamplight. *Ornament:* wooden frames with visible joints (pegs, dovetails); copper only as thin lines and wire.
- **2. Brass engine.** *Mood:* proud, loud, working; the machine runs. *Motifs:* brass rims, rivets, gauges with needles, pipes, cogs at the edges. *Ornament:* brass bezels round panels, rivet rows along borders, a gauge as the corner piece. Ornament stays at the edges; the middle of a panel stays plain enough to read.
- **3. Soot and steam.** *Mood:* heavy, smoky, a little uneasy; the works have grown. *Motifs:* soot-dark metal, steam wisps, scorch marks, a cooler and darker palette. *Ornament:* the same brass, tarnished and darker, and one faint rune glint in one place only (a seam, a gauge face). This step **foreshadows rune tech**.

**Rune tech**: engineering with magic inside. The machines stay; runes go into them.

- **1. Etched slate.** *Mood:* still, precise, expectant; the inscriptions are there but nothing answers yet. *Motifs:* dark slate and stone, carved Elder Futhark lines (Runescript's alphabet, `WORLD.md` § Runescript), the wood and metal of the earlier eras worked into the frame. *Ornament:* runes cut into borders and corners, unlit: shown by their cut edges and shadow, no glow.
- **2. Waking runes.** *Mood:* alive, humming, careful; the first rune works. *Motifs:* cyan light at the edges of the cuts, conduit lines between runes. *Ornament:* the same carved borders, with cyan only along the rune edges and conduits; panels stay dark and plain.
- **3. Full rune tech.** *Mood:* sure, bright, a little strange. *Motifs:* violet and cyan glow on dark slate and metal, inscriptions that run the length of a border. *Ornament:* glowing rune bands on panel borders and corner pieces. Glow sits behind or beside text, never on it. What comes after rune tech is open, so this step foreshadows nothing yet.

### The rules

Art agents and the theme engine follow these; they are the owner's (#1717).

1. **The look changes when the Warden makes something new**, never on a rank number or a level. Each step's trigger is a made thing: brass appears with the first brass part, runes glow when the first rune works. The trigger list is #1723's; a step without a trigger is dev-preview only. (After *A Dark Room*.)
2. **An era boundary gets an age-up moment, and it is quiet:** a short beat, one journal line, then the new look fades in. **Steps inside an era drift without announcement:** no popup, no sound, no line. (After *Age of Empires*, softer.)
3. **Earlier eras stay visible.** The journal keeps its pencil-on-parchment look in every era, the drawn map stays hand-drawn, and old tools and items keep their colours and icons. A new era changes the frame around them and never repaints what the Warden already has. (After *Mistborn*.)
4. **The layout never changes, only colours and ornaments.** Every panel, button and list keeps its place and size in all nine looks. A look is a token set (colours, borders, ornament images), not a layout. Ornaments sit in margins, borders and corners and never cover text or a control. (After *Slay the Spire* and *Hollow Knight*.)
5. **Rune tech is engineering with magic inside**, learned through concepts like any craft. A rune is part of a tool, carved and built into it. Draw runes as cut lines, inlays and conduits in a made thing, never as free-floating sigils or sparkles. Canon: the rune-tech note in `docs/canon.md`. (After *Stormlight*'s fabrials.)
6. **Each era's last step foreshadows the next:** brass in the surveyor's frame, a rune glint in the soot. One small touch, not a preview of the whole next era.
7. **Players can keep a look they've reached.** A setting beside reduced motion holds the frame on any step already reached, never one not yet reached. So each step's art has to stand on its own: a player may stay there.

For all nine: text and controls meet the same contrast bar in every look (#1693), and `prefers-reduced-motion` turns glow, steam and fades into still images and instant swaps.

### Touchstones

One line each on what we take, and only that.

**Games**

- ***Age of Empires.*** Advancing to a new age is a deliberate moment, and buildings change their look with it. We take the age-up beat at an era boundary, made quieter.
- ***A Dark Room.*** It starts as a near-empty text screen, and new panels and words appear as the player builds and discovers. We take an interface that grows with what you've made.
- ***Slay the Spire.*** Each act has its own backdrop and colours while the screen's layout stays the same. We take same layout, new palette.
- ***Hollow Knight.*** Each area has a strong palette and mood of its own under an interface that doesn't move. We take a palette that carries the mood by itself.
- ***Arcanum: Of Steamworks and Magick Obscura.*** A fantasy world going through an industrial revolution, with technology and magic at odds. We take steam-age machines in a fantasy world; whether ours are at odds is the owner's question (#1725).
- ***Dishonored.*** An industrial city of pipes, gauges and grime, with a strange supernatural power beside the machines. We take the ornament language of industrial brass, and the grimier step.
- ***Frostpunk.*** A city in a frozen world, built around a coal-fired generator. We take steam as warmth and survival, a warm glow against cold dark, for soot and steam.

**Books**

- ***Mistborn*** (Brandon Sanderson). The series moves its world from one age into a later, industrial one, and the earlier age is still remembered there. We take a world told in eras, with the old era still present.
- ***The Stormlight Archive*** (Brandon Sanderson). Fabrials are devices built around gemstones that hold power, made by artisans as engineering. We take magic housed inside an engineered thing.
- ***Perdido Street Station*** (China Miéville). A grimy city where steam machines, science and thaumaturgy are parts of the same industry. We take magic and machines as one messy craft, and the grime.
- ***Raising Steam*** (Terry Pratchett). The railway comes to the Discworld. We take the wonder, and the humour, of a new machine arriving among people who've never seen one.
- **Jules Verne.** Machines like the Nautilus, described with an engineer's care and an explorer's wonder. We take instruments, gauges and the explorer's eye.
- ***The Wonderful Adventures of Nils*** (Selma Lagerlöf). Written as a geography reader for Swedish schoolchildren: the country seen from above, from a goose's back. We take the land seen as a map, for the cartographer step.

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
