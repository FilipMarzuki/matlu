/**
 * Notion field copy for the `sjovandrare` Races page (#696).
 * Legacy visual spec for the old harborfolk race id; settlement weights now
 * sample Markfolk and Deepwalkers (see docs/peoples-and-races.md).
 */

import { RACES_DB_ID } from './races-vindfarare-content.mjs';

export { RACES_DB_ID };

export const SJOVANDRARE_RACE_ID = 'sjovandrare';

export const pageProperties = {
  Name: { title: [{ type: 'text', text: { content: 'Sjövandrare' } }] },
  id: { rich_text: [{ type: 'text', text: { content: 'sjovandrare' } }] },
  bodyPlan: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Quasi-humanoid: two arms, two legs, upright stance on a human baseline. Maritime adaptations stay subtle: partial webbing between toes (and at most a trace along fingers to the first knuckle), denser connective tissue around ankles and wrists for wet stone and deck work, and a ribcage that reads slightly broad for cold-water breath-hold and buoyancy. Still reads as “person of the shore,” not merfolk tail, caudal fin, or ichthyic head.',
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
            'Low, wide diamond: a rounded cap of head mass, short neck, shoulders and hips both carrying width, feet slightly turned out — the shape that reads “harbor stance” at sprite scale before costume or props.',
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
            'Adults trend shorter and stockier than inland norms (about 6.5–7.0 heads tall) with a low center of mass and knees that rest slightly unlocked. Slightly bowed “rope-and-rock” legs are habit from piers and swell, not skeletal deformity. Children are round in the torso with a large head; teens widen through chest and back before limbs finish lengthening. Elders keep the wide frame; mass may soften forward while feet and stance stay planted.',
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
            'Palette: sea-glass teal undertone, kelp brown, grey-green, salt-bleached forearms, and cool grey at lips and eyelids; diffuse mottling on shoulders and back like light through ripples. Skin is smooth and thick-stratum with a faint oily sheen at hairline and wrists in large art (optional at 32px). Sparse body hair; scalp hair often heavy and wavy as default texture — not an outfit choice.',
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
            'Eyes large, slightly hooded against glare; allow one crisp corneal highlight to suggest strong reflectivity in pier light — not a glow or “night vision” shine. Ears low-set, compact, with a thickened anti-tragus ridge that sheds spray. Nose short-to-medium, nostrils mobile. Jaw broad but soft; teeth within human range — slight emphasis on incisors is acceptable as a shell-cracking echo, never predator fangs. No horns. Optional low cartilaginous nuchal ridge at the hairline for streamlining, smooth not spiny.',
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
            'Versus generic human: (1) toe webbing to roughly one-third span; finger webbing, if shown, stops before the proximal knuckle so hands stay articulate; (2) Achilles region reads as a clean tendon line in hi-res; (3) modest subcutaneous fat tuned for cold immersion; (4) palms and soles can flush visibly after cold water. No gills or neck slits; breath-hold physiology is internal. No extra limbs.',
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
            'Sex: adult builds overlap; on average one pattern runs a broader pelvis and wider hands, another a flatter torso and longer reach — individuals mix freely. Age: infants show bright webbing blush; young children have oversized heads, short thick limbs, and obvious toe webbing; teens lengthen with defined calves and forearms; elders show coarser skin mottle, thinner scalp density, and paler, softer webbing edges. Regional: inner-harbor lineages may read duskier with heavier lids; outer-isle lineages may read leaner with longer limbs — soft gradients for variants, not hard sub-races.',
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
            'Vision favors horizon scan and shallow-water shimmer; good discrimination in blue-green water tones, ordinary night vision (human coastal, not feline). Hearing acute for hull slap, rope strain, and low thumps transmitted through hulls and feet — inner ear slightly robust. Taste/smell biased to salt and brine freshness versus rot; nostril mobility supports that, not whiskers.',
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
            'Physical maturation about 17–19 years in rough harbors, prime roughly 22–50, then ageing with joint thickening, sun-and-salt vascular maps on skin, and slowly reduced cold tolerance. Lifespan broadly human; very old adults may show webbing margins that look softened or thinned as skin loses turgor.',
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
            'At 32px: grounded wide stance (feet clearly apart), blocky torso, short neck, one strong eye highlight, hair as one or two solid masses (avoid tall narrow vertical — that belongs to windfarer reads). Toe webbing: a single darker V between feet if the palette allows; otherwise imply with splayed foot blobs. Hands mitten-simple unless a hero close-up frame.',
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
              'Mood: patient, briny, lantern-and-tide. Visual anchors: harbor heron, oyster farmer, cold-water freediver — not merfolk tail fantasy, not pirate costume kitsch. Fictional race for the Matlu multiworld. Legacy id `sjovandrare` maps to the old harborfolk culture row in settlement data; Markfolk and Deepwalkers weights replaced that slot for generation, while this page keeps the shore-body visual spec for sprites and codex.',
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
              'Clothes, kit, boats, and architecture are culture. Do not use this page to lock costume — only bare anatomy and default surface variation.',
          },
        },
      ],
    },
  },
];
