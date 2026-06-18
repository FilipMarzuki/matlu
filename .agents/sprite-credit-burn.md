# Sprite Credit-Burn Agent

Generate pending pixel art assets using the **pixellab-burn pipeline**. This agent orchestrates the Node.js scripts that call PixelLab's HTTP API directly — no MCP tool calls needed.

## RULES
- **Never call PixelLab MCP tools directly.** Use the burn script for all generation.
- **Check credits first** — if balance is low, report and stop.
- **Commit after every entity** so progress survives crashes.
- **Stop immediately** if the script reports credits exhausted.

---

## Step 1 — Regenerate the queue

```bash
npm run pixellab:queue
```

This scans existing sprites and `pixellab-ids.json` to build `pixellab-queue.json` with everything that's missing. Review the summary output to see what's pending.

Optional filters: `--idle-run`, `--extras`, `--birds`, `--npcs`, `--art`.

---

## Step 2 — Run the burn

```bash
npm run pixellab:burn
```

The script will:
1. Check credit balance
2. Process queue items sequentially (generate → poll → download → git commit)
3. Save progress to `pixellab-queue.json` after each item
4. Stop when credits are exhausted or queue is empty

For a limited run: `npm run pixellab:burn -- --limit 20`

---

## Step 3 — Post-processing

After the burn completes:

1. Run `npm run assets:sprites` to update the sprite manifest
2. Run `npm run typecheck` to verify nothing is broken
3. Push to origin:
   ```bash
   git push origin main
   ```

---

## Step 4 — Report

Print summary:
- How many items were completed
- Which item caused the stop (if credits ran out)
- How many items remain per pass
- Current credit balance
- Suggestion: re-run after credits reset on the 9th

---

## IMPORTANT NOTES

- The burn script reads `PIXELLAB_API_KEY` from `.env.local` or `.env` or environment
- `pixellab-queue.json` tracks status per item (`pending`, `done`, `error`, `timeout`)
- The `_raw/` directory is gitignored — never commit it
- Process items sequentially to avoid overwhelming PixelLab's concurrent slots (10-slot limit)
- The script handles rate limiting and retries automatically
