/**
 * Notion field copy for the Goblins Race DB page (#742).
 * Source: WORLD.md (Species, Goblin Compact, relations, clothing/architecture cues), AXES.md
 * (Tradition 0, Survival −2, Tight −1, Context +1, Face; Survival, Memory, Mutual-aid, Adaptation),
 * docs/race-and-culture.md, docs/peoples-and-races.md (bazaar-folk → Goblins).
 */

export const RACES_DB_ID = '34e843c0-718f-81a3-b4c8-c0ff6839bd21';
export const CULTURES_DB_ID = '2928281c-057d-4632-8834-98cd2d873912';
export const GOBLINS_PAGE_ID = '34e843c0-718f-81c2-bffa-f3a9c7bc119c';

/** Viddfolk — shadow-network arrangement with the Compact (WORLD.md). */
export const VIDDFOLK_RACE_PAGE_ID = '34e843c0-718f-8158-a595-c82d2e85c046';
/** Pandor — archives and indirect knowledge exchange with the Compact. */
export const PANDOR_RACE_PAGE_ID = '34e843c0-718f-81cc-8fdf-db6824a6ddd0';
/** Bergfolk — official denial vs. tolerated salvage in old holds. */
export const BERGFOLK_RACE_PAGE_ID = '34e843c0-718f-818d-8d9b-eb68b2cb8325';
/** Markfolk (Merkförbund) — outlawed officially, quietly employed in practice. */
export const MARKFOLK_RACE_PAGE_ID = '34e843c0-718f-81f0-8427-cf8b7f1d2a1e';

/**
 * Notion `pageProperties` for PATCH — relations (`Allied with`, `In tension with`, `Default Culture`)
 * are merged in `races-push-goblins.mjs` after resolving the Culture page id.
 */
export const pageProperties = {
  Name: { title: [{ type: 'text', text: { content: 'Goblins' } }] },
  Endonym: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'No single exonym-free collective name in wide diplomatic use. Individual bands and settlements name themselves; spoken introductions favour band lineage and place over a pan-goblin ethnonym. External records and larger polities default to the category label “Goblins” regardless.',
        },
      },
    ],
  },
  Exonyms: {
    multi_select: [
      { name: 'Goblins' },
      { name: 'Goblin Compact' },
      { name: 'Goblinsamfund' },
    ],
  },
  bodyPlan: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Quasi-humanoid: two arms, two legs, plantigrade biped on a compact, lighter-than-human baseline. Proportions read as “small adult” rather than human child — limb segments are near-adult in leverage and reach relative to torso; the torso is short and nimble, not toddler-round. No tail, wings, or extra paired limbs. Hands are fully dexterous for salvage, map notation, and tool adaptation.',
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
            'Low, forward-leaning humanoid wedge: head and shoulders form a tight triangle above a short trunk; legs carry most of the vertical in a ready-to-sprint stance. At 32px the read is “one tile shorter than a human hero, weight on the front foot” before costume. Avoid a squat cartoon ball; keep neck short but present so the head is not a separate bobble.',
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
            'Adults commonly about 3.8–4.6 heads tall: wiry lean muscle, narrow hips, shoulders compact but strong for climbing and haul work. Children are leggy early with a slightly larger head until adolescence; teens close the adult envelope quickly. Elders may show rope-thin posture, deliberate economy of motion, and scar or callus maps — not frailty so much as mileage.',
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
            'Matte skin across a human-adjacent range: warm ash, umber, olive, and grey-brown are common; occasional faint cool undertone from marginal light in ruins is allowed, not a mandatory “monster green.” Weathering reads as wind- and grit-polished rather than polished-glamour. Body hair, if shown, is sparse-to-modest and practical — not a species uniform.',
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
            'Face is expressive and mobile — humour, warning, and barter all show clearly when they choose. Eyes are proportionally large and dark-adaptation friendly for ruin work; brows mobile. Nose small to medium; mouth wide when speaking or grinning. Ears may read slightly larger than a human baseline for heat and parallax in tunnels — a sprite-friendly tell, not a hard rule for every individual. Teeth within human dental range; no default fang grammar.',
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
            'Standard mammalian humanoid organ layout at reduced stature: high recovery between bursts, grip and forearm strength biased toward climbing and manipulating odd salvage. No biological breath weapon, armoured integument, or luminous organs by default. Corruption and The Dry affect goblin communities the same as any other — vulnerability tracks social fracture and scarcity, not a separate “monster biology.”',
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
            'Sex: adult silhouettes overlap; band-specific averages exist but do not define the People. Age: wide scatter from fast juvenile mobility to elders who have outlasted several surface regimes. Regional reads follow margin ecology — flood-edge bands, sea-cave towns, and upper-hold salvage crews share anatomy but differ in sun weathering and scar patterns. Patchwork and gear biography are cultural reads (WORLD.md clothing) layered on this row.',
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
            'Vision biased toward contrast and motion in dim ruin air; bright open fields are tolerable but not where the eye is optimised first. Hearing is socially load-bearing — oral histories, three-rune spoken shortcuts, and tunnel acoustics all reward attentive ears. Smell useful for damp stone, cold iron, old wood rot, and salvage context; not predator-grade tracking unless a Class brief demands it.',
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
            'Calendar span broadly human-adjacent for individuals who survive marginal conditions. Early maturity is common; environmental risk and political hostility pull population averages downward more than a short natural clock. AXES Survival −2 reflects precarity and clearance history, not a biological “short-lived species” tag.',
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
            'At 32px: one tile shorter than a default human hero; 2px-wide head with a forward lean; sell with a knee bend or mid-stride freeze, not a static squat. One ear tick, hood line, or salvage strap can carry ID — avoid cramming patchwork micro-detail; imply biography with one broken colour block on the torso. Big eye pair or a single nose dot; merge fingers unless the pose needs a tool read. Teeth are not the default silhouette hook.',
        },
      },
    ],
  },
  'Lore Status': { select: { name: 'draft' } },
};

/** Page body — origin and People narrative (WORLD.md). */
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
              'Goblins are present across Mistheim in bands, settlements, and sometimes whole towns that larger polities fail to document accurately. They have Classes — a [Goblin Chef] and a [Human Chef] learn from the same system, which makes no distinction between them — a fact many cultures refuse to acknowledge because it undermines narratives of exterminability.',
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
              'They are small, fast, and deeply social. A goblin band is a community with internal hierarchy, long memory, and humour that skews dark given their circumstances. [Bards] and [Keepers] carry oral histories of what written records deliberately omitted. Inns that mean their sanctuary extend protection to goblin travellers the same as anyone else — the world’s refusal to call them people does not change how the Skills read the room.',
          },
        },
      ],
    },
  },
  {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: 'People' } }],
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
              'The twenty largest goblin settlements form the Goblinsamfund — the Goblin Compact — an informal network with no capital, no formal governance, and more effective intelligence than most nations’ spy services. Most communities live in margins others abandoned: ruin edges, flooded ground too unstable for farming, sea-caves under stilt-towns, upper levels Bergfolk holds pretend are empty. That is not chosen poverty; it is what centuries of clearance made workable.',
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
              'Their economy is salvage, information, and repair. [Delvers] and [Salvagers] mapped pre-age infrastructure other peoples never found; the Compact trades that knowledge quietly to Viddfolk carriers, Pandor archivists, and merchants who do not ask provenance. [Tinkerers] and [Menders] fix what licensed engineers will not touch — the relationship in miniature with Markfolk farms is tolerated, necessary, and publicly denied. Representative Classes include [Delver], [Salvager], [Tinkerer], [Mender], and [Band-Keeper].',
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
              'Runescript reaches them as abbreviated oral three-rune sequences and self-taught styles from salvaged stone — enough to horrify Pandor stylistic purists while still working. Rasa flows through goblin bands as lived emotional context; practical, high-trust in-band, adaptive out-band — matching AXES: Tradition 0, Survival −2, Tight −1, Context +1, Face; top values Survival, Memory, Mutual-aid, Adaptation.',
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
              'Clothing patchwork, ruin-within-ruin architecture, compact-seal tokens, and map notation are cultural and settlement cues (WORLD.md); this Race DB row is anatomy, senses, and default visual language only. Default settlement culture in code is `bazaar-folk` (Goblin Warrens) per macro-world/cultures.json and docs/peoples-and-races.md.',
          },
        },
      ],
    },
  },
];
