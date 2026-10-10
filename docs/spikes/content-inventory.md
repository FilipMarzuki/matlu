# Spike: content inventory (#1505)

What the game has, or plans to have, for items, recipes, concepts and resources, and which of it a player can reach today. The full table, one row per id, is generated: [`docs/content-inventory.md`](../content-inventory.md). Re-run it with `npm run content:inventory` whenever content changes; nothing in the table is hand-kept.

## Two games, two kinds of content

The repo has two places where a player meets this content, and they barely share any of it.

- **The Artificer** (`artificer.html`), the sim in active development. It defines its own content in code: 16 recipes, paid for in seven store goods (`rawFood`, `water`, `firewood`, `materials`, `rations`, `stone`, `hides`), plus the scout's pack (27 items) and two manuals. It reads `concepts.json`, but not the item registry or the 131-recipe file. Of the 177 registry items, it reaches one (`trap-snare`).
- **The Homestead** (`/`, the main menu's Play). It gathers from resource nodes and crafts through the crafting menu, which loads every registry recipe. Ten raw things can be gathered, and 15 recipes can actually be made.

Dev modes add little: Wilderview's shop sells three potions, and the `/crafter` testbed uses the old 34-recipe file.

| | Total | In the game | Conceptual |
|---|---:|---:|---:|
| Items | 225 | 68 (45 Artificer, 25 Homestead) | 154 |
| Recipes | 141 | 29 (16 Artificer, 15 Homestead) | 112 |
| Concepts | 34 | 15 | 19 |
| Resources | 18 | 13 | 5 |

Of the registries alone: **20 of 177 items** and **15 of 131 recipes** are reachable as written. Everything else is a plan.

## The two `recipes.json` files

`macro-world/recipes.json` (34 recipes) is an exact, older subset of `public/macro-world/recipes.json` (131 recipes plus 11 `_tier` section headers). The first came with the crafting prototype (e2cbf00b, May 3). The full tech tree (3b507964, May 7) was then written only to the `public/` copy. Every shared recipe is identical, and nothing exists only in the old file.

The game loads the `public/` one: the crafting menu and the Artificer's crafting tests read it. Only the `/crafter` testbed (`CrafterScene.ts`) still imports the old file. So the canonical file is `public/macro-world/recipes.json`, and the old one can go once `/crafter` points at it. The two `tinker-tray.json` files are identical copies in the same way, and nothing loads the root one. (Both old copies were removed in #1513, and `/crafter` now reads the canonical recipes.)

## A production bug

`macro-world/item-registry.json` isn't under `public/`, so Vite doesn't ship it, yet the Homestead, its crafting menu and BaseForge fetch `/macro-world/item-registry.json`. In dev, Vite serves the project root, so it works. In production, Vercel rewrites the miss to `index.html`; the live site returns HTML for that URL (checked). The crafting menu's JSON parse then throws, and it falls back to the small inline list in `CraftingMenuScene.loadFallbackData`: 11 concepts, 8 recipes and 9 materials. The Homestead's inventory also loses its stack limits and categories. So on corewarden.app, the Homestead runs on placeholder data. (Fixed in #1512: the registry is now bundled. The forge scenes' `building-registry.json` and `architecture.json` have the same problem; that's #1518.)

## Why the Homestead reaches so little

- **No coal.** The ore nodes drop iron and copper ore, but nothing gives coal, which blocks 24 recipes, the whole iron chain included. Nothing gives animal products either (`hide-raw`, `sinew`, `animal-fat`), so leather, bowstrings, glue and salves are out. The generated table ranks every missing raw material by how many recipes it would open.
- **Most discovery routes have no caller.** The crafting menu only crafts discovered recipes. Two unlocks work: innate recipes, and "memory" recipes that count crafts (`craft:copper-ingot:3`). Observation, teachers, experiments and the gather/hunt/weather counters are defined in `DiscoverySystem`, but nothing calls them. `trap-snare` and `purified-water` could be made from what's gathered, but they never unlock. (Since #1515, gathering counts toward memory triggers and the Pack tab has an Experiment button; observation, teachers and the other counters still have no caller.)
- **Stations aren't checked.** Smelter, smithy and kiln recipes (copper ingots, charcoal) craft anywhere. That's generous rather than blocking, but it means the station structures (`struct-*`) have no purpose yet.

## Concepts

15 of 34 can be reached:

- **Artificer (13):** the six it starts with (joinery, tension, sealing, leverage, sharpening, weaving); heat-treatment and toxicology, from answers and lessons; and alloys, counterweight, distillation, precision and pressure, which open once their prerequisites are studied.
- **Homestead only:** combustion and friction, through recipes it can make that use them.

The other 19 are conceptual. They include the arcane branch (inscription, resonance, conduit-craft, material-affinity), most of chemistry, the rotation → bearings → gear-train line, tanning, fermentation and preservation. Several, like bearings, are blocked only because a prerequisite (friction, rotation) has no way in through the Artificer.

## Resources

The Artificer's store goods and the Homestead's six node types are all in play. Five materials exist only as talk topics in the Artificer (`topics.ts`): iron, copper, salt, wood and mana-granite. People talk about them, and asking about iron even gives heat-treatment insight, but there's nothing to hold. Salt is in the item registry; it just isn't reachable anywhere.

## Duplicates, conflicts and loose ends

- **Six recipe ids mean two different recipes:** `stone-knife`, `bedroll`, `waterskin`, `crude-shovel`, `backpack` and `trap-snare` are paid in store goods in the Artificer, and in registry items (flint, hide-raw, rope…) in the registry. Their output items aren't in the item registry either, except `trap-snare`.
- **95 item ids and 83 recipe ids are named but never defined.** Most are recipe outputs missing from the item registry (`bread`, `compass`, `drone-chassis-small`…), plus concept `unlocks` that point at recipes that don't exist (`hardened-armor`, `tempered-tools`…). (Resolved in #1514: the items were added, and unbuilt `unlocks` moved to `futureUnlocks`.)
- **48 items in play aren't in the item registry:** the Artificer's pack, manuals, shelters, tools and carrying gear; the Homestead's starting `dry-grass`; and three things it crafts (`copper-tube`, `wire-copper`, `fire-starter`).
- **Five items are flagged NPC-only** (`playerObtainable: false`) but a player gets them: the three shop potions, `campfire` and `lean-to`.
- `item-registry.json` says `_stats.totalItems: 176` and holds 177.

**Specs not yet built.** `tinker-tray.json` is loaded by the crafting menu's Tinker Tray (its combos and modifiers). Its `activePerception` section has no reader. `src/ai/asset-spec.json` is the sprite-generation spec (183 item icons, 307 map objects). It's art pipeline, not game content, so it's out of this inventory.

## Follow-ups

Filed (none labelled `ready`; triage will size them):

- #1512: ship the item registry in the build, so the Homestead's crafting menu stops falling back in production.
- #1518: the same for the forge scenes' `building-registry.json` and `architecture.json` (found while fixing #1512).
- #1513: retire the duplicate registry files. Point `/crafter` at the canonical recipes, delete the old `recipes.json` and the root `tinker-tray.json`, and fix `_stats`.
- #1514: registry integrity. Add the missing recipe-output items, fix or drop dangling concept `unlocks`, correct the NPC-only flags, and add a unit test so references keep resolving.
- #1515: Homestead, wire the discovery routes that have no caller.
- #1516: Homestead, a coal source and animal drops, so its ore and hunting lead somewhere.

**Decided (2026-10-10).** The owner: "Just use raw meat, for now. Let's keep it simple; we can diversify later. Same for items and resources. Let's try to polish the mechanics before expanding too much." So `raw-meat` is the one meat item (`game-meat` was dropped in #1523), and new item or resource variety waits until the mechanics are polished. #1516 was narrowed to a coal source (animal drops deferred), the talk-only materials stay as lore, and the `futureUnlocks` ideas stay parked.

Left for the owner (game design, not implementation):

- **One content model or two?** The Artificer runs on store goods and its own recipes; the registries describe a 131-recipe tech tree that only the Homestead touches. Should the Artificer move onto the registry's items as it grows, should the registry be cut back to what the Artificer needs, or should they stay separate games?
- **Talk-only materials.** Should iron, copper and salt become something the Warden can hold (a store good, or a trader's item), or stay as lore for now?
