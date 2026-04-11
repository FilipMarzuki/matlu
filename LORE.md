# Lore Index

Canonical lore lives in Notion. IDs below let agents fetch entries directly without searching.

## Workspace pages

| Page         | Notion ID                              | URL |
|--------------|----------------------------------------|-----|
| Matlu (root) | `33f379d6-d7c6-8106-a7ad-d846b1770765` | https://www.notion.so/33f379d6d7c68106a7add846b1770765 |
| Lore         | `33f379d6-d7c6-8117-be1b-e352efcad6f0` | https://www.notion.so/33f379d6d7c68117be1be352efcad6f0 |
| Dev Blog     | `33f379d6-d7c6-81d0-b52a-ee235fdc2cc6` | https://www.notion.so/33f379d6d7c681d0b52aee235fdc2cc6 |
| Concept Art  | `33f379d6-d7c6-81e2-a542-edab42475324` | https://www.notion.so/33f379d6d7c681e2a542edab42475324 |
| Stats        | `33f379d6-d7c6-816e-a1cb-df23d81a5bd6` | https://www.notion.so/33f379d6d7c6816ea1cbdf23d81a5bd6 |

## Lore databases

| Database   | Notion ID                              | Data Source ID                          |
|------------|----------------------------------------|-----------------------------------------|
| Creatures  | `0aa66b53-d99f-48b1-9a05-061f33ecfb86` | `collection://2a4f2cbb-c6bb-4e8d-8ba9-854b91e07434` |
| Characters | `a64001e9-0780-407c-94df-8b7b5c8cd80c` | `collection://05467c79-7160-41e0-92a7-388fa4938d26` |
| Factions   | `9c2b96ac-e9a3-41f0-b899-9c444bd9b82e` | `collection://fedcf030-a638-4257-947b-d9e187eee7c9` |
| Worlds     | `6b01ee9e-237d-4d3f-8ed9-8b2fa3fc9d41` | `collection://d2c63f94-48dc-4443-b7d4-f27edd578987` |
| Locations  | `017500ae-8b0f-4dff-be87-702683453ffb` | `collection://fe876fc1-18c1-49c1-8ba8-5299e38a910d` |

## Database schemas

### Creatures
`Name` (title) · `World` (select) · `Type` (select) · `Threat Level` (number) · `Lore Status` (select) · `Description` (rich text)

### Characters
`Name` (title) · `World` (select) · `Faction` (text) · `Role` (select) · `Lore Status` (select) · `Description` (rich text)

### Factions
`Name` (title) · `World` (select) · `Alignment` (select) · `Lore Status` (select) · `Description` (rich text)

### Worlds
`Name` (title) · `Tagline` (text) · `Lore Status` (select) · `Description` (rich text) · `Visual Notes` (rich text)

### Locations
`Name` (title) · `World` (select) · `Region` (text) · `Lore Status` (select) · `Description` (rich text)

## Select field values

| Field        | Valid values |
|--------------|-------------|
| World        | `Earth`, `Spinolandet`, `Vattenpandalandet`, `Blended` |
| Type         | `wildlife`, `corrupted`, `boss`, `critter` |
| Role         | `NPC`, `antagonist`, `ally`, `neutral` |
| Alignment    | `Earth`, `Spino`, `Vatten`, `Mixed` |
| Lore Status  | `draft`, `reviewed`, `final`, `deprecated` |

## Agent conventions

- **Create** a new entry: `notion-create-pages` with `parent.data_source_id` = the database's data source ID above.
- **Read** a specific entry: `notion-fetch` with the page URL or ID.
- **Search** lore: `notion-search` with a keyword query.
- **Update** an entry: `notion-update-page` with the page ID.
- **Never delete** entries — set `Lore Status` to `deprecated` instead.
- Set `Lore Status` to `draft` on creation. Only mark `final` after narrative review.
- Concept art goes as an inline image in the page body, not as a file attachment property.
- Weekly dev blog posts go as sub-pages under the Dev Blog page (`33f379d6-d7c6-81d0-b52a-ee235fdc2cc6`).
- Weekly stats pages are auto-posted by GitHub Actions under Stats (`33f379d6-d7c6-816e-a1cb-df23d81a5bd6`).
