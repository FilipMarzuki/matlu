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

| Command             | Description                                  |
| ------------------- | -------------------------------------------- |
| `npm run dev`       | Vite dev server on **port 3000**             |
| `npm run build`     | `tsc` then `vite build` (typecheck + bundle) |
| `npm run typecheck` | `tsc --noEmit` only                          |
| `npm run preview`   | Preview production build                     |

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

Tasks are tracked in **Linear** (project: Matlu, assignee: Filip Marzuki).

- Pick the highest-priority issue in **Backlog** or **Todo** state
- Move the issue to **In Progress** when starting
- After implementing: open a PR, post the PR link as a comment on the Linear issue, mark it **Done**

## When implementing a task

1. Read the relevant existing files before writing anything
2. Keep changes small and focused on the issue
3. Don't refactor things outside the scope of the task
4. Run `npm run build` and `npm run typecheck` before opening a PR
5. If anything is unclear, open a PR with a plan and ask rather than guessing

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
