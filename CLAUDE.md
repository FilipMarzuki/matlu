# Matlu — Phaser 3 + TypeScript + Vite

Small Phaser 3 game used to practice dev workflows. The stack is **Phaser 3**, **TypeScript** (strict), and **Vite** for bundling and dev server.

## Scripts

| Command            | Description                                      |
| ------------------ | ------------------------------------------------ |
| `npm run dev`      | Vite dev server on **port 3000**                 |
| `npm run build`    | `tsc` then `vite build` (typecheck + bundle)     |
| `npm run typecheck`| `tsc --noEmit` only                              |
| `npm run preview`  | Preview production build                         |

## Project layout

- `index.html` — HTML shell; loads `src/main.ts`
- `src/main.ts` — Phaser game config (800×600, arcade physics, FIT scaling)
- `src/scenes/GameScene.ts` — main scene: map, vehicle, Rex virtual joystick
- `vite.config.ts` — Vite options (dev port 3000)

## Rex virtual joystick

The **rex virtual joystick** plugin is loaded from the official CDN in `preload()` so the runtime matches the documented minified build. TypeScript types and instance typing come from the **`phaser3-rex-plugins`** package:

- Plugin type: `VirtualJoystickPlugin` from `phaser3-rex-plugins/plugins/virtualjoystick-plugin`
- Joystick instance type: `VirtualJoyStick` from `phaser3-rex-plugins/plugins/virtualjoystick`

## Supabase

The app includes **`@supabase/supabase-js`** and a shared client in `src/lib/supabaseClient.ts` (`createClient<Database>`). This is a **Vite SPA** (Phaser), not Next.js: there is **no** `@supabase/ssr`, cookie-based server client, or Next middleware. Session persistence and token refresh use the browser client with `persistSession` and `autoRefreshToken` (no extra middleware file required).

Vite exposes credentials via **`VITE_*`** env vars (not `NEXT_PUBLIC_*`):

- `VITE_SUPABASE_URL` — project API URL (Settings → API)
- `VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY` — default **publishable** key (`sb_publishable_…`), preferred
- `VITE_SUPABASE_ANON_KEY` — optional legacy anon JWT if publishable is not set

Copy `.env.example` to **`.env`** or **`.env.local`** and paste values from the [Supabase dashboard](https://supabase.com/dashboard). Those files are gitignored.

For **CI**, the workflow sets placeholder `VITE_*` variables so `vite build` succeeds without storing secrets in the repo. For **production** (for example Vercel), add the same variables in the host’s environment settings.

### Cursor Supabase MCP (schema + types)

DDL should go through **`apply_migration`** (not ad-hoc DDL in `execute_sql`). Example migration already applied: **`create_matlu_runs`** — table `public.matlu_runs` with RLS so **anon** and **authenticated** can **select** and **insert**.

After changing the schema, run **`generate_typescript_types`** and merge the result into `src/types/database.types.ts` (this repo currently types the Matlu table only; the live DB may also contain other tables).

Helpers for the Matlu table live in `src/lib/matluRuns.ts` (`insertMatluRun`, `fetchMatluLeaderboard`).

### Agent skills (optional)

The repo can include Supabase’s **`supabase-postgres-best-practices`** skill under **`.agents/skills/`**, tracked with **`skills-lock.json`**. Reinstall with:

`npx skills add supabase/agent-skills -y`

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on pushes to `main` and `claude/**`, and on pull requests targeting `main`. It uses Node 20, `npm ci`, then `npm run typecheck` and `npm run build`.
