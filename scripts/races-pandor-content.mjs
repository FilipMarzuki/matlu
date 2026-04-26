/**
 * Notion field copy for the `pandor` Races page (#693).
 * Source of truth for wording pushed to Notion; cache comes from `npm run races:sync`.
 */

export const RACES_DB_ID = '34e843c0-718f-81a3-b4c8-c0ff6839bd21';

export const pageProperties = {
  Name: { title: [{ type: 'text', text: { content: 'Pandor' } }] },
  id: { rich_text: [{ type: 'text', text: { content: 'pandor' } }] },
  bodyPlan: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Quasi-humanoid: upright biped with two arms, two legs, and five digits on hands and feet; plantigrade. Torso is deep and barrel-chested relative to humans; limbs thick but still within scholar-labourer scale rather than giant mass-class. No tail, no extra limbs, no secondary muzzle that replaces a readable humanoid face at sprite scale — ursine identity comes from markings, ear shape, fur length, and cranial roundness.',
        },
      },
    ],
  },
  spriteResolution: { number: 32 },
  silhouette: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Short, wide oval on thick legs: a broad head cap with two rounded ear lumps and a high-contrast “mask” band across the eyes — reads as ink on cream before any muzzle detail.',
        },
      },
    ],
  },
  build: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Adults are compact and heavy-boned: about 5–5.5 heads tall (stocky), broad shoulders and hips, short neck, weight through the full foot. Children carry a larger head on a shorter torso and limbs; the face mask reads softer at the edges. Adolescents lengthen in the legs before the chest finishes widening. Elders keep upright posture; fur at the ears and mask margin greys or thins, temples hollow slightly, and the hand reads bonier under coat.',
        },
      },
    ],
  },
  surface: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Dense underfur with longer guard hairs; ground colours run warm cream, rice-paper ivory, and cool mist-grey, with charcoal, soot, or deep umber for the classic periorbital “spectacle,” ear fronts, and often forearms or shoulders as species pigment (not cosmetics). Nose leather and palmar/plantar skin can read pink-brown to blue-grey. No scales, plates, or bare hide patches except nose and digital pads implied under fur.',
        },
      },
    ],
  },
  head: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Face is broad and round with a short upper lip and shallow snout projection — less pronounced than a real giant panda, enough for sprite clarity. Eyes sit within the dark mask band; pupils round like a human’s. Ears are round-tipped, wide-set, and thickly furred. Jaw is wide; teeth follow human layout without enlarged carnivore canines. No horns; a slightly raised cap of longer occipital fur is allowed.',
        },
      },
    ],
  },
  anatomy: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Plantigrade feet with a strong arch and thick digital pads under fur; hallux present and load-bearing. Hands favour grip and fine work: sturdy wrists, palms a bit broad, fingers shorter relative to palm than a lanky human. Rib cage is wide for stature (comfortable sustained walking in thin highland air at a mundane, anatomical level — not a magical trait). Fur bulk adds silhouette width without extra bones or limbs.',
        },
      },
    ],
  },
  variation: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Sex: adult silhouettes overlap; on average one pattern runs squarer at the shoulders and jaw, another slightly wider pelvis, with full overlap. Age: young children — oversized head, large ears, soft mask edges; tweens — gangly leg growth; adults — filled chest; seniors — silvering at mask rim and ear tufts, finer guard hair, slight retraction of cheek fluff. Regional: cooler highland lineages may read greyer cream and sharper mask contrast; milder valleys may read warmer ivory and softer band edges — paint as gradient variants only.',
        },
      },
    ],
  },
  senses: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Vision is human-typical in daylight and twilight; the mask is pigment, not a night-vision organ. Hearing benefits from small, mobile pinnae under fur. Smell modestly above human baseline for ink, paper sizing, damp bamboo, and loam — express with nostril flare, not a wet carnivore nose.',
        },
      },
    ],
  },
  lifespan: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Near-adult proportions by about 16–18 years; prime roughly 20–50; ageing shows grey or silver at mask margins and ears, thinning cheek mane, and more pronounced fur lines at the eyes. Typical span into the 70s; no exceptional longevity.',
        },
      },
    ],
  },
  spriteNote: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'At 32px, sell Pandor with two dark ear pixels or one rounded ear arc, a bold eye mask (paired wedges or a shallow U), and a torso one pixel wider than a human hero of the same tile height. Scallop the head outline for fur; keep the face to one bright eye pair inside the mask. Hands and feet are three-lobe blobs unless a pose needs fingers. No micro-muzzle — mask + ears carry the species read.',
        },
      },
    ],
  },
};

/** Page body — mood, references, and scope note. */
export const pageBodyBlocks = [
  {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: 'Mood and visual references' } }],
    },
  },
  {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [
        {
          type: 'text',
          text: {
            content:
              'Mood: still concentration, archive hush, mist-grey patience — panda-lineage scholars, not feral bears or mascot caricature. Visual anchors: giant panda colour logic on a stocky, upright humanoid frame; aligns to WORLD.md “panda scholars of the highland mist” and the Pandor People row in docs/peoples-and-races.md. Legacy settlement id pandor maps to the Pandor People.',
          },
        },
      ],
    },
  },
  {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [
        {
          type: 'text',
          text: {
            content:
              'Robes, scroll gear, kloster architecture, and brewing are culture. This page locks bare species surface, proportions, and markings only.',
          },
        },
      ],
    },
  },
];
