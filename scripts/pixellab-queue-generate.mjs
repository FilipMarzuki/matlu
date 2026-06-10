#!/usr/bin/env node
/**
 * pixellab-queue-generate.mjs — Generate pixellab-queue.json from current state.
 *
 * Reads pixellab-ids.json + animation-queue.md to determine what's pending,
 * then outputs a queue file for pixellab-burn.mjs to process.
 *
 * Usage:
 *   node scripts/pixellab-queue-generate.mjs              # full queue
 *   node scripts/pixellab-queue-generate.mjs --idle-run   # only idle+run pass
 *   node scripts/pixellab-queue-generate.mjs --extras     # only extra anims (walk/eat/sleep/death/drink)
 *   node scripts/pixellab-queue-generate.mjs --birds      # only bird pro animations
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const IDS_FILE = join(ROOT, 'public/assets/sprites/wildlife/pixellab-ids.json');
const QUEUE_FILE = join(ROOT, 'pixellab-queue.json');
const WILDLIFE_DIR = join(ROOT, 'public/assets/sprites/wildlife');

// ── Load pixellab-ids.json ───────────────────────────────────────────────────

const ids = JSON.parse(readFileSync(IDS_FILE, 'utf8'));

// ── Template → animation mapping ─────────────────────────────────────────────

const TEMPLATE_ANIMS = {
  cat: {
    idle: 'idle',
    run: 'running-6-frames',
    walk: { mode: 'v3', action: 'walking', frames: 8 },
    eat: 'eating',
    sleep: 'sitting',
    death: { mode: 'v3', action: 'dying', frames: 8 },
    drink: 'drinking',
    // Predator + all-species extras
    alert: { mode: 'v3', action: 'alert, ears up, body tense, looking around', frames: 8 },
    sneak: { mode: 'v3', action: 'sneaking stealthily, low crouch, slow careful movement', frames: 8 },
    attack: { mode: 'v3', action: 'biting, attacking, lunging forward', frames: 8 },
  },
  bear: {
    idle: 'idle-resting',
    run: 'running-4-frames',
    walk: { mode: 'v3', action: 'walking', frames: 8 },
    eat: 'eating',
    sleep: 'going-to-sleep',
    death: { mode: 'v3', action: 'dying', frames: 8 },
    drink: 'drinking',
    alert: { mode: 'v3', action: 'alert, standing tall, looking around cautiously', frames: 8 },
    sneak: { mode: 'v3', action: 'sneaking stealthily, low heavy crouch', frames: 8 },
    attack: 'attack-left',
  },
  horse: {
    idle: 'idle-shaking-head',
    run: 'running-6-frames',
    walk: 'walk-cycle',
    eat: 'eating',
    sleep: 'rest-idle',
    death: 'dying',
    drink: { mode: 'v3', action: 'drinking, head lowered to water', frames: 8 },
    alert: { mode: 'v3', action: 'alert, head raised high, ears forward, body rigid', frames: 8 },
    // Horses/deer don't sneak or attack
  },
};

// ── Check which sprites already exist ────────────────────────────────────────

function hasSprite(species, anim, dir) {
  const dirAbbrev = { south: 's', 'south-east': 'se', east: 'e', 'north-east': 'ne',
    north: 'n', 'north-west': 'nw', west: 'w', 'south-west': 'sw' };
  const file = join(WILDLIFE_DIR, species, `${anim}_${dirAbbrev[dir]}.png`);
  return existsSync(file);
}

function hasAllDirs(species, anim) {
  const dirs = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west'];
  return dirs.every(d => hasSprite(species, anim, d));
}

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const onlyIdleRun = args.includes('--idle-run');
const onlyExtras = args.includes('--extras');
const onlyBirds = args.includes('--birds');
const all = !onlyIdleRun && !onlyExtras && !onlyBirds;

// ── Build queue ──────────────────────────────────────────────────────────────

const queue = [];

// Quadruped idle+run pass
if (all || onlyIdleRun) {
  for (const [species, data] of Object.entries(ids.quadrupeds)) {
    const template = TEMPLATE_ANIMS[data.template];
    if (!template) { console.log(`  skip ${species}: unknown template ${data.template}`); continue; }

    // Idle
    if (!hasAllDirs(species, 'idle')) {
      const animId = typeof template.idle === 'string' ? template.idle : null;
      queue.push({
        type: 'animate',
        species,
        characterId: data.id,
        template: animId,
        mode: animId ? null : 'v3',
        actionDescription: animId ? null : template.idle?.action,
        frameCount: animId ? null : template.idle?.frames,
        directions: 8,
        status: 'pending',
        pass: 'idle-run',
      });
    }

    // Run
    if (!hasAllDirs(species, 'run')) {
      const animId = typeof template.run === 'string' ? template.run : null;
      queue.push({
        type: 'animate',
        species,
        characterId: data.id,
        template: animId,
        mode: animId ? null : 'v3',
        actionDescription: animId ? null : template.run?.action,
        frameCount: animId ? null : template.run?.frames,
        directions: 8,
        status: 'pending',
        pass: 'idle-run',
      });
    }
  }
}

// Quadruped extra anims pass
if (all || onlyExtras) {
  // Predator species need sneak + attack
  const PREDATORS = new Set([
    'lynx', 'wildcat', 'wolverine', 'arctic-fox', 'pine-marten',
    'beech-marten', 'polecat', 'stoat', 'weasel', 'wild-boar',
  ]);

  const EXTRAS_1D = ['eat', 'sleep', 'death', 'drink'];    // 1-direction south (all species)
  const EXTRAS_8D = ['walk', 'alert'];                       // 8-direction (all species)
  const PREDATOR_8D = ['sneak'];                             // 8-direction (predators only)
  const PREDATOR_1D = ['attack'];                            // 1-direction (predators only)

  for (const [species, data] of Object.entries(ids.quadrupeds)) {
    const template = TEMPLATE_ANIMS[data.template];
    if (!template) continue;
    const isPredator = PREDATORS.has(species);

    // 8-direction anims for all species (walk, alert)
    for (const anim of EXTRAS_8D) {
      if (!template[anim]) continue;
      if (hasAllDirs(species, anim)) continue;
      const def = template[anim];
      const animId = typeof def === 'string' ? def : null;
      queue.push({
        type: 'animate', species, characterId: data.id,
        template: animId,
        mode: animId ? null : (def?.mode || 'v3'),
        actionDescription: animId ? null : (def?.action || anim),
        frameCount: animId ? null : (def?.frames || 8),
        directions: 8, status: 'pending', pass: 'extras',
      });
    }

    // 8-direction predator anims (sneak)
    if (isPredator) {
      for (const anim of PREDATOR_8D) {
        if (!template[anim]) continue;
        if (hasAllDirs(species, anim)) continue;
        const def = template[anim];
        const animId = typeof def === 'string' ? def : null;
        queue.push({
          type: 'animate', species, characterId: data.id,
          template: animId,
          mode: animId ? null : (def?.mode || 'v3'),
          actionDescription: animId ? null : (def?.action || anim),
          frameCount: animId ? null : (def?.frames || 8),
          directions: 8, status: 'pending', pass: 'predator-extras',
        });
      }
    }

    // 1-direction anims for all species (eat, sleep, death, drink)
    for (const anim of EXTRAS_1D) {
      if (!template[anim]) continue;
      if (hasSprite(species, anim, 'south')) continue;
      const def = template[anim];
      const animId = typeof def === 'string' ? def : null;
      queue.push({
        type: 'animate', species, characterId: data.id,
        template: animId,
        mode: animId ? null : (def?.mode || 'v3'),
        actionDescription: animId ? null : (def?.action || anim),
        frameCount: animId ? null : (def?.frames || 8),
        directions: ['south'], status: 'pending', pass: 'extras',
      });
    }

    // 1-direction predator anims (attack)
    if (isPredator) {
      for (const anim of PREDATOR_1D) {
        if (!template[anim]) continue;
        if (hasSprite(species, anim, 'south')) continue;
        const def = template[anim];
        const animId = typeof def === 'string' ? def : null;
        queue.push({
          type: 'animate', species, characterId: data.id,
          template: animId,
          mode: animId ? null : (def?.mode || 'v3'),
          actionDescription: animId ? null : (def?.action || anim),
          frameCount: animId ? null : (def?.frames || 8),
          directions: ['south'], status: 'pending', pass: 'predator-extras',
        });
      }
    }
  }
}

// NPC pipeline: portrait → full-body concept → character creation → animations
const onlyNpcs = args.includes('--npcs');
if (all || onlyNpcs) {
  // Existing PixelLab NPC characters — already created, need animations + portraits
  // Two cultures have characters: Ikibeki (beastkin) and Fieldborn (human)
  const EXISTING_NPCS = [
    // Ikibeki culture (beastkin NPCs)
    { id: 'ikibeki-smith',        pixelId: '3f8740cd-d161-4e9e-b865-e296f5b04361', name: 'Boar-Smith (Ikibeki)',       role: 'blacksmith',  culture: 'ikibeki' },
    { id: 'ikibeki-herbalist',    pixelId: '95130b77-71bd-4484-8487-196015fc143f', name: 'Fox-Herbalist (Ikibeki)',    role: 'merchant',    culture: 'ikibeki' },
    { id: 'ikibeki-trader',       pixelId: '35f01005-d66f-4de8-94ab-a434ced7c54e', name: 'Fox Trader',                role: 'merchant',    culture: 'ikibeki' },
    { id: 'ikibeki-highfang',     pixelId: 'd1e05856-0965-4e8e-8388-f21984dc3c68', name: 'Wolf-Highfang (Ikibeki)',   role: 'guard',       culture: 'ikibeki', hasAnims: 4 },
    { id: 'ikibeki-cook',         pixelId: '8ed0aa47-8da0-4dbb-a0f4-36bf52ef94de', name: 'Wolf-Cook (Ikibeki)',       role: 'innkeeper',   culture: 'ikibeki' },
    { id: 'ikibeki-brewer',       pixelId: '95857118-c1e7-434e-9d4f-3adb78bcc101', name: 'Cat-Brewer (Ikibeki)',      role: 'brewer',      culture: 'ikibeki' },
    { id: 'ikibeki-lorekeeper',   pixelId: '324b433e-34da-4f4d-bc36-983ced7eed0b', name: 'Snake-Lorekeeper (Ikibeki)',role: 'priest',      culture: 'ikibeki' },
    { id: 'ikibeki-scout',        pixelId: '9f1cec15-2ac9-45c3-8c42-5624948cf01a', name: 'Hawk-Scout (Ikibeki)',      role: 'guard',       culture: 'ikibeki' },
    { id: 'ikibeki-porter',       pixelId: '3189f782-b0ba-4c2c-a378-6999330d286e', name: 'Boar-Porter (Ikibeki)',     role: 'porter',      culture: 'ikibeki', hasAnims: 17 },
    { id: 'ikibeki-woodcutter',   pixelId: 'd7e5682c-a288-4c73-ac2f-e3fa5861136b', name: 'Boar-Woodcutter (Ikibeki)', role: 'farmer',      culture: 'ikibeki' },
    { id: 'ikibeki-warrior',      pixelId: 'a8f9554e-a9e0-4e51-8143-c522399a1293', name: 'Wolf Warrior',             role: 'guard',       culture: 'ikibeki', hasAnims: 8 },
    { id: 'ikibeki-elder',        pixelId: 'd74ed413-2856-44fa-bce3-dd4a1e91f38d', name: 'Bear Elder',               role: 'elder',       culture: 'ikibeki' },
    { id: 'ikibeki-farmer',       pixelId: 'ee729bd5-732c-4975-bf6d-3e6a047506f2', name: 'Boar Farmer',              role: 'farmer',      culture: 'ikibeki' },
    { id: 'ikibeki-barmaid',      pixelId: 'e040a266-7a46-42e9-830e-65bc74902cbc', name: 'Fox-Barmaid (Ikibeki)',     role: 'barmaid',     culture: 'ikibeki', hasAnims: 6 },
    { id: 'ikibeki-commoner',     pixelId: 'dafd4e02-eb58-4c7d-a718-a1d1142216fc', name: 'Rabbit Commoner',          role: 'villager',    culture: 'ikibeki' },
    { id: 'ikibeki-stablehand',   pixelId: 'e124b495-8ea2-4d6d-bd3b-97488530b232', name: 'Bear-Stablehand (Ikibeki)',role: 'stablehand',  culture: 'ikibeki' },
    // Fieldborn culture (human NPCs)
    { id: 'fieldborn-chief',      pixelId: 'df8e572c-5a63-4ca1-88ca-080b789d3d2e', name: 'Fieldborn Chief',          role: 'chief',       culture: 'fieldborn' },
    { id: 'fieldborn-blacksmith', pixelId: '6ac2e614-ed1a-453f-929c-9a3de12fb2d4', name: 'Fieldborn Blacksmith',     role: 'blacksmith',  culture: 'fieldborn' },
    { id: 'fieldborn-farmer',     pixelId: 'd37c78d8-8b9c-4f6e-a277-da8366bf1db9', name: 'Fieldborn Farmer',         role: 'farmer',      culture: 'fieldborn' },
    { id: 'fieldborn-guard',      pixelId: 'bc764364-4c54-4486-a993-a0024f9715e9', name: 'Fieldborn Guard',          role: 'guard',       culture: 'fieldborn' },
    { id: 'fieldborn-hearthkeeper',pixelId:'f91bacef-35a0-4b28-97da-e0dcef85f56b', name: 'Fieldborn Hearthkeeper',   role: 'innkeeper',   culture: 'fieldborn' },
    { id: 'fieldborn-shrine',     pixelId: 'a2fb4727-809e-4cd9-a748-1e1674037541', name: 'Fieldborn Shrine Keeper',  role: 'priest',      culture: 'fieldborn' },
    { id: 'fieldborn-elder',      pixelId: '079fb6cb-a6cf-4b1d-b97b-caf8d30c0982', name: 'Fieldborn Elder',          role: 'elder',       culture: 'fieldborn' },
    { id: 'fieldborn-child',      pixelId: '6ca8be8c-e15e-45a2-ba5d-b17b639995a8', name: 'Fieldborn Child',          role: 'child',       culture: 'fieldborn', hasAnims: 8 },
    { id: 'wallborn-gate-guard',  pixelId: '2f7089b1-eb05-43c6-958d-48fa38082181', name: 'Wallborn Gate Guard',      role: 'guard',       culture: 'wallborn' },
    // Standalone useful NPCs
    { id: 'wanderer',             pixelId: '54c2652b-b655-4015-b157-6be24c1a5213', name: 'Wanderer NPC',             role: 'wanderer',    culture: 'none', hasAnims: 10 },
  ];

  const NPC_ANIMS = ['idle', 'walk', 'run'];
  const NPC_ANIM_TEMPLATES = {
    idle: 'breathing-idle',
    walk: 'walk',
    run: 'running-6-frames',
  };

  for (const npc of EXISTING_NPCS) {
    const npcSpriteDir = join(ROOT, `public/assets/sprites/characters/npcs/${npc.id}`);
    const portraitPath = join(ROOT, `public/assets/sprites/portraits/${npc.role}.png`);
    const fullBodyPath = join(ROOT, `public/assets/sprites/characters/npcs/${npc.id}-fullbody.png`);

    // Portrait (96×96 bust — if no portrait exists for this role)
    if (!existsSync(portraitPath)) {
      queue.push({
        type: 'create_map_object',
        name: `portrait-${npc.id}`,
        description: `Pixel art bust portrait, 3/4 view facing left, transparent background. ${npc.name}. Anime-tech-meets-fantasy style, selective outline, warm palette.`,
        width: 96, height: 96, view: 'side',
        outputPath: portraitPath,
        status: 'pending', pass: 'npc-portraits',
      });
    }

    // Full-body concept (128×192 standing pose)
    if (!existsSync(fullBodyPath)) {
      queue.push({
        type: 'create_map_object',
        name: `fullbody-${npc.id}`,
        description: `Pixel art full body character, standing pose facing forward, transparent background. ${npc.name}. Full outfit visible head to toe. Anime-tech-meets-fantasy style, selective outline.`,
        width: 128, height: 192, view: 'front',
        outputPath: fullBodyPath,
        status: 'pending', pass: 'npc-fullbody',
      });
    }

    // Core animations (idle, walk, run — 8 dirs each)
    for (const anim of NPC_ANIMS) {
      if (existsSync(join(npcSpriteDir, `${anim}_s.png`))) continue;
      queue.push({
        type: 'animate', species: npc.id, characterId: npc.pixelId,
        template: NPC_ANIM_TEMPLATES[anim], directions: 8,
        status: 'pending', pass: 'npc-anims',
      });
    }

    // Role-specific animations (v3 custom, 1d south or 8d)
    const ROLE_ANIMS = {
      blacksmith:  [{ name: 'hammer', desc: 'hammering on an anvil, forging metal, arm swinging down', dirs: ['south'] }],
      farmer:      [{ name: 'dig', desc: 'digging with a hoe, bending and lifting, farming', dirs: ['south'] }],
      innkeeper:   [{ name: 'serve', desc: 'serving a drink, holding a mug, offering forward', dirs: ['south'] }],
      merchant:    [{ name: 'gesture', desc: 'beckoning gesture, inviting to trade, hand waving', dirs: ['south'] }],
      guard:       [{ name: 'alert', desc: 'alert stance, hand on weapon, scanning for threats', dirs: 8 }],
      priest:      [{ name: 'pray', desc: 'praying, hands together, head bowed, ritualistic', dirs: ['south'] }],
      elder:       [{ name: 'gesture', desc: 'wise gesturing while speaking, hand raised, storytelling', dirs: ['south'] }],
      brewer:      [{ name: 'stir', desc: 'stirring a large barrel or pot, brewing motion', dirs: ['south'] }],
      porter:      [{ name: 'carry', desc: 'carrying heavy load on back, walking with burden', dirs: 8 }],
      stablehand:  [{ name: 'brush', desc: 'brushing or grooming an animal, caring motion', dirs: ['south'] }],
      villager:    [{ name: 'wave', desc: 'friendly wave greeting, casual, welcoming', dirs: ['south'] }],
      child:       [{ name: 'play', desc: 'playful jumping, excited, energetic child movement', dirs: ['south'] }],
      barmaid:     [{ name: 'serve', desc: 'carrying a tray, serving drinks, walking carefully', dirs: 8 }],
      wanderer:    [{ name: 'sit', desc: 'sitting on the ground cross-legged, resting by campfire', dirs: ['south'] }],
      scout:       [{ name: 'lookout', desc: 'hand shielding eyes, looking into the distance, scouting', dirs: ['south'] }],
      chief:       [{ name: 'command', desc: 'authoritative pointing gesture, giving orders, commanding', dirs: ['south'] }],
    };

    const roleAnims = ROLE_ANIMS[npc.role] || [];
    for (const ra of roleAnims) {
      const animPath = join(npcSpriteDir, `${ra.name}_s.png`);
      if (existsSync(animPath)) continue;
      queue.push({
        type: 'animate', species: npc.id, characterId: npc.pixelId,
        mode: 'v3', actionDescription: ra.desc, frameCount: 8,
        directions: ra.dirs, status: 'pending', pass: 'npc-role-anims',
      });
    }
  }

  // Wildlife static states: sleeping, dead, decomposing→bones
  for (const [species, data] of Object.entries(ids.quadrupeds)) {
    const stateDir = join(WILDLIFE_DIR, species);
    const displayName = species.replace(/-/g, ' ');

    // Sleeping state (static, south-facing, curled up)
    if (!existsSync(join(stateDir, 'sleep-state_s.png'))) {
      queue.push({
        type: 'create_object_state', name: `${species}-sleep-state`,
        characterId: data.id,
        description: `sleeping, curled up on the ground, eyes closed, peaceful, still, south-facing`,
        outputPath: join(stateDir, 'sleep-state_s.png'),
        status: 'pending', pass: 'wildlife-states',
      });
    }

    // Dead state (static, lying on side)
    if (!existsSync(join(stateDir, 'dead-state_s.png'))) {
      queue.push({
        type: 'create_object_state', name: `${species}-dead-state`,
        characterId: data.id,
        description: `dead, lying on side, motionless, eyes closed, limbs limp, south-facing`,
        outputPath: join(stateDir, 'dead-state_s.png'),
        status: 'pending', pass: 'wildlife-states',
      });
    }

    // Decomposition animation: dead → skeleton → bones (v3 custom, south only)
    if (!existsSync(join(stateDir, 'decompose_s.png'))) {
      queue.push({
        type: 'animate', species, characterId: data.id,
        mode: 'v3',
        actionDescription: `decomposing after death, body gradually decaying, flesh fading away, revealing skeleton, ending as bare bones on the ground`,
        frameCount: 16, directions: ['south'],
        status: 'pending', pass: 'wildlife-decompose',
      });
    }
  }

  // NPC static states: sleeping, dead
  for (const npc of EXISTING_NPCS) {
    const npcDir = join(ROOT, 'public/assets/sprites/characters/npcs', npc.id);

    if (!existsSync(join(npcDir, 'sleep-state_s.png'))) {
      queue.push({
        type: 'create_object_state', name: `${npc.id}-sleep-state`,
        characterId: npc.pixelId,
        description: `sleeping, lying down or sitting slumped, eyes closed, peaceful, south-facing`,
        outputPath: join(npcDir, 'sleep-state_s.png'),
        status: 'pending', pass: 'npc-states',
      });
    }

    if (!existsSync(join(npcDir, 'dead-state_s.png'))) {
      queue.push({
        type: 'create_object_state', name: `${npc.id}-dead-state`,
        characterId: npc.pixelId,
        description: `dead, collapsed on the ground, motionless, south-facing`,
        outputPath: join(npcDir, 'dead-state_s.png'),
        status: 'pending', pass: 'npc-states',
      });
    }
  }

  // Wildlife portraits (96×96 side-view illustration for dialog/bestiary)
  const WILDLIFE_PORTRAIT_DIR = join(ROOT, 'public/assets/sprites/portraits/wildlife');
  const allWildlife = [...Object.keys(ids.quadrupeds), ...Object.keys(ids.birds)];
  for (const species of allWildlife) {
    const portraitPath = join(WILDLIFE_PORTRAIT_DIR, `${species}.png`);
    if (existsSync(portraitPath)) continue;
    const entry = ids.quadrupeds[species] || ids.birds[species];
    const displayName = species.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    queue.push({
      type: 'create_map_object',
      name: `portrait-wildlife-${species}`,
      description: `Pixel art portrait of a ${displayName}, side view facing left, transparent background. Natural realistic coloring, detailed fur/feather texture. Anime-tech-meets-fantasy style, selective outline.`,
      width: 96, height: 96, view: 'side',
      outputPath: portraitPath,
      status: 'pending', pass: 'wildlife-portraits',
    });
  }
}

// Bird animations — flight + ground behaviors
if (all || onlyBirds) {
  // Waterbird species that can swim
  const WATERBIRDS = new Set(['heron', 'stork', 'mallard', 'swan', 'kingfisher']);
  // Ground birds that walk/forage on the ground
  const GROUND_BIRDS = new Set(['pheasant', 'partridge', 'capercaillie', 'raven', 'great-tit', 'woodpecker', 'magpie']);
  // Birds of prey (perch, don't walk much)
  const RAPTORS = new Set(['buzzard', 'golden-eagle', 'white-tailed-eagle', 'sparrowhawk', 'goshawk', 'kestrel', 'red-kite', 'owl', 'barn-owl', 'eagle-owl']);

  for (const [species, data] of Object.entries(ids.birds)) {
    const isWaterbird = WATERBIRDS.has(species);
    const isGroundBird = GROUND_BIRDS.has(species);
    const isRaptor = RAPTORS.has(species);

    // Flight (8 directions, pro mode, 16 frames) — species-specific descriptions
    const FLIGHT_DESCS = {
      'buzzard':            'common buzzard soaring with broad rounded wings held in a shallow V-shape, tail fanned, riding thermals, slow deliberate wingbeats between long glides',
      'golden-eagle':       'golden eagle in powerful flight, massive wingspan fully extended, dark brown plumage with golden nape catching light, deep slow wingbeats, apex predator silhouette',
      'white-tailed-eagle': 'white-tailed eagle flying with huge broad plank-like wings, short wedge-shaped white tail visible, heavy deliberate flight, fingered wingtips',
      'sparrowhawk':        'sparrowhawk in fast agile flight, short rounded wings with rapid flap-flap-glide pattern, long tail for sharp turns, dashing between trees',
      'goshawk':            'goshawk flying with powerful direct flight, broad wings and long tail, muscular wingbeats, fierce predator moving through forest with precision',
      'kestrel':            'common kestrel hovering in wind, wings beating rapidly, tail fanned and angled down, head perfectly still scanning ground below, characteristic hover-hunting',
      'red-kite':           'red kite soaring gracefully, long forked russet tail twisting to steer, angled wings with pale patches, elegant effortless flight',
      'owl':                'tawny owl in silent flight, round face forward, broad rounded wings beating softly, feathers muffling sound, ghostly nocturnal hunter',
      'barn-owl':           'barn owl gliding silently on pale wings, heart-shaped white face, golden-buff upperparts, legs dangling slightly, hunting low over fields',
      'eagle-owl':          'eagle owl in powerful flight, massive orange eyes visible, ear tufts flattened, enormous wingspan with deep wingbeats, largest European owl',
      'heron':              'grey heron flying with slow deep wingbeats, long neck folded in S-shape tucked back, long legs trailing behind, broad bowed wings',
      'stork':              'white stork soaring with neck outstretched forward, long red legs trailing straight behind, black and white wings spread wide, thermal-riding migration flight',
      'mallard':            'mallard duck in fast direct flight, rapid wingbeats, short wings whirring, iridescent green head visible on male, compact powerful flight',
      'swan':               'mute swan in flight with neck outstretched forward, powerful rhythmic wingbeats creating whooping sound, large white body, heavy majestic flight',
      'kingfisher':         'kingfisher darting in fast low flight over water, electric blue back flashing, short wings whirring rapidly, orange belly, arrow-straight trajectory',
      'woodpecker':         'great spotted woodpecker in distinctive bounding undulating flight, wings folded closed between bursts of rapid flapping, red under-tail visible',
      'raven':              'raven in confident acrobatic flight, glossy black plumage, wedge-shaped tail, deep croaking wingbeats alternating with soaring glides, playful barrel rolls',
      'great-tit':          'great tit in small bounding flight, rapid wing fluttering between brief closed-wing pauses, undulating trajectory, yellow-green body with black head stripe',
      'pheasant':           'pheasant in explosive burst flight, short rounded wings beating frantically, long copper tail streaming behind, low fast escape flight through cover',
      'partridge':          'grey partridge in whirring low flight, rapid wingbeats on short rounded wings, gliding on bowed wings between bursts, hugging close to ground',
      'capercaillie':       'capercaillie in heavy powerful flight through forest, large dark body, broad wings beating with audible whooshing, crashing through branches, impressive size',
    };

    const flightDesc = FLIGHT_DESCS[species] || `${species.replace(/-/g, ' ')} flying with wings spread`;
    const ALL_DIRS = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west'];

    for (const dir of ALL_DIRS) {
      if (hasSprite(species, 'fly', dir === 'south' ? 'south' : dir.replace(/-/g, ''))) continue;
      // Check abbreviated dir too
      const dirAbbrev = { south: 's', 'south-east': 'se', east: 'e', 'north-east': 'ne', north: 'n', 'north-west': 'nw', west: 'w', 'south-west': 'sw' };
      if (hasSprite(species, 'fly', dirAbbrev[dir])) continue;

      queue.push({
        type: 'animate', species, characterId: data.id,
        mode: 'pro',
        actionDescription: flightDesc,
        frameCount: 16, directions: [dir],
        status: 'pending', pass: 'birds-flight',
        note: `Pro mode ${dir} — call without confirm_cost first, check cost, then confirm`,
      });
    }

    // Walk (8d) — ground birds + waterbirds (on land)
    if ((isGroundBird || isWaterbird) && !hasAllDirs(species, 'walk')) {
      queue.push({
        type: 'animate', species, characterId: data.id,
        mode: 'v3', actionDescription: 'walking on the ground, short steps, head bobbing',
        frameCount: 8, directions: 8,
        status: 'pending', pass: 'birds-ground',
      });
    }

    // Eat/peck (1d south) — ground birds + waterbirds
    if ((isGroundBird || isWaterbird) && !hasSprite(species, 'eat', 'south')) {
      queue.push({
        type: 'animate', species, characterId: data.id,
        mode: 'v3', actionDescription: 'pecking at the ground, eating, head down then up',
        frameCount: 8, directions: ['south'],
        status: 'pending', pass: 'birds-ground',
      });
    }

    // Swim (8d) — waterbirds only
    if (isWaterbird && !hasAllDirs(species, 'swim')) {
      queue.push({
        type: 'animate', species, characterId: data.id,
        mode: 'v3', actionDescription: 'swimming on water, floating, gentle paddling',
        frameCount: 8, directions: 8,
        status: 'pending', pass: 'birds-swim',
      });
    }

    // Landing (1d south) — all birds
    if (!hasSprite(species, 'land', 'south')) {
      queue.push({
        type: 'animate', species, characterId: data.id,
        mode: 'v3', actionDescription: 'landing, wings spread slowing down, feet reaching for ground',
        frameCount: 8, directions: ['south'],
        status: 'pending', pass: 'birds-ground',
      });
    }

    // Take-off (1d south) — all birds
    if (!hasSprite(species, 'takeoff', 'south')) {
      queue.push({
        type: 'animate', species, characterId: data.id,
        mode: 'v3', actionDescription: 'taking off, jumping up, wings opening and flapping upward',
        frameCount: 8, directions: ['south'],
        status: 'pending', pass: 'birds-ground',
      });
    }

    // Perch idle (1d south) — raptors (sitting on branch/post)
    if (isRaptor && !hasSprite(species, 'perch', 'south')) {
      queue.push({
        type: 'animate', species, characterId: data.id,
        mode: 'v3', actionDescription: 'perched on a branch, sitting still, alert, occasionally turning head',
        frameCount: 8, directions: ['south'],
        status: 'pending', pass: 'birds-ground',
      });
    }
  }
}

// Static art: buildings, furniture, tilesets, vegetation, UI, player
const onlyArt = args.includes('--art');
if (all || onlyArt) {
  const ART_DIR = join(ROOT, 'public/assets/sprites');

  // ── Tree wind variants (#994) — Terraria-style 2-frame canopy shift ──
  const TREE_SPECIES = [
    { prefix: 'tree-pine',   matureN: 3, youngN: 2 },
    { prefix: 'tree-spruce', matureN: 3, youngN: 3 },
    { prefix: 'tree-oak',    matureN: 14, youngN: 5 },
    { prefix: 'tree-birch',  matureN: 4, youngN: 4 },
    { prefix: 'tree-elm',    matureN: 4, youngN: 3 },
  ];
  for (const sp of TREE_SPECIES) {
    for (let i = 0; i < sp.matureN; i++) {
      const windPath = join(ART_DIR, `trees/${sp.prefix.replace('tree-','')}/mature/${i}-wind.png`);
      if (existsSync(windPath)) continue;
      queue.push({
        type: 'create_object_state', name: `${sp.prefix}-${i}-wind`,
        description: 'very subtle wind variant, canopy shifted 1-2 pixels, trunk unchanged, barely noticeable movement',
        characterId: null, // need to look up or create as object
        outputPath: windPath, status: 'pending', pass: 'tree-wind',
      });
    }
  }

  // ── Survival buildings (#992) — isometric exterior sprites ──
  const BUILDINGS = [
    // Tier 0
    { id: 'lean-to',          desc: 'A-frame of branches against rock, covered in pine boughs, simple survival shelter, Nordic bushcraft', w: 48, h: 48 },
    { id: 'campfire-ring',    desc: 'stone circle fire pit with small flames, surrounded by flat rocks, outdoor cooking spot', w: 32, h: 32 },
    { id: 'bedroll',          desc: 'fur hide bedroll on the ground, rolled out, simple sleeping pad near campfire', w: 32, h: 16 },
    // Tier 1
    { id: 'log-shelter',      desc: 'three-wall notched log structure with sloped bark roof, open front, rustic Nordic survival shelter', w: 64, h: 64 },
    { id: 'drying-rack',      desc: 'wooden A-frame drying rack with meat and herbs hanging, rope lashing, outdoor food preservation', w: 48, h: 48 },
    { id: 'storage-platform', desc: 'raised log platform on stilts, crates and sacks on top, bear-safe food storage', w: 48, h: 48 },
    { id: 'rain-barrel',      desc: 'hollowed log barrel collecting rainwater, birch bark funnel, simple water collection', w: 32, h: 32 },
    // Tier 2
    { id: 'log-cabin',        desc: 'small notched-corner log cabin with sod/grass roof, single door, chimney smoke, Nordic rustic', w: 64, h: 64 },
    { id: 'smokehouse',       desc: 'small log structure with smoke rising from roof vents, meat preservation building, rustic', w: 48, h: 48 },
    { id: 'wood-shed',        desc: 'open-sided log frame with bark roof, stacked firewood inside, simple storage structure', w: 48, h: 48 },
    { id: 'fire-pit-spit',    desc: 'upgraded campfire with iron cooking spit, roasting meat, stone ring, outdoor cooking station', w: 48, h: 32 },
    // Tier 3
    { id: 'workshop',         desc: 'log building with workbench visible through open side, tool rack, crafting workshop, rustic', w: 64, h: 64 },
    { id: 'root-cellar',      desc: 'earth-covered mound with log-framed door, sod roof, underground storage entrance', w: 48, h: 48 },
    { id: 'animal-pen',       desc: 'log fence enclosure with gate, hay on ground, simple livestock pen', w: 64, h: 48 },
    { id: 'watchtower',       desc: 'elevated log platform with ladder, railing, scout lookout tower, rustic Nordic', w: 48, h: 64 },
    { id: 'bath-house',       desc: 'small log building with steam rising, stones visible near entrance, Nordic sauna/bath house', w: 48, h: 48 },
  ];
  for (const b of BUILDINGS) {
    const outPath = join(ART_DIR, `buildings/survival/${b.id}.png`);
    if (existsSync(outPath)) continue;
    queue.push({
      type: 'create_map_object', name: `building-${b.id}`,
      description: `Isometric pixel art building, low top-down view. ${b.desc}. Transparent background.`,
      width: b.w, height: b.h, view: 'low top-down',
      outputPath: outPath, status: 'pending', pass: 'buildings',
    });
  }

  // ── Furniture (#988) — isometric interior objects ──
  const FURNITURE = [
    { id: 'bed-single',     desc: 'wooden single bed with fur blanket, simple frame, pillow', w: 32, h: 32 },
    { id: 'bed-double',     desc: 'wide wooden bed with fur covers, two pillows, sturdy frame', w: 48, h: 32 },
    { id: 'table-small',    desc: 'small round wooden table, simple legs, a mug on top', w: 32, h: 32 },
    { id: 'table-large',    desc: 'long wooden dining table with benches, plates and cups', w: 48, h: 32 },
    { id: 'chair-stool',    desc: 'simple wooden stool, three legs, rustic', w: 16, h: 16 },
    { id: 'chest',          desc: 'wooden storage chest with iron bands, closed lid, loot container', w: 32, h: 24 },
    { id: 'fireplace',      desc: 'stone fireplace hearth with small fire burning, warm glow, rustic', w: 48, h: 48 },
    { id: 'workbench',      desc: 'sturdy wooden workbench with tools, vise, wood shavings, crafting station', w: 48, h: 32 },
    { id: 'forge-anvil',    desc: 'blacksmith forge with anvil, bellows, glowing coals, metalworking station', w: 48, h: 48 },
    { id: 'brewing-barrel', desc: 'large wooden barrel on stand, tap at front, brewing/fermenting station', w: 32, h: 32 },
    { id: 'loom',           desc: 'upright wooden loom with partially woven fabric, weaving station', w: 32, h: 48 },
    { id: 'cooking-pot',    desc: 'iron cauldron on tripod over small fire, steam rising, cooking station', w: 32, h: 32 },
    { id: 'shelves',        desc: 'wooden wall shelves with jars, bottles, and supplies, storage', w: 32, h: 48 },
    { id: 'lantern',        desc: 'hanging iron lantern with warm yellow glow, chain, decorative light', w: 16, h: 24 },
    { id: 'rug',            desc: 'woven patterned rug on floor, warm colors, Nordic textile design', w: 32, h: 32 },
  ];
  for (const f of FURNITURE) {
    const outPath = join(ART_DIR, `furniture/${f.id}.png`);
    if (existsSync(outPath)) continue;
    queue.push({
      type: 'create_map_object', name: `furniture-${f.id}`,
      description: `Isometric pixel art furniture, low top-down view. ${f.desc}. Transparent background.`,
      width: f.w, height: f.h, view: 'low top-down',
      outputPath: outPath, status: 'pending', pass: 'furniture',
    });
  }

  // ── Cave entrance + tileset (#984, #987) ──
  if (!existsSync(join(ART_DIR, 'buildings/cave-entrance.png'))) {
    queue.push({
      type: 'create_map_object', name: 'cave-entrance',
      description: 'Isometric rock cliff face with dark cave opening, moss around edges, mysterious interior glow, entrance to underground. Low top-down view.',
      width: 64, height: 48, view: 'low top-down',
      outputPath: join(ART_DIR, 'buildings/cave-entrance.png'),
      status: 'pending', pass: 'cave',
    });
  }

  // ── Caravan trade camp + goods (#1019) ──
  const CARAVAN_OBJECTS = [
    { id: 'trade-camp',    desc: 'small canvas tent/market stall with displayed goods, warm lantern, inviting trade spot', w: 48, h: 48 },
    { id: 'trade-crates',  desc: 'stack of wooden crates and barrels, rope-tied, trade goods containers', w: 32, h: 24 },
    { id: 'trade-blanket', desc: 'spread blanket on ground with displayed wares (gems, tools, bottles), market display', w: 32, h: 32 },
  ];
  for (const c of CARAVAN_OBJECTS) {
    const outPath = join(ART_DIR, `objects/caravan/${c.id}.png`);
    if (existsSync(outPath)) continue;
    queue.push({
      type: 'create_map_object', name: `caravan-${c.id}`,
      description: `Isometric pixel art, low top-down view. ${c.desc}. Transparent background.`,
      width: c.w, height: c.h, view: 'low top-down',
      outputPath: outPath, status: 'pending', pass: 'caravan-objects',
    });
  }

  // ── Water vegetation (#1012) ──
  const WATER_VEG = [
    { id: 'lily-pad-cluster',  desc: 'cluster of 3-4 green lily pads floating on water, one with white flower blooming', w: 32, h: 32 },
    { id: 'lily-pad-single',   desc: 'single green lily pad with yellow flower, floating on water surface', w: 16, h: 16 },
    { id: 'reed-cluster',      desc: 'tall reeds/cattails (vass/kaveldun) growing from water edge, brown seed heads, 4-5 stalks', w: 32, h: 48 },
    { id: 'reed-sparse',       desc: '2-3 thin reed stalks at water edge, subtle, marsh grass', w: 16, h: 32 },
    { id: 'water-grass',       desc: 'low green grass tufts emerging from shallow water, marsh vegetation', w: 16, h: 16 },
    { id: 'duckweed-patch',    desc: 'small cluster of tiny green dots on water surface, duckweed/andmat, floating', w: 16, h: 16 },
  ];
  for (const v of WATER_VEG) {
    const outPath = join(ART_DIR, `vegetation/water/${v.id}.png`);
    if (existsSync(outPath)) continue;
    queue.push({
      type: 'create_map_object', name: `waterveg-${v.id}`,
      description: `Isometric pixel art, low top-down view. ${v.desc}. Transparent background.`,
      width: v.w, height: v.h, view: 'low top-down',
      outputPath: outPath, status: 'pending', pass: 'water-vegetation',
    });
  }

  // ── UI Art (#898-901) ──
  const UI_SPRITES = [
    { id: 'panel-dark',    desc: 'dark UI panel with double gold border, tech-rune fantasy style, nine-slice compatible', w: 96, h: 96, pass: 'ui-panels' },
    { id: 'panel-warm',    desc: 'warm brown UI panel with gold trim, fantasy parchment feel, nine-slice compatible', w: 96, h: 96, pass: 'ui-panels' },
    { id: 'panel-tooltip', desc: 'small dark tooltip frame with thin border, compact, nine-slice compatible', w: 64, h: 48, pass: 'ui-panels' },
    { id: 'panel-dialog',  desc: 'wide dialog box frame with decorative top edge, NPC conversation panel, nine-slice', w: 128, h: 64, pass: 'ui-panels' },
    { id: 'btn-primary',   desc: 'primary action button, gold border, glowing center, idle state, fantasy UI', w: 64, h: 24, pass: 'ui-buttons' },
    { id: 'btn-secondary', desc: 'secondary/ghost button, thin border, subtle, idle state', w: 64, h: 24, pass: 'ui-buttons' },
    { id: 'btn-close',     desc: 'small X close button, circular, red accent', w: 24, h: 24, pass: 'ui-buttons' },
    { id: 'slot-empty',    desc: 'empty inventory slot, inner shadow, dark background, subtle border', w: 48, h: 48, pass: 'ui-slots' },
    { id: 'slot-selected', desc: 'selected inventory slot, glowing gold border, highlighted', w: 48, h: 48, pass: 'ui-slots' },
    { id: 'bar-hp-frame',  desc: 'health bar frame, segmented, dark border, horizontal, CrossCode-style', w: 96, h: 16, pass: 'ui-bars' },
    { id: 'bar-xp-frame',  desc: 'experience bar frame, thin, subtle blue tint, horizontal', w: 96, h: 12, pass: 'ui-bars' },
  ];
  for (const ui of UI_SPRITES) {
    const outPath = join(ART_DIR, `ui/${ui.id}.png`);
    if (existsSync(outPath)) continue;
    queue.push({
      type: 'create_map_object', name: `ui-${ui.id}`,
      description: `Pixel art UI element. ${ui.desc}. Transparent background, crisp edges, no anti-aliasing.`,
      width: ui.w, height: ui.h, view: 'front',
      outputPath: outPath, status: 'pending', pass: ui.pass,
    });
  }

  // ── Water animation tiles (#999) ──
  const WATER_TILES = [
    { id: 'river-1', desc: 'isometric water tile, energetic river flow, light blue with white shimmer highlights, flowing movement frame 1 of 4' },
    { id: 'river-2', desc: 'isometric water tile, energetic river flow, light blue with white shimmer shifted, flowing movement frame 2 of 4' },
    { id: 'river-3', desc: 'isometric water tile, energetic river flow, white foam crest visible, flowing movement frame 3 of 4' },
    { id: 'river-4', desc: 'isometric water tile, energetic river flow, foam dissolving back to shimmer, flowing movement frame 4 of 4' },
    { id: 'lake-1',  desc: 'isometric water tile, calm still lake surface, dark reflective blue, very subtle ripple, frame 1 of 4' },
    { id: 'lake-2',  desc: 'isometric water tile, calm lake surface, slight brightness shift on surface, barely perceptible change, frame 2 of 4' },
    { id: 'lake-3',  desc: 'isometric water tile, calm lake with single subtle ripple ring visible, frame 3 of 4' },
    { id: 'lake-4',  desc: 'isometric water tile, calm lake returning to still, nearly identical to frame 1, frame 4 of 4' },
    { id: 'ocean-shore-1', desc: 'isometric coastal water tile, shore edge with foam line, light teal water meeting sand, lapping wave frame 1 of 4' },
    { id: 'ocean-shore-2', desc: 'isometric coastal water tile, foam line advancing slightly toward shore, wave building, frame 2 of 4' },
    { id: 'ocean-shore-3', desc: 'isometric coastal water tile, foam at maximum shore extent, white crest breaking, frame 3 of 4' },
    { id: 'ocean-shore-4', desc: 'isometric coastal water tile, foam receding, wave retreating from shore, frame 4 of 4' },
  ];
  for (const t of WATER_TILES) {
    const outPath = join(ART_DIR, `tilesets/water/${t.id}.png`);
    if (existsSync(outPath)) continue;
    queue.push({
      type: 'create_isometric_tile', name: `water-${t.id}`,
      description: `${t.desc}. 32x32 isometric diamond. Transparent background.`,
      outputPath: outPath, status: 'pending', pass: 'water-tiles',
    });
  }

  // ── Cave tileset (#987) ──
  const CAVE_TILES = [
    { id: 'cave-floor-dark',    desc: 'dark stone cave floor, rough texture, grey-brown, underground' },
    { id: 'cave-floor-wet',     desc: 'wet stone cave floor, slight shine/reflection, darker patches near water' },
    { id: 'cave-floor-gravel',  desc: 'loose gravel and rubble cave floor, broken rocks scattered' },
    { id: 'cave-wall-south',    desc: 'cave rock wall face, south-facing cliff, jagged grey stone, dark shadows' },
    { id: 'cave-wall-east',     desc: 'cave rock wall face, east-facing cliff, rough stone texture' },
    { id: 'cave-crystal-blue',  desc: 'glowing blue crystal formation growing from cave floor, magical glow, translucent' },
    { id: 'cave-crystal-green', desc: 'glowing green crystal cluster, smaller, embedded in rock, faint glow' },
    { id: 'cave-mushroom',      desc: 'cluster of bioluminescent mushrooms on cave floor, soft purple glow, fantasy' },
    { id: 'cave-stalactite',    desc: 'hanging stalactite formation from cave ceiling, dripping water, grey stone' },
    { id: 'cave-pool',          desc: 'small underground water pool, dark still water, cave floor around edges' },
    { id: 'cave-ore-iron',      desc: 'iron ore vein in cave wall, rusty orange-brown streaks in dark rock' },
    { id: 'cave-ore-copper',    desc: 'copper ore vein in cave wall, green-blue streaks in grey stone' },
  ];
  for (const t of CAVE_TILES) {
    const outPath = join(ART_DIR, `tilesets/cave/${t.id}.png`);
    if (existsSync(outPath)) continue;
    queue.push({
      type: 'create_isometric_tile', name: `cave-${t.id}`,
      description: `Isometric cave tile. ${t.desc}. 32x32 diamond. Transparent background.`,
      outputPath: outPath, status: 'pending', pass: 'cave-tiles',
    });
  }

  // ── Interior tileset (#970) ──
  const INTERIOR_TILES = [
    { id: 'floor-wood-plank',  desc: 'wooden plank floor, warm brown, visible board seams, interior' },
    { id: 'floor-wood-dark',   desc: 'dark aged wooden floor, worn finish, old cabin interior' },
    { id: 'floor-stone',       desc: 'cut stone floor, grey, mortared joints, castle/cellar interior' },
    { id: 'floor-dirt',        desc: 'packed dirt floor, brown earth, root cellar or barn interior' },
    { id: 'wall-wood-south',   desc: 'wooden log wall, south-facing, horizontal logs with visible notch joints' },
    { id: 'wall-wood-east',    desc: 'wooden log wall, east-facing, horizontal logs, slightly different angle' },
    { id: 'wall-stone-south',  desc: 'stone wall, south-facing, stacked grey stones with mortar' },
    { id: 'wall-stone-east',   desc: 'stone wall, east-facing, stacked stones, slightly different angle' },
    { id: 'door-wood-open',    desc: 'open wooden door in wall frame, interior doorway, warm light through' },
    { id: 'door-wood-closed',  desc: 'closed wooden door with iron hinges and handle, solid planks' },
    { id: 'window-small',      desc: 'small window in wall, wooden frame, light coming through, interior view' },
  ];
  for (const t of INTERIOR_TILES) {
    const outPath = join(ART_DIR, `tilesets/interior/${t.id}.png`);
    if (existsSync(outPath)) continue;
    queue.push({
      type: 'create_isometric_tile', name: `interior-${t.id}`,
      description: `Isometric interior tile. ${t.desc}. 32x32 diamond. Transparent background.`,
      outputPath: outPath, status: 'pending', pass: 'interior-tiles',
    });
  }

  // ── Road tiles (#812) ──
  const ROAD_TYPES = [
    { id: 'road-dirt-straight',   desc: 'isometric dirt path tile, worn earth, subtle tracks, straight section' },
    { id: 'road-dirt-corner',     desc: 'isometric dirt path tile, worn earth, 90 degree corner/bend' },
    { id: 'road-dirt-cross',      desc: 'isometric dirt path tile, worn earth, crossroads intersection' },
    { id: 'road-dirt-end',        desc: 'isometric dirt path tile, worn earth, dead end with grass creeping in' },
  ];
  for (const r of ROAD_TYPES) {
    const outPath = join(ART_DIR, `tilesets/roads/${r.id}.png`);
    if (existsSync(outPath)) continue;
    queue.push({
      type: 'create_isometric_tile', name: r.id,
      description: `${r.desc}. 32x32 isometric diamond tile. Transparent background.`,
      outputPath: outPath, status: 'pending', pass: 'road-tiles',
    });
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────

const byPass = {};
for (const item of queue) {
  byPass[item.pass] = (byPass[item.pass] || 0) + 1;
}

console.log(`\nQueue generated: ${queue.length} items`);
for (const [pass, count] of Object.entries(byPass)) {
  console.log(`  ${pass}: ${count}`);
}

// Estimate generations
let estGens = 0;
for (const item of queue) {
  const dirs = Array.isArray(item.directions) ? item.directions.length
    : item.directions === 8 ? 8 : 1;
  if (item.mode === 'pro') estGens += dirs * 25;  // pro: ~20-30 gens per direction
  else estGens += dirs;  // template/v3: 1 gen per direction
}
console.log(`\nEstimated generations: ~${estGens}`);

// ── Write queue ──────────────────────────────────────────────────────────────

writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2) + '\n');
console.log(`\nWritten to: ${QUEUE_FILE}`);
console.log('Run: node scripts/pixellab-burn.mjs');
