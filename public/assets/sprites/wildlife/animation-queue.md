# Wildlife Animation Queue

Tracking issue: #929
Status as of 2026-05-28. Each species needs idle + run (2 animations × 8 directions each).

## Completed
| Species | idle | run | Template |
|---------|------|-----|----------|
| Lynx | ✅ 8/8 | ✅ 8/8 | cat |
| Wildcat | ✅ 7/8 (NE failed) | ✅ 7/8 | cat |
| Bear | ✅ 8/8 | ⏳ 5/8 (SE/E/NE left) | bear |

## Queue (in order)
| # | Species | ID | idle template | run template |
|---|---------|-----|--------------|-------------|
| 1 | Squirrel | `97d23b68` | `idle` | `running-6-frames` |
| 2 | Hedgehog | `1feb8b5a` | `idle` | `running-6-frames` |
| 3 | Elk | `a0341fce` | `idle-shaking-head` | `running-6-frames` |
| 4 | Bison | `4ae8b75c` | `idle-shaking-head` | `running-6-frames` |
| 5 | Roe Deer | `d8c5b1a1` | `idle-shaking-head` | `running-6-frames` |
| 6 | Wolverine | `9e8321f7` | `idle-resting` | `running-4-frames` |
| 7 | Rabbit | `9ba09240` | `idle` | `running-6-frames` |
| 8 | Pine Marten | `e3e2cdff` | `idle` | `running-6-frames` |
| 9 | Beech Marten | `d69ae300` | `idle` | `running-6-frames` |
| 10 | Polecat | `0f8994d2` | `idle` | `running-6-frames` |
| 11 | Stoat | `df776d72` | `idle` | `running-6-frames` |
| 12 | Weasel | `1d00382a` | `idle` | `running-6-frames` |
| 13 | Raccoon | `37ae6144` | `idle` | `running-6-frames` |
| 14 | Rat | `e51a59c3` | `idle` | `running-6-frames` |
| 15 | Grass Snake | `5ac7b3f3` | `idle` | `running-6-frames` |

## How to resume
```bash
# 1. Check bear run status (3 pending jobs):
# Use: mcp__pixellab__get_character(character_id="147321e3-6572-4bb5-ba85-d55c132cd68a")

# 2. When bear is done (no pending jobs), queue squirrel idle:
# Use: mcp__pixellab__animate_character(character_id="97d23b68-...", template_animation_id="idle")

# 3. When idle finishes, queue squirrel run:
# Use: mcp__pixellab__animate_character(character_id="97d23b68-...", template_animation_id="running-6-frames")

# 4. Repeat for each species in the queue
```

## Notes
- 10 concurrent job limit on PixelLab — each animation takes all 8 slots
- ~10 min per animation batch (east-facing directions are 2-3x slower)
- Some directions fail under heavy server load — retry individually
- Full character ID reference in `pixellab-ids.json`
- Animations stay on PixelLab servers — download via `get_character` URLs when ready
