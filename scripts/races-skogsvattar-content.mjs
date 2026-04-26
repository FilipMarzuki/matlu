/**
 * Notion field copy for the `skogsvattar` Races page (#697).
 * Kept in-repo so the sync cache matches authored canon without duplicating long strings in two places.
 */

export const RACES_DB_ID = '34e843c0-718f-81a3-b4c8-c0ff6839bd21';

export const pageProperties = {
  Name: { title: [{ type: 'text', text: { content: 'Skogsvattar' } }] },
  id: { rich_text: [{ type: 'text', text: { content: 'skogsvattar' } }] },
  bodyPlan: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Quasi-humanoid: two arms, two legs, upright stance on human leg geometry. Mild interdigital webbing to the first knuckle on hands and feet; torso a finger longer than a human baseline for wading and low bramble passage. Optional low soft ridge along the spine (connective tissue, not fin rays) — readable in large art, optional at sprite scale. No tail used for locomotion; not merfolk lower body.',
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
            'Wide, low stance with a rounded shoulder cap and a small head: a squat trapezoid or “reed-root” outline — reads as understory and shallow water before any face detail.',
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
            'Adults are medium height with a compact core and proportionally long forearms and thighs (roughly 6.5–7.0 heads tall). Default posture: hips slightly flexed, weight mid-foot, arms ready for low branches and water edges. Children carry a larger head, shorter legs, and visibly plumper digits where webbing meets skin. Teens lengthen in limb and neck first. Elders keep the low stance but may read narrower at the waist, with more pronounced upper-back speckle fade and slightly sunken eyes.',
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
            'Palette: bog-green, birch-pale grey-green, wet-stone blue-grey, and brown-moss undertones. Skin often carries a fine leaf-dapple speckle or soft mottle (species pattern, not paint). Short velvety hair at crown and nape is common; body pelage is minimal. Webbing lines can carry a faint cool sheen in illustration; at 32px that collapses to one highlight pixel if needed. Lichen-toned shoulder and scapular washes are default markings, not clothing.',
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
            'Eyes large, set slightly high, with a mild upward tilt at the outer canthus — helps with glare off water. In large art pupils may read mildly vertical-oval; at sprite scale use a dark core plus one catch-light. Ears ride close to the skull with an elongated tragus (splash shedding). Nose short with a broad bridge; nostrils angle slightly downward. Mouth wide; teeth within human range — no carnivore fangs. No horns. A low, rounded brow ridge can be present and softens with age.',
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
            'Beyond baseline human: (1) webbing and thicker palmar/plantar skin; (2) extra lumbar flex for crawling under brush; (3) rib cage modestly broad for comfortable breath-hold in quiet water (seconds to a short minute, not deep diving); (4) slightly richer subcutaneous hydration look in large art — smooth limb reads at 32px rather than ropey tendons. No gills; no powered swimming tail.',
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
            'Sex: adults share one build envelope; on average one pattern trends broader hands and feet, another trends a narrower waist and longer neck — individuals mix freely. Age: infants show webbing proportionally large relative to palm; juveniles lose facial roundness before limbs finish growing; elders show web margins slightly frayed or thinned in art, speckle contrast softened, temples a bit hollow. Regional: high-canopy lineages can read a finger longer in limb; fen-margin lineages can read slightly thicker ankles and wider feet.',
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
            'Vision favours dappled light and shimmer on water — good contrast sensitivity over long-distance hawk acuity. Hearing is strong for litter rustle and small surface ripples. Chemoreception (smell/taste) leans humid-air and decay-organics, supported by generous nasal turbinate area rather than an external muzzle. Webbing is thermally sensitive for water current and temperature.',
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
            'Physical maturation about 14–16 years, prime roughly 18–40, then visible ageing with thinning web edges, softer speckle, and slightly deeper-set eyes while posture stays low. Lifespan in a typical human band; no exceptional longevity.',
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
            'At 32px: feet two pixels wide when planted; one low brow mass or a two-pixel eye band; single cheek or teardrop highlight for damp skin. If hands show, a one-pixel webbing tick between fingers. Silhouette priority: wide base, small head, rounded shoulders — avoid micro-striping; at most a two-tone limb (belly shadow / moss back).',
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
              'Mood: humid understory, still pools, light through leaves on water. Visual anchors: salamander and newt skin texture language on a human facial plane — not a monster muzzle, not fish-folk hybrid. Fictional race for the Matlu multiworld. Settlement data maps the old thicket-dwellers culture to Lövfolk weights; this page keeps the legacy skogsvattar id as the dedicated visual spec for sprites and codex.',
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
              'Clothes, kit, and architecture are culture. Do not use this page to lock costume — only bare anatomy and default surface variation.',
          },
        },
      ],
    },
  },
];
