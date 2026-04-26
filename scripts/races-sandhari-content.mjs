/**
 * Notion field copy for the `sandhari` Races page (#695).
 * Kept in-repo so the sync cache matches authored canon without duplicating long strings in two places.
 */

import { RACES_DB_ID } from './races-vindfarare-content.mjs';
export { RACES_DB_ID };

export const pageProperties = {
  Name: { title: [{ type: 'text', text: { content: 'Sandhari' } }] },
  id: { rich_text: [{ type: 'text', text: { content: 'sandhari' } }] },
  bodyPlan: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Humanoid, fully upright, with proportions skewed for heat dissipation: long limbs relative to torso, narrow frame, slightly extended neck. No extra digits, secondary limbs, or non-human segments. Reads as "desert-tall" before any surface detail.',
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
            'Long-limbed narrow vertical frame with large, slightly forward-cupped ears as the primary distinguishing element — the "heat-ear" silhouette reads as desert before any colour does.',
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
            'Adults average slightly taller than a human median (about 7.2–7.8 heads tall) but with a markedly low mass: long shanks, long forearms, a narrow pelvis, and a lean torso. Neck is long relative to the head; shoulders are level and fairly narrow, no barrel chest. Adolescents have the length before the muscle definition arrives. Elders show tendon and knuckle lines clearly as subcutaneous fat thins, and the ear cartilage continues to elongate slowly.',
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
            'Palette runs warm sand tones — pale ochre through deep sienna — with a dull matte finish that limits glare reflection. Scalp hair is tightly coiled, worn close in most lineages. Eye pigment tends amber, brown, or grey-green; no reflective tapetum, no cat slit. A coarse fine vellus covers the torso and upper limbs; it does not read at 32px. No scales, no metallic sheen.',
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
            'Slightly elongated skull with a high crown. Eyes are wide-set with a dense but narrow brow ridge that shades them in high-angle sun; a heavy inner canthus fold softens the orbital line. Ears are large and somewhat forward-cupped with a tall helix — the key silhouette marker at sprite scale. Nose is broad at the base with muscular, filter-capable nostrils (the owner can close them partially against blown sand); bridge is medium-high. Jaw is long, chin rounded. Teeth within human class; no predator fangs.',
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
            'Beyond humanoid baseline: (1) metatarsals are slightly elongated — still plantigrade, but the wide foot base provides stability on loose sand; (2) rib cage is long and narrow, giving the torso a hollow-flanked silhouette; (3) ear cartilage exhibits continuous slow growth throughout life (common in long-lived desert mammals), so ear length is a rough age proxy in large art. No structural departures from bipedal humanoid: these are degree-of-variation adaptations only.',
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
            'Sex: adults share a build envelope; one tendency runs slightly narrower-shouldered with more pronounced ear length; another runs slightly broader-shouldered with lower-set ears — population-level softcounts, not reliable individual markers. Age: children have oversized heads and already-prominent ears relative to short bodies, giving a top-heavy silhouette; teens extend in the limbs first; the ear-to-head ratio "normalises" as the frame catches up; elderly individuals have clearly longer lower-lobe lines readable in large art. Regional: northern desert lineages run paler ochre with amber eyes; deep-interior lineages run dark sienna to near-ebony at elbows and knuckles, with grey-green eyes.',
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
            'Vision adapted for high-glare flat terrain: the brow ridge reduces overhead glare, and colour discrimination in the yellow-red band is slightly above human norm — useful for reading heat shimmer and subtle ground texture. Night vision is human-grade. Hearing favours mid-range frequencies; the large cupped ear catches long-distance low-volume sounds across open terrain. Smell is human; nostril musculature can partially close against blown sand.',
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
            'Physical maturation around 17–19 years, prime roughly 22–50, gradual ageing thereafter: skin loosens and loses the matte-tight finish, ear cartilage elongates further, deep eye-socket shadow increases. No extraordinary lifespan versus human baseline. Cold and damp climates accelerate joint degradation; the elderly are still mobile in warm dry conditions. Sprite age cue: enlarged ear relative to head width, slight forward neck-lean, visible joint definition.',
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
            'At 32px, lead with large cupped ears (1–2 pixel lateral protrusion from the head block), long shanks (3–4 pixel lower legs), and an ochre-to-sienna warm palette. Keep a normal 2-pixel head block — do not shrink it to "make room" for the ears; let the ear extend 1 pixel out each side instead. Brow ridge, vellus, and nostril detail do not resolve; rely on warm palette and ear silhouette for identity. Child sprites: oversized head block, very short legs, ears already prominent.',
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
              'Mood: dry heat, long sight lines, unhurried endurance. Visual anchors: lean desert runner and long-distance trader — not exotic or fantastical, not bestial. The ear is the single non-human tell; everything else reads as a lean, sun-hardened humanoid. Fictional race for the Matlu multiworld. The caravan-folk culture no longer carries a racePreferences entry (the canonical 15 Peoples have no desert People); this page is the dedicated visual spec tied to the legacy sandhari id for sprites and the codex.',
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
              'Clothes, kit, and architecture are culture. Do not use this page to lock costume or caravan equipment — only bare anatomy and default surface variation.',
          },
        },
      ],
    },
  },
];
