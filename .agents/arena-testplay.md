# Arena Testplay

Runs CombatArenaScene for 300 simulated seconds using `sys.step()` to
fast-forward the game loop deterministically. Produces a JSON balance report
and periodic screenshots without needing a display.

## Running

```bash
# Build first if you haven't already, then run:
npm run build && npm run arena:testplay
```

For GPU-accurate screenshots (recommended when reviewing visual output):
```bash
npm run arena:testplay:headed
```

Output files are written to `screenshots/`:
- `arena-testplay-report.json` — balance metrics (read this first)
- `arena-testplay-{15,30,...,300}s.png` — periodic snapshots

## Reading the report

```json
{
  "summary": {
    "finalWave":   8,   // wave group index when sim ended
    "totalKills":  27,  // cumulative enemies killed
    "heroDeaths":  1    // how many times the Tinkerer was killed
  },
  "balanceHints": [ ... ],  // auto-generated warnings (may be empty)
  "snapshots": [
    { "simTime": 5, "wave": 0, "kills": 2, "heroDeaths": 0, "heroAlive": true, "enemiesAlive": 3 },
    ...
  ]
}
```

Each `snapshots` entry covers 5 simulated seconds.

## Balance targets (rough, adjust as the game evolves)

| Metric         | Target range | Signal if outside range |
|----------------|--------------|-------------------------|
| `finalWave`    | 10–25        | <10: spawns too slow, >25: spawns too fast |
| `totalKills`   | 30–100       | <20: hero AI struggling; >120: hero is overpowered |
| `heroDeaths`   | 0–5          | ≥8: enemies too strong; 0 across many waves: enemies too weak |
| `levelsCleared`| 1–3          | 0: hero never found exit; >3: dungeon too small/easy |

## What to look for

- **Hero dying frequently early** (`heroDeaths` jumps in the first 15 s):
  Enemy damage or HP is too high. Check `CombatEntity.ts` base stats.

- **Kills plateau while `enemiesAlive` grows**:
  Hero AI targeting is failing (enemies out of range, stuck on obstacles).
  Inspect `BehaviorTree.ts` and the `shoot` / `melee` nodes.

- **Kill/wave ratio < 2** for multiple consecutive snapshots:
  Enemies accumulate faster than the hero clears them. Either reduce spawn
  rate (`nextMainInterval()` in `CombatArenaScene.ts`) or buff hero DPS.

- **`heroAlive: false` for several consecutive snapshots**:
  Hero died and respawn timer (2 s) is being hit repeatedly. Cross-check
  `heroDeaths` to confirm it's the same death or multiple deaths.

## How the simulation works

`sys.step(time, delta)` is a Phaser internal that advances one game frame —
physics, AI behavior trees, timers, collision — without invoking the WebGL
render pipeline. This makes it safe in headless Chrome (CI) and much faster
than waiting for real-time execution.

The spec patches `respawnHero()` at runtime to count hero deaths, then reads
private scene fields (`waveNumber`, `killCount`, `aliveEnemies`) which are
accessible from JavaScript despite being `private` in TypeScript.
