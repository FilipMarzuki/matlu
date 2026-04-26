# Lore Index

Canonical lore lives in Notion. IDs below let agents fetch entries directly.

## Databases

| Database   | Notion ID                              | Purpose |
|------------|----------------------------------------|---------|
| Races      | `34e843c0-718f-81a3-b4c8-c0ff6839bd21` | Mistheim race / People **visual and anatomical** canon (sprites, codex, lore) — not culture |
| Creatures  | `4c71181b-2842-4301-b7cf-94572b3845a9` | All fauna: wildlife, corrupted, bosses, critters |
| Characters | `751f1b85-0c99-4e1b-a0a5-c39a5422498a` | Named NPCs, antagonists, allies |
| Factions   | `833dd954-974b-422d-adb2-14a51f30af16` | Organisations and factions across all three worlds |
| Worlds     | `466886c8-a11c-46e7-b974-a58b8ee6647d` | The three worlds + the blended state |
| Locations  | `e374f3c2-e431-4e96-ab00-0dd21a6223b5` | Named places, regions, landmarks |

## Key pages

| Page             | Notion ID                              | Purpose |
|------------------|----------------------------------------|---------|
| Dev Blog root    | `33f843c0-718f-8197-8972-fb2b6e44754a` | Parent page for weekly dev posts |
| Concept Art root | `33f843c0-718f-8124-b05f-fd88c9cb4c6a` | Parent page for concept art galleries |
| Stats root       | `33f843c0-718f-819d-9f0e-ed05d4a8a6bf` | Parent page for weekly engineering stats |

## Agent conventions

- When adding a new lore entry, set `Lore Status` to `draft`. Mark `final` only after the narrative has been reviewed.
- Concept art goes on the entry's own page (inline image), not as a file attachment.
- Never delete entries — set `Lore Status` to `deprecated` instead.
- World names in database selects: `Earth`, `Spinolandet`, `Mistheim`, `Blended`
- **Race / People IDs:** the canonical names are the 15 Mistheim Peoples (TitleCase). See `docs/peoples-and-races.md` for the canon and the cultures.json mapping. `AXES.md` holds the cultural-axes scoring per People.
- To fetch a database: use `notion-fetch` with the database ID above.
- To list entries: use `notion-search` with a keyword, or `notion-fetch` the database ID directly.
- To create an entry: use `notion-create-pages` with the database ID as `data_source_id` parent.
