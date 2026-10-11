# Peoples and Races — Canonical Naming

> **Status:** Decision recorded 2026-04-26. Resolves issue #709.

## Decision

There is **one race vocabulary** in Matlu: the **18 Mistheim Peoples**, the 15 first named in `WORLD.md` and scored in `AXES.md`, the Wildkin, and the two human Peoples, the Riksfolk and the Strandfolk (all added 2026-10-11, below).

| # | People | Notes |
|---|---|---|
| 1 | Bergfolk | Mountain hold-culture, runesmiths |
| 2 | Lövfolk | Long-lived elven Rasa healers |
| 3 | Markfolk | Orcs of the southern plains. Farmers, dry-comedy, Dignity-mode. Their fields grow east onto the steppe (#1620) |
| 4 | Viddfolk | Route-singers, high plains |
| 5 | Steinfolk | Stone-folk |
| 6 | Pandor | Panda-scholar archivists |
| 7 | Deepwalkers | Coastal/cave Keepers |
| 8 | Merfolk (Djupvolk) | Deep-water people |
| 9 | Goblins | Adaptive, in-band high-trust |
| 10 | Fae (Hollow Courts) | Layered, ancient, binding |
| 11 | Giants (the Seven) | Geological scale |
| 12 | Dragons | Territory, hoard, patience |
| 13 | Everstill | Vitstad archivists, preservation |
| 14 | Constructs | Made things; Bergfolk-built majority |
| 15 | Remnants | Inscrutable ancients |
| 16 | Wildkin | Beastkin clans (wolf, bear, fox, hawk, boar, cat, rabbit, snake); the Highfang and the Great Clans. Core Warden's homeland. |
| 17 | Riksfolk | Humans of the Realm (Riket), the setting bible's human lands on the Wildkin's eastern border: charters, the Landslag, a Marshal consolidating the kingdoms. The West March and the Stone Line (#1623) |
| 18 | Strandfolk | Humans of the harbour coast east of the delta: shipwrights and freighters, the Hamnlag of free harbour towns, storm-right (#1623) |

**Wildkin (owner, 2026-10-11, #1603):** the beastkin of Core Warden's setting bible (`macro-world/setting-corewarden.md`) are the 16th People, and their kingdom between the mountains and the sea is **the core area** of Mistheim. The `ikibeki` culture is theirs; Supabase keeps one ancestry per clan (`Wildkin (Wolf)`…) under `Wildkin`. They still need their `WORLD.md` section and `AXES.md` scoring (#1606).

**Humans and orcs (owner, 2026-10-11, #1623):** "There needs to be human peoples but also an orc people, you decide which is which." Decided: **the Markfolk are the orc People**, as `WORLD.md` already had it ("The Markfolk — orcs of the southern plains"), and **humans are their own Peoples**: the **Riksfolk** (#17), the human realm of the setting bible on the Wildkin's eastern border, and the **Strandfolk** (#18), harbour-coast humans, so humans aren't one realm. This undoes #709's folding of `human` into the Markfolk. Both names are Swedish-styled placeholders (*rike*, realm; *strand*, shore) until the owner reviews them. Supabase keeps the `human` ancestry as the umbrella `Humans`, with one ancestry per human People and a separate `markfolk` ancestry for the orcs (migration `20261011120000_human_peoples.sql`, not yet applied). The cultures that were human before #709 get the human Peoples back in their `racePreferences` (table below). Each has a `WORLD.md` section and an `AXES.md` scoring.

**Where humans come from (owner, 2026-10-11):** "Humans are not earth arrivals, some of their ancestors are but humans were here too. However all previous earthlings came without memories." Humans are native to Mistheim. Some of their ancestors came through with the Earth fragments, and every Earth arrival came without memory of Earth, so no human remembers Earth and most have an Earth ancestor somewhere in the line.

**What people know (owner, 2026-10-11):** "The people here do not know where those humans, the extra ones, came from. But throughout history there have been odd patches of extra humans in unexpected places. And sometimes human settlements have grown in strange ways." In the world, the Earth arrivals are a pattern nobody can explain, not a known fact: lore and history should show the patches and the strange growth, never the cause.

Race IDs use **TitleCase** to match `AXES.md` and the Peoples Notion DB (#625). Cultures (`macro-world/cultures.json`) reference Peoples by these IDs in `racePreferences`.

**Cultures are race-agnostic** (per `cultures.json` `_doc`) — a culture is a settlement style, not a People. `racePreferences` is a **soft weighted hint** to the settlement generator and may now contain **multiple Peoples with weights summing to ≤ 1.0**.

## Rationale

`cultures.json` previously used 19 race IDs invented incrementally by the settlement-generator agents (`dvergr`, `sylphari`, `chitinvavare`, `vandoda`, …). Of those:

- **2 already aligned** with the canon (`pandor`, `goblin`)
- **~6 had defensible matches** (`dvergr` ≈ Bergfolk, `sylphari` ≈ Lövfolk, `troll` ≈ Giants, `steppevarg` ≈ Viddfolk, `draak` ≈ Dragons, `korallfolk` ≈ Merfolk)
- **~12 were stale agent inventions** with no intended canonical status

Carrying two parallel taxonomies forward would have forced every downstream system (sprite spec, lore agents, codex) to maintain a translation table indefinitely. Reducing to one canon eliminates that overhead and gives the lore agents (which already use the WORLD.md/AXES.md naming) a single source of truth.

The 12 stale IDs are folded into the closest canonical People rather than promoted, per the design call "no real intended canon" for them. Where folding loses semantic information (e.g. `chitinvavare`'s insectoid trait set has no canonical analog), the *culture* is retired.

## Mapping (cultures.json racePreferences)

| Culture | Old `racePreferences` | New `racePreferences` | Since #1623 (human Peoples) |
|---|---|---|---|
| coastborn | `{ "human": 1.0 }` | `{ "Markfolk": 0.7, "Deepwalkers": 0.3 }` | `{ "Strandfolk": 0.6, "Deepwalkers": 0.3, "Markfolk": 0.1 }` |
| ridgefolk | `{ "human": 1.0 }` | `{ "Markfolk": 0.5, "Bergfolk": 0.5 }` | `{ "Bergfolk": 0.5, "Riksfolk": 0.3, "Markfolk": 0.2 }` |
| fieldborn | `{ "human": 1.0 }` | `{ "Markfolk": 1.0 }` | `{ "Markfolk": 0.6, "Riksfolk": 0.4 }` |
| wallborn | `{ "human": 1.0 }` | `{ "Markfolk": 0.5, "Bergfolk": 0.3, "Pandor": 0.2 }` | `{ "Bergfolk": 0.3, "Riksfolk": 0.3, "Markfolk": 0.2, "Pandor": 0.2 }` |
| mountainhold | `{ "dvergr": 1.0 }` | `{ "Bergfolk": 1.0 }` | unchanged |
| sylvan-enclave | `{ "sylphari": 1.0 }` | `{ "Lövfolk": 1.0 }` | unchanged |
| bazaar-folk | `{ "goblin": 1.0 }` | `{ "Goblins": 1.0 }` | unchanged |
| waterstead | `{ "pandor": 1.0 }` | `{ "Pandor": 1.0 }` | unchanged |
| steading | `{ "troll": 1.0 }` | `{ "Giants": 1.0 }` | unchanged |
| dragonkin-remnant | `{ "draak": 1.0 }` | `{ "Dragons": 1.0 }` | unchanged |
| reefborn | `{ "korallfolk": 1.0 }` | `{ "Merfolk": 1.0 }` | unchanged |
| steppe-camp | `{ "steppevarg": 1.0 }` | `{ "Viddfolk": 1.0 }` | unchanged |
| harborfolk | `{ "sjovandrare": 1.0 }` | `{ "Markfolk": 0.6, "Deepwalkers": 0.4 }` | `{ "Strandfolk": 0.5, "Deepwalkers": 0.4, "Markfolk": 0.1 }` |
| caravan-folk | `{ "sandhari": 1.0 }` | `{}` (no canonical desert People; sample regional demographics) | unchanged |
| windfarer-eyrie | `{ "vindfarare": 1.0 }` | `{ "Viddfolk": 0.7, "Bergfolk": 0.3 }` | unchanged |
| grovekin | `{ "rotfolk": 1.0 }` | `{ "Lövfolk": 1.0 }` | unchanged |
| workshop-collective | `{ "grynfolk": 1.0 }` | `{ "Bergfolk": 0.6, "Constructs": 0.4 }` | unchanged |
| crystal-resonance | `{ "kristallbundna": 1.0 }` | `{ "Fae": 1.0 }` | unchanged |
| refuge-keepers | `{ "vandoda": 1.0 }` | `{ "Remnants": 0.7, "Constructs": 0.3 }` | unchanged |
| ironborne-encampment | `{ "jarnborn": 1.0 }` | `{ "Steinfolk": 0.7, "Bergfolk": 0.3 }` | unchanged |
| thicket-dwellers | `{ "skogsvattar": 1.0 }` | `{ "Lövfolk": 1.0 }` | unchanged |
| **nestborne** | `{ "chitinvavare": 1.0 }` | **retired** (insectoid trait set has no canonical analog) | retired |

The #1623 column puts the human Peoples back where `human` stood before #709, keeping a share for the Markfolk, who have lived in those cultures in Artificer's villages since. The Reach's own copy of these weights (`src/artificer/world/peoples.ts`, `PEOPLES_OF`) follows this column since #1631 (owner, 2026-10-11), and a Reach culture with no humans (a Pandor waterstead, a Bergfolk hall) can still seat a human house now and then (`ODD_PATCHES`, the odd patches of extra humans above). The houses' Peoples change; the engine gives Peoples no biology and the told history doesn't name them, so the history itself stays the same.

Weights are first-pass and intended to be tuned later when settlement generation has visible output to balance against.

## Implications for in-flight work

- **#625 (Peoples DB)** — The Notion DB schema already uses TitleCase canonical names. No change needed. The 15 stub pages are the same 15 listed above.
- **#683–#702 (race-visual issues)** — Superseded. These were created with the kebab-case `cultures.json` IDs and a separate "Races DB" assumption. The canonical home for race visual fields is the Peoples DB (#625) — visual fields can be added as additional Peoples DB properties in a follow-up issue. The 19 child issues should be closed and a new fan-out filed against the 15 Peoples (or visual fields added inline to the Peoples lore fan-out).
- **#626 (lore-autofill prompt update)** — Not affected. The agent already uses Peoples canon.

## Open / deferred

- **Sandhari / desert peoples.** Mistheim canon currently has no desert People. If the world later acquires desert geography and culture, consider promoting a new People rather than re-adding `sandhari` ad-hoc.
- **Chitinvävare / insectoid niche.** Same — if a hive-mind or insectoid People is later wanted in the canon, add it deliberately, not as a settlement-gen byproduct.
- **Multi-race weights are first-pass.** Tune when settlement generation produces visible output and you can see whether the demographic mixes feel right.
- **Earth and Spinolandet peoples.** Not in scope here; AXES.md notes them as "score when canon firms up". When they do, this doc gets a sibling table.

## See also

- `WORLD.md` — primary creative source for Peoples
- `AXES.md` — cultural-axes scoring per People
- `LORE.md` — Notion DB IDs (Peoples DB added in #625)
- `macro-world/cultures.json` — settlement cultures (race-agnostic)
