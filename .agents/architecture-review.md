# Weekly Architecture Review Agent

You are performing a weekly architectural review of the **Core Warden** game project — a Phaser 4 +
TypeScript isometric action RPG set in the Matlu multiworld.

**Monorepo structure** — three deployable projects in one repo:
| Directory | Vercel project | Tech |
|-----------|---------------|------|
| `/` (root) | `matlu` | Phaser 4 + TypeScript + Vite |
| `wiki/` | `matlu-wiki` | Astro 6 (Matlu Codex community hub) |
| `dev/` | `matlu-dev` | Astro 6 (Agentic Experiments dev blog + metrics) |

Focus your review on the game (`/`). Note changes to `wiki/` and `dev/` only if they reveal
architectural patterns worth tracking (e.g. shared data contracts, API surface changes).

## Environment

- `GITHUB_TOKEN` — GitHub API token (env var).

Today's date: run `date -u +%Y-%m-%d` to get it.

## STEP 1 — READ THE CURRENT ARCHITECTURE DOC

Read `ARCHITECTURE.md` in full.

## STEP 2 — CHECK WHAT CHANGED THIS WEEK

Run: `git log --since='7 days ago' --oneline`

Then for any files that appear frequently or seem architecturally significant, read them. Focus on:
- New files added to `src/`
- Changes to GameScene.ts, NavScene.ts, or any scene
- New entries in `world/`, `entities/`, `shaders/`, `lib/`
- Changes to constants or major data structures

## STEP 3 — UPDATE ARCHITECTURE.MD

Update the doc to reflect the current state of the codebase:
- Add any new systems, scenes, entities, or lib files to the File Structure section
- Update tuning constants if they changed
- Update the GameScene Internals section if responsibilities shifted
- Update the Camera Setup table if zoom or follow behaviour changed
- Update the Non-Obvious Decisions section if new patterns were introduced
- Keep the doc accurate and concise — remove stale content

## STEP 4 — ADD REVIEW NOTES

At the bottom of ARCHITECTURE.md, add or update a section:

```
## Review Notes — YYYY-MM-DD

### What changed this week
- bullet list of significant changes

### Concerns
- any architectural drift, files getting too large, duplication, or patterns that may cause problems
- or: "None this week" if things look healthy
```

Replace the previous Review Notes section if one exists — keep only the latest.

## STEP 5 — COMMIT AND PUSH

```bash
git add ARCHITECTURE.md
git commit -m "chore: weekly architecture review $(date -u +%Y-%m-%d)"
git push
```

## STEP 6 — CREATE A LINEAR ISSUE

Use the Linear GraphQL API (`LINEAR_API_KEY` env var) to create an issue:

- **Team**: Fills Pills (`84cc2660-9d7a-424a-99c6-3e858a67db4c`)
- **Project**: Matlu (`c3622eaf-83ff-48b9-a611-c9b21fd8f039`)
- **Assignee**: Filip Marzuki (`563bef3c-ccc8-4d5e-9922-47b90c4e2595`)
- **State**: Done
- **Title**: `Weekly architecture review — YYYY-MM-DD`
- **Description**: summary of what changed this week + concerns flagged

If `LINEAR_API_KEY` is not set or the API call fails, log a warning but do not fail — the ARCHITECTURE.md commit is the primary deliverable.

Be honest and direct in the concerns section. Flag real issues — a 6000-line scene file is a concern worth naming.
