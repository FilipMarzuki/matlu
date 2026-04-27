/**
 * Notion field copy for the `Fae` Race DB page (#743).
 * Source: WORLD.md §"The Fae — the Hollow Courts", clothing/architecture notes, Runescript/Rasa;
 * AXES.md (Tradition +2, Survival +1, Tight +2, Context +2, Face; Exchange, Bargain, Memory, Possibility);
 * docs/race-and-culture.md, docs/peoples-and-races.md.
 */

export const RACES_DB_ID = '34e843c0-718f-81a3-b4c8-c0ff6839bd21';
export const FAE_PAGE_ID = '34e843c0-718f-813b-925a-fae4d8244f8a';
export const CULTURES_DB_ID = '2928281c-057d-4632-8834-98cd2d873912';

/** Canonical Races DB stubs used as relation targets. */
export const RACE_PAGE_IDS = {
  lovfolk: '34e843c0-718f-81b4-9c45-de652bc8414b',
  pandor: '34e843c0-718f-81cc-8fdf-db6824a6ddd0',
};

export const pageProperties = {
  Name: { title: [{ type: 'text', text: { content: 'Fae' } }] },
  id: { rich_text: [{ type: 'text', text: { content: 'fae' } }] },
  Endonym: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'No widely traded public endonym: court allegiance (What Was / What May Be) and personal true names matter more than a folk label. Outsiders say “the fae” or “Hollow Court fae”; documents use “Fae” as the Peoples name.',
        },
      },
    ],
  },
  Exonyms: {
    multi_select: [{ name: 'Fae' }, { name: 'faeries' }, { name: 'Hollow Court fae' }],
  },
  bodyPlan: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Quasi-humanoid: two arms, two legs, upright biped at human door-and-table scale — they sit across from innkeepers, pass through architecture built for other peoples, and bargain in shared space. Species identity is liminal law and age, not a second skeleton. No wings, tail, or extra limbs as the default anatomy (court glamour and layered territory read as narrative and art-direction, not a required limb chart). Lineages that bind Myst into crystal (legacy kristallbundna morphology) are a known Fae extreme; this row states the broad envelope before that specialization.',
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
            'A calm humanoid column with a hint of elongation: slightly long neck or narrow waist reads as “unhurried” before face detail. Weight appears perfectly settled — no idle sway baseline unless a scene demands it. Optional one-pixel ear point or asymmetry at the crown; avoid insect, draconic, or Tinkerbell wing tells. At 32px the read is “negotiator in the threshold,” not monster silhouette.',
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
            'Adults present in a medium-to-willowy band, roughly 6.5–7.5 heads tall, with unforced posture and hands suited to gesture and precision. Children and elders are rarely described in the public record; where they appear, proportions stay humanoid without a separate “fae child” sprite grammar — age reads as scale and face, not a different body plan. Weight is seldom heavy; muscle reads as spare rather than bulky.',
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
            'Skin tones span a human-like range biased toward uncanny coolness: birch-ash, bark-brown, moon-pale grey, muted leaf-green undertone — matte, never glitter. Species tell is restraint, not sparkle: optional faint freckle or dust-mote pattern at temple or throat that reads as starlit dust, not cosmetics. Hair, when visible, is often fine and dark or silvered; presentation can shift in story (glamour) without changing this baseline bare surface.',
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
            'Fine-boned face with human layout; eyes carry an “older than the room” read — slightly deep-set or still in large art, round pupils at sprite scale. Ears may be subtly tapered (optional); no muzzle, tusks, or horn cores on the default row. Mouth and jaw stay within human occlusion; expression is controlled — micro-expression baseline is low unless intent is shown. Crown hairline stays clear of tall fantasy crests unless a named lineage calls for it.',
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
            'Organ layout matches a humanoid baseline for practical interaction with Mistheim’s built world. Exceptional longevity is normal in lore — calendar age can reach centuries while surface presentation stays adult-stable; ageing cues, when shown, are cultural and narrative rather than a separate senescence chart. Bargains and oaths bind without leaving a mandatory visible scar pattern. Crystal fused to bone is not assumed here; see the deprecated kristallbundna row for that morphology as a Fae-lineage extreme.',
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
            'Court of What Was vs What May Be skews presentation toward memory-debt stillness vs possibility-forward alertness — art direction, not mandatory anatomy splits. Sex silhouettes overlap the humanoid envelope. Regional reads follow liminal niche: forest-edge fae may pick up cooler green undertones; inn-back-room fae may read slightly softer and more “assembled” in large art. Crystal-heavy lineages diverge toward the kristallbundna visual spec.',
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
            'Vision comfortable in dim, dappled, and threshold light (dawn, doorway, grove edge); open high sun can read flat or over-bright in illustration without implying a separate eye organ. Hearing and proprioception support conversation, oath-weighing, and spatial navigation in courts where geometry is unreliable — express as poise and timing, not super ears. Smell/taste broadly human unless a scene needs otherwise. Rasa sensitivity is narrative (emotional truth, old bargains), not a mapped extra sense on this row.',
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
            'Effectively unbounded in lore: individuals reference centuries of continuity while still presenting as vigorous adults. The scholarly record does not fix a maximum span; visible “age” often reads as bearing and gaze rather than greying or height loss. Where the Dry frays old bargains, the stress is legal-mystical, not a new grey-hair clock.',
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
            'At 32px: humanoid column same tile height as hero; no wings, no particle glitter. Sell the species with still posture, one cooler skin step vs Markfolk baseline, and asymmetric eye highlight (1px) or a single ear point. If glamour is needed, imply with palette swap or soft second outline — do not add wings or fairy sparkles as default. Fingers merged unless the pose needs a gap. For crystal-bound characters, use the kristallbundna crown-spire grammar instead of this default.',
        },
      },
    ],
  },
  'Lore Status': { select: { name: 'draft' } },
};

/** Page body — origin and People narrative. */
export const pageBodyBlocks = [
  {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: 'Origin' } }],
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
              'The Fae of the Hollow Courts predate Runescript in practice and predatory clarity in diplomacy. Their arrangements bind in ways the Class system cannot override — a hint that their terms are older than the machinery other peoples live inside. They do not map territory like nations; they occupy liminal layers over land others believe they own.',
          },
        },
      ],
    },
  },
  {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: 'The Hollow Courts' } }],
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
              'The courts gather in edges and undersides: forest meeting field, the hour before dawn, the space beneath old bridges, the back rooms of inns that have been open long enough. Two tendencies dominate. The Court of What Was tends memory, debt, and the past — drawn to old places and old promises. The Court of What May Be tends potential and unspent Myst — drawn to places where change is imminent. They have no official relation to each other and a great deal of unofficial commerce.',
          },
        },
      ],
    },
  },
  {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: 'In Mistheim' } }],
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
              'The fae make deals, not goods. Exchanges are technically fair; complexity comes from asymmetry of lifespan and knowledge. Most fae do not seek Classes — they operate on older terms — but those who do often lean toward Keeper, Bard, or Innkeeper: exchange, story, and shelter. Inns are rare neutral ground; a true innkeeper and a fae court leader recognize each other as doing the same work by different means. Pandor scholars have tried to document fae Rasa and produced accounts that are accurate and useless.',
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
              'Relations with the Lövfolk are complicated: courts sit under several eastern groves without invitation — the fae were there before the trees were saplings. Polite coexistence rests on the mutual understanding that neither side can expel the other. The Dry disturbs the Court of What Was: old promises fray in binding quality, while the Court of What May Be watches newly opened ruins with sharp interest.',
          },
        },
      ],
    },
  },
  {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: 'Cultural-axes note' } }],
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
              'AXES.md scores for Fae (Hollow Courts): Tradition +2, Survival +1, Tight +2, High/Low Context +2, Mode Face — values Exchange, Bargain, Memory, Possibility. The note in AXES.md calls them a pure example of layered, ancient, binding culture.',
          },
        },
      ],
    },
  },
  {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: 'Lore note' } }],
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
              'Glamour clothing, non-Euclidean court geometry, and deal-text belong to narrative and culture pages. This row locks default Fae anatomy and sprite reads. The legacy kristallbundna settlement slug folded into Fae documents a crystal-bound lineage — use that deprecated row for crown-spire morphology when a character needs it. Default Culture in code: crystal-resonance / Fae Resonance Sites per docs/peoples-and-races.md.',
          },
        },
      ],
    },
  },
];
