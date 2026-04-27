/**
 * Notion field copy for the `Everstill` Races page (#746).
 * Source: WORLD.md (Pale City, Compact of Knowing, visual identity) and AXES.md
 * (Tradition 0, Survival +2, Tight +1, Context +1, Dignity; Knowledge, Preservation, Continuity, Patience).
 */

export const RACES_DB_ID = '34e843c0-718f-81a3-b4c8-c0ff6839bd21';
export const EVERSTILL_PAGE_ID = '34e843c0-718f-81a1-b23f-c6129a775556';

/** Race DB relation targets (canonical stub rows) — Races database. */
export const RACE_PAGE_IDS = {
  pandor: '34e843c0-718f-81cc-8fdf-db6824a6ddd0',
  lovfolk: '34e843c0-718f-81b4-9c45-de652bc8414b',
  deepwalkers: '34e843c0-718f-8138-878f-d4fc27cbe8b3',
  bergfolk: '34e843c0-718f-818d-8d9b-eb68b2cb8325',
};

export const pageProperties = {
  Name: { title: [{ type: 'text', text: { content: 'Everstill' } }] },
  id: { rich_text: [{ type: 'text', text: { content: 'everstill' } }] },
  Endonym: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'No distinct ethnonym in wide use among themselves: the Pale City and the archive are home; role and record matter more than a folk name. The scholarly exonym "Everstill" is what other peoples use.',
        },
      },
    ],
  },
  Exonyms: {
    multi_select: [
      { name: 'Everstill' },
      { name: 'the Still' },
      { name: 'Vitstad archivists' },
    ],
  },
  bodyPlan: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Quasi-humanoid: two arms, two legs, plantigrade upright — the same body plan the individual had in life, because the Everstill are not a separate breeding lineage but a continuation state. A [Scholar], [Soldier], or [Innkeeper] who continued after death still presents that life’s build and species baseline; what unifies the People in lore is the Class-anchored continuation, not a shared organ blueprint. No extra limbs, wings, or post-mortem "monster" growths; corruption is not the mechanism here. Sprite work treats "Everstill" as a preserved-undead *read* layered on a normal humanoid silhouette for the same tile height and People-adjacent proportions.',
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
            'A humanoid column that *holds* still: shoulders level, weight settled, no idle sway or breathing bounce at art-director option. The outline matches the person’s life-role (broad or narrow) but the read at distance is "paused life" before era-specific costume. At 32px, identity can lean on a one-pixel cooler midtone, level cap line, or a hair/cloth line that does not break as if wind-moved—rules-of-thumb, not a second skeleton.',
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
            'Varies with origin: a founding-era archivist, a field soldier, and a post-death [Innkeeper] do not share one envelope. In aggregate, expect adult humanoid proportions for Mistheim (roughly 5.5–7.5 heads depending on prior lineage), with the Everstill *not* gaining new mass or height after continuation; a teen who continued stays that shape. What reads as "build" in the archive city is a cross-section of four centuries of preserved bodies, not a single breed. Elders-who-died-older look as they last looked—no further biological ageing of skin or bone.',
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
            'Preserved, not decayed: cool matte skin in ranges from ashen and parchment-pale to faint blue-grey or muted warm pallor; no green rot, no open wound grammar by default. Eyes may read steady with a reduced corneal catch-light, or a slightly dry sclera at illustration scale. Hair, where present, is fixed at the state of death—no new growth, no new greying. Species pigment and fur patterns follow whatever the individual had while living; the Everstill *overlay* is desaturation and "held" stillness, not a uniform new palette that replaces lineages. Optional fine line-work like age-varnish or paper crack can sell centuries without gore.',
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
            'Facial structure matches life; expression is available for speech and archivist work, but micro-expression baseline is reduced—less unconscious flicker. Ears, nose, and jaw read true to the prior People. No muzzle, horn cores, or undead fangs as standard; the uncanny is "correct features, wrong stillness" rather than a new head shape. Scalp and facial hair for sprites follow the last living configuration (cut, style, and length fixed).',
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
            'Outwardly the same organ layout as in life, without the metabolic loop: they do not eat, sleep, or age in the living sense, so large-art cues avoid stomach hunger lines or fatigue posture—unless a Class or scene explicitly calls for them. Continuation is tied to the Class and sometimes to a Myst-anchored place (e.g. an inn, a post); damage and repair are not fully documented. Do not add skeletal extensions or "lich core" as default anatomy; reserve extreme reads for specific characters in lore, not the species row.',
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
            'Sex: follows the same overlap as the living lineages the Everstill come from. Age-at-death: frozen—children who continued do not "grow up." Epoch: Vitstad is a visible time slice—earliest dead wear second-age and founding silhouettes, newer dead wear more recent garb. Regional variation is the variation of the living cultures they were drawn from, overlaid with preservation grammar only.',
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
            'Perception is sufficient for archive and diplomatic work: reading, low-light work in stacks, and conversation at normal ranges—no need to assert superhuman senses for the default row. The Everstill are not a hunting People; if a story needs exceptional acuity, attach it to a Class or a named character. Smell/taste and fatigue cues are not used as the primary species tell.',
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
            'After continuation, calendar time does not add biological years: no further skin ageing, no greying, no height loss. Pre-death lifespan was whatever the individual’s living People had. Open-ended post-death duration is normal for the archive population; the Dry has recently introduced a fear that some myst-anchored continuations are weakening—possible end of the condition, not a natural life limit.',
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
            'At 32px: if mirroring a living template, step one or two values cooler on skin, keep posture level, and avoid "breath" micro-motion in idle. One grey or desat pixel at cheek, hairline, or eye rim can sell Everstill; avoid shambling, jaw slack, and horror-green. Merge fingers unless the pose needs clarity. Epoch identity lives in *costume* (culture), not a second head mesh—this row is bare surface + stillness on a humanoid base.',
        },
      },
    ],
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
              'The Pale City—Vitstad—stands in the ruins of a second-age capital on a northern plateau and has been continuously inhabited for four hundred years by people who died and did not stay dead, without corruption’s involvement. Their Classes still include provisions for continuation: a [Scholar] can resume a manuscript, a [Soldier] at an abandoned post can remain, an [Innkeeper] can keep a Sanctuary that still tests true.',
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
              'The Everstill do not form a new breeding stock—they are a population of continuations, chiefly archivists and the roles that support the greatest library in Mistheim. A community that does not age, eat, or sleep has invested centuries in material no living polity will catalogue: old economies, lost infrastructure, coastlines that moved, and philosophies that ended with their authors. The Compact of Knowing counts Vitstad as a partner: knowledge access and preservation services, plus diplomatic formality; most other nations are polite, quietly uneasy—especially where long-lived, powerful undead [practitioners] worry neighbours who work stone and rune. The city restores rather than renovates: second-age stone stays as it was, which makes Vitstad the quietest city in Mistheim—nothing new under scaffolding.',
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
              'The Dry: some continuations tied to a Myst anchor are weakening. The archivists are searching the stacks for precedent and have not announced it widely. This row records anatomy and default visual variation; Class specifics, full wardrobe, and archive politics live in story and character entries.',
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
              'Mood: archive hush, stone that does not get rebuilt, and dignity without warmth performance. Visual anchors: preserved *person* (the clothing they died in, maintained) rather than horror-undead. Aligns to AXES: Knowledge, Preservation, Continuity, Patience. Fictional People for the Matlu multiworld; see docs/peoples-and-races.md for the 15-canon list.',
          },
        },
      ],
    },
  },
];
