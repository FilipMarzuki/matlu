# Wildlife Animation Queue

Tracking issue: #929
Status as of 2026-06-08.

## Animation sets per template

Based on wolf reference (9 anims). 8d = 8 directions, 1d = south only.

### Core animations (all species)
| Template | idle (8d) | run (8d) | walk (8d) | eat (1d) | sleep (1d) | death (1d) | drink (1d) |
|----------|-----------|----------|-----------|----------|------------|------------|------------|
| **cat** | `idle` | `running-6-frames` | v3 "walking" | `eating` | `sitting` | v3 "dying" | `drinking` |
| **bear** | `idle-resting` | `running-4-frames` | v3 "walking" | `eating` | `going-to-sleep` | v3 "dying" | `drinking` |
| **horse** | `idle-shaking-head` | `running-6-frames` | `walk-cycle` | `eating` | `rest-idle` | `dying` | v3 "drinking" |

### Predator-only animations (sneak + alert + attack)
| Template | sneak (8d) | alert (8d) | attack (1d) |
|----------|------------|------------|-------------|
| **cat** | **pro** "sneaking stealthily" | v3 "alert ears up" | v3 "biting attacking" |
| **bear** | **pro** "sneaking stealthily" | v3 "alert standing tall" | `attack-left` |

### Predator species
Lynx, Wildcat, Wolverine, Arctic Fox, Pine Marten, Beech Marten, Polecat, Stoat, Weasel, Wild Boar (charge)

### Prey species (no sneak/attack)
Squirrel, Hedgehog, Rabbit, Rat, Grass Snake, Beaver, Badger, Raccoon, Elk, Bison, Roe Deer, Fallow Deer, Red Deer, Moose, Bear (has attack but not sneak)

### Cost per species
- Core 7 anims: idle 8 + run 8 + walk 8 + eat 1 + sleep 1 + death 1 + drink 1 = **28 gens**
- Predator +3: sneak **pro 20-40/dir × 8** + alert 8 + attack 1 = **~170-330 gens** (pro is expensive!)
- Predator +3 v3 fallback: sneak 8 + alert 8 + attack 1 = **17 gens** (try v3 first, pro if bad)

### Strategy
1. Finish idle+run for all species (template, 1 gen/dir)
2. Add 1d anims (eat/sleep/death/drink) — cheap, 1 gen each, can batch fast
3. Add walk (8d) — template or v3, 8 gens each
4. Add sneak (8d) for predators — try v3 first (8 gens), escalate to pro if quality is poor
5. Add alert (8d) for predators — v3 (8 gens)
6. Add attack (1d) for predators — template or v3 (1 gen)

1d animations use `directions: ["south"]` to save gens.

## Completed (idle + run)
| Species | Template | idle | run | walk | eat | sleep | death | drink |
|---------|----------|------|-----|------|-----|-------|-------|-------|
| Lynx | cat | 8/8 | 8/8 | - | - | - | - | - |
| Wildcat | cat | 7/8 | 7/8 | - | - | - | - | - |
| Bear | bear | 8/8 | 8/8 | - | - | - | - | - |
| Squirrel | cat | 8/8 | 8/8 | - | - | - | - | - |
| Hedgehog | cat | 8/8 | 8/8 | - | - | - | - | - |
| Elk | horse | 8/8 | 8/8 | - | - | - | - | - |
| Bison | horse | 8/8 | 8/8 | - | - | - | - | - |
| Roe Deer | horse | 8/8 | 8/8 | - | - | - | - | - |
| Wolverine | bear | 8/8 | 8/8 | - | 1/1 | - | - | - |

## Generating idle+run (queued 2026-06-08)
| # | Species | ID | Template | idle | run | Status |
|---|---------|-----|----------|------|-----|--------|
| 7 | Rabbit | `9ba09240` | cat | queued | queued | batch 1 |
| 8 | Pine Marten | `e3e2cdff` | cat | queued | queued | batch 1 |
| 9 | Beech Marten | `d69ae300` | cat | queued | queued | batch 1 |
| 10 | Polecat | `0f8994d2` | cat | queued | queued | batch 1 |
| 11 | Stoat | `df776d72` | cat | queued | queued | batch 1 |
| 12 | Weasel | `1d00382a` | cat | queued | queued | batch 2 |
| 13 | Raccoon | `37ae6144` | cat | queued | queued | batch 2 |
| 14 | Rat | `e51a59c3` | cat | queued | queued | batch 2 |
| 15 | Grass Snake | `5ac7b3f3` | cat | queued | queued | batch 2 |
| 16 | Arctic Fox | `bcf356d7` | cat | queued | queued | batch 2 |
| 17 | Beaver | `ad0e546c` | bear | queued | queued | batch 3 |
| 18 | Wild Boar | `19c0575b` | bear | queued | queued | batch 3 |
| 19 | Badger | `69500eb8` | bear | queued | queued | batch 3 |
| 20 | Fallow Deer | `794234d8` | horse | queued | queued | batch 3 |
| 21 | Red Deer | `0417c353` | horse | queued | queued | batch 3 |
| 22 | Moose | `8b63d1e5` | horse | queued | queued | batch 3 |

## Extra animations pass (after idle+run done)
Go back and add walk/eat/sleep/death/drink for all species.
1d anims use `directions: ["south"]` — costs 1 gen each.
Walk is 8d template or v3 — costs 8 gens.
Total per species: ~12 gens (walk 8 + eat 1 + sleep 1 + death 1 + drink 1)
Total for 22+3 existing species: ~300 gens

### Priority order for extra anims:
1. **eat** (1d, south) — all species, template `eating`
2. **sleep** (1d, south) — all species, template varies
3. **death** (1d, south) — all species, template `dying` or v3
4. **drink** (1d, south) — all species, template `drinking` or v3
5. **walk** (8d) — all species, template `walk-cycle` (horse) or v3 (cat/bear)

## Notes
- 10 concurrent job limit on PixelLab — 8d animation takes all 8 slots, 1d takes 1 slot
- 1d animations are cheap (1 gen) and can be batched faster
- ~10 min per 8d animation batch (east-facing directions are 2-3x slower)
- Full character ID reference in `pixellab-ids.json`
- Animations stay on PixelLab servers — download via `get_character` URLs when ready
