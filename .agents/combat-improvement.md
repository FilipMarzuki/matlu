# Nightly Combat Improvement Agent

You improve the combat AI in Matlu's CombatArenaScene by making small, targeted code changes and measuring their effect via the arena testplay benchmark. You work iteratively: measure → hypothesise → change → measure → keep if better.

## Environment

- `GITHUB_TOKEN` — for creating PRs.
- Vite build artefacts are already in `dist/` (pre-built by the workflow before this session starts).

## Score formula

```
score = totalKills - (heroDeaths × 5)
```

Higher is better. Deaths are penalised heavily because each death wastes wave time and lets enemies accumulate.

---

## STEP 1 — ESTABLISH BASELINE

Run the arena testplay. The workflow pre-built the project, so this should start immediately:

```bash
npm run arena:testplay
```

Read `screenshots/arena-testplay-report.json`. Compute the baseline score:

```
baseline_score = summary.totalKills - (summary.heroDeaths × 5)
```

Print clearly:
```
BASELINE: kills=<N> deaths=<N> waves=<N> score=<N>
```

---

## STEP 2 — IDENTIFY THE HIGHEST-IMPACT IMPROVEMENT

Read the `balanceHints` array from the report and the snapshot series to diagnose:

| Signal | Likely cause | Where to look |
|--------|-------------|---------------|
| `heroDeaths >= 5` | Hero AI dying too fast | Hero BT in `CombatEntity.ts` — attack range too low, not kiting, or not using ranged |
| `kills < 10` | Hero not attacking enough | Hero attack cooldowns, melee range threshold, or ranged trigger conditions |
| `kill/wave < 2` | Enemies outpacing the hero | Hero aggression (BT ordering), attack frequency, movement toward enemies |
| Kills plateau after wave 3 | Overwhelm — hero not prioritising | BT doesn't flee when low HP, or not using dash to escape |

Also read the entity behavior trees in `src/entities/CombatEntity.ts` to understand what parameters exist.

---

## STEP 3 — MAKE ONE TARGETED CHANGE

### Allowed targets (read before editing):

| File | What you can change |
|------|-------------------|
| `src/entities/CombatEntity.ts` | BT node distance thresholds, HP thresholds, cooldown durations, BT ordering within a Selector/Sequence |
| `src/entities/SwarmBrain.ts` | `BASE_WEIGHTS` values (separation, alignment, cohesion) |
| Any entity constructor | `speed`, `aggroRadius`, `attackDamage` of individual enemy types |

### Rules:
- Change **only one logical unit** per attempt (one threshold, one BT reorder, one weight)
- Do **not** add new files, new BT node types, new systems, or new entity types
- Do **not** change arena setup, wave timing, spawn counts, or hero HP
- Do **not** touch visual, animation, physics engine, or audio code
- Read the relevant section of the file before editing

### Good first candidates if hero is struggling:

**Hero melee range** — If hero melee fires too early and misses (ranged enemies), increase the `< 60` threshold on Tinkerer's melee condition.

**Hero ranged trigger** — If hero only uses ranged when very close, adjust the ranged distance window.

**Hero HP retreat** — If hero isn't fleeing when low HP, add or lower the HP threshold on a kite/steerAway branch.

**Enemy attack cooldown** — If enemies are dealing too much damage too fast, slightly increase their attack cooldown multiplier.

---

## STEP 4 — REBUILD AND MEASURE

After editing:

```bash
npm run build
npm run arena:testplay
```

Read the updated `screenshots/arena-testplay-report.json`. Compute the new score.

Print:
```
ATTEMPT <N>: kills=<N> deaths=<N> waves=<N> score=<N>  delta=<+/-N>
```

---

## STEP 5 — DECIDE (max 3 attempts)

**If new score > baseline score:**
→ Keep the change. Go to STEP 6.

**If new score <= baseline score:**
→ Revert the change completely:
```bash
git checkout -- <file you edited>
```
→ Try a different improvement angle (different file, different parameter).
→ After **3 failed attempts**, exit without committing. Print: "No improvement found in 3 attempts — nothing committed."

---

## STEP 6 — TYPECHECK, COMMIT, OPEN PR

```bash
npm run typecheck
```

If typecheck passes:

```bash
git checkout -b claude/combat-improvement-$(date +%Y%m%d)
git add <only the changed source files>
git commit -m "perf(combat-ai): <one-line description of change> — score +<N>"
git push origin HEAD
```

Open a PR:

```bash
gh pr create \
  --title "perf(combat-ai): <description> — score +<delta>" \
  --body "$(cat <<'PREOF'
## Combat AI improvement — $(date +%Y-%m-%d)

### Score
| | Kills | Deaths | Score |
|---|---|---|---|
| Before | <baseline_kills> | <baseline_deaths> | <baseline_score> |
| After  | <new_kills> | <new_deaths> | <new_score> |
| **Delta** | | | **+<delta>** |

### What changed
<one paragraph: which file, which parameter, what value changed from→to, and why this helps>

### Attempts tried
<list each attempt and its outcome, even the ones that were reverted>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
PREOF
)"
```

---

## FINAL STEP — LOG TOKENS

```bash
npm run log-tokens
```
