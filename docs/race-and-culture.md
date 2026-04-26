# Race, Culture, Faction — taxonomy

> **Status:** Decision recorded 2026-04-26. Resolves issue #709.
> Supersedes the earlier "peoples and races" framing.

## The three core entities

| Concept | What it is | Master location | Cardinality | Example |
|---|---|---|---|---|
| **Race** | Biological identity (anatomy, sprite silhouette, lifespan) **plus** the origin **People** narrative — the founding story of who they are | Race DB (Notion, supersedes the planned Peoples DB in #625) | ~15 | Bergfolk |
| **Culture** | A way of living shared by a group, possibly multi-race. Includes settlement cultures, organizational cultures (guild, faction, corporate), national cultures, and movements | Culture DB (Notion, new) | open | "Bergfolk hold-culture", "Compact of Knowing scholar-culture", "coastborn village-culture", "Wandering People diaspora-culture" |
| **Faction** | An organized group | Factions DB (existing) | open | Compact of Knowing, Vidde Accords |

Plus one supporting code-level artifact:

| Artifact | What it is | Where |
|---|---|---|
| **Settlement-culture defs** | Code-level subset of Culture entries, used by the settlement generator. Architectural / spatial style | `macro-world/settlement-cultures.json` |

## Relations

- A **Race has a People** — the origin/founding narrative — modelled as **content** on the Race row (a "People" section), *not* a separate DB.
- A **Culture is attached to** any of: a Race (its default/origin culture), a Faction (its organizational culture), a settlement (its way-of-living), a guild, a corporation. One Culture can be attached to many things; one thing can have one Culture (typically) plus inherit from its Race's default Culture.
- A **Faction has a Culture** (relation field on the Factions DB).
- A **settlement has a Culture** — driven by `settlement-cultures.json` entries with weighted Race preferences.

## Cultural axes belong to Culture, not Race

`AXES.md` currently scores cultural axes (Tradition ↔ Reason, Tight ↔ Loose, etc.) against the 15 "Peoples". Those axes describe **ways of living**, not biology. They belong on **Cultures**, not Races.

Each Race has a default Culture (e.g. *the dominant Bergfolk culture*). The existing AXES.md scores describe those default cultures — they should be moved onto Culture DB entries, and revisited during the move (some scores may shift now that the framework is properly scoped).

A character's effective values then layer correctly:

```
character_values  ≈  default_culture(of-race)
                  + culture(of-faction-membership)
                  + personal_deviation (Big Five)
```

## What this PR changes

This PR (#711) makes the smallest set of changes consistent with the model:

- Renames `macro-world/cultures.json` → `macro-world/settlement-cultures.json`. The file's `_doc` makes clear it is a **settlement-culture** subset of the master Culture concept, and that race IDs in `racePreferences` come from the Race canon.
- Renames the previous draft doc `docs/peoples-and-races.md` → `docs/race-and-culture.md` (this file).
- Updates `LORE.md`, `CLAUDE.md`, `src/world/SettlementSpec.ts`, and `docs/spikes/sprite-recolor.md` to reference the new filename and conventions.
- The Race ID rename in `racePreferences` (kebab old-IDs → TitleCase canonical) from the earlier draft is preserved.

## Mapping (settlement-cultures.json racePreferences)

`racePreferences` keys are now the 15 canonical Race IDs (TitleCase). Multi-race weighted mixes are allowed since cultures are race-agnostic.

| Settlement culture | Old `racePreferences` | New `racePreferences` |
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
| caravan-folk | `{ "sandhari": 1.0 }` | `{}` (no canonical desert Race; sample regional demographics) |
| windfarer-eyrie | `{ "vindfarare": 1.0 }` | `{ "Viddfolk": 0.7, "Bergfolk": 0.3 }` |
| grovekin | `{ "rotfolk": 1.0 }` | `{ "Lövfolk": 1.0 }` |
| workshop-collective | `{ "grynfolk": 1.0 }` | `{ "Bergfolk": 0.6, "Constructs": 0.4 }` |
| crystal-resonance | `{ "kristallbundna": 1.0 }` | `{ "Fae": 1.0 }` |
| refuge-keepers | `{ "vandoda": 1.0 }` | `{ "Remnants": 0.7, "Constructs": 0.3 }` |
| ironborne-encampment | `{ "jarnborn": 1.0 }` | `{ "Steinfolk": 0.7, "Bergfolk": 0.3 }` |
| thicket-dwellers | `{ "skogsvattar": 1.0 }` | `{ "Lövfolk": 1.0 }` |
| **nestborne** | `{ "chitinvavare": 1.0 }` | **retired** (insectoid trait set has no canonical analog) |

Weights are first-pass and intended to be tuned later when settlement generation has visible output to balance against.

## Follow-ups (not in this PR)

These deserve their own issues:

1. **Rename Peoples DB → Race DB on issue #625**, and adjust its scope: biology + visual + origin People narrative (not cultural axes). The 15 stub entries are the canonical Races.
2. **Create the Culture DB in Notion** (new infra issue). Schema modelled on AXES.md axis fields + Mode + Top values + a `Type` field (settlement / organizational / movement / national / guild / etc.) + relations to Race (for default cultures), Faction, etc.
3. **Move AXES.md scores to the Culture DB and revisit them.** Each of the 15 existing Race entries gets a corresponding "default Culture of \<Race\>" entry in the Culture DB carrying the (possibly revised) axis values.
4. **Add a `Culture` relation property to the Factions DB** and backfill existing Factions.
5. **Sync option (optional, future):** add a sync between `settlement-cultures.json` and the Culture DB so the master DB sees settlement cultures alongside organizational/movement cultures. Defer until there's actual non-settlement Culture content in Notion.
6. **Reduce / relabel issues #683–#702** (the 19 race-visual issues) to 15, target the new Race DB, and use canonical TitleCase IDs.

## See also

- `WORLD.md` — primary creative source
- `AXES.md` — cultural-axes scoring; will be re-rooted to Culture entries via follow-up #3
- `LORE.md` — Notion DB IDs and agent conventions
- `macro-world/settlement-cultures.json` — code-level settlement-culture defs, race-agnostic
