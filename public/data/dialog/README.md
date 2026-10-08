# NPC dialog trees

Each file in this directory is one NPC conversation, loaded by `GameScene` at
startup and walked by `NpcDialogScene`. No TypeScript changes are needed to
add or edit a conversation — just add or edit a `.json` file here.

## Format

```json
{
  "id": "blacksmith-greeting",
  "startNode": "start",
  "nodes": {
    "start": {
      "text": "Welcome, traveler. Need something forged?",
      "choices": [
        { "label": "What can you make?", "next": "catalog" },
        { "label": "Just browsing.", "next": "farewell" }
      ]
    },
    "catalog": {
      "text": "Blades, shields, tools — if I have the materials.",
      "choices": [
        { "label": "Interesting.", "next": "farewell" }
      ]
    },
    "farewell": {
      "text": "Come back when you need something.",
      "choices": []
    }
  }
}
```

- `id` — matches the file's base name (e.g. `blacksmith-greeting.json`).
- `startNode` — key into `nodes` for the first line shown.
- `nodes` — a map of node id → `{ text, choices }`.
  - `text` — the line of dialog shown for that node.
  - `choices` — buttons shown after the text finishes typing. Each choice has
    a `label` (button text) and `next` (the node id to walk to). An **empty**
    `choices` array ends the conversation after that node's text.

Every `next` must point at a key that exists in `nodes` — the loader
(`src/dialog/loadDialogTree.ts`, validated by `src/dialog/dialogTree.ts`)
throws a descriptive error at load time if a file is malformed.

## Wiring a file to an NPC

Settlement NPCs load `data/dialog/<settlementId>.json` — see
`SETTLEMENTS` in `src/world/Level1.ts` for the ids already wired in
`GameScene.preload()`. Adding a dialog tree for an existing settlement is a
pure JSON change; wiring a *new* trigger point (a new NPC/object that opens a
dialog) still requires a small `GameScene` change to call
`queueDialogTreeLoad` / `getDialogTree` for the new id.
