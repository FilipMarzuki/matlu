# Monthly PixelLab Credit Burn — Agent Prompt

Run this on the **8th of each month** (day before credits reset on the 9th) to maximise
remaining PixelLab credit value. Paste the prompt below into a Claude Code session in the
`matlu` project directory.

---

You are a pixel art asset generation agent for the Matlu game project.
Today is the last day before PixelLab credits reset (they reset on the 9th of each month),
so your goal is to maximise the value of remaining credits by generating as many high-quality
assets as possible.

## Your working directory

C:\Users\marzu\matlu

## Step 0 — Orient yourself

Read these files first before doing anything:
- src/ai/AGENTS.md          ← full generation protocol, follow it exactly
- src/ai/asset-spec.json    ← current asset registry with statuses

Run: npm run sprites:status
to see what is pending, in-progress, and done.

## Priority order (work through these in order, do not skip ahead)

### Priority 1 — Assemble tinkerer (already generated, free)
Raw frames for the tinkerer character are sitting in public/assets/sprites/_raw/tinkerer/
but have not been assembled into a spritesheet yet (the character is marked "done" in spec
but no .png/.json exists at outputDir). Run:
  npm run sprites:assemble -- --id tinkerer
Commit the result. This is a quick win with zero credit cost.

### Priority 2 — Arena floor tilesets (3 pending, cheap)
Generate the three pending tilesets from asset-spec.json:
  - arena_floor_earth
  - arena_floor_spinolandet
  - arena_floor_vatten

Follow Steps 3a–3c in AGENTS.md. Generate all three, then assemble and commit.
These are cheap (~2 credits each) and immediately unblock map rendering.

### Priority 3 — Spinolandet enemies (5 characters, main credit burn)
These enemies are designed but not yet in asset-spec.json. Add them now, then generate.

Add each of the following to the "characters" array in src/ai/asset-spec.json before
starting generation. Use the style guide (low top-down, single color black outline,
basic shading, medium detail, default proportions, size 32 unless noted).
Output dirs: public/assets/sprites/characters/spinolandet/enemies/{id}

Characters to add:

1. id: "spore_husk"
   name: "SporeHusk"
   world: spinolandet, faction: enemy
   description: "bloated fungal creature, round swollen body covered in pale mushroom caps and
     purple spores, stubby legs, glowing amber pustules ready to burst, bioluminescent teal
     veins, deep purple and sickly green tones, organic alien biology, top-down pixel art RPG"
   size: 28, body_type: humanoid
   animations: breathing-idle (idle), walking-4-frames (walk), cross-punch (attack),
               falling-back-death (death)

2. id: "acid_lancer"
   name: "AcidLancer"
   world: spinolandet, faction: enemy
   description: "insectoid creature, elongated mantis-like body, barbed forearms raised to
     throw, acid dripping from jaw mandibles, segmented carapace in amber and dark chitin,
     bioluminescent teal acid sac visible on thorax, four legs, top-down pixel art RPG"
   size: 28, body_type: humanoid
   animations: breathing-idle (idle), walking-4-frames (walk), throw-object (attack),
               falling-back-death (death)

3. id: "brute_carapace"
   name: "BruteCarapace"
   world: spinolandet, faction: enemy
   description: "massive armored beetle, huge domed chitinous shell with cracks exposing
     glowing amber beneath, thick stubby legs, small head with crushing mandibles, bulk and
     weight visible from above, dark purple and amber carapace, top-down pixel art RPG"
   size: 40, body_type: quadruped, template: bear
   animations: idle, walk-4-frames (walk), bark (attack)
   Note: Quadruped — verify available template animations via get_character after creation.

4. id: "parasite_flyer"
   name: "ParasiteFlyer"
   world: spinolandet, faction: enemy
   description: "winged leech creature, flat oval body with membrane wings spread wide,
     sucker mouth on underside, translucent purple wings with teal bioluminescent veins,
     top-down view shows wing span, parasitic alien biology, top-down pixel art RPG"
   size: 24, body_type: humanoid
   animations: fight-stance-idle-8-frames (idle), walking-4-frames (walk),
               flying-kick (attack), falling-back-death (death)

5. id: "warrior_bug"
   name: "WarriorBug"
   world: spinolandet, faction: enemy
   description: "tiny fast arachnid swarm unit, six legs, small compact thorax, sharp
     pincer mandibles, glossy black chitin with faint acid green highlights, Starship
     Troopers warrior bug aesthetic, very small and dangerous, top-down pixel art RPG"
   size: 16, body_type: quadruped, template: dog
   animations: idle, fast-walk (walk), bark (attack)
   Note: Quadruped — verify available template animations via get_character after creation.

For each character, follow the full protocol in AGENTS.md Steps 2a–2d:
- Create base character → store _pixellabCharacterId in asset-spec.json immediately
- Show preview and get human approval before queueing animations (REQUIRED)
- Queue animations one at a time (8 concurrent slot limit)
- Download and extract frames
- Assemble spritesheet

Generate characters in priority order: warrior_bug and spore_husk first (cheapest/fastest),
then acid_lancer and parasite_flyer, then brute_carapace last (largest, most credits).

### Priority 4 — If credits still remain
Look at what else is pending or planned. Consider:
- Additional animations for existing earth heroes (skald currently only has 4 animations;
  could add dash: running-slide, or crouching/getting-up if it fits the character)
- Any new pending items added to asset-spec.json since this prompt was written
- Check Linear (project: Matlu) for any asset-related issues in Backlog or Todo state

## Constraints

- Follow AGENTS.md exactly — do not skip human approval before animations
- Store _pixellabCharacterId in asset-spec.json immediately after each create_character call
- Queue animations one at a time; poll every 60s between jobs
- Style guide: view=low top-down, outline=single color black outline, shading=basic shading,
  detail=medium detail, palette per world (spinolandet: deep purple, acid green, amber, teal)
- Run npm run typecheck after assembling to verify nothing is broken
- Commit after each logical unit of work (tilesets batch, then each character)
- Do NOT commit public/assets/sprites/_raw/ (it is gitignored)

## Commit message format

"Generate pixel art: [comma-separated list of what was generated]"
