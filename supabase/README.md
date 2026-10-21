# Supabase

- `migrations/`: every schema and data change to the live project (`matlu`), one SQL file each, named `<UTC timestamp>_<name>.sql`. A file lands by PR and is applied after the merge (below). Canon rules: [`docs/canon.md`](../docs/canon.md).
- `functions/`: Edge Functions (`trigger-entity-pipeline` dispatches the Submission to Entity workflow; it writes no tables).

## Macro-world tables: generated from the repo JSON (#1642)

The settlement and ancestry tables (`ancestries`, `cultures`, `culture_traits`, their join tables, `architecture_styles`/`_blocks`, `fashion_styles`/`_variants`, `population_archetypes`) are generated from the master JSON in `macro-world/` and `public/macro-world/architecture.json`. Don't write a migration for them by hand and don't edit them in the dashboard:

```sh
# 1. Edit the JSON, then write the migration for what changed since origin/main
npm run macro:sync                       # → migrations/<timestamp>_macro_sync.sql (re-running rewrites it)
npm run macro:sync -- --name new_culture # names the file
npm run macro:sync -- --allow-delete     # needed when the JSON removed a row (deletes cascade)
node scripts/macro-sync.mjs --verify     # the branch's sync file matches its JSON change
# 2. Commit the JSON and the migration in one PR.
```

Columns the JSON doesn't hold (ancestry body and sprite columns, `culture_architecture_assignments`, biome and feature names, `buildings`, `building_architecture_availability`) still change by a hand-written migration (`docs/canon.md` gap G9).

## After a merge: applying migrations

No workflow applies migrations. After a PR that adds files here merges to `main`, the owner (or a session with the Supabase connector):

1. `list_migrations` (Supabase MCP) to see what's live. A file is applied when a live migration has its name (the file name after the timestamp). The live versions are the times they were applied, not the files' timestamps.
2. For each new file, **in filename order**: `apply_migration` with the name (file name without timestamp and `.sql`) and the file's contents, unchanged.
3. `npm run macro:export`: the drift check (needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; or `node scripts/macro-sync.mjs --print-dump-query`, run it with the MCP's `execute_sql`, save the result and pass `--check --live-dump <file>`). It should report that the live database matches the JSON.

Don't use `supabase db push` until the migration history is repaired (#1640): it compares versions, and since the live versions don't match the files' timestamps it would re-run files that are already applied.

**Pending (2026-10-12), in this order:** `20261011120000_human_peoples.sql`, `20261011180000_human_peoples_bodies.sql`, `20261012073526_macro_sync_null_population_weights.sql`. The live database also holds 12 migrations from 2026-05-01 (Wildkin, ikibeki) that have no file here yet (#1640).
