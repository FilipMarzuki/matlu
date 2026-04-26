/**
 * Notion field copy for the `rotfolk` Races page (#694).
 * Source of truth for wording pushed to Notion; cache comes from `npm run races:sync`.
 */

export const RACES_DB_ID = '34e843c0-718f-81a3-b4c8-c0ff6839bd21';

export const pageProperties = {
  Name: { title: [{ type: 'text', text: { content: 'Rotfolk' } }] },
  id: { rich_text: [{ type: 'text', text: { content: 'rotfolk' } }] },
  bodyPlan: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Quasi-humanoid: two arms, two legs, upright biped on a human baseline. Same broad People as Lövfolk (eastern forest) but the legacy rotfolk slug describes lineages adapted to root-mat, humus, and understory light — not a separate culture or body plan from “canopy” Lövfolk sprites, only a stockier default morphology. No tail, wings, or extra limbs.',
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
            'Low, wide wedge: short vertical column with a broad hip/shoulder read and a rounded crown or “root-bun” mass — silhouette says “planted” before ears or face pixels; reads shorter and wider than the sylphari reed-line at the same tile height.',
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
            'Adults run about 5.5–6 heads tall: deep chest, shorter neck than sylphari, wide pelvis, weight through the whole foot on soft ground. Children carry a larger head on a compact torso, short shins, and a prominent crown tuft; teens gain leg length before shoulders finish widening. Elders keep mass low; hands and face show desiccation like leaf-scar tissue while height barely drops — slow-ageing Lövfolk cue, not frailty.',
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
            'Matte skin from birch-pale through humus brown and muted olive, often dusted with a cool grey-green cast in deep groves. Species-only patterning: fine vertical striae on forearms or flanks (bark-grain read), and pale lichen-freckle clusters at clavicle, temple, or knuckle — not cosmetics or clothing. Short vellus only; no scales, shell, or full pelt.',
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
            'Eyes large, slightly deep-set for dappled understory; round pupils. Ears shorter than sylphari’s, mildly pointed, hugging the skull — silhouette cue is width, not height. Nose broad with mobile nostrils for damp earth and fungal volatiles. Jaw human in range; teeth standard occlusion, no tusks or muzzle. Crown carries dense hair or stiff rootlet tuft that can stack into a soft “cap” mass at sprite scale — keratin nubs only if reading as bark scar, never true horns.',
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
            'Ankles and feet emphasize stability on uneven humus: broad tarsals, strong Achilles, splayed weight through the metatarsals. Hands are broad with spatulate digits (shorter reach than sylphari but strong grip in soil). Shallow lumbar curve when standing long periods; rib cage a touch deeper than the gracile canopy line. No patagia, patagial ribbons, or climbing tail.',
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
            'Sex: adults share one silhouette envelope; on average one pattern leans squarer at shoulder and jaw, another slightly wider at hip, with full overlap. Age: rotfolk children read round-bellied with oversized head and crown tuft; adolescents stretch in the legs first; elders show lichen bands brighter, hollower temples, and more pronounced striae — no sudden height loss. Regional: deep-grove cooler grey-green; edge-grove warmer brown — soft gradients for variants, not hard sub-races.',
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
            'Vision biased toward contrast in green/brown and motion in low light (understory, not true night vision). Hearing favours leaf-litter crackle, root creak, and close footfalls; ears still human in structure. Smell clearly above human baseline for soil, decay, and fungal metabolites — shown as nostril flare, not a snout. No echolocation or heat pits.',
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
            'Matches Lövfolk: physical young-adult presentation may align to human late teens–twenties while calendar age runs long; ageing appears first as skin texture, lichen contrast, and crown tuft thinning rather than height collapse. Very old individuals may show softer ear outline, pronounced fine lines at the eyes, and hands that read more sinew than cushion — same broad schedule as sylphari, different surface tells.',
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
            'At 32px: prioritize a 3–4px wide torso block, 2px head with low ear nubs (not tall sylphari spikes), one lichen speckle or vertical grain stroke on cheek or shoulder, and a two-pixel-wide stance. Crown tuft = 1–2px bump above the hairline. Merge fingers unless a pose needs them; skip micro-face. Palette shift alone must not be the only difference from sylphari — width and ear height sell rotfolk.',
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
              'Mood: still humus, mycorrhiza hush, root-cellar cool — forest people of the floor and hollow, not the high rope-road canopy. Visual anchors: grounded Lövfolk morphology distinct from the tall sylphari “reed” read; think understory athlete and root-nurse anatomy, not zombie rot or plague imagery. Legacy id rotfolk tied grovekin settlements to Lövfolk in docs/peoples-and-races.md; this page is anatomy and sprite canon only.',
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
              'Clothes, grove architecture, and craft belong to culture. WORLD.md — Lövfolk (Grenmark, living archives, Rasa healers) supplies People-level lore; use this row for bare surface, proportions, and default variation.',
          },
        },
      ],
    },
  },
];
