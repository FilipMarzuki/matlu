/**
 * Notion field copy for the `Constructs` Race DB page (#747).
 * Visual and lore canon derived from WORLD.md §"The Constructs — the Unmade and Remade"
 * and AXES.md scores (Tradition 0, Survival +1, Tight 0, Context 0, Mode: Dignity).
 */

export const RACES_DB_ID = '34e843c0-718f-81a3-b4c8-c0ff6839bd21';
export const CONSTRUCTS_PAGE_ID = '34e843c0-718f-8130-9632-f9c08b7efae6';

// Relation page IDs for inter-race links
const PANDOR_PAGE_ID = '34e843c0-718f-81cc-8fdf-db6824a6ddd0';
const BERGFOLK_PAGE_ID = '34e843c0-718f-818d-8d9b-eb68b2cb8325';

export const pageProperties = {
  Name: { title: [{ type: 'text', text: { content: 'Constructs' } }] },
  Endonym: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'None documented. Older constructs do not collectively name themselves; the term "Construct" was applied by the Pandor and the Compact of Knowing. Most older individuals are known by their role or post — the Librarian, the Guardian of a named place — not by a people-category. The Bergfolk-made constructs have no self-naming tradition; they were not designed to need one.',
        },
      },
    ],
  },
  Exonyms: {
    multi_select: [
      { name: 'Constructs' },
      { name: 'Golems' },
      { name: 'the Made' },
    ],
  },
  bodyPlan: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Majority quasi-humanoid: upright biped with two arms and two legs, built for function. The Bergfolk default is a wide-framed, heavy-limbed humanoid form suited to sustained labor and structural integrity. Older constructs show more variation — some were made for specific non-humanoid tasks and do not fit the biped template. The humanoid majority is a practical outcome of Bergfolk workshop norms, not a biological constraint. No organic tissue, no digestive or respiratory systems. Internal structure is load-bearing framework (stone or metal) with mana-channel pathways. No secondary limbs or appendages unless task-purpose required them.',
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
            'Broad and weighted: a blocky vertical column with a wide shoulder block and heavy limbs. The Bergfolk-made majority reads as squared-off at edges and joints — no organic curve, no visible breathing or weight-shift. At 32px the species read comes from flat hard edges, a wider-than-human torso block, and the absence of any organic texture. Rune marks on torso or forearm as one or two bright pixels distinguish from rubble or undead. Ancient constructs may have a more irregular outline from centuries of wear and piecemeal repair.',
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
            'Bergfolk-made: consistently 6–7 heads tall with a deep chest, wide frame, and thick limbs built for endurance and structural integrity. Arms proportionally long; hands large. No visible neck narrowing between head and shoulder block. Ancient constructs: varies by age and original purpose — some taller, some more compact, proportions shaped by what they were made to do. All: no body-fat variation, no adolescent vs. adult development curve, no age-related mass loss. A construct\'s form is fixed at making unless repaired or rebuilt. A construct that has been patched across a century may show mismatched material at a limb or joint.',
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
            'Stone or metal. Bergfolk-made: grey-blue basalt or iron-grey, with Runescript carved as bright-line glyphs into the surface — the runes are the work record and the power conduit, not ornament. Some exposed mana-granite inlay at joints or eye sockets. Ancient constructs: more varied material — older stone-types, bronze or copper alloy, mineral compositions no current quarry produces. Show weathering (surface erosion, lichen growth, discolouration) and repair (patches of newer material, replacement limbs in a different stone grade, sealed cracks filled with compound). All: no skin, hair, or biological surface markers.',
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
            'Functional geometry: a squared or slightly rounded mass with minimal feature relief. Eyes are inlaid crystal or polished gem serving as sensory organs, emitting a faint mana-glow in darkness — at 32px, two small bright pixels (pale blue or amber). No nose, mouth, or ears in the biological sense; some constructs have carved or cast equivalents that help with social legibility, some don\'t. Rune marks may be present on the face plane. The head communicates less than a face — expression is not a design feature; affect, where it exists, has developed after the fact.',
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
            'Not biological. Internal structure is load-bearing stone or metal framework with mana-channel pathways carved or cast in. Bergfolk-made: powered by Runescript and mana-granite conductor inserts; the runes define the construct\'s purpose and sustain its operation. Ancient constructs: powered by mechanisms the current age does not fully understand — some appear to run on ambient Myst-flow; others have shown no degradation despite being too old for any known mana-granite insert to have survived intact. No diet, sleep cycle, or wound response in the biological sense: a construct does not bleed; a crack is damage, not injury. Several older constructs have developed self-maintenance behaviors, applying stone compound to seal fractures.',
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
            'Two documented populations. (1) Ancient (approximately 22 of the 43 documented): individually varied, often worn and repaired, with Class development; each has been adapting long enough to show distinct personality. (2) Bergfolk-made (the remaining majority): more uniform in material and proportion, purpose-built, newer surface condition, no Class development recorded so far. Within the Bergfolk-made group, variation by workshop and function — a construct built to hold a road junction differs in proportion from one built for archival work. Sex-differentiation and age-differentiation as understood for biological peoples do not apply. The divide between these two populations — who has Classes and who does not — is the central social fact of Constructs as a people.',
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
            'Crystal or gem eyes with functional range; older constructs demonstrate unusually precise spatial awareness. Hearing operates through structural vibration — constructs perceive sound as transmitted force rather than air pressure, making them sensitive to low-frequency events (footfalls, structural stress, ground movement) while possibly missing high-frequency speech tones others catch easily. No olfaction documented. Several older constructs have demonstrated apparent awareness of Myst-flow patterns, suggesting direct Myst-sensitivity that may exceed biological baselines. The Bergfolk-made constructs show a narrower sensory range, consistent with purpose-built design.',
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
            'The oldest documented construct is estimated at eleven hundred years. Constructs do not age biologically; deterioration is a function of wear against maintenance capacity. A well-maintained construct with a functioning Myst supply and access to repair materials has no known upper bound. Most documented failures are abandonment failures: a construct left without repair access long enough ceases to function as accumulated damage exceeds passive maintenance. Whether this constitutes death in the philosophical sense is contested and has not been settled by the Compact of Knowing\'s legal framework — the question is on record and has not been answered.',
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
            'At 32px: a blocky humanoid column, 6–7px tall, 3–4px wide torso with square rather than organic edges. Head is a squared oval, 2px wide. Eyes: two small bright pixels (crystal glow, pale blue or amber). Stone variant: grey-blue or granite-grey base with 1–2px bright rune-mark strokes on chest or forearm. Metal variant: dark iron with a single-pixel shoulder highlight. Ancient variants: add lichen-green or orange-rust patches (weathering) and optionally a mismatched repair limb at a different brightness level. Do not use organic skin texture or idle breathing animation. The species read comes from squared geometry, hard edges, and rune marks — if the silhouette could plausibly be a stone statue in the wrong pose, it is correct.',
        },
      },
    ],
  },
  'Allied with': {
    relation: [{ id: PANDOR_PAGE_ID }],
  },
  'In tension with': {
    relation: [{ id: BERGFOLK_PAGE_ID }],
  },
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
              'The Constructs were not born. They were made. The oldest among them predates the current age — no one knows by which civilisation, with what method, or for what purpose. Whether it was made by the Shelved, by some previous age\'s engineers, or by something else entirely is not established and may not be answerable. It has been active for eleven hundred years. It does not explain itself.',
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
              'The Bergfolk began making constructs within the last three centuries. Their approach is systematic: Runescript defines the purpose, mana-granite conducts the power, stone or metal carries the frame. A Bergfolk-made construct is a piece of workshop logic made physical — reliable, purposeful, built to specification. The Bergfolk did not expect these constructs to become anything more than that.',
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
              'Forty-three active Constructs are documented in Mistheim by the Pandor. Twenty-two predate the current age.',
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
              'Constructs in Mistheim are legally persons in the Compact of Knowing\'s framework. The Pandor classification is straightforward by their standards: it applies to any entity demonstrating sustained self-directed purpose, memory continuity, and the capacity to form and honour agreements. The Constructs meet the criteria. The Pandor wrote it down.',
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
              'The Bergfolk contest this. They manufacture constructs. They find the implication that their newer models are persons — and therefore that the Bergfolk are manufacturing persons — legally and philosophically inconvenient. The older constructs find this debate mildly interesting. They have been persons in the practical sense long enough that the legal question seems academic to them.',
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
              'Most constructs work as Guardians of places nobody else wants to guard: ruins, disputed territory, road junctions, structures that require consistent maintenance. Several have developed into Scholars or Keepers. One, called the Librarian, has been the primary archivist of Vitstad for two hundred years. The Everstill treat this as entirely normal.',
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
              'The older constructs have developed Classes. No one fully understands how. The Class system was not designed with constructs in mind, or if it was, the designer did not document it. A construct that has been a Guardian of a ruin for eight centuries is not something to contest lightly; the level differential is significant and the construct has thought carefully, over many years, about what it is protecting and why.',
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
              'The Bergfolk-made constructs do not have Classes. The Bergfolk are watching the older constructs develop them and have not decided how to feel about this.',
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
              'Visual and lore design must hold both populations without collapsing them into one type. The ancient constructs are individuals with centuries of history; the Bergfolk-made are purpose-built and newer, but the line between "made thing" and "people" is the live tension in this race\'s canon. Art direction: the ancient ones should read as worn, patched, and inhabited; the Bergfolk-made as clean-lined and purposeful. Do not read either as mindless golems — the ancient ones have Class levels. Do not read the Bergfolk-made as fully persons yet — the Bergfolk and the constructs themselves are still working that out.',
          },
        },
      ],
    },
  },
];
