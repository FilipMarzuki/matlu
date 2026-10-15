# Canon sources: where the master copy lives

**Issue:** #1638 · **Audited:** 2026-10-11, against `origin/main` at `4f3edcc2`, the live Supabase project (read-only selects) and the repo's Notion scripts and prompts (Notion itself was not called). Macro-world section and G2/G4 updated 2026-10-12 (#1642).

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
| **Supabase table** | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (or the publishable key where RLS allows `select`), or the Supabase MCP `execute_sql` / `list_tables` | A migration file in `supabase/migrations/` by PR, then applied after the merge with the Supabase MCP `apply_migration` ([the post-merge step](#applying-merged-migrations-post-merge-step)). Data-only changes go in a migration too (see `20261011090000_ancestry_canon_names.sql`). For the macro-world tables the migration is generated from the JSON: `npm run macro:sync` (#1642), and `npm run macro:export` checks the database against the JSON afterwards. | Service key: workflow secrets (stats, submission-to-entity, lore autofill, playtest upload, token logging); not given to the nightly dev agent's session. `apply_migration`: sessions with the Supabase connector (the owner's interactive sessions; the submission-to-entity workflow allows it). **No workflow applies merged migrations**: it's a documented operator step (below). |
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
| `docs/local-culture.md` | Design (#1739): how a culture's style varies by realm, region, province and village, and the reason for each difference | Design only. Its data file (proposed `macro-world/culture-styles.json`) gets its own row when it's added | Repo file / PR |

### Macro-world data (`macro-world/*.json`, `public/macro-world/*.json`) and Supabase

**The repo JSON is master; Supabase is generated from it** (owner decision, 2026-10-12, #1642). The six files `macro:export` used to write from Supabase (`cultures.json`, `race-affinities.json`, `culture-traits.json`, `fashion.json`, `population-archetypes.json`, `public/macro-world/architecture.json`) are changed by PR. In the same PR, `npm run macro:sync` (`scripts/macro-sync.mjs`) turns the change into a migration file in `supabase/migrations/` (`<timestamp>_macro_sync[_name].sql`), applied after the merge. Nothing edits these tables directly any more.

- **What it writes.** Upserts by slug (or culture, or building and role) for the entities the JSON change touches, each guarded by `is distinct from`, so a second run changes nothing; each touched entity's child rows (biome scores, feature bonuses, People weights, traits, blocks, fashion variants, archetypes) are made exactly the JSON's. It uses `scripts/export-macro-world.mjs`'s table and column mapping in reverse (`scripts/lib/macro-sync-core.mjs`, tested in `src/macro-sync.test.ts`).
- **Deletes are guarded.** A row is deleted only when the JSON removed it in this change (against `origin/main`) *and* `--allow-delete` is passed, because deleting an ancestry, culture or style cascades to rows the JSON doesn't hold (body columns go with the row; `culture_architecture_assignments`, `building_architecture_availability`). Rows the JSON never had are never deleted; the check reports them.
- **Only the columns the JSON carries.** The JSON doesn't hold the ancestries' body and sprite columns (`body_plan` … `lifespan`), the biome and feature names, `culture_architecture_assignments`, `buildings` or `building_architecture_availability`. The sync leaves those as they are; they stay Supabase-master, changed by a hand-written migration (gap G9).
- **The check.** `npm run macro:export` is now `macro-sync.mjs --check`: it reads the live tables (with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`; without them it says so and exits 0), runs them through the old export mapping, and lists entities missing live, differing, or live only. Exit 1 on drift. Without the key, dump the tables with the Supabase MCP (`node scripts/macro-sync.mjs --print-dump-query`, run it with `execute_sql`, save the result) and pass `--live-dump <file>`.
- `node scripts/macro-sync.mjs --verify` fails when a branch's JSON change and its sync migration don't match (no network; it needs `origin/main` fetched). It isn't wired into CI yet.
- `--full` writes every entity, for a new database or to repair drift the check found.
- `scripts/export-macro-world.mjs` (overwrite the JSON from Supabase) now refuses to run without `--overwrite-masters`: recovery only. The seed scripts (`npm run macro:import`, `scripts/seed-macro-world.mjs`, `seed-macro-world-phase2.mjs`) write the tables directly and refuse without `--empty-database`.

| Source | Holds | Status | Agent read / write |
| --- | --- | --- | --- |
| Supabase `ancestries` (36 rows) | Ancestry slugs and names, climate ranges, clustering, mixing, naming base, body and sprite columns, lifespan. Includes the Wildkin and one row per clan; still holds the retired agent-invented ancestries (`sandhari`, `jarnborn`, `troll`…) | **Generated** from `race-affinities.json` for the columns it holds. **Master** for the body and sprite columns, which the JSON doesn't hold (gap G9) | `npm run macro:sync` migration by PR (body columns: a hand-written migration), applied after merge. Read: MCP or service key |
| Supabase `cultures` (22), `culture_traits` (25), `culture_trait_assignments`, `culture_ancestry_preferences` (38), `culture_architecture_assignments` | The 22 settlement cultures' layout fields, traits, People weights, architecture | **Generated** from `cultures.json` and `culture-traits.json` (no axis columns: cultural axes aren't here). `culture_architecture_assignments` isn't in any JSON, so it stays **master** here (gap G9) | Same |
| Supabase `biomes` (13), `geographic_features` (27), `ancestry_biome_affinities`, `ancestry_feature_bonuses` | Where each ancestry lives | **Generated** from `race-affinities.json` (scores; biome and feature rows are added when missing, their names aren't synced) | Same |
| Supabase `architecture_styles` (21), `architecture_blocks`, `fashion_styles` (22), `fashion_variants`, `buildings` (58), `building_architecture_availability`, `population_archetypes` (73) | Architecture, fashion, buildings, who works in them | **Generated** from `architecture.json`, `fashion.json`, `population-archetypes.json`. `buildings` and `building_architecture_availability`: not synced (buildings: unclear, gap G3) | Same |
| `macro-world/cultures.json`, `culture-traits.json`, `race-affinities.json`, `fashion.json`, `population-archetypes.json`; `public/macro-world/architecture.json` | Settlement cultures, traits, ancestries' climate and People weights, architecture, fashion, population archetypes | **Master** (#1642). Checked 2026-10-12 (read-only): the live tables match them except the human Peoples split, whose migrations (`20261011120000_human_peoples.sql`, `20261011180000_human_peoples_bodies.sql`) are merged but not applied (gap G2) | Repo file / PR, with the `npm run macro:sync` migration in the same PR |
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
| `src/artificer/content/ties.json` | Ties between the road's people (kin, friends, rivals, debts, and one-sided grudges, #1659) and what each says of the other (placeholders for owner review, #1588) | **Master** (Artificer) | Repo file / PR |
| `src/artificer/content/claims.json` | Rumours, lies with a reason, and what people make claims about (the journal's propositions), #1580; placeholders for owner review. Only the `true` claims are held to canon (the owner's answer 6 in `docs/knowledge-model-design.md`): a lie or a drifted rumour may contradict it | **Master** (Artificer) | Repo file / PR; `claims.test.ts` checks each source line is there and each motive holds in the data |
| `src/artificer/content/claims.json` › `tellers`, and the rumours with `feature: rumour-drift` | How the road cultures the story engine has no `biasSeed` for tell a rumour (bias seeds in the engine's `PerceptualBias` words), a debt with a name that swaps, and a Compact secret that leaks, #1589; placeholders for owner review. The Reach's five cultures' biases stay in `world/peoples.ts`, read by both the history and the road | **Master** (Artificer) for the seven road cultures' telling biases; **derived** from `cultures-lore.json` lines, each cited | Repo file / PR; `rumour-drift.test.ts` checks each source line is there, every road culture has biases, and every bias is the engine's |
| `src/artificer/claims.ts` `TELLING_BENDS` | How each of the story engine's biases bends a rumour on the road (grows it, vouches for it, holds the place, the teller's own line), #1589; the lines are placeholders | **Master** (Artificer) for the road's reading of the engine's bias vocabulary; keyed by `storytelling/types.ts` `PerceptualBias`, so a new engine bias fails to compile until it has a bend | Repo file / PR (code) |
| `src/artificer/content/lifespans.json` | Each of the 18 Peoples' lifespan as a number (the middle of canon's range), or `unbounded` where canon gives none (Fae, Giants, Dragons, Everstill, Constructs, Remnants), #1650. Merfolk and Wildkin have no figure in canon and take the story engine's human baseline (75, `storytelling/biology.ts`), marked `default` | **Derived** from Supabase `ancestries.lifespan` (master, text) through its repo copies: `scripts/races-<people>-content.mjs` › lifespan, and for the Riksfolk and Strandfolk `supabase/migrations/20261011180000_human_peoples_bodies.sql` (not yet applied, gap G2). Each entry cites its file and quotes its words. The `race-affinities.json` mirror doesn't carry lifespan | Repo file / PR; `old-history.test.ts` checks every quote is in its source and every People has an entry |
| `src/artificer/world/old-history.ts` | How old history bends by who remembers it (#1650): living memory and a generation scaled by lifespan from the human `LIVING_MEMORY` (40 at 75 years), retellings per generation of tellers, the `{n}` / `{place}` / `{who}` slots read out of the engine's words (never a year), and one telling per People and culture in a place, bent by `TELLING_BENDS` | **Master** (Artificer) for the reading; behind the `old-history-drift` switch | Repo file / PR (code) |
| `src/artificer/region1.ts`, `kit.ts`, `trade.ts`, `techniques.ts` | Materials, recipes, items, techniques | **Master** (#1531) | Repo file / PR (code, so CI and tests) |
| `src/artificer/content/art-briefs.json` | A visual brief (silhouette, material, colour, one detail), an art tier and the icon path for every Artificer item, #1673 (`docs/art-pipeline.md`) | **Master** for how each item looks; the item ids are the code's above | Repo file / PR; `art-briefs.test.ts` fails when an item has no brief, a brief has no item, or an icon file is missing |
| `src/artificer/content/art-style.json` | The pixel-art style guide the PixelLab icon pass reads: sizes, the 32-colour palette, outline, light, reference icons, #1673; `eraLooks` points to the nine era looks (#1718, `docs/art-pipeline.md` § Era looks) | **Master** for the Artificer's art style | Repo file / PR; `art-briefs.test.ts` checks it's well-formed and its reference icons exist |
| `src/artificer/villages.ts` | The road villages, their people (People, culture, role), lore lines | **Master** for those places and people | Repo file / PR |
| `src/artificer/economy.ts` | Each road village's dominant, secondary and founding trade | **Master** for the road villages' economies; generated places come from the story engine | Repo file / PR |
| `src/artificer/world/peoples.ts` | The Reach's cultures as engine data (names, temperament, succession law) and which Peoples follow them | **Derived master**, from `docs/peoples-and-races.md` | Repo file / PR |
| `src/artificer/world/provinces.ts`, `organisations.ts`, `local-history.ts`, `regional-facts.ts` | The generated Reach and its history | **Generated** from seeds; masters are the code and the specs it reads | Repo file / PR |

#### Rune tech: runes are a craft, not magic coming back (#1718)

The Artificer's third era of looks is rune tech (`docs/art-pipeline.md` § Era looks, epic #1717). What it means in canon:

- **Runes are built into tools.** This is `WORLD.md` § Runescript › *Who uses it and how*: "A runed tool is not decorated — the runes are functional, specifying what the tool should do when it operates. A [Runesmith]'s work is literally programming the tool." Rune tech is that: engineering with Myst running inside it. A rune in the Artificer is a cut line, an inlay or a conduit in a made thing, never a spell in the air.
- **They are learned through concepts, like any craft.** The Warden reaches rune tech the way they reach joinery or alloys: by ranks in concepts, learned from things they make and people they meet. The concepts are already in `src/artificer/content/concepts.json`, category `arcane`: `inscription` (carving the marks), `resonance` (needs `inscription:1`), `conduit-craft` (needs `inscription:1` and `resonance:1`) and `material-affinity`.
- **It is not magic returning.** Myst never left Mistheim and Runescript has always worked (`WORLD.md`: "A rune carved three thousand years ago means what it meant then"); the Bergfolk and goblin [Runesmiths] (`classes.json`) work it today. The Warden is learning an old, living craft, not bringing back a lost one. Where the Myst runs thin (the Dry, which corrupts Runescript logic, `WORLD.md` § *What the Dry does to Runescript*), runes work worse; that is the world's trouble, not a sign that magic had gone.

Who puts the power in: the concepts' notes, copied from the Homestead's draft, say the Warden carves the channels and builds the vessel, and an **enchanter** (an NPC) fills or charges it. `WORLD.md` has the [Runesmith] doing both. The two agree that the making is engineering; whether the Warden ever charges a rune alone is open, and goes with the magic-and-machines question (#1725).

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
| **Settlement Approaches**, **Architecture**, **Culture–Architecture Affinities**, **Building Registry** DBs | Settlement layout, architecture, buildings | **Mirrors** (`LORE.md`: they mirror `cultures.json` and `building-registry.json`); the masters are `cultures.json` and `architecture.json` (#1642; buildings: G3). No sync script in the repo: they were seeded once and drift | None found in the repo |
| Dev Blog, Concept Art, Stats, Weekly Dispatch, Release Notes, Learning Summary, Agent Performance Log, Roadmap pages | Reports and posts | **Not canon** (outputs) | Their workflows |

## Applying merged migrations (post-merge step)

No workflow applies migrations (#1642 chose a documented step: a workflow would need the owner's database secrets, and today `supabase db push` would re-run old files, because the live migration versions are the times they were applied, not the files' timestamps; gap G2). After a PR that adds files to `supabase/migrations/` merges to `main`, someone with the Supabase connector (the owner's interactive session):

1. Lists what's live: Supabase MCP `list_migrations`. A repo file counts as applied when a live migration has its name (the part after the timestamp).
2. Applies each new file **in filename order**, with `apply_migration` (name: the file name without the timestamp and `.sql`; query: the file's contents). Never edit the SQL on the way: if it's wrong, fix it by PR.
3. Runs the check: `npm run macro:export` with the service key, or with `--live-dump` from the MCP. It should say the live database matches the JSON. If it doesn't, write the repair with `npm run macro:sync -- --full` (by PR).

**Pending today, in this order:** `20261011120000_human_peoples.sql`, `20261011180000_human_peoples_bodies.sql`, then `20261012073526_macro_sync_null_population_weights.sql`. The order matters: the human Peoples file moves the Markfolk orc body columns from `human` to `markfolk` only while `human` is still named Markfolk, and a macro sync that touched those rows first would rename it. `supabase/README.md` has the same steps.

## Gaps

Each is a source that is master but not agent-updatable through a reviewed path, or whose master is unclear. Each is to get its own follow-up issue (#1638).

| # | Gap | Fix |
| --- | --- | --- |
| G1 | **AXES scores**: `AXES.md` and `LORE.md` say the live values are on Notion Culture DB entries; the lore autofill prompt reads them from the Peoples/Races DB; `AXES.md` holds a table that "may drift". Three places, no reviewed path for the one called master | Make `AXES.md` (or a JSON beside it) the master; sync to Notion; fix the prompt |
| G2 | **Partly fixed (#1642).** Done: the macro-world sync (JSON → migration), the drift check (`npm run macro:export`), and a documented post-merge step (above). Still open (#1640): the live DB holds 12 Wildkin/ikibeki migrations (2026-05-01) with no file in `supabase/migrations/`; `20261011120000_human_peoples.sql` and `20261011180000_human_peoples_bodies.sql` are merged but not applied; live migration versions don't match the files' timestamps (so `supabase db push` would re-run old files); no workflow applies migrations and CI doesn't compare repo and live history. The JSON already holds the Wildkin's synced columns, so what the 12 migrations wrote to those columns is in the repo; their body columns, architecture assignments and building changes aren't | Back-fill the 12 files from the live schema and data; repair the migration history so versions match; apply the two human Peoples files; then a CI check on repo vs live history |
| G3 | **Buildings**: `building-registry.json` is written by the Building Forge and overwritten by `macro:export` from Supabase `buildings`; Notion keeps a third copy | Pick one master (the Forge's file, with Supabase seeded from it, or Supabase with the Forge writing a migration) |
| G4 | **Resolved (#1642).** The macro-world JSON is master and Supabase is generated from it (`npm run macro:sync`); `docs/race-and-culture.md` says so, and the Building Forge and the Artificer reading `cultures.json` as their own is now right | — |
| G5 | **Races DB (Peoples) in Notion**: biology and visual canon are pushed from `scripts/races-*-content.mjs` by hand, nothing for the three newest Peoples, the cache is from April, and Notion-side edits never come back to the repo | Make the content files the master (all 18 Peoples), sync to Notion by workflow, refresh the cache |
| G6 | `macro-world/races.json` covers 15 Peoples, not 18 | Add the Wildkin, Riksfolk and Strandfolk |
| G7 | `storytelling/worlds/frontier.ts` and `DEFAULT_SPEC` predate the Mistheim canon (faiths, an orc/human Horde) and read like canon to an agent | Say in their headers that they're engine scenarios, not canon |
| G8 | Notion lore DBs (Creatures, Characters, Factions, Locations, Worlds) are agent-writable but unreviewed and unreadable without `NOTION_API_KEY` or the connector (CI has a placeholder key) | Keep them as documented agent-writable masters, or export them to the repo on a schedule so every agent can read them |
| G9 | **Supabase-only macro-world data** (#1642): the ancestries' body and sprite columns, `culture_architecture_assignments`, the biome and feature names and `building_architecture_availability` aren't in any JSON, so they stay master in Supabase (changed by hand-written migrations) while the rest of their tables is generated from the repo. Agents writing sprites read the body columns from Supabase | Add them to the JSON (e.g. `architectureStyles` on each culture, a body block on each ancestry) and let the sync own them; or keep them Supabase-master and say so per column |
