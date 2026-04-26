/**
 * Notion field copy for the `human` Races page (#689).
 * Source of truth for wording pushed to Notion; cache comes from `npm run races:sync`.
 */

export const RACES_DB_ID = '34e843c0-718f-81a3-b4c8-c0ff6839bd21';

export const pageProperties = {
  Name: { title: [{ type: 'text', text: { content: 'Human' } }] },
  id: { rich_text: [{ type: 'text', text: { content: 'human' } }] },
  bodyPlan: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Humanoid: two arms, two legs, upright biped — the baseline body plan from which all quasi-humanoid Peoples are measured. No tail, wings, extra limbs, or significant skeletal deviations. Legacy id `human` maps to Markfolk (southern plains farmers) and Deepwalkers (coastal and cave peoples) in settlement data, reflecting that unmodified humanoid physiology underlies both lineages.',
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
            'Medium vertical column with a balanced shoulder-to-hip read and a rounded head — no crests, pointed ears, or projections; readable at sprite scale purely by balanced proportion and pose.',
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
            'Adults run 6.5–7.5 heads tall with moderate build and no extreme proportions — the reference envelope other Peoples deviate from. Children carry a large head on a compact torso with short limbs; teens stretch in leg length before shoulders and hips widen; adults hold stable proportions through midlife. Elders retain most height but lose muscle volume gradually, with reduced neck mass and flatter deltoids.',
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
            'Wide palette from pale northern tones through warm olive to deep river-delta brown; no species-specific patterning, scales, lichen marks, or speckle. Fine vellus on forearms and shins; scalp hair variable in texture and density. No striae, bark-grain, or gloss that belongs to another People.',
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
            'Eyes forward-set, medium-sized, round pupils; one corneal highlight. Ears small-to-medium, set level with the eyes, rounded lobes — no points, ridges, or elongation above the hairline. Nose medium with moderate nostrils. Jaw rounded; teeth within standard occlusion, no tusks or enlarged canines. No horns, bony crests, or nuchal ridges.',
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
            'Standard biped with no habitat-specific adaptations. Hands five-fingered with an opposing thumb; feet low-arched to flat, weight distributed heel-to-ball. Achilles tendon visible in large art but not distinctive at sprite scale. No interdigital webbing, patagia, tail, or structural asymmetry.',
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
            'Sex: adult silhouettes overlap fully; on average one pattern runs slightly broader shoulders and a squarer jaw, another slightly wider hips and a softer jawline — full overlap, large shared envelope. Age: infants show an oversized head and short, tucked limbs; children lose newborn proportions quickly; teens stretch before broadening; elders show reduced muscle mass, looser skin at jaw and neck, and greying scalp hair — height drops only very late. Regional: southern lineages (Markfolk-adjacent) can read a touch broader across the hands and feet from fieldwork; coastal lineages (Deepwalker-adjacent) may read slightly heavier through the ankle from stone and wet-ground work — soft gradients, not separate builds.',
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
            'Standard-baseline vision, hearing, and smell with no adaptive enhancements. Vision is trichromatic, front-weighted, good contrast in mid-range light — no superior night vision, no predator acuity. Hearing covers the common speech range; nothing anatomically distinct at the pinna. Smell broadly functional; no hunting or tracking enhancement shown as a structural feature.',
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
            'Physical maturation around 16–20 years; prime broadly 20–50; ageing visible from the mid-50s as greying hair, skin laxity at jaw and around the eyes, and gradually reduced muscle and fat volume. Typical span 60–80 years; elders stay mobile but posture may soften forward and movement slows. No exceptional longevity.',
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
            'At 32px the human reads by absence: no crest, no spike ears, no tail, no oversized jaw — a balanced column. Use a 3px torso block, 2px head with round-nub ears that do not clear the hairline, medium legs (2–3px shank). Age and sex read through width and silhouette curves, not feature additions. Palette range is the widest of any People; never let colour alone carry species identity — proportion is the only mark.',
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
              'Mood: unremarkable at a glance, immediately readable — the face in a crowd that every other silhouette is measured against. Visual anchors: reference-body anatomy drawing, classic game "peasant" or "townsfolk" neutral, warm-delta farmer. Not a stereotype of Earth fantasy human; this is simply the unmodified biped baseline that Mistheim\'s other Peoples diverge from.',
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
              'Legacy id `human` originally covered coastborn, ridgefolk, fieldborn, and wallborn cultures in settlement data; those now sample Markfolk, Deepwalkers, and Bergfolk weights. This page is the dedicated visual spec for the `human` slug as used in sprite pipelines and codex tooling — race anatomy only, no clothes, tools, or architecture.',
          },
        },
      ],
    },
  },
];
