# Macro World Generation

Automated pipeline for generating an Earth-based reference map using [Azgaar's Fantasy Map Generator](https://azgaar.github.io/Fantasy-Map-Generator/). Part of the Core Warden macro world system — see `docs/MACRO_WORLDGEN.md` for the full design.

## Quick start

```bash
npm run worldgen:earth
```

This runs the full pipeline: download heightmap → import into Azgaar → export → validate.

## Prerequisites

- **Playwright Chromium**: `npx playwright install chromium`
- **Internet access** for first run (downloads the heightmap source image)

## Pipeline steps

| Step | npm script | What it does |
| ---- | ---------- | ------------ |
| 1 | `worldgen:heightmap` | Downloads Natural Earth III grayscale bump map, converts to 2048×1024 PNG |
| 2 | `worldgen:generate` | Playwright opens Azgaar FMG, imports heightmap, exports .map + JSON |
| 3 | `worldgen:validate` | Checks exported JSON: cell count, land ratio, biomes, rivers, continents, temperature |

`worldgen:earth` chains all three. Each step is also runnable independently.

## Output files

All generated files live in `earth-reference/` (gitignored, re-generated on demand):

| File | Description |
| ---- | ----------- |
| `_heightmap_source.jpg` | Cached source image (skips re-download on subsequent runs) |
| `heightmap.png` | Converted grayscale heightmap (2048×1024) |
| `azgaar.map` | Azgaar native save — re-open in the browser app for manual edits |
| `azgaar-export.json` | Full JSON export (~4 MB) — cells, rivers, biomes, cultures, states |

## Debugging

Use `--headed` to watch the browser during Azgaar automation:

```bash
npm run worldgen:generate -- --headed
```

## Manual tweaking

1. Open [Azgaar FMG](https://azgaar.github.io/Fantasy-Map-Generator/) in your browser
2. Load → Open → select `earth-reference/azgaar.map`
3. Edit the map (heightmap, cultures, states, etc.)
4. Export: Save → Machine (saves .map), then Export → Full JSON
5. Replace the files in `earth-reference/` and re-run `worldgen:validate`

## Troubleshooting

| Problem | Fix |
| ------- | --- |
| Heightmap download fails (HTTP error) | Download manually from [shadedrelief.com](https://shadedrelief.com/natural3/pages/extra.html) and use `npm run worldgen:heightmap -- --input path/to/file.jpg` |
| Azgaar times out loading | Check internet connection; Azgaar is a client-side app hosted on GitHub Pages |
| Selectors not found | Azgaar UI may have changed — check [FMG source](https://github.com/Azgaar/Fantasy-Map-Generator) for updated selectors |
| Biome regen timeout | The 120s timeout may be too short for very large maps; edit `REGEN_TIMEOUT` in `generate-earth-map.ts` |
| Validation fails | Run `worldgen:generate -- --headed` to inspect the map visually; thresholds can be tuned in `validate-earth-export.ts` |

## What's next

This is the Earth reference phase (issues #601–#605). Future phases in the pipeline:

- **Mistheim map** — procedural Azgaar map with extreme biome tuning
- **Heightmap merge** — cherry-pick Earth landmasses into Mistheim
- **Race assignment** — assign races to cultures based on affinity rules
- **Fragment catalog** — place Earth ruins on the merged map

See `docs/MACRO_WORLDGEN.md` for the full roadmap.
