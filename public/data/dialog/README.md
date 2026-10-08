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

Every `next` must point at a key that exists in `nodes`, or the sentinel
`"END"` to close the dialog — the loader (`src/dialog/loadDialogTree.ts`,
validated by `src/dialog/dialogTree.ts`) throws a descriptive error at load
time if a file is malformed.

## Condition-gated choices + side-effects (#943)

For branching that depends on live game state (quest flags, inventory,
active world events, time of day, location, or how many times the player has
talked to this NPC), use `src/dialog/DialogRunner.ts` instead of walking the
tree directly:

- A choice's `condition` (see `Condition` in `src/dialog/dialogTree.ts`) is
  evaluated against a `WorldContext` snapshot by `evalCondition` — the choice
  is hidden from `DialogRunner.visibleChoices` unless it passes. Conditions
  compose with `all`/`any`/`not`.
- A node can set `next` instead of (or alongside empty) `choices` to
  auto-advance once its text finishes typing — no player input needed.
- A node's `onEnter` fires `NodeEffect`s (`setFlag`, `clearFlag`, `giveItem`,
  `startQuest`, `completeQuest`) that `DialogRunner` emits as events; the
  caller (e.g. `GameScene`) listens via `runner.on('setFlag', cb)` etc. and
  applies them — the runner itself never mutates game state.
- A node can override `npcName` / `portraitKey` for just that beat.

See `elder_vask.json` in this directory for an example that gates a choice on
`quest:corruption_started` and sets a flag via `onEnter`.
`NpcDialogScene` accepts a `DialogRunner` via the `dialogRunner` field on
`NpcDialogData`, which takes priority over the plain `dialogTree` field.

## Wiring a file to an NPC

Settlement NPCs load `data/dialog/<settlementId>.json` — see
`SETTLEMENTS` in `src/world/Level1.ts` for the ids already wired in
`GameScene.preload()`. Adding a dialog tree for an existing settlement is a
pure JSON change; wiring a *new* trigger point (a new NPC/object that opens a
dialog) still requires a small `GameScene` change to call
`queueDialogTreeLoad` / `getDialogTree` for the new id (or, for a condition-
gated conversation, to assemble a `WorldContext` and construct a
`DialogRunner`).
