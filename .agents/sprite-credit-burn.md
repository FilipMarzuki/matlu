# Sprite Credit-Burn Agent

Generate pending pixel art assets from `src/ai/asset-spec.json` using the PixelLab MCP tools. Stop cleanly when credits run out. Commit progress frequently.

## RULES
- **ALWAYS use `n_frames: 1`** for `create_object`. Never use `n_frames: 4` — it wastes 64 credits generating review candidates instead of 1.
- **Commit after every 8-10 completed downloads** so progress survives crashes.
- **Stop immediately** if any `create_object` or `create_map_object` call returns "Insufficient generations" — credits are exhausted.
- **Skip entries with `status: "done"`** — they were completed in a previous run.
- Only process entries that have an `id` field (skip `_section` and `_note` markers).

---

## PASS 1 — CONCEPT ICONS (`icons` array)

For each entry in `asset-spec.json → icons` where `status === "pending"` and `id` exists:

1. Call `create_object` with:
   - `description`: entry.pixellab.description
   - `size`: 32
   - `directions`: 1
   - `n_frames`: 1
   - `object_view`: "top-down"

2. If the call returns "Insufficient generations" → stop, jump to COMMIT & REPORT.

3. Poll `get_object(object_id)` until status is completed (typically 30-90 seconds). Poll every 30 seconds, timeout after 3 minutes.

4. Download the PNG from the storage URL to `{entry.outputDir}/{entry.id}.png`. Create directory with `mkdir -p` if needed. Use curl:
   ```bash
   curl -sL "{storage_url}" -o "{outputDir}/{id}.png"
   ```

5. Update `asset-spec.json`: set `entry.status = "done"`.

6. After every 8 completed items, write the updated `asset-spec.json` and commit:
   ```bash
   git add src/ai/asset-spec.json public/assets/sprites/icons/
   git commit -m "art(icons): generate concept patch icons — batch N"
   ```

---

## PASS 2 — ITEM ICONS (`itemIcons` array)

Same flow as Pass 1 but reading from `asset-spec.json → itemIcons`.

Output directory: `public/assets/sprites/icons/items/`

Commit message: `"art(icons): generate item icons — batch N"`

---

## PASS 3 — MAP OBJECTS (`mapObjects` array)

For each entry in `asset-spec.json → mapObjects` where `status === "pending"`, `category` exists, and `id` exists:

**Priority order:** trees first, then shrubs, grass, rocks, ground, decorations.

1. Call `create_map_object` with:
   - `description`: entry.pixellab.description
   - `width`: entry.pixellab.width
   - `height`: entry.pixellab.height
   - `view`: entry.pixellab.view
   - `outline`: entry.pixellab.outline
   - `shading`: entry.pixellab.shading
   - `detail`: entry.pixellab.detail

2. If the call fails → stop, jump to COMMIT & REPORT.

3. Poll `get_map_object(object_id)` until completed. Poll every 30 seconds, timeout 3 minutes.

4. Download PNG to `{entry.outputDir}/{entry.id}.png`.

5. Update `asset-spec.json`: set `entry.status = "done"`.

6. Commit after every 10 items:
   ```bash
   git add src/ai/asset-spec.json public/assets/sprites/decorations/
   git commit -m "art({biome}): generate map objects — batch N"
   ```

---

## PASS 4 — COMMUNITY CREATURES (Supabase queue)

Skip if `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` env vars are not set.

Query: `creature_submissions?status=eq.queued&order=queue_priority.asc,queued_at.asc`

For each queued creature:
1. Set status to `spriting`
2. Derive entity fields from submission data
3. Call `create_character` — if fails, reset to `queued` and stop
4. Animate with template animations (idle, walk, attack, death)
5. Download frames to `public/assets/sprites/_raw/{slug}/`
6. Run `npm run sprites:assemble -- --id {slug}`
7. Update entity-registry.json
8. Set submission status to `in-game`
9. Commit after each creature

See `src/ai/AGENTS.md` for the full character generation protocol.

---

## COMMIT & REPORT

After all passes (or credits exhausted):

```bash
git push origin main
```

Print summary:
- How many items completed per pass
- Which item caused the stop (if credits ran out)
- How many items remain per category
- Suggestion: re-run after credits reset on the 9th

---

## IMPORTANT NOTES

- The `_raw/` directory is gitignored — never commit it
- Preserve all existing fields in JSON files — only update `status` and add `_pixellabObjectId`
- Process items sequentially (one at a time) to avoid overwhelming PixelLab's concurrent slots
- The PixelLab MCP is available via the project's `.mcp.json` — tools are `create_object`, `get_object`, `create_map_object`, `get_map_object`, `create_character`, `get_character`, `animate_character`
