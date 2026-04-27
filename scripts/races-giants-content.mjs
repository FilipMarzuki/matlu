/**
 * Notion field copy for the Giants Race DB page (#744).
 * Source: WORLD.md §"The Giants — the Seven", §Giants (Appearance / Architecture / Objects),
 * AXES.md (Tradition +2, Survival +2, Tight 0, Context +2, Dignity),
 * docs/race-and-culture.md, docs/peoples-and-races.md (legacy `troll` → Giants).
 */

export const RACES_DB_ID = '34e843c0-718f-81a3-b4c8-c0ff6839bd21';
export const GIANTS_PAGE_ID = '34e843c0-718f-81a3-be7c-df0e97ec4cdf';
export const PANDOR_RACE_PAGE_ID = '34e843c0-718f-81cc-8fdf-db6824a6ddd0';

export const CULTURES_DB_ID = '2928281c-057d-4632-8834-98cd2d873912';

export const pageProperties = {
  Name: { title: [{ type: 'text', text: { content: 'Giants' } }] },
  id: { rich_text: [{ type: 'text', text: { content: 'giants' } }] },
  Endonym: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'No collective endonym is recorded from the Seven themselves. Each answers to their own name where surface chroniclers have one: Aldriksson, Bergamora, Hjelmfall, Skörna, Vötur, Klev, and the one called Oldest, who has offered no other. Scholars file the category under exonyms.',
        },
      },
    ],
  },
  Exonyms: {
    multi_select: [{ name: 'Giants' }, { name: 'the Seven' }],
  },
  bodyPlan: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Quasi-humanoid where they choose to appear embodied: two arms, two legs, plantigrade bearing — but at canon scale the Seven read as geological process (ridge, coast, valley) as much as creature. Proportions follow Nordic hill- and stone-giant folklore: deep thorax, short neck, head carried low between massive traps — not a linearly scaled-up human. No default extra limbs or wings. There is no breeding population count; seven are named in Mistheim. Settlement data maps legacy `troll` to this People; the deprecated Troll row holds tighter people-scale sprite grammar when art cannot use map-scale bodies.',
        },
      },
    ],
  },
  spriteResolution: { number: 64 },
  silhouette: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'At true scale, outline reads as terrain in motion — a moving ridgeline, a wall of weathered stone, coast where the giant meets the sea. On a tile (64px), sell a low, wide trapezoid: immense shoulder and back, head small and deep-set, pillar legs — moving boulder before face. The seven are not uniform; variance tracks territory (granite block, smoothed dark coast, moss-strewn highland).',
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
            'No population envelope — seven documented individuals, more speculated in northern wastes or deep ocean. Aldriksson reads weathered granite-grey with a living moss-and-plant beard; Bergamora is darker, smoother, and uncannily precise in motion; others carry ritual stones or echo mountain spine, coast, or valley hydrology in surface and stance. Mass and height are not convertible from human growth charts: each has occupied a territory long enough to have shaped it. Do not assume children or teens for the named Seven in canon.',
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
            'Cool matte geologic palette: grey granites, blue-greys, green-grey spray-stone, mottled lichen and moss inclusions where recesses hold soil. Skin reads stone-forward — weathered bedrock, not warm mammalian flush — with joint creases like strata fissures. Eyes small and deep at distance. Avoid cartoon bridge-goblin neon green; corruption is a different brief.',
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
            'Broad, low skull; heavy brow; eyes deep-set (two bright points at medium resolution). Nose wide; nostrils large; mandible heavy. Ears small or tight to the skull — not long elf ears. Worn tusks or thick canines can appear at the tooth line as keratin, not sabres. Horns are not a species default; story-specific stone knurls or scar mass only when named.',
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
            'Limbs are column-thick; hands can manipulate finely but casual contact with smaller folk is a scale hazard. The Class system has not granted the Seven Classes — they sit outside ordinary advancement. Mass favours stillness and long dwell; motion, when it comes, is deliberate. Public dissection has not replaced diplomacy. Each body echoes its domain enough that anatomy and landscape blur on maps.',
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
            'Inter-individual only among the seven named giants; no sex-or-age spread in the record for them. For steading-settlement depictions that need people-scale silhouettes, borrow the envelope from the deprecated Troll row (stocky 4.5–5.5 heads, wide rib cage, coastal vs highland mottle) — same People ID, different depiction tier.',
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
            'Lore describes awareness of surface nations like a mountain aware of weather: long horizon, pressure and pattern over generations, not tavern gossip. Hearing plausibly favours low rumbles, shifting stone, long-wave coast; vision serves weather fronts, distant armies, century-scale land change. Aldriksson is the exception who speaks regularly with smaller folk; the other six notice surface peoples in that impersonal register unless engaged.',
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
            'Older than continuous written history in Mistheim; birth, growth curves, and natural death are not documented. Prefer narrative spans (ages, geology) over human year counts.',
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
            'At 64px for a named giant: width before height — 4–6px shoulder read, ~2px head block low between traps, thick legs, no fine ankles. One or two moss/lichen pixels sell Aldriksson-types; cool grey mottle for all. At 32px use only for distant “hill with a face”; merge detail into silhouette. Idle: minimal micro-motion; stillness reads as dignity. Steading crowd sprites: see deprecated Troll row proportions.',
        },
      },
    ],
  },
};

/** Page body — origin, the Seven, relations to smaller peoples, visual scope. */
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
              'There are seven known giants in Mistheim who have been in contact with other peoples long enough to be named: Aldriksson, Bergamora, Hjelmfall, Skörna, Vötur, Klev, and Oldest, who has not offered another name. More may exist in the northern wastes or deep ocean; they are not in the same record.',
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
              'Each has occupied a territory — mountain, valley, stretch of coast — longer than history remembers. The land shows it: drainage that surveys cannot explain, mineral faces that look deliberate, harbours that refuse to silt closed. They do not form a nation and do not confer among themselves in any way smaller polities would recognise.',
          },
        },
      ],
    },
  },
  {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: 'The Seven' } }],
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
              'They are not uniform. Aldriksson is weathered granite-grey with a beard that has become a small ecosystem. Bergamora is darker, smoother, and moves with long-practised care not to break what she touches. Hjelmfall is never seen without a specific set of stones whose purpose is unknown. Each looks like their territory — something of the mountain, something of the coast — in a way scholars stop short of calling metaphor.',
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
              'They do not have Classes. The system has apparently decided this would be inappropriate and has not revisited the decision. Aldriksson alone speaks regularly with other peoples; he finds it mildly amusing. His advice is useless in the short term and correct in the long term. The others are aware of surface folk the way terrain is aware of weather.',
          },
        },
      ],
    },
  },
  {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: 'Relations to smaller peoples' } }],
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
              'The Old Accords bind recognised nations: no warfare in giant territories, no resource extraction without negotiation, no waking a giant who has gone to sleep. The accords were not negotiated with the giants; they were adopted after enough states learned why such rules were necessary.',
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
              'The Pandor maintain scholarly and diplomatic contact — Aldriksson agreed to meet a delegation about the Dry on a timetable only a giant would call soon. That relationship is cordial, uneven, and slow. This row is bare anatomy and visual canon; named characters and scene politics live elsewhere.',
          },
        },
      ],
    },
  },
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
              'Mood: still, geologic, sovereign — Nordic troll- and stone-giant folklore, not a small goblin or cartoon bridge-gremlin. Visual anchors: weathered bedrock, coastal spray-stone, hill silhouettes, dignity without performance. AXES top values: Stillness, Long-knowing, Sovereignty, Continuity. Clothes, tools, and architecture are culture; giant “buildings” in lore are shaped land. Default Culture: Giant Steadings (steading) in settlement data. Fictional People for the Matlu multiworld.',
          },
        },
      ],
    },
  },
];
