/**
 * Notion field copy for the `jarnborn` Races page (#690).
 * Source of truth for wording pushed to Notion; cache comes from `npm run races:sync`.
 */

export const RACES_DB_ID = '34e843c0-718f-81a3-b4c8-c0ff6839bd21';

export const pageProperties = {
  Name: { title: [{ type: 'text', text: { content: 'Jarnborn' } }] },
  id: { rich_text: [{ type: 'text', text: { content: 'jarnborn' } }] },
  bodyPlan: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Quasi-humanoid: two arms, two legs, upright biped on a compact, dense human baseline. No extra limbs, wings, or tail. Lower center of mass and wider weight distribution than typical human proportions — the lineage reads as "built for pulling, lifting, and enduring" before any cultural read. Legacy id jarnborn labels the demographic tied to ironborne-encampment settlements; it is anatomy only, not a culture.',
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
            'Short, wide block: broad round-capped head on a very short neck, shoulders noticeably wider than hips, compact barrel torso — reads as "planted, immovable weight" at sprite scale before any face detail.',
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
            'Adults run about 5.0–5.5 heads tall: deep barrel chest, neck short and thick, shoulders markedly wider than hip, forearms and hands oversized relative to torso length. Stance is naturally wide, weight low and forward through the ball of the foot. Children are round-bellied with a large head and short thick legs; teens gain shoulder width before height fills in. Elders stay dense and low; shoulders may slope forward slightly but height barely drops.',
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
            'Palette runs from iron-grey through coal-dark brown, smoked tan, and oxidised copper-red; cool matte undertone across the board. Skin is thick and callous-tending: visible thickening at knuckles, palms, and elbows. Species pigment: fine mineral-speckle inclusions at temples, shoulder peaks, and knuckles — reads as embedded slag or iron freckle; not metallic sheen, just a cool grey-speck pattern. Short dense body hair, often the same tone as skin, heavier at forearms.',
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
            'Eyes deep-set under a pronounced brow ridge for forge-heat and glare tolerance; pupils standard round, iris often mid-grey to amber-brown. Ears compact and close to the skull, with a thick helix — percussion and ceiling-clearance buffering, not decorative. Nose broad and wide-bridged; nostrils large for high-exertion air volume. Jaw and cheek architecture very wide and heavy; teeth within human range — no tusks, canines only slightly pronounced. No horns. The brow ridge is bone-mass only and does not extend past the hairline.',
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
            'Relative to human baseline: (1) forearm circumference notably thicker, especially at the flexors; (2) hands wide-palmed with short, dense digits; (3) rib cage reaches low and full — depth and breadth both beyond human norms; (4) sternum and clavicles read as a wide flat shelf in large art; (5) metatarsals broad for weight on stone. No tail, no extra limbs, no armoured integument — these are anatomical density differences, not magical metallic features.',
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
            'Sex: adults share one build envelope; on average one pattern carries a slightly wider pelvis and narrower shoulder stack, another a wider shoulder and flatter waist — overlap is heavy. Age: infants are notably round with a large head, minimal neck, and short arms and legs; the head-to-body ratio feels top-heavy until roughly age 5–7. Teens gain shoulder width before height fills in; the adult silhouette "widens out" around 16–18. Elders show callous buildup intensifying on hands and forearms, mineral-speckle brightening slightly at temples, and a mild forward shoulder roll — not frailty, just decades of overhead work. Regional: deep-mine lineages run darker skin tones with a stronger cool-grey cast and heavier brow ridge; surface-forge lineages run warmer soot-brown to copper-red with less pronounced brow depth — soft gradient for sprite variants, not hard sub-races.',
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
            'Vision adapted for contrast in low light with forge-bright flash tolerance: pupils modestly large, iris often dark-centred. Hearing: compact ear with a thick helix tolerates percussion and resonance well; not favoured for high-register range. Smell: large-volume nasal passage, good sensitivity for mineral, smoke, and metal oxide — not bloodhound-grade organic tracking. No heat pits or echolocation.',
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
            'Physical maturation slow: young-adult build around 22–24 years; prime from roughly 25–70; ageing visible as mineral-speckle spreading, callous thickening, and gradual greying of the dense body hair. Very old jarnborn may show a smoother brow ridge as bone density redistributes, a more pronounced shoulder roll, and a slightly lower wide-legged stance. Calendar lifespan is broadly human-adjacent with a slower prime and distinctive density cues in late age.',
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
            'At 32px: a 3–4px torso block nearly as wide as it is tall; no visible neck; head 2px wide under a single heavy brow bar; one dark eye highlight; shoulder line clearly wider than hip. Speckle = one grey pixel at temple or knuckle, optional. Forearm reads the same width as upper arm. If using two tones, keep the belly shadow from narrowing the silhouette — stay wide through the torso. Avoid height; sell horizontal mass first.',
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
              'Mood: forge-heat, cold stone, patience. Visual anchors: dense mountain-laborer and smith-culture anatomy — not a fantasy dwarf costume. "Jarnborn" ("iron-born") is the legacy settlement-generator slug for the ironborne-encampment culture; anatomically adjacent to Steinfolk and Bergfolk, the lineage description for short, wide People of forge and mine. Fictional race for the Matlu multiworld. This page is anatomy and sprite canon only.',
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
              'Clothes, forge-kit, and architecture are culture. Do not use this page to lock costume — only bare anatomy and default surface variation.',
          },
        },
      ],
    },
  },
];
