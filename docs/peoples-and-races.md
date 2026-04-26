# Peoples and Races — Canonical Naming

> **Status:** Decision recorded 2026-04-26. Resolves issue #709.

## Decision

There is **one race vocabulary** in Matlu: the **15 Mistheim Peoples** named in `WORLD.md` and scored in `AXES.md`.

| # | People | Notes |
|---|---|---|
| 1 | Bergfolk | Mountain hold-culture, runesmiths |
| 2 | Lövfolk | Long-lived elven Rasa healers |
| 3 | Markfolk | Farmers, dry-comedy, Dignity-mode |
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

| Culture | Old `racePreferences` | New `racePreferences` |
|---|---|---|
| coastborn | `{ "human": 1.0 }` | `{ "Markfolk": 0.7, "Deepwalkers": 0.3 }` |
| ridgefolk | `{ "human": 1.0 }` | `{ "Markfolk": 0.5, "Bergfolk": 0.5 }` |
| fieldborn | `{ "human": 1.0 }` | `{ "Markfolk": 1.0 }` |
| wallborn | `{ "human": 1.0 }` | `{ "Markfolk": 0.5, "Bergfolk": 0.3, "Pandor": 0.2 }` |
| mountainhold | `{ "dvergr": 1.0 }` | `{ "Bergfolk": 1.0 }` |
| sylvan-enclave | `{ "sylphari": 1.0 }` | `{ "Lövfolk": 1.0 }` |
| bazaar-folk | `{ "goblin": 1.0 }` | `{ "Goblins": 1.0 }` |
| waterstead | `{ "pandor": 1.0 }` | `{ "Pandor": 1.0 }` |
| steading | `{ "troll": 1.0 }` | `{ "Giants": 1.0 }` |
| dragonkin-remnant | `{ "draak": 1.0 }` | `{ "Dragons": 1.0 }` |
| reefborn | `{ "korallfolk": 1.0 }` | `{ "Merfolk": 1.0 }` |
| steppe-camp | `{ "steppevarg": 1.0 }` | `{ "Viddfolk": 1.0 }` |
| harborfolk | `{ "sjovandrare": 1.0 }` | `{ "Markfolk": 0.6, "Deepwalkers": 0.4 }` |
| caravan-folk | `{ "sandhari": 1.0 }` | `{}` (no canonical desert People; sample regional demographics) |
| windfarer-eyrie | `{ "vindfarare": 1.0 }` | `{ "Viddfolk": 0.7, "Bergfolk": 0.3 }` |
| grovekin | `{ "rotfolk": 1.0 }` | `{ "Lövfolk": 1.0 }` |
| workshop-collective | `{ "grynfolk": 1.0 }` | `{ "Bergfolk": 0.6, "Constructs": 0.4 }` |
| crystal-resonance | `{ "kristallbundna": 1.0 }` | `{ "Fae": 1.0 }` |
| refuge-keepers | `{ "vandoda": 1.0 }` | `{ "Remnants": 0.7, "Constructs": 0.3 }` |
| ironborne-encampment | `{ "jarnborn": 1.0 }` | `{ "Steinfolk": 0.7, "Bergfolk": 0.3 }` |
| thicket-dwellers | `{ "skogsvattar": 1.0 }` | `{ "Lövfolk": 1.0 }` |
| **nestborne** | `{ "chitinvavare": 1.0 }` | **retired** (insectoid trait set has no canonical analog) |

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
