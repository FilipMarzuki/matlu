/**
 * Notion field copy for the `Remnants` Race DB page (#748).
 * Visual and lore canon derived from WORLD.md §"The Remnants — what the dead gods left"
 * and AXES.md scores (Tradition +2, Survival +2, Tight 0, Context +2, Mode n/a).
 */

export const RACES_DB_ID = '34e843c0-718f-81a3-b4c8-c0ff6839bd21';
export const REMNANTS_PAGE_ID = '34e843c0-718f-81f3-bd76-e592fd4bd8d9';

export const pageProperties = {
  Name: { title: [{ type: 'text', text: { content: 'Remnants' } }] },
  Endonym: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'None documented. They do not use any name for themselves and have not provided an alternative to the one coined by a Pandor scholar in the third century.',
        },
      },
    ],
  },
  Exonyms: {
    multi_select: [
      { name: 'Remnants' },
      { name: 'the Quiet Ones' },
      { name: 'the First Ones' },
    ],
  },
  bodyPlan: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Non-humanoid by origin but humanoid-adjacent in effect: the three documented Remnants present with bilateral symmetry, two upper limbs, and an upright axis — enough to deliver a message, sit at a crossroads, or be encountered in a corridor. Whether this form is intrinsic or adopted is not established. No sufficient population exists to derive species-wide anatomy; what is documented is that each Remnant can interact with the built world at human scale without requiring architectural adaptation.',
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
            'Upright and absolutely still: a tall narrow vertical with no visible weight-shift, no breathing cycle, and no fidget baseline. The outline reads as roughly humanoid from a distance; closer inspection reveals the absence of the small involuntary movements living things make when not actively moving. At 32px the silhouette carries its read through stillness alone — a pale narrow column that does not animate when idle.',
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
            'The three known Remnants have not been measured in parallel; no canonical height range can be established. Art direction: lean tall and narrow, 7–8 heads, with a quality of unoccupied space — as if the form is present but not entirely inhabited. No visible mass distribution that suggests a centre of gravity. Adolescent or child forms have never been documented.',
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
            'Pale and faded — something that has been here long enough to lose contrast with its surroundings. Not luminous; they do not glow or radiate. Palette sits in the cool desaturated range: aged-paper white through pale grey-blue, like old dry stone or sun-bleached bone. No visible skin texture at any documented scale. No fur, scales, or surface pattern. No variation by region, age, or lineage — the three known examples have not been studied closely enough to derive a range, and may not exhibit biological variation at all.',
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
            'Features are present and correctly positioned but read as unfinished: eyes that do not visibly track, a mouth that produces complete sentences but shows no micro-expression baseline. Ears, if present, are smooth and close to the skull. No hair. The face communicates nothing it does not intend to. At 32px: a pale oval with two small dark points (eyes) and no readable emotional register.',
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
            'Outside known biological categories. No confirmed diet, sleep cycle, or wound response has been documented. The Messenger has operated continuously for two hundred years without known rest, resupply, or observable deterioration. The Crossroads figure has remained in an exposed highland location across seasonal extremes for longer than recorded settlement history. What sustains them is not known. They predate the current age and the systems that made them — the dead gods — no longer exist.',
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
            'Three confirmed individuals. No two appear identical. No species-level variation pattern can be derived from this population size. The Messenger reads as compact and mobile; the Crossroads figure as tall and stationed; the third has never been fully observed. Whether there is a range of forms, or each is a singular made thing, is not established.',
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
            'Functional at minimum: the Messenger delivers accurately and the Crossroads figure answers questions correctly, implying normal-range perception. What else they perceive is not documented. The third Remnant appears aware of being tracked — inferred from how it moves relative to observers — suggesting Myst-sensitivity or a perceptual range beyond normal biological baselines. No organ-level anatomy has been examined.',
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
            'The Crossroads Remnant has been in the central highlands longer than Vitstad has been inhabited, placing its minimum documented presence at several hundred years. The upper bound is not known. Whether the category "lifespan" applies to entities made by dead gods in a previous age is a question the scholarly record notes but does not attempt to answer. No Remnant has been observed to age in the way biological entities do.',
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
            'At 32px: a pale upright column, 7–8 pixels tall. Two small dark points for eyes; no readable expression. The defining read is absolute stillness — even in an idle frame, no weight-shift or breathing motion. If animated, movement should read as displacement rather than locomotion: the Remnant changes position, but the motion does not look like an organism moving. One subtle highlight pixel at crown or shoulder to separate the silhouette from a light background. Avoid detail that implies biology (no skin crease, no visible breath). The species read comes entirely from stillness and pale monochrome surface.',
        },
      },
    ],
  },
};

/** Page body — origin narrative and scope note. */
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
              'The name "Remnant" was coined in the third century of the current age by a Pandor [Scholar] who needed something to write in the margin. They do not use it. They have not provided an alternative.',
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
              'There were dead gods. Their names are not said aloud. The Remnants are — possibly — what is left of something the dead gods made, or what the dead gods left behind them when they ended. Neither reading has been confirmed. The Remnants have not confirmed anything about themselves, and no living source has access to a record that could. They do not explain what they are.',
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
              'Three are confirmed active in Mistheim. Whether others exist elsewhere, in other states, or in other worlds is not known.',
          },
        },
      ],
    },
  },
  {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: 'The Three' } }],
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
              'The Messenger has worked as a courier for the Pandor scholars for two hundred years. It delivers things accurately and on time. It does not discuss its origins, its nature, or why it took the work. Whether it was asked or came of its own accord is disputed in the Pandor records. The Pandor are not sure it matters.',
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
              'The Crossroads figure has been at the Threefold Crossroads in the central highlands since before Vitstad was built. Travellers stop there and ask questions. It answers in ways that are technically accurate and frequently unhelpful. Several of its answers have become proverbs. The proverbs are not comforting.',
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
              'The third has never been directly observed. Its presence is inferred from a particular pattern of Myst disturbance and a quality of silence it leaves in places it has recently occupied. The Fae appear to know more than they are saying about it. They have not been asked directly, and being asked directly by someone who is not Fae rarely produces useful results.',
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
              'Three examples are the entire documented population visible to the world. Sprite design and art direction cannot draw on full species anatomy — the incompleteness is the point. Visual reads should emphasize: humanoid enough to function in a corridor or at a crossroads; inscrutable enough that everything else is uncertain. The Remnants are not monsters and not gods. They are what is left after both.',
          },
        },
      ],
    },
  },
];
