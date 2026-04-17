# Matlu — Phaser 3 + TypeScript + Vite

Top-down vehicle game built with Phaser 3 + TypeScript. A vehicle drives on a 2D map controlled by a virtual joystick (mobile-first) or keyboard. Leaderboard stored in Supabase.

Primary platform: Android tablet (Chrome). Keyboard also supported.
Deployed to: Vercel (auto-deploy on push to main)
Database: Supabase (leaderboard via `matlu_runs` table)

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
| `npm run typecheck`       | `tsc --noEmit` only                                                              |
| `npm run preview`         | Preview production build                                                         |
| `npm run assets:manifest` | Regenerate `public/assets/manifest.json` from `public/assets/packs/`             |
| `npm run screenshot`      | Capture game screenshots to `screenshots/` for visual review                     |

## Visual review

Run `npm run screenshot` to capture the current game state as PNGs in `screenshots/`.
Must run with a display available (uses `--headed` Playwright so WebGL renders correctly).
Read the files in `screenshots/` before doing any visual/UI work — they show the actual
rendered game, not just code. `screenshots/manifest.json` lists each file and what it shows.

## Pixel art assets

Put each source pack in its **own folder** under **`public/assets/packs/<pack-name>/`** (sprites, audio, tilemaps, etc. as shipped). Vite serves `public/` at the site root, so URLs look like `/assets/packs/<pack-name>/...`.

After adding or renaming files, run **`npm run assets:manifest`**. That writes **`public/assets/manifest.json`** — a flat catalog grouped by pack (`id`, `path`, `assets[]` with `relative` and `url`) so agents can pick files without walking the tree.

## AI asset generation (PixelLab)

Custom pixel art is generated via the **PixelLab MCP** (available in this project via `.mcp.json`).

| File | Purpose |
| ---- | ------- |
| `src/ai/asset-spec.json` | Declarative spec — what to generate, PixelLab params, output paths |
| `src/ai/AGENTS.md` | **Full step-by-step protocol** for generating assets autonomously |

| Command | Description |
| ------- | ----------- |
| `npm run sprites:status` | Show pending / done assets |
| `npm run sprites:assemble` | Assemble raw frames → spritesheets + JSON |
| `npm run sprites:assemble -- --id skald` | Assemble one asset only |
| `npm run sprites:assemble -- --dry-run` | Preview without writing |

**To generate pending assets:** read `src/ai/AGENTS.md` and follow the protocol.
Raw frames go in `public/assets/sprites/_raw/` (gitignored). Assembled spritesheets go in `public/assets/sprites/` and are committed to git.

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
```

## Coding conventions

- Mobile-first controls — virtual joystick is the primary input
- Design for landscape tablet (800×600 minimum)
- Keep game logic in scene classes; don't add abstractions speculatively
- Run `npm run typecheck` and `npm run build` before pushing

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
| Outcome | `agent:success`, `agent:partial`, `agent:failed`, `agent:wrong-interpretation` |
| State | `in-progress` |
| Category | `systems`, `art`, `lore`, `infrastructure`, `world`, `hero`, `tech`, `ui-hud`, `ui-menus`, `audio`, `weapons`, `enemies`, `waves`, `upgrades`, `parts`, `mobile` |

**Workflow:**

- Pick the highest-priority open issue labelled `ready` (or without a blocking label)
- Apply the `in-progress` label when you start
- After implementing: open a PR with `Closes #<issue-number>` in the body — GitHub closes the issue automatically on merge
- Run `.github/scripts/create-labels.js` to create all required labels idempotently

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

`.github/workflows/agent-nightly.yml` — per-issue runner. Cron (`0 2 * * *`) + `workflow_dispatch`. Fetches Linear Backlog issues with the `ready` label via `.github/scripts/fetch-agent-issues.js`, then fans out in a matrix (`max-parallel: 3`, `fail-fast: false`) and spawns one isolated Claude Code session per issue via `.github/scripts/run-agent.js`. Per-session prompt lives in `.agents/per-issue.md`.

The per-issue runner requires `LINEAR_API_KEY` plus one of two Claude credentials as repo secrets:

- **`CLAUDE_CODE_OAUTH_TOKEN`** (preferred) — generated locally via `claude setup-token`; usage counts against your Claude Pro/Max/Team-premium subscription quota so you avoid pay-as-you-go API billing.
- **`ANTHROPIC_API_KEY`** — fallback, pay-as-you-go. Set this instead if you don't have a Claude Code subscription seat.

It also expects four labels to already exist in Linear: `agent:success`, `agent:partial`, `agent:failed`, `agent:wrong-interpretation` — create them before the first run.

On-demand runs: trigger `Dev Agent` from the Actions tab, optionally pinning it to one issue via the `issue_id` input.

## Triage agent

`.github/workflows/agent-triage.yml` — nightly cron (`0 22 * * *`, 22:00 UTC) + `workflow_dispatch`. Runs 4 hours before the implementation agent (02:00 UTC) so any issue triaged as `ready` tonight is immediately picked up. Sweeps Backlog issues that haven't been triaged (no `ready`, `needs-refinement`, `blocked`, `too-large`, or `agent:*` label) and spawns one Claude Code session per issue to assess readiness for the nightly implementation agent.

The triage agent **reads the codebase but never writes code**. Its output is Linear labels + description edits + comments. Per-session prompt lives in `.agents/triage.md`.

Scripts: `.github/scripts/fetch-triage-issues.js` (query un-triaged issues) + `.github/scripts/run-triage.js` (per-issue runner).

Same secrets as the nightly agent (`LINEAR_API_KEY` + `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`).

Triage labels (pre-created on the Fills Pills team):
- `ready` — agent can pick this up in the nightly run.
- `needs-refinement` — close but missing specifics; description has been edited.
- `blocked` — hard dependency on another issue or missing infrastructure.
- `too-large` — needs to be split into 2+ smaller issues.
- `rework` — issue fixes/reverts/polishes something recently shipped. Applied alongside a readiness label.

The triage agent also sets the Linear `estimate` field using T-shirt sizes (XS=1, S=2, M=3, L=5, XL=8) based on codebase analysis.

### Rework tracking

Rework = fixing something that was recently shipped. Tracked in two ways:

1. **Per-issue** — triage agent applies the `rework` label when it detects fix/regression/polish patterns in the title or recently-changed files.
2. **Weekly metric** — `collect-stats.js` computes rework rate (% of files changed this week that were also changed in prior 3 weeks), top rework hotspots, and posts to a dedicated Notion database for trend charting.

On-demand: trigger `Backlog Refinement` from the Actions tab, optionally pinning to one issue via `issue_id`.

## Scheduled agent workflows

All agent workflows run as GitHub Actions cron jobs. Each spawns a single Claude Code session with the corresponding prompt from `.agents/`. All support `workflow_dispatch` for manual runs.

| Workflow | Cron (UTC) | Prompt | Secrets | Description |
| -------- | ---------- | ------ | ------- | ----------- |
| Backlog Cleanup | after Backlog Refinement | `.agents/hygiene.md` | `LINEAR_API_KEY`, `GITHUB_TOKEN` | Marks Done if PR merged, splits `too-large` issues, enriches `needs-refinement` descriptions |
| PR Grooming | after Dev Agent | `.agents/pr-merge.md` | `LINEAR_API_KEY`, `GITHUB_TOKEN` | Triages open PRs: closes superseded, merges clean, rebases dirty |
| Better Stack Error Monitor | `0 7 * * *` (daily) | `.agents/error-monitor.md` | `LINEAR_API_KEY`, `BETTERSTACK_API_TOKEN` | Checks Better Stack for unresolved errors, files Linear bugs |
| Lore Auto-fill | `0 14 * * *` (daily) | `.agents/lore-autofill.md` | `NOTION_API_KEY` | Expands thin lore entries, generates new ones in Notion |
| Lore from Features | `0 15 * * *` (daily) | `.agents/lore-features.md` | `NOTION_API_KEY` | Scans merged PRs for new game entities, creates Notion lore entries |
| Weekly Learning Summary | `0 7 * * 6` (Saturday) | `.agents/learning-summary.md` | `NOTION_API_KEY`, `GITHUB_TOKEN` | Writes learning summary from the week's PRs, posts to Notion |
| Weekly Architecture Review | `0 17 * * 5` (Friday) | `.agents/architecture-review.md` | `LINEAR_API_KEY` | Updates ARCHITECTURE.md, flags concerns, creates Linear issue |
| **Weekly Engineering Stats** | `0 8 * * 0` (Sunday) | `collect-stats.js` (script, not agent) | `LINEAR_API_KEY`, `GITHUB_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NOTION_API_KEY` | Collects delivery/quality/rework metrics; writes to Supabase `stats_weekly` + `cognitive_load`; triggers Vercel rebuild |
| Weekly Release Notes | after Weekly Engineering Stats | `.agents/release-notes.md` | `NOTION_API_KEY`, `GITHUB_TOKEN` | Writes release notes from merged PRs, posts to Notion |
| Agent Performance Log | after Weekly Release Notes | `.agents/agent-perf-log.md` | `LINEAR_API_KEY`, `NOTION_API_KEY` | Queries Linear for agent:* outcome labels, creates weekly summary child page in Notion "Agent Performance Log" |
