# Matlu — Phaser 3 + TypeScript + Vite

Top-down action RPG called **Core Warden**, set in the **Matlu multiworld**. A hero character explores a corrupted world, fights enemies, and cleanses corruption — controlled by a virtual joystick (mobile-first) or keyboard. Leaderboard stored in Supabase.

Primary platform: Android tablet (Chrome). Keyboard also supported.
Deployed to: Vercel, inside the free tier's 100 deployments a day, so no branch previews. The game, the Codex and Agentic Experiments deploy once a day at 06:00 UTC (deploy hooks in `vercel-daily-deploy.yml`); the Artificer deploys on each push to `main` that touches it. The game's project (`matlu`) is paused since 2026-10-10, so corewarden.app is offline. Each project's ignore step compares against its last deploy (`VERCEL_GIT_PREVIOUS_SHA`).
Database: Supabase (leaderboard via `matlu_runs` table)

## Sites

This repo contains four deployable projects:

| Project | Directory | Vercel project | Purpose |
| ------- | --------- | -------------- | ------- |
| **Core Warden** (game) | `/` (root) | `matlu` — [corewarden.app](https://corewarden.app) (paused) | The Phaser 3 game |
| **Matlu Codex** | `wiki/` | `matlu-codex` — [codex.corewarden.com](https://codex.corewarden.com) | Community hub — lore, biomes, creatures, contribution forms. Audience: players, kids, contributors. |
| **Agentic Experiments** | `dev/` | `matlu-dev` | AI/automation learning log — metrics, agent performance, dev blog. Audience: self (primary), external devs (secondary). |
| **Artificer** | `artificer/` (Vercel config; the code is `src/artificer*` at the root) | `matlu-artificer` — [artificer.corewarden.app](https://artificer.corewarden.app) | The text-and-logic game, built on its own by `npm run build:artificer` (#1534). |

`wiki/` and `dev/` each have their own `package.json` and are built independently in CI. The Artificer shares the root `package.json`; its Vercel project (Root Directory `artificer/`) installs and builds from the root and only builds when Artificer files change.

## Tech stack

- **Phaser 3** + **TypeScript** (strict)
- **Vite** (bundler, dev server on port 3000)
- **Supabase** (`@supabase/supabase-js`, browser client)
- **rex-virtual-joystick** plugin (mobile controls, loaded from CDN)

## Scripts

| Command                   | Description                                                                      |
| ------------------------- | -------------------------------------------------------------------------------- |
| `npm run dev`             | Vite dev server on **port 3000**                                                 |
| `npm run build`           | `tsc` then `vite build` (typecheck + bundle)                                       |
| `npm run build:artificer` | The Artificer alone → `artificer/dist/` (for artificer.corewarden.app)            |
| `npm run typecheck`       | `tsc --noEmit` only                                                              |
| `npm run unit:src`        | Vitest unit tests under `src/` (pure game logic, no browser)                     |
| `npm run unit:story`      | Vitest unit tests for the storytelling engine (golden hashes)                    |
| `npm run preview`         | Preview production build                                                         |
| `npm run assets:manifest` | Regenerate `public/assets/manifest.json` from `public/assets/packs/`             |
| `npm run assets:sprites`  | Regenerate `public/assets/sprite-manifest.json` — catalogs all sprites + wired status |
| `npm run screenshot`      | Capture game screenshots to `screenshots/` for visual review                     |
| `npm run pixellab:queue`  | Regenerate `pixellab-queue.json` from current sprite state                       |
| `npm run pixellab:burn`   | Run PixelLab burn pipeline (generate → poll → download → commit)                 |
| `npm run pixellab:burn:dry` | Dry-run burn — logs actions without calling API                                |
| `npm run ai:play`         | Let an AI (or scripted/random baseline) play Artificer Region 1; transcripts → `ai-runs/` |
| `npm run ai:bench`        | Play the model roster (`src/artificer-ai/roster.ts`); prints cost estimate, `--budget` cap |
| `npm run ai:report`       | Build the cross-model progression + cost report from `ai-runs/` transcripts |
| `npm run worldgen:earth`  | Full Earth map pipeline: heightmap → Azgaar import/export → validate             |
| `npm run worldgen:heightmap` | Download + convert Earth heightmap to PNG                                     |
| `npm run worldgen:generate`  | Playwright: import heightmap into Azgaar FMG, export .map + JSON             |
| `npm run worldgen:validate`  | Validate exported JSON (cells, biomes, rivers, continents, temperature)      |

## Visual review

Run `npm run screenshot` to capture the current game state as PNGs in `screenshots/`.
Must run with a display available (uses `--headed` Playwright so WebGL renders correctly).
Read the files in `screenshots/` before doing any visual/UI work — they show the actual
rendered game, not just code. `screenshots/manifest.json` lists each file and what it shows.

## Pixel art assets

Put each source pack in its **own folder** under **`public/assets/packs/<pack-name>/`** (sprites, audio, tilemaps, etc. as shipped). Vite serves `public/` at the site root, so URLs look like `/assets/packs/<pack-name>/...`.

After adding or renaming files, run **`npm run assets:manifest`**. That writes **`public/assets/manifest.json`** — a flat catalog grouped by pack (`id`, `path`, `assets[]` with `relative` and `url`) so agents can pick files without walking the tree.

## Asset pipeline — MANDATORY steps when adding sprites

**Every time a new sprite is created (PixelLab, manual, any source):**

1. **Download the PNG** to the correct folder:
   - Trees → `public/assets/sprites/trees/<species>/<stage>/<N>.png`
   - Icons → `public/assets/sprites/icons/<type>/<name>.png`
   - Characters → `public/assets/sprites/characters/<world>/<role>/<name>/`
   - Buildings → `public/assets/packs/building-objects/<culture>/<name>.png`
2. **Run `npm run assets:sprites`** — regenerates `sprite-manifest.json` so the asset viewer sees it
3. **Wire it up** — add a `this.load.image()` call in the scene that uses it (or reference it in the relevant JSON registry: `trees.json`, `asset-spec.json`, `building-registry.json`)
4. **Verify in the asset viewer** — navigate to `/assets`, find your sprite, confirm it shows a green dot (wired)
5. **Commit the PNG + updated manifest** together

Browse all sprites at `/assets` — red dot = unwired (not used in code), green dot = wired.

## AI asset generation (PixelLab)

Custom pixel art is generated via the **pixellab-burn pipeline** — a Node.js script that calls PixelLab's MCP HTTP API directly. This is the **default and preferred** method for all PixelLab generation (characters, animations, objects, tiles).

### Pipeline overview

1. **`pixellab-queue-generate.mjs`** scans existing sprites + `pixellab-ids.json` and builds `pixellab-queue.json` with everything that's missing
2. **`pixellab-burn.mjs`** processes the queue sequentially: generate → poll → download → commit

| Command | Description |
| ------- | ----------- |
| `npm run pixellab:queue` | Regenerate `pixellab-queue.json` from current state |
| `npm run pixellab:burn` | Process the queue (generate, download, commit) |
| `npm run pixellab:burn:dry` | Dry run — log what would happen without API calls |
| `npm run pixellab:burn -- --limit 10` | Process at most 10 items |
| `npm run pixellab:burn -- --skip-download` | Generate only, no download/commit |
| `npm run sprites:status` | Show pending / done assets (from `asset-spec.json`) |
| `npm run sprites:assemble` | Assemble raw frames → spritesheets + JSON |
| `npm run sprites:assemble -- --id skald` | Assemble one asset only |

### Queue passes

The queue generator supports filters: `--idle-run`, `--extras`, `--birds`, `--npcs`, `--art`. Without flags it generates everything.

### Adding new generation work

To add new items to the pipeline, edit **`scripts/pixellab-queue-generate.mjs`** — add entries to the relevant section (quadrupeds, birds, NPCs, buildings, furniture, tiles, etc.). The generator checks what already exists on disk and only queues missing items.

For one-off or experimental generations, the **PixelLab MCP** tools are still available via `.mcp.json` for interactive use.

### Legacy spec file

`src/ai/asset-spec.json` contains older generation specs (icons, map objects). These are still read by `sprites:assemble` but new work should go through the queue generator.

### PixelLab credentials

Two auth methods depending on context:

| Context | Method | Notes |
| ------- | ------ | ----- |
| **Local Claude Code** | MCP OAuth (automatic) | PixelLab's allowlist supports the local CLI; no key needed |
| **Remote Claude Code / CI** | `PIXELLAB_API_KEY` env var | Set in repo secrets + `.mcp.json` passes it as Bearer token |
| **Scripts** (`sprite-credit-burn`, `wildlife-species`) | `PIXELLAB_API_KEY` env var | Read by workflow YAML |

Get your API key from the [PixelLab dashboard](https://pixellab.ai/dashboard) → API Keys. Add to `.env.local` for local script use or to GitHub repo secrets for CI.

### PixelLab animation generation — SERIAL ONLY

**Never launch multiple agents/processes that call `animate_character` in parallel.** The account has a **10-concurrent-job limit**, and each 8-direction template animation requires 8 free slots. Multiple agents competing for the same slots causes total gridlock — all agents spin-wait and none make progress.

Rules:
- Use **one sequential agent** for all animation work in a session
- Queue one animation at a time: fire → wait for completion → fire next
- You MAY fire idle + run for the **same species** in parallel (8+8 ≤ 10 slots if nothing else is running)
- Never launch a second PixelLab animation agent while one is active
- Check `get_balance()` before starting — if `generations_remaining` is low, stop and report

## Project structure

```
index.html              # HTML shell; loads src/main.ts
src/
  main.ts               # Phaser game config (800×600, arcade physics, FIT scaling)
  scenes/
    GameScene.ts        # Main scene: map, vehicle, joystick, physics
  lib/
    supabaseClient.ts   # Shared Supabase browser client (createClient<Database>)
    matluRuns.ts        # insertMatluRun, fetchMatluLeaderboard helpers
  types/
    database.types.ts   # Generated Supabase TypeScript types (Matlu table)
  vite-env.d.ts         # Vite env type declarations
vite.config.ts          # Vite options (dev port 3000)

wiki/                   # Matlu Codex — community hub (Astro 6)
  src/
    layouts/Base.astro
    components/Nav.astro
    pages/
      playtest.astro    # Feedback form
      lore/             # Notion-driven lore pages (#358)
      biomes/           # Biome cards (#324)
      creatures/        # Creature gallery + submit form (#329)

dev/                    # Agentic Experiments — AI/automation dev log (Astro 6)
  src/
    layouts/Base.astro
    components/Nav.astro
    pages/
      index.astro       # Landing + metric cards (#354)
      metrics.astro     # Charts dashboard (#354)
      blog/             # Content collections blog (#355)
      architecture.astro # Renders ARCHITECTURE.md (#355)
      agents.astro      # Agent performance table (#357)
    content/
      blog/             # Markdown posts, draft: true/false frontmatter
```

## Coding conventions

- Mobile-first controls — virtual joystick is the primary input
- Design for landscape tablet (800×600 minimum)
- Keep game logic in scene classes; don't add abstractions speculatively
- Run `npm run typecheck` and `npm run build` before pushing
- **Settlements live in Mistheim.** There is no separate worldgen for other realms — the 22 cultures (`macro-world/cultures.json`) all populate Mistheim. Spinolandet, Earth, and other narrative realms exist as lore but have no procedural settlement system.
- **Cultures are race-agnostic.** Many races can share a culture. Culture IDs have no race prefix (e.g. `coastborn`, not `human-seafaring`). `racePreferences` is an optional weighted hint; absent means sample from regional demographics.
- **Artificer is the master for materials and concepts.** Its concepts live in `src/artificer/content/concepts.json`; its materials, recipes and items are in its own code (`region1.ts`, `kit.ts`, `trade.ts`, `techniques.ts`…). The Homestead's registries (`macro-world/item-registry.json`, `public/macro-world/recipes.json`, `public/macro-world/concepts.json`) are earlier drafts, frozen as they are: don't add material, recipe or concept work there, and Artificer doesn't read them. `src/artificer/content-ownership.test.ts` pins their hashes (#1531).

## Story engine — update checklist

When adding new world elements to `storytelling/` (new Province fields, new races/biology traits, new event types, new catastrophe templates), update ALL of the following layers that the new element touches:

| Layer | File | What to check |
| ----- | ---- | ------------- |
| Data model | `types.ts` | Add the field/type |
| Spec | `world-spec.ts` | Add to `WorldSpec` / `RaceSpec` if configurable |
| Seed | `seed.ts` | Initialize the field on Province/Character/Dynasty |
| Simulation | `tick.ts`, `phenomena.ts`, `geography.ts`, `people.ts` | Wire the field into the annual simulation passes |
| Psyche | `perception.ts` | Does the new element affect distortion onset or bias weights? |
| Culture | `culture-drift.ts` | Does the new element create cultural pressure? |
| Catastrophe | `catastrophe.ts` | Does it enable a new shock template or modify existing ones? |
| Magic | `magic.ts` | Does it affect XP / class access / comfort? |
| Sifter | `sifter.ts` | Should the new event type carry a significance score? |
| Renderer | `render.ts` | Does it need a prose template? |
| Tests | `testkit.ts` | Rebaseline golden hashes if the RNG stream changed |

**Golden hash rule**: any change that touches the RNG stream for default-world or frontier configs **requires rebaselineing** the affected hashes in `testkit.ts`. Run `npm run unit:story` and copy the new hashes from the failure output.

## Current milestone

Milestone 1 — vehicle moving on a map with joystick controls ✓

## Task management

Tasks are tracked in **GitHub Issues** (repo: FilipMarzuki/matlu).

**State model** — GitHub's open/closed maps to the task lifecycle:

| GitHub state | Meaning |
| ------------ | ------- |
| Open (no label) | Backlog — not yet started |
| Open + `in-progress` | Actively being implemented |
| Closed | Done — PR merged or issue resolved |

**Label conventions:**

| Group | Labels |
| ----- | ------ |
| Readiness | `ready`, `needs-refinement`, `blocked`, `too-large` |
| Outcome | `agent:success`, `agent:partial`, `agent:failed`, `agent:wrong-interpretation`, `agent:already-shipped` |
| State | `in-progress` |
| Category | `systems`, `art`, `lore`, `infrastructure`, `world`, `hero`, `tech`, `ui-hud`, `ui-menus`, `audio`, `weapons`, `enemies`, `waves`, `upgrades`, `parts`, `mobile` |
| Type | `type:feature`, `type:bug`, `type:refactor`, `type:perf`, `type:infra`, `type:docs`, `type:spike` |

Every issue must carry exactly one `type:*` label.

**Acceptance criteria — test-first (ATDD) vs exempt:**

| Issue labels | How acceptance is written and verified |
| ------------ | --------------------------------------- |
| `systems` and none of `art`, `ui-hud`, `ui-menus`, `world` | **ATDD.** Criteria are Given/When/Then scenarios, each checkable by a unit test without a browser or Phaser. Triage appends Given/When/Then when the prose is concrete, otherwise labels `needs-refinement`. The dev agent writes one failing Vitest test per scenario before implementing. Use the **Systems (ATDD)** issue template. |
| Anything with `art`, `ui-hud`, `ui-menus` or `world` | **Exempt.** Look-and-feel changes too often for tests to help; acceptance is a screenshot or checklist. Use the **Visual / exploration** issue template. |

Templates live in `.github/ISSUE_TEMPLATE/`; the rules are enforced in `.agents/triage.md`, `.agents/per-issue.md` and `.agents/review.md`.

**Workflow:**

- Pick the highest-priority open issue labelled `ready` (or without a blocking label)
- Apply the `in-progress` label when you start
- After implementing: open a PR with `Closes #<issue-number>` in the body — GitHub closes the issue automatically on merge
- Run `.github/scripts/create-labels.js` to create all required labels idempotently

**All work must have an issue.** If you're doing work that doesn't have a GitHub Issue yet (bug fixes, ad-hoc requests, infrastructure changes, etc.), create one *before* committing. Every issue must have:
- A clear title describing the change
- One `type:*` label (e.g. `type:bug`, `type:infra`, `type:refactor`)
- At least one category label (e.g. `infrastructure`, `systems`)
- The commit or PR must reference the issue (`Closes #N` or `Fixes #N`)

This ensures all work is tracked, labelled, and visible in metrics/reports.

Label conventions (Type, Domain, Effort labels) are documented in **[`LABELS.md`](LABELS.md)**.

## When implementing a task

1. Read the relevant existing files before writing anything
2. Keep changes small and focused on the issue
3. Don't refactor things outside the scope of the task
4. Run `npm run build` and `npm run typecheck` before opening a PR
5. Reference the GitHub issue number (e.g. `Closes #42`) in the PR description so the issue closes automatically on merge
6. If anything is unclear, open a PR with a plan and ask rather than guessing

## PR descriptions

Write PR descriptions as a learning resource for someone new to this tech stack. Include:

- What was built and why
- Key Phaser/TypeScript concepts used
- Any important decisions made and the alternatives considered
- Links to relevant Phaser docs if applicable
- Anything surprising or worth knowing

### Design decisions (medium- and high-risk PRs)

Run `node .github/scripts/risk-score.mjs --local` after committing. It scores the branch's commits since `origin/main`, the same files the PR will show, and prints `risk:<tier>`. If it prints `risk:medium` or `risk:high`, the PR body needs a **Design decisions** table (#1433). It's optional for low-risk PRs:

```markdown
## Design decisions
| Decision | Why | Rejected alternative | Wrong if… |
|---|---|---|---|
| Score PRs with a script, not a model | predictable, tunable, can't be talked down by the PR text | an LLM classifier | a risky change lands in a path no rule covers |
```

- **2–5 rows**, only choices a reviewer could reasonably have made differently. Not "used TypeScript".
- **Wrong if…** is the point: the concrete condition that would make the decision a bug. Write down the assumptions you're relying on ("a PR can't change its own rules"), because reviewers check those first.
- Reviewers verify each row against the diff and flag decisions the diff makes that the table leaves out. A stated reason is a claim to check, not a settled question.

## Before merging a PR — always review first

No PR merges without a review pass, and the depth of review scales with the PR's **risk tier** (#1431). A script scores every PR from the paths it touches, its size and whether code changed without tests — rules and weights in **`.github/review-risk.json`** — and *DevCycle 3c — Risk review* labels it and comments the reasons. **The tier decides which review models must agree before the merge (#1481), never a person: people decide game design; implementation merges on the models' reviews.**

| Tier | Typical PR | Must agree before the merge |
| ---- | ---------- | ------- |
| `risk:low` | docs, wiki, styles, game code with tests | self-review + *DevCycle 3 — Review* (the Claude review agent) approves |
| `risk:medium` | agent instructions, sim code, large diffs | + a second opinion from another model family (`REVIEW_MODEL_MEDIUM`) says `approve` |
| `risk:high` | seeded RNG / golden hashes, save format, CI workflows, build config, Supabase, paid-API scripts | + one focused review per lens (`.agents/review-lenses/`: determinism, saves, general) on a stronger model (`REVIEW_MODEL_HIGH`) finds nothing |

The verdicts count on the head commit only, and the review agent must approve that commit too. A new commit re-runs the reviews. Re-running *DevCycle 3c* (`workflow_dispatch`, PR number) replaces an unclear or failed review, but a `request-changes` or a finding holds until a new commit.

"Merge it" means, in order:

1. **Self-review.** Review the PR's own diff (e.g. the `/code-review` skill on the PR) for correctness bugs, missed edge cases, and gaps against the issue's acceptance criteria. Go deeper the higher the tier: for `risk:high`, check the matching lens file's list by hand too. Fix what's real in a new commit; say what was found and what was fixed or left (with why).
2. **Agent review.** Mark the PR ready for review — the review agents skip drafts. Marking ready starts *3c — Risk review*, which scores the PR, starts *DevCycle 3 — Review*, and runs the paid reviews its tier calls for. Fix blocking findings: a second opinion's `request-changes` or a focused review's finding holds the merge until a new commit.
3. **Merge.** *DevCycle 4 — Merge* merges once the Review agent approves and the gate passes; *3c* starts it again when the tier's reviews finish. Every merge path runs the gate `node .github/scripts/risk-score.mjs --pr N --gate` (exit 3 = hold): CI passed on the head commit, and the tier's models agree on it.

Never mark a PR ready and merge it in the same step — that skips the review agents entirely.

## Code comments

Add educational comments to non-obvious code. The owner is learning Phaser, TypeScript, and game dev — briefly explain **why** things are done a certain way, not just what the code does.

## Rex virtual joystick

Loaded from CDN in `preload()` so the runtime matches the documented minified build. TypeScript types come from `phaser3-rex-plugins`:

- Plugin type: `VirtualJoystickPlugin` from `phaser3-rex-plugins/plugins/virtualjoystick-plugin`
- Joystick instance type: `VirtualJoyStick` from `phaser3-rex-plugins/plugins/virtualjoystick`

## Supabase

This is a **Vite SPA** (Phaser), not Next.js — there is **no** `@supabase/ssr`, cookie-based server client, or Next middleware. Session persistence uses the browser client with `persistSession` and `autoRefreshToken`.

Vite exposes credentials via **`VITE_*`** env vars (not `NEXT_PUBLIC_*`):

- `VITE_SUPABASE_URL` — project API URL (Settings → API)
- `VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY` — default **publishable** key (`sb_publishable_…`), preferred
- `VITE_SUPABASE_ANON_KEY` — optional legacy anon JWT if publishable is not set

Copy `.env.example` to **`.env`** or **`.env.local`** and paste values from the Supabase dashboard. Those files are gitignored.

For **CI**, the workflow sets placeholder `VITE_*` variables so `vite build` succeeds without storing secrets. For **production** (Vercel), add the same variables in the host's environment settings.

### Schema migrations

DDL should go through **`apply_migration`** (not ad-hoc DDL in `execute_sql`). Migration already applied: **`create_matlu_runs`** — table `public.matlu_runs` with RLS so `anon` and `authenticated` can `select` and `insert`.

After changing the schema, run **`generate_typescript_types`** and merge the result into `src/types/database.types.ts`.

### Agent skills (optional)

The repo can include Supabase's **`supabase-postgres-best-practices`** skill under `.agents/skills/`, tracked with `skills-lock.json`. Reinstall with:

```
npx skills add supabase/agent-skills -y
```

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on pushes to `main` and `claude/**`, and on pull requests targeting `main`. Uses Node 20, `npm ci`, then `npm run typecheck` and `npm run build`.

## Nightly agent

`.github/workflows/agent-nightly.yml` — single-issue-per-cycle runner. Cron (`0 2 * * *`) + `workflow_dispatch` + `workflow_run` (re-wakes after each Bender PR merges). Each cycle fetches the highest-priority `ready` issue via `.github/scripts/fetch-agent-issues.js`, runs one Claude Code session via `.github/scripts/run-agent.js`, and opens a PR. The PR flows through DevCycle 2 — CI → 3 — Review → 4 — Merge (or 5 — Grooming), and the merge's `workflow_run` event wakes Bender for the next cycle. Capped at 10 cycles per 8-hour window. Per-session prompt lives in `.agents/per-issue.md`.

The per-issue runner requires one of two Claude credentials as repo secrets:

- **`CLAUDE_CODE_OAUTH_TOKEN`** (preferred) — generated locally via `claude setup-token`; usage counts against your Claude Pro/Max/Team-premium subscription quota so you avoid pay-as-you-go API billing.
- **`ANTHROPIC_API_KEY`** — fallback, pay-as-you-go. Set this instead if you don't have a Claude Code subscription seat.

It also requires **`GH_TRACKER_TOKEN`** — a GitHub PAT (fine-grained or classic) with `contents:write`, `pull-requests:write`, and `workflows:write`. The built-in `GITHUB_TOKEN` cannot be used for the branch push or PR open, because GitHub suppresses downstream `push` / `pull_request` triggers for those cases — which would prevent DevCycle 2 — CI (and therefore Review and Merge) from firing on agent-authored PRs. Bender (`agent-nightly.yml`) uses this secret (already provisioned for `creature-tracker-sync.yml`).

It also expects five labels to exist in GitHub Issues: `agent:success`, `agent:partial`, `agent:failed`, `agent:wrong-interpretation`, `agent:already-shipped` — create them before the first run.

On-demand runs: trigger `Dev Agent` from the Actions tab, optionally pinning it to one issue via the `issue_id` input.

## Triage agent

`.github/workflows/agent-triage.yml` — nightly cron (`0 22 * * *`, 22:00 UTC) + `workflow_dispatch`. Runs 4 hours before the implementation agent (02:00 UTC) so any issue triaged as `ready` tonight is immediately picked up. Sweeps Backlog issues that haven't been triaged (no `ready`, `needs-refinement`, `blocked`, `too-large`, or `agent:*` label) and spawns one Claude Code session per issue to assess readiness for the nightly implementation agent.

The triage agent **reads the codebase but never writes code**. Its output is GitHub labels + description edits + comments. Per-session prompt lives in `.agents/triage.md`.

Scripts: `.github/scripts/fetch-triage-issues.js` (query un-triaged issues) + `.github/scripts/run-triage.js` (per-issue runner).

Same secrets as the nightly agent (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`).

Triage labels (in GitHub Issues):
- `ready` — agent can pick this up in the nightly run.
- `needs-refinement` — close but missing specifics; description has been edited.
- `blocked` — hard dependency on another issue or missing infrastructure.
- `too-large` — needs to be split into 2+ smaller issues.
- `rework` — issue fixes/reverts/polishes something recently shipped. Applied alongside a readiness label.

The triage agent also sets an effort estimate using T-shirt sizes (XS=1, S=2, M=3, L=5, XL=8) based on codebase analysis.

### Rework tracking

Rework = fixing something that was recently shipped. Tracked in two ways:

1. **Per-issue** — triage agent applies the `rework` label when it detects fix/regression/polish patterns in the title or recently-changed files.
2. **Weekly metric** — `collect-stats.js` computes rework rate (% of files changed this week that were also changed in prior 3 weeks), top rework hotspots, and posts to a dedicated Notion database for trend charting.

On-demand: trigger `Refinement 1 — Triage` from the Actions tab, optionally pinning to one issue via `issue_id`.

## Scheduled agent workflows

Most agent workflows run as GitHub Actions cron jobs. Each spawns a single Claude Code session with the corresponding prompt from `.agents/`. All support `workflow_dispatch` for manual runs.

**Submission to Entity** also runs when a new row is inserted into `creature_submissions`: Supabase **Database Webhook** (INSERT) → Edge Function `supabase/functions/trigger-entity-pipeline` → GitHub `workflow_dispatch` with `submission_id`. Under normal conditions the Actions run should start within about 30 seconds of the insert.

**Operator checklist (after merge):** (1) Deploy: `supabase functions deploy trigger-entity-pipeline` from the repo root with the [Supabase CLI](https://supabase.com/docs/guides/cli) linked to the project. (2) Secret: `supabase secrets set GH_TRACKER_TOKEN=<PAT>` — same token as the GitHub repo secret `GH_TRACKER_TOKEN` (needs permission to dispatch workflows on `FilipMarzuki/matlu`, e.g. fine-grained PAT with Actions write or classic `workflow` scope). (3) **Database → Webhooks:** table `creature_submissions`, event **INSERT**, URL `https://<project-ref>.supabase.co/functions/v1/trigger-entity-pipeline`, header **`Authorization: Bearer <service_role_jwt>`** so the Edge Function accepts the call when JWT verification is on. Manual `workflow_dispatch` stays available for retries.

| Workflow | Cron (UTC) | Prompt | Secrets | Description |
| -------- | ---------- | ------ | ------- | ----------- |
| **Submission to Entity** | **on insert** (`creature_submissions`) + manual | `.agents/submission-to-entity.md` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NOTION_API_KEY`, `CLAUDE_CODE_PERSONAL` → `CLAUDE_CODE_OAUTH_TOKEN` in job; `GH_TRACKER_TOKEN` (Edge Function secret) | Converts a new community creature submission into entity spec + Notion + GitHub issue; auto-dispatched via `trigger-entity-pipeline` |
| **DevCycle 3c — Risk review** | after DevCycle 2 — CI; on *ready for review*; manual (`workflow_dispatch`, PR number) | `.github/review-risk.json`, `.agents/review-second-opinion.md`, `.agents/review-lenses/*.md` | `OPENROUTER_API_KEY`; `ANTHROPIC_PLAYTEST_KEY` (the fallback, #1509); variables `REVIEW_MODEL_MEDIUM` (default `google/gemini-2.5-pro`), `REVIEW_MODEL_HIGH` (default `openai/gpt-5`), `REVIEW_FALLBACK_MODEL` (default `claude-sonnet-5-5`) | Scores the PR (`risk-score.mjs`), labels `risk:<tier>`, comments the reasons. Medium/high: second-opinion review; high: one focused review per lens. Their verdicts gate the merge (#1481): the gate reads them on the head commit. When they finish, starts DevCycle 4. Paid reviews only after CI passed, same-repo PRs only; `pull_request_target`, so the base branch's workflow and scripts run. Workflows are started with `GITHUB_TOKEN` (#1476). **When OpenRouter can't review** (out of credit, down, no key), Claude does on `ANTHROPIC_PLAYTEST_KEY` (#1509): the review still counts at the gate, says it's weak, and the PR is labelled `weak-review` — the owner's rule is that a credit problem never stops a merge. Find them to revisit with `is:pr label:weak-review`. With neither key, medium/high PRs get no reviews and the gate holds them. `node .github/scripts/run-second-review.js --pr N --focus saves --dry-run` prints a lens prompt. |
| **DevCycle 3b — Second opinion** | manual only (`workflow_dispatch`) | `.agents/review.md` + `.agents/review-second-opinion.md` | `OPENROUTER_API_KEY`; variable `SECOND_REVIEW_MODEL` | Re-runs the second-opinion review by hand; 3c runs it automatically for medium/high PRs. Exits green if the secret is unset. |
| Refinement 2 — Hygiene | after Refinement 1 — Triage | `.agents/hygiene.md` | `GITHUB_TOKEN` | Marks Done if PR merged, splits `too-large` issues, enriches `needs-refinement` descriptions |
| DevCycle 5 — Grooming | after DevCycle 1 — Dev Agent | `.agents/pr-merge.md` | `GITHUB_TOKEN` | Triages open PRs: closes superseded, merges clean, rebases dirty |
| Better Stack Error Monitor | `0 7 * * *` (daily) | `.agents/error-monitor.md` | `GITHUB_TOKEN`, `BETTERSTACK_API_TOKEN` | Checks Better Stack for unresolved errors, files GitHub bugs |
| Lore Auto-fill | `0 14 * * *` (daily) | `.agents/lore-autofill.md` | `NOTION_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Expands thin lore entries, generates new ones in Notion; auto-drafts Notion lore pages for `balanced` creature submissions and flips their status to `lore-ready` |
| Lore from Features | `0 15 * * *` (daily) | `.agents/lore-features.md` | `NOTION_API_KEY` | Scans merged PRs for new game entities, creates Notion lore entries |
| Entity Spec Fill | `0 16 * * *` (daily) | `.agents/entity-spec-fill.md` | `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` | Writes `designNotes` (sprite, animation, sound briefs) for all entities missing them in `entity-registry.json` |
| Weekly Learning Summary | `0 7 * * 6` (Saturday) | `.agents/learning-summary.md` | `NOTION_API_KEY`, `GITHUB_TOKEN` | Writes learning summary from the week's PRs, posts to Notion |
| Weekly Architecture Review | `0 17 * * 5` (Friday) | `.agents/architecture-review.md` | `GITHUB_TOKEN` | Updates ARCHITECTURE.md, flags concerns, creates GitHub issue |
| **Weekly Engineering Stats** | `0 8 * * 0` (Sunday) | `collect-stats.js` (script, not agent) | `GITHUB_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NOTION_API_KEY` | Collects delivery/quality/rework metrics; writes to Supabase `stats_weekly` + `cognitive_load`; triggers Vercel rebuild |
| Weekly Release Notes | after Weekly Engineering Stats | `.agents/release-notes.md` | `NOTION_API_KEY`, `GITHUB_TOKEN` | Writes release notes from merged PRs, posts to Notion |
| Agent Performance Log | after Weekly Release Notes | `.agents/agent-perf-log.md` | `NOTION_API_KEY`, `GITHUB_TOKEN` | Queries GitHub Issues for agent:* outcome labels, creates weekly summary child page in Notion "Agent Performance Log" |
| **Sprite Credit Burn** | **manual only** (`workflow_dispatch`) | `.agents/sprite-credit-burn.md` | `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`, `PIXELLAB_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Runs `npm run pixellab:queue` then `npm run pixellab:burn` — the Node.js burn script handles all PixelLab generation via HTTP API. Commits after each entity; stops when credits run out. Run before the 9th of the month. |
| **Artificer AI playtest** | `15 23 * * *` (only if the Artificer sim changed that day) | scripts (`ai-bench.ts`, `ai-report.ts`) | `OPENROUTER_API_KEY`; vars `AI_BENCH_BUDGET` (default 1), `AI_BENCH_MIN_CHANGES` (default 1) | Skips ($0) unless commits in the last 24h touched `src/artificer*/`. Otherwise plays random baselines + the model roster (~$0.80 for whole-year games), posts a summary on the run page, uploads the report + transcripts as the `ai-playtest` artifact |
| **Wildlife Species** | nightly (after Dev Agent) | `.agents/wildlife-species.md` | `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`, `PIXELLAB_API_KEY` | One pipeline step per session for the next wildlife species. State tracked in `wildlife-pipeline-state.json`. Character creation requires human approval before animations are queued. ~48 credits per species. |
