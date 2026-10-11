# Canon sources: where the master copy lives

**Issue:** #1638 · **Audited:** 2026-10-11, against `origin/main` at `4f3edcc2`, the live Supabase project (read-only selects) and the repo's Notion scripts and prompts (Notion itself was not called).

The owner (2026-10-11): "any master canon we use needs to be accessible and updatable via agents."

## The rule

1. **The master copy of any canon lives where an agent can read it and change it through a reviewed path:** a repo file, changed by PR; or a Supabase table, changed by a migration file in `supabase/migrations/`, merged by PR and then applied.
2. **Notion and other stores are mirrors**, synced from the repo, unless this page lists them as agent-writable masters with a documented path.
3. **A mirror is never edited by hand** to change canon. Change the master, then re-run the sync.
4. When two copies disagree, the one this page names as master wins, and the other gets re-synced.
5. Existing rule (#1531, CLAUDE.md): **the Artificer is the master for materials and concepts.** `src/artificer/content-ownership.test.ts` fails if Artificer code reads the Homestead's draft registries, and pins those drafts by hash.

A new canon source gets a row here in the PR that adds it.

## How agents reach each store

| Store | Read | Write (reviewed path) | Who has the credentials |
| --- | --- | --- | --- |
| **Repo file** | Any session or workflow with a checkout | PR, through DevCycle 2–4 (CI, risk review, review agent, merge gate) | Everyone. Nightly dev agent pushes with `GH_TRACKER_TOKEN`. |
| **Supabase table** | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (or the publishable key where RLS allows `select`), or the Supabase MCP `execute_sql` / `list_tables` | A migration file in `supabase/migrations/` by PR, then applied with the Supabase MCP `apply_migration`. Data-only changes go in a migration too (see `20261011090000_ancestry_canon_names.sql`). After applying, `npm run macro:export` refreshes the JSON mirrors, committed by PR. | Service key: workflow secrets (stats, submission-to-entity, lore autofill, playtest upload, token logging); not given to the nightly dev agent's session. `apply_migration`: sessions with the Supabase connector (the owner's interactive sessions; the submission-to-entity workflow allows it). **No workflow applies merged migrations.** |
| **Notion** | REST API with `NOTION_API_KEY`, or the Notion MCP where the connector is attached | REST API or MCP. **No PR review**: the guard is `Lore Status` (`draft` until a person sets `final`) and "never delete, set `deprecated`" (`LORE.md`). | `NOTION_API_KEY`: lore autofill, lore from features, submission-to-entity, the nightly dev agent, stats/release-notes/learning/perf-log/roadmap/blog/diagram workflows, and the Codex build. Not in CI or in cloud sessions without the connector. |

## The audit

**Master** = the copy you change. **Mirror** = generated or synced from a master. **Derived** = hand-written from another source, owned by its consumer (it cites the source, and can lag it).

### World and Peoples (repo docs)

| Source | Holds | Status | Agent read / write |
| --- | --- | --- | --- |
| `WORLD.md` | World bible: premise, themes, magic (Rasa, Runescript), the 18 Mistheim Peoples' sections, nations, visual identity, resources | **Master** for world prose and each People's narrative canon | Repo file / PR |
| `docs/peoples-and-races.md` | The People vocabulary (18 TitleCase IDs), owner decisions (#709, #1603, #1606, #1623), the culture → People mapping for `racePreferences` | **Master** for which Peoples exist and their IDs | Repo file / PR |
| `AXES.md` | The cultural-axes framework (four axes plus Honor/Dignity/Face) and per-People scores | **Master** for the framework. **Scores: master unclear** (see gap G1): the file says the live values are on Notion Culture DB entries | Repo file / PR |
| `LORE.md` | Notion database and page IDs, Notion agent conventions | **Master** for the Notion index. Its opening line ("Canonical lore lives in Notion") predates this rule; read it as "the Notion lore DBs" (below) | Repo file / PR |
| `docs/race-and-culture.md` | Information model: Race, Culture, Faction, Character and their homes | **Master** for the model; its "Culture canonical home: `macro-world/cultures.json`" is out of date, since that file is an export of Supabase (gap G4) | Repo file / PR |
| `docs/WORLD_LORE.md` | The nine corruption boundaries (Swedish) | **Master** for that early lore; partly superseded by `WORLD.md` | Repo file / PR |
| `macro-world/setting-corewarden.md` | Core Warden's setting bible: the Wildkin kingdom, the Highfang, its threats | **Master** for the Wildkin core area alongside `WORLD.md` (which says the bible stays canon for the Wildkin) | Repo file / PR |
| `docs/culture-lore.md` | How `peoples-lore.json` and `cultures-lore.json` are built and read | Documentation for the Artificer files below | Repo file / PR |

### Macro-world data (`macro-world/*.json`, `public/macro-world/*.json`) and Supabase

The settlement and ancestry data lives in Supabase; the repo holds JSON exports of it (`npm run macro:export`, `scripts/export-macro-world.mjs`, each file stamped "Exported from Supabase. Do not edit"). The seed scripts go the other way: `npm run macro:import` (`scripts/seed-macro-world.mjs`) and `scripts/seed-macro-world-phase2.mjs` insert rows from those JSON files with the service key, and phase 2 copies ancestry body columns from `data/notion-races-cache.json`.

| Source | Holds | Status | Agent read / write |
| --- | --- | --- | --- |
| Supabase `ancestries` (36 rows) | Ancestry slugs and names, climate ranges, clustering, mixing, naming base, body and sprite columns, lifespan. Includes the Wildkin and one row per clan; still holds the retired agent-invented ancestries (`sandhari`, `jarnborn`, `troll`…) | **Master** | Migration by PR, then `apply_migration`. Read: MCP or service key |
| Supabase `cultures` (22), `culture_traits` (25), `culture_trait_assignments`, `culture_ancestry_preferences` (38), `culture_architecture_assignments` | The 22 settlement cultures' layout fields, traits, People weights, architecture | **Master** (no axis columns: cultural axes aren't here) | Same |
| Supabase `biomes` (13), `geographic_features` (27), `ancestry_biome_affinities`, `ancestry_feature_bonuses` | Where each ancestry lives | **Master** | Same |
| Supabase `architecture_styles` (21), `architecture_blocks`, `fashion_styles` (22), `fashion_variants`, `buildings` (58), `building_architecture_availability`, `population_archetypes` (73) | Architecture, fashion, buildings, who works in them | **Master** (buildings: unclear, gap G3) | Same |
| `macro-world/cultures.json`, `culture-traits.json`, `race-affinities.json`, `fashion.json`, `population-archetypes.json`; `public/macro-world/architecture.json` | Exports of the tables above | **Mirror** of Supabase. Note: `cultures.json` and `race-affinities.json` already show the human Peoples split, whose migrations (`20261011120000_human_peoples.sql`, `20261011180000_human_peoples_bodies.sql`) are not applied, so today the mirror is ahead of its master (gap G2) | Regenerate with `npm run macro:export` (service key), commit by PR |
| `public/macro-world/building-registry.json` | Every building a settlement can have (58), sprite variants | **Master unclear** (gap G3): written by the Building Forge's dev save (`/__save-registry`, `vite.config.ts`) *and* by `macro:export` from Supabase `buildings`; mirrored to the Notion Building Registry. The Artificer's Reach settlements read it (#1541) | Repo file / PR (Forge save) |
| `macro-world/races.json` | Base presentation (stature, skeleton, voice…) for the first 15 Peoples; not the Wildkin, Riksfolk or Strandfolk | **Master** for presentation, behind the People list (gap G6) | Repo file / PR |
| `macro-world/npc-presentation.json`, `npc-asset-tracker.json`, `ui-spec.json`, `shop-inventories.json` | NPC overlays, NPC asset status, crafting UI spec, Homestead shops | **Master** (game data rather than canon) | Repo file / PR |
| `macro-world/item-registry.json`, `public/macro-world/recipes.json`, `public/macro-world/concepts.json` | The Homestead's items, recipes, concepts | **Frozen drafts** (#1531). Not canon for new work; pinned by hash in `content-ownership.test.ts` | Change only with a re-pin in the same PR, and a reason |
| `public/macro-world/fauna-registry.json`, `trees.json`, `resource-nodes.json`, `groundcover.json`, `plot-registry.json` | Wildlife, trees, nodes and plots for the Phaser game | **Master** (game data) | Repo file / PR |

### Artificer content (`src/artificer/content/*.json`) and code-held canon

The Artificer is the master for materials and concepts (CLAUDE.md, #1531), and owns the rest of its content. Most of it is derived from the world docs: every claim in `peoples-lore.json` names its source (`WORLD.md` § heading), and `invented: true` marks what canon doesn't say.

| Source | Holds | Status | Agent read / write |
| --- | --- | --- | --- |
| `src/artificer/content/concepts.json` | The 34 concepts, their requirements and unlocks | **Master** (#1531) | Repo file / PR; `content-ownership.test.ts` checks the sim reads it |
| `src/artificer/content/peoples-lore.json` | What each of the 18 Peoples values, shames, does and believes about the others | **Derived master** for the Artificer's claims, from `WORLD.md` / `AXES.md` | Repo file / PR |
| `src/artificer/content/cultures-lore.json` | The same for the 12 road cultures; ids and names are `cultures.json`'s | **Derived master** | Repo file / PR |
| `src/artificer/content/scope-facts.json` | Facts everyone in a village, road, trade or skill knows | **Master** (Artificer) | Repo file / PR |
| `src/artificer/content/organisations.json` | Organisations on the road and what members know (placeholders for owner review) | **Master** (Artificer) | Repo file / PR |
| `src/artificer/content/classes.json` | Every Mistheim [Class]: kind, holders, WORLD.md source, dates; a test keeps it in step with WORLD.md (#1637, `docs/class-registry.md`) | **Master** (Artificer) | Repo file / PR |
| `src/artificer/content/ties.json` | Ties between the road's people (kin, friends, rivals, debts) and what each says of the other (placeholders for owner review, #1588) | **Master** (Artificer) | Repo file / PR |
| `src/artificer/region1.ts`, `kit.ts`, `trade.ts`, `techniques.ts` | Materials, recipes, items, techniques | **Master** (#1531) | Repo file / PR (code, so CI and tests) |
| `src/artificer/villages.ts` | The road villages, their people (People, culture, role), lore lines | **Master** for those places and people | Repo file / PR |
| `src/artificer/economy.ts` | Each road village's dominant, secondary and founding trade | **Master** for the road villages' economies; generated places come from the story engine | Repo file / PR |
| `src/artificer/world/peoples.ts` | The Reach's cultures as engine data (names, temperament, succession law) and which Peoples follow them | **Derived master**, from `docs/peoples-and-races.md` | Repo file / PR |
| `src/artificer/world/provinces.ts`, `organisations.ts`, `local-history.ts`, `regional-facts.ts` | The generated Reach and its history | **Generated** from seeds; masters are the code and the specs it reads | Repo file / PR |

### Storytelling engine

| Source | Holds | Status | Agent read / write |
| --- | --- | --- | --- |
| `storytelling/world-spec.ts` (`DEFAULT_SPEC`) | The engine's default three-realm tableau: provinces, houses, cultures, races | **Master** for the engine's test world, not Mistheim canon. Byte-stable: changes move golden hashes (`testkit.ts`) | Repo file / PR (risk:high when hashes move) |
| `storytelling/worlds/frontier.ts` | The "Ibiki heartland" frontier world with its Horde, Empire of Zafran and faiths | **Master** for an engine scenario; it predates the Wildkin canon and differs from it (faiths, a Khaganate), so don't read it as canon (gap G7) | Repo file / PR |
| `storytelling/specs/*.ts` | Event templates by domain (court, siege, trade…) | **Master** for event shapes | Repo file / PR |
| `storytelling/README.md` | The engine's design; "the simulation is the source of truth, the LLM a renderer" | Documentation | Repo file / PR |

### Entities and creatures

| Source | Holds | Status | Agent read / write |
| --- | --- | --- | --- |
| `src/entities/entity-registry.json` | Every game entity, its personality and `designNotes` | **Master** ("source of truth for entity completeness") | Repo file / PR; Entity Spec Fill writes `designNotes` by commit |
| Supabase `creature_submissions`, `creature_status_history` | Community creature submissions and pipeline state | **Input, not canon** until submission-to-entity turns one into an entity spec, a Notion Creatures page and an issue | Service key (workflow), Codex API |

### Notion

IDs are in `LORE.md`. Writers found by grepping `.github/workflows`, `.github/scripts`, `.agents/`, `scripts/` and `wiki/src`.

| Notion source | Holds | Status | Who reads / writes |
| --- | --- | --- | --- |
| **Races DB** (`34e843c0…`; called the Peoples DB in #625 and the lore prompt) | Biology, visual canon, origin narrative, relations per People; `RACE-N` IDs | **Master by practice, partly backed by the repo**: `scripts/races-<people>-content.mjs` hold the page bodies and properties, pushed by `scripts/races-push-<people>.mjs` (`NOTION_API_KEY`, run by hand). There is no push script for the Wildkin, Riksfolk or Strandfolk, and edits made in Notion don't flow back except through the cache (gap G5) | Read: lore autofill (first query of every run), `npm run races:sync`. Write: the push scripts |
| `data/notion-races-cache.json` | Snapshot of the Races DB (28 rows, synced 2026-04-27, includes deprecated entries) | **Mirror** of Notion, stale. `seed-macro-world-phase2.mjs` copies its body fields into Supabase `ancestries` | `npm run races:sync` (`NOTION_API_KEY`), commit by PR |
| **Cultures DB** (`2928281c…`) | Ways of living; `CULT-N`; one `default-of-race` Culture per People carries the **axis scores** | **Master per `AXES.md` and `LORE.md`, not agent-updatable through review** and with no repo copy of the live values (gap G1). The lore autofill prompt reads axis scores from the Peoples/Races DB instead, so the three sources disagree on where scores live | Read: lore agents (via `LORE.md`). Write: no script in the repo; by hand or MCP |
| **Creatures DB** (`4c71181b…`) | All fauna lore pages | **Agent-writable master** for creature lore prose (draft → final) | Write: submission-to-entity (step 12), lore autofill (balanced submissions), lore from features, the Codex `create-lore-page` / `create-lore-entry` admin API. Read: Codex build (`wiki/src/lib/notion-lore.ts`) |
| **Characters**, **Factions**, **Locations**, **Worlds** DBs | Named NPCs, organisations, places, the worlds | **Agent-writable master** for lore prose (draft → final) | Write: lore autofill, lore from features (`NOTION_API_KEY`). Read: Codex build |
| **Settlement Approaches**, **Architecture**, **Culture–Architecture Affinities**, **Building Registry** DBs | Settlement layout, architecture, buildings | **Mirrors** (`LORE.md`: they mirror `cultures.json` and `building-registry.json`); the Supabase tables are the masters. No sync script in the repo: they were seeded once and drift | None found in the repo |
| Dev Blog, Concept Art, Stats, Weekly Dispatch, Release Notes, Learning Summary, Agent Performance Log, Roadmap pages | Reports and posts | **Not canon** (outputs) | Their workflows |

## Gaps

Each is a source that is master but not agent-updatable through a reviewed path, or whose master is unclear. Each is to get its own follow-up issue (#1638).

| # | Gap | Fix |
| --- | --- | --- |
| G1 | **AXES scores**: `AXES.md` and `LORE.md` say the live values are on Notion Culture DB entries; the lore autofill prompt reads them from the Peoples/Races DB; `AXES.md` holds a table that "may drift". Three places, no reviewed path for the one called master | Make `AXES.md` (or a JSON beside it) the master; sync to Notion; fix the prompt |
| G2 | **Supabase migrations aren't applied by any workflow**, and the live DB holds 12 Wildkin/ikibeki migrations (2026-05-01) with no file in `supabase/migrations/`. The repo's exports are ahead of the DB (human Peoples), the DB is ahead of the repo (Wildkin) | Back-fill the missing migration files from the live schema and data; apply merged migrations by a workflow or a documented post-merge step; check drift in CI |
| G3 | **Buildings**: `building-registry.json` is written by the Building Forge and overwritten by `macro:export` from Supabase `buildings`; Notion keeps a third copy | Pick one master (the Forge's file, with Supabase seeded from it, or Supabase with the Forge writing a migration) |
| G4 | **Cultures direction**: `cultures.json` is an export, but `docs/race-and-culture.md` calls it the canonical home, the Building Forge and the Artificer read its layout fields as their own, and the seed scripts insert from it | State Supabase as master in those docs, or move the master to the file |
| G5 | **Races DB (Peoples) in Notion**: biology and visual canon are pushed from `scripts/races-*-content.mjs` by hand, nothing for the three newest Peoples, the cache is from April, and Notion-side edits never come back to the repo | Make the content files the master (all 18 Peoples), sync to Notion by workflow, refresh the cache |
| G6 | `macro-world/races.json` covers 15 Peoples, not 18 | Add the Wildkin, Riksfolk and Strandfolk |
| G7 | `storytelling/worlds/frontier.ts` and `DEFAULT_SPEC` predate the Mistheim canon (faiths, an orc/human Horde) and read like canon to an agent | Say in their headers that they're engine scenarios, not canon |
| G8 | Notion lore DBs (Creatures, Characters, Factions, Locations, Worlds) are agent-writable but unreviewed and unreadable without `NOTION_API_KEY` or the connector (CI has a placeholder key) | Keep them as documented agent-writable masters, or export them to the repo on a schedule so every agent can read them |
