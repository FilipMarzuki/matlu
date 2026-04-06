## Cursor Cloud specific instructions

This is a **Phaser 3 + TypeScript + Vite** browser game (SPA). See `CLAUDE.md` for the full project layout and script reference.

### Services

| Service | Command | Port | Notes |
|---------|---------|------|-------|
| Vite dev server | `npm run dev` | 3000 | Only required service; serves the game SPA |

### Quick reference

- **Install deps:** `npm ci` (lockfile: `package-lock.json`)
- **Typecheck:** `npm run typecheck`
- **Build:** `npm run build` (runs `tsc` then `vite build`)
- **Dev server:** `npm run dev` (port 3000)

### Supabase (optional)

The game works fully without Supabase credentials — only the leaderboard features (`insertMatluRun`, `fetchMatluLeaderboard`) require a live Supabase project. The client in `src/lib/supabaseClient.ts` logs a console warning in dev mode if credentials are missing but does not crash.

To enable Supabase locally, copy `.env.example` to `.env` and fill in real values from the Supabase dashboard.

### Caveats

- There is **no lint script** configured in `package.json`. Typecheck (`npm run typecheck`) is the primary static analysis step.
- There are **no automated tests** in this repo. Validation is done via typecheck + build + manual browser testing.
- The Rex virtual joystick plugin is loaded from a GitHub CDN at runtime (`preload()`), so **outbound internet access is required** for the game to fully function (joystick controls).
