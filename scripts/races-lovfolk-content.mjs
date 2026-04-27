/**
 * Notion field copy for the `Lövfolk` Races page (#735).
 * Source: WORLD.md (elves of the eastern canopy, Grenmark, Rasa healers, living archives)
 * and AXES.md (Tradition +2, Survival +1, Tight +1, Context +2, Face; Continuity, Knowledge,
 * Beauty, Long-knowing).
 */

export const RACES_DB_ID = '34e843c0-718f-81a3-b4c8-c0ff6839bd21';
export const LOVFOLK_PAGE_ID = '34e843c0-718f-81b4-9c45-de652bc8414b';

/** Race DB relation targets (canonical stub rows) — Races database. */
export const RACE_PAGE_IDS = {
  pandor: '34e843c0-718f-8139-ae0c-ff29f37ccb38',
  bergfolk: '34e843c0-718f-818d-8d9b-eb68b2cb8325',
};

export const pageProperties = {
  Name: { title: [{ type: 'text', text: { content: 'Lövfolk' } }] },
  Endonym: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Lövfolk — "leaf-people" in Old Grenmark. There is no separate private name. The nation is the Grenmark; the People are Lövfolk. Outsiders sometimes use the Grenmark name as a geographical stand-in, or reach for descriptions ("the Long-lived", "canopy-dwellers", "wood elves") that the Lövfolk accept without preference.',
        },
      },
    ],
  },
  Exonyms: {
    multi_select: [
      { name: 'Lövfolk' },
      { name: 'Grenmark elves' },
      { name: 'the Long-lived' },
      { name: 'Wood Elves' },
      { name: 'Canopy-folk' },
    ],
  },
  bodyPlan: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Quasi-humanoid: two arms, two legs, upright biped on a gracile human baseline. Limbs are long relative to torso for reach and grip in canopy environments — long femurs, extended forearms, slightly spatulate digits. No tail, wings, or extra limbs. The legacy sprite slug sylphari (Races DB 34e843c0-718f-816a-a22d-c37ac7f5d598) carries the visual anatomy spec tied to the settlement generator; this row carries People-level lore.',
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
            'Tall, narrow vertical: a small head on a long neck, narrow waist, long legs — reads "canopy" before any face pixel. The ear tips rise above the hairline as a notch or V at sprite scale; this is the primary species marker at 32px. The silhouette contrast against Rotfolk and Jarnborn at the same tile height should be immediately obvious.',
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
            'Adults run 7–8 heads tall with a gracile frame: long femurs, long forearms, shallow rib cage, weight often on the forefoot. Children carry a proportionally larger head and shorter legs; adolescents stretch in limb length before shoulders widen; elders retain height but may show a gentle forward cant in the upper back from lifelong canopy movement. Neither sex has a markedly different silhouette — both run tall and lean with full overlap.',
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
            'Palette from birch-pale through muted leaf-green to sun-flecked bronze. Fine short vellus on forearms and shins; no scales, full pelt, or iridescence. Optional soft dapple or vein-like mottling across shoulders reads as species pattern, not cosmetics. Deep-canopy lineages often carry a cooler greenish undertone; edge-forest lineages trend warmer bronze.',
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
            'Eyes large, forward-set, with a single clean corneal highlight — tuned for detail and parallax in dappled canopy light; round pupils. Ears long, tapering to a point, rising visibly above the hairline in side view — the primary silhouette marker at 32px. Nose straight and narrow with subtle nostril flare under effort. Jaw refined; teeth within human dental range, no tusks or enlarged canines. No horns or bony crests.',
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
            'Long limbs for reach and grip in canopy: slightly spatulate distal digits for bark and rope; strong shoulder and hip mobility for twisting and bracing on narrow supports. Torso reads slim at low resolution because the rib cage is shallow relative to body length. Strong plantar grip — the Lövfolk are comfortable barefoot on rope and branch. Lightweight bone structure optimised for height and reach, not load-bearing. No patagia, climbing tail, or wings.',
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
            'Sex: adults share one slender silhouette envelope with full overlap; on average one pattern leans squarer at shoulder and jaw, another slightly longer in the leg and softer at the jawline. Age: children show a proportionally large head, prominent ears, and short torso; adolescents gain leg length before shoulders widen; elders show fine creasing at eyes and temple, silvering or fading hair, and a gentle upper-back forward lean — height barely drops. Regional: deep-canopy lineages pick up cooler green skin undertones; edge-forest lineages trend warmer bronze.',
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
            'Vision tuned for detail and motion in dappled canopy light — strong contrast sensitivity in green spectra and excellent colour discrimination in mid-light. Long ears provide good lateral sound localisation; hearing is strong for wind in branches, rope tension, and close footfalls on wood. Smell is modestly above human baseline for bark resin, Myst-saturated wood, and medicinal plant compounds. No echolocation, heat-pit, or elevated predator sensing.',
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
            'Physical maturation around 30–40 years; a Lövfolk appears "young adult" well into their second century. The prime spans roughly 80–300 years — the range in which the calcification of opinion and position is most pronounced. Ageing shows first as skin texture (subtle bark-grain quality), hair silvering, and a slight settling of movement; height does not collapse. Very old individuals may show softer ear-tip lines, more pronounced fine lines at eyes and temple, and hands that read more sinew than cushion. Total lifespan commonly 400–600 years; some Grenmark elders are older.',
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
            'At 32px: tall pointed ears (two pixels rising above the hairline) and a narrow silhouette are the primary species markers. Head is a narrow oval on a long neck; 2–3px wide torso with a shallow-chest read. Eyes as a bright pixel pair, slightly larger than human baseline at the same tile height. Long legs — three- to four-pixel shanks. The species reads as "tall reed" before clothing or context. Never a blocky or wide read; the silhouette contrast with Rotfolk, Jarnborn, and Steinfolk at the same tile height should be immediately obvious.',
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
              'The Lövfolk — leaf-people — have held the eastern ancient forests since before the Grenmark was a nation. Their oldest trees are older than their oldest records, and their oldest records are older than most Peoples\' written history. The Grenmark did not begin with a founding; it grew the way a tree grows, from root to canopy, across centuries too long for any individual to have witnessed the beginning.',
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
              'The city-states sit in the high canopy, connected by rope-road networks strung between trees that are older than any Lövfolk alive. The Grenmark is less a polity than a loose association of city-states sharing a legal tradition and a deep mutual distrust of anything from outside the treeline. The same governing councils have held the same positions for four centuries; their policies describe a world that no longer exists. The Lövfolk councils do not consider this a problem.',
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
              'The Lövfolk are the oldest Rasa practitioners in Mistheim. Their long lives give them access to emotional depths unavailable to shorter-lived peoples — grief that has had three hundred years to settle, love that has been maintained and tested and maintained again. A Lövfolk [Healer] does not simply want the patient to heal. They have wanted patients to heal for two centuries and know exactly what that wanting feels like. This is why Lövfolk Rasa is quiet and very effective.',
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
              'Their crafts are equally patient. Grenmark bows are accurate beyond what physics should allow — built from Myst-dense timber harvested with ceremony from trees at the ley-line junctions. Grenmark herbal compounds treat conditions other healers have no name for. Their third, less-acknowledged export is memory: the oldest trees in the eastern forests function as living archives, retaining impressions of events through centuries of Myst saturation. A [Keeper] who knows how to read a tree can extract historical records that no written document survived. The Lövfolk maintain this skill as diplomatic currency.',
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
              'Slow ageing is not the gift outsiders imagine. After 300 years a Lövfolk has developed opinions so calcified that changing them requires an event of genuine seismic scale. Young Lövfolk — anyone under 80 — are restless and frequently leave. They are disproportionately represented among the Wandering People, among the Compact of Knowing\'s scholars, and among the Called. They leave because they are tired of waiting for the world to fit the shape their elders remember. The ones who stay tend to arrive at the same positions as the generation before them, for reasons they would not recognise as repetition.',
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
              'AXES.md scores: Tradition +2, Survival +1, Tight +1, Context +2, Face mode; top values Continuity, Knowledge, Beauty, Long-knowing. Face mode means reputation is managed in how actions appear to the community — the Grenmark councils\' centuries-long paralysis is partly a face-preservation mechanism; publicly acknowledging error damages status accumulated over lifetimes. The very high Tradition score (+2) reflects a society where the same individuals hold power across multiple generations, with no natural turnover to introduce new norms. The high Context score (+2) is consistent with a People who communicate through implication, deep cultural reference, and what is not said — outsiders consistently misread Lövfolk diplomatic exchanges as agreement when none was given.',
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
              'The Compact of Knowing (Pandor, Lövfolk, Deepwalkers, Vitstad) is the primary institutional relation. The Bergfolk hardwood dispute is the live conflict — centuries old, publicly cold, with an unacknowledged secondary tension around Bergfolk mana-granite channels disrupting Myst flow in the forest\'s western edge. Fae courts exist under several Lövfolk groves; the Fae predate the trees, and both sides understand that neither can make the other leave. Representative Classes: [Keeper], [Leafweaver], [Bowwright], [Herbalist], [Canopy Scout]. The legacy sprite slug sylphari (Races DB 34e843c0-718f-816a-a22d-c37ac7f5d598) carries the visual anatomy spec; this row is People-level lore and relations.',
          },
        },
      ],
    },
  },
];
