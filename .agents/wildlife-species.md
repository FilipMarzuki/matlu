# Wildlife Species Pipeline Agent

You are running one step of the wildlife species pipeline. Read the state file, do the NEXT step only, update state, commit, and stop.

## Rules

1. **ONE step per session.** Do not run the full pipeline — do the single next step, verify, commit, stop.
2. **Never spend PixelLab credits without checking state.** If `characterApproved` is false, do NOT queue animations.
3. **Template animations only** for the nightly agent (cheap, 1 gen/direction). Custom v3 (eat/sleep/death/drink) are also cheap (1 gen/direction, SE only).
4. **Never use pro mode.** Pro costs 20-40 gen/direction — only humans approve that.
5. **Read `public/macro-world/wildlife-pipeline-state.json`** at the start of every session. This is your source of truth.
6. **Update the state file** after each successful step. Commit the state file alongside any sprites/code.

## Pipeline steps (in order)

### Step 1: Registry entry
- Read `docs/species-backlog.md` for the next species in the queue
- Read `docs/wildlife-species-pipeline.md` for the design template
- Add entry to `fauna-registry.json` (all fields filled)
- Update state: `status: "registry-done"`
- Commit

### Step 2: Create character
- Call `create_character` with the species description from designNotes
- Use the correct body_type/template from the pipeline doc
- Save the `pixellabCharacterId` to state
- Wait for completion, save preview
- Update state: `status: "character-created", characterApproved: false`
- Commit
- **STOP HERE.** Character needs human approval before spending animation credits.

### Step 3: Idle animation (requires characterApproved: true)
- Check `characterApproved === true` in state. If false, STOP.
- Queue `idle` animation (template, 8 directions)
- Wait for completion
- Download ZIP, assemble 8 direction strips
- Add to registry sprites + GameScene preload
- Update state: `animations.idle.status: "done", animations.idle.directions: 8`
- Run `npm run wildlife:audit` to verify
- Commit

### Steps 4-8: walk, run, sneak, alert (one per session)
- Same pattern as step 3
- Template animations: walk-6-frames, running-6-frames, sneaking, bark
- Each step does ONE animation, downloads, assembles, wires, commits

### Steps 9-12: eat, sleep, death, drink (one per session)
- Custom v3, SE direction only
- Cheaper but still one per session
- action_descriptions from designNotes in registry

### Step 13: Final audit
- Run `npm run wildlife:audit`
- Verify all animations present
- Update state: `status: "complete", auditPassed: true`
- Remove species from queue, add next species
- Commit

## How to read state

```javascript
const state = JSON.parse(fs.readFileSync('public/macro-world/wildlife-pipeline-state.json'));
const queue = state.queue;
const nextSpecies = queue[0];
const speciesState = state.species[nextSpecies];

if (!speciesState) {
  // Step 1: create registry entry
} else if (speciesState.status === 'registry-done') {
  // Step 2: create character
} else if (!speciesState.characterApproved) {
  // STOP — waiting for human approval
} else {
  // Find next animation that isn't done
  const ANIM_ORDER = ['idle', 'walk', 'run', 'sneak', 'alert', 'eat', 'sleep', 'death', 'drink'];
  const nextAnim = ANIM_ORDER.find(a => !speciesState.animations?.[a]?.status || speciesState.animations[a].status !== 'done');
  if (nextAnim) {
    // Generate this animation
  } else {
    // All done — run final audit
  }
}
```

## Commit format

```
feat(wildlife): {species} — {step description}
```

Examples:
- `feat(wildlife): wildcat — registry entry`
- `feat(wildlife): wildcat — idle animation (8 dirs)`
- `feat(wildlife): wildcat — eat animation (SE only)`
- `feat(wildlife): wildcat — complete, audit passed`

## Credit budget

Per species (approximate):
- Character creation: ~4 credits
- 5 template animations × 8 dirs = ~40 credits
- 4 custom v3 × 1 dir = ~4 credits
- Total: ~48 credits per species

At 10 species in the priority queue, that's ~480 credits total. Monthly budget is ~2000, so this is well within budget across 2-3 months of nightly runs.

## What NOT to do

- Never generate all animations in one session
- Never use pro mode
- Never skip the characterApproved gate
- Never redo a step that's already "done" in state
- Never modify sprites for a species that's "complete"
