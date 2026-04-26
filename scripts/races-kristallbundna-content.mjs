/**
 * Notion field copy for the `kristallbundna` Races page (#692).
 * Source of truth for wording pushed to Notion; cache comes from `npm run races:sync`.
 *
 * The kristallbundna are a Fae lineage whose Myst-resonance has crystallised into
 * a stable physical form over centuries — liminal in origin, materially fixed at the
 * surface. Legacy id for the crystal-resonance culture; canonical People is Fae
 * (Hollow Courts).
 */

export const RACES_DB_ID = '34e843c0-718f-81a3-b4c8-c0ff6839bd21';

export const pageProperties = {
  Name: { title: [{ type: 'text', text: { content: 'Kristallbundna' } }] },
  id: { rich_text: [{ type: 'text', text: { content: 'kristallbundna' } }] },
  bodyPlan: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Quasi-humanoid: two arms, two legs, upright biped on a human baseline, but with crystalline growths erupting from the spine, clavicles, and crown that alter the silhouette without adding extra limbs. The crystal formations are structural — bonded to the skeleton — not ornament. Fae lineage that bound its Myst-resonance into a physical substrate; more materially fixed than most Fae, still unmistakably liminal.',
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
            'A lean vertical with a shard-crown: two or three crystal spires above the head, asymmetric, the tallest slightly off-centre — reads as "crystal entity" before any face detail. Shoulder crystals add a subtle widening at the upper third that narrows through the waist and widens again at steady-stance feet.',
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
            'Adults run lean and upright, approximately 7 heads tall, deliberate in posture — weight balanced as if the ground is a temporary arrangement. Torso narrow; limbs without excess muscle bulk, hands with long fingers. Crystal growths increase in size and complexity with age: children show small smooth nubs at the crown and spine; adolescents show first proper spires, still pale and unformed; adults carry fully faceted multi-point formations at the crown, shoulder blades, and knuckles. Elders are the most crystalline — the growths may extend to elbow and hip, deeply coloured, internally refracted, with the underlying skin read as barely more than a thin membrane between crystals.',
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
            'Skin is pale to mid-tone, slightly translucent — veins visible at wrist and temple as a cool violet or blue-grey trace. Undertone ranges from glacial blue through pale amber depending on dominant crystal type in the lineage. Crystals range from near-clear (young) to deeply saturated — cobalt, deep violet, cold teal, or dense amber — with internal facets that catch and scatter light. No fur, scales, or external patterning on skin; any pigment shift is carried by the crystal formations, not the skin surface. The transition where skin meets crystal growth is sharp and clean, not gradual.',
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
            'Narrow, slightly elongated face; eyes large, set slightly forward with a reflective depth — iris can show internal scatter-light in dim conditions (the visual cue for Myst sensitivity, not a glow effect). Pupils are round. Ears narrow and low; the crown crystals are the dominant head feature, not the ears. Nose subtle, bridge minimal. Jaw clean and tapered; teeth are within human class — the kristallbundna do not show predator fangs or a secondary beak. No separate bone-horn structures; the crystal spires emerge from skin over the skull, not from horn cores. Hair, if present, is thin and pale — often pushed aside or absent where crystal has grown through the scalp.',
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
            'Crystal growths are fused to the bone and cannot be shed voluntarily; they can fracture under serious impact and regrow slowly over months. Internal Myst-resonance means the kristallbundna are anatomically tuned to detect and respond to concentrated Myst flows — expressed as a faint vibration in the crystal lattice and a sensory awareness like pressure-change, not a supernatural scan. Very low subcutaneous fat under the skin; muscle reads as lean cord rather than mass. Joints at knuckle, elbow, and knee often show small satellite crystal nubs — the main identifier that reads at distance.',
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
            "Sex: adult silhouettes overlap fully; both carry the same crystal layout. On average one pattern grows taller spinal spires and a narrower crown cluster; another grows a broader shoulder array and more numerous smaller facets — soft gradients, not binary splits. Age: children have no developed crown spires, only small smooth nubs (2–3px crown smudge at 32px); adolescents have first sharp spires, clear-pale crystal, and visible elongation of limbs before the chest fills; adults have fully faceted deep-colour growths and composed posture; elders' growths dominate the upper body silhouette, skin reads as near-secondary, and the internal light-scatter in dim settings is most visible. Regional: lineages near Bergfolk mining territory grow iron-blue or bronze-tinted crystal; court lineages deep in old-growth grow greenish or amber formations aligned to preserved Myst; coastal or river lineages grow paler, more translucent crystals with a water-blue tint.",
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
            'Vision adapted for dim, faceted-light environments — crystal-lit caves, overcast glades, the interior light of the Hollow Courts. Open high-sun glare reads as flattened; they shade their eyes not from discomfort but from visual information loss. The internal crystal-resonance provides a tactile analogue to Myst-flow awareness — detects concentrated Myst within a room-scale radius as vibration, not precise direction. Hearing sensitive to resonance frequencies — they can perceive the hum of crystalline structures and Runescript inscriptions as a faint tonal layer over normal sound. Smell is broadly human.',
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
            'Maturation is slower than human-adjacent peoples: adolescent proportions may persist to early-twenties calendar years; adult prime from roughly 25–200; visible aging begins only after the first century and shows first as deepening crystal colour and extension of growths, not physical frailty. Lifespan is open-ended in theory but practically bounded by the accumulated crystal mass — very old kristallbundna become largely crystal and largely stationary, which is described by the courts as a transition state rather than death. In sprite terms: child (small nubs), youth (first spires), adult (full faceted crown), elder (crystal-dominant silhouette, minimal exposed skin).',
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
            'At 32px: lead with the crown spires — 2–3 pixels above the head in an asymmetric cluster, one or two pixels wide at base, tapering to a single pixel. One interior-bright pixel on the largest crystal reads as the Myst-scatter cue. Shoulder nubs are a 1px jag on each side at the deltoid line. Body is a narrow lean column; legs have small crystal nubs at the knee as a 1px detail if resolution allows. Palette: pale translucent base skin (near-white or blue-grey), one saturated accent colour on the crystal growths. If palette is tight: keep crown spires + one bright crystal pixel, drop shoulder and knee nubs. Silhouette and crown carry the identity — no micro-face needed.',
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
              'Mood: still, resonant, deep-cave light and slow time. Visual anchors: a being that has partially become what it studies — Myst crystallised into flesh, not a gem-encrusted costume. Not a standard "crystal golem" (no elemental blankness) and not a sparkle-fae (no wings, no glamour glow). The kristallbundna read as ancient-and-aware, deliberate-and-present. Their crystal growths are as natural to them as antlers are to a deer — species anatomy, not ornamentation.',
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
              'Legacy id kristallbundna maps to the Fae (Hollow Courts) in canonical Peoples (see docs/peoples-and-races.md). The crystal-resonance culture (settlement data) was tied to this demographic historically; the culture is now race-agnostic, sampling Fae in racePreferences. This page locks bare anatomy and default surface only — deals, architecture, and court politics belong to culture and lore pages.',
          },
        },
      ],
    },
  },
];
