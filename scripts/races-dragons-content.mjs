/**
 * Notion field copy for the Dragons Races DB page (#745).
 * Source: WORLD.md ("The Dragons — the territorial powers", safe-reference table), AXES.md,
 * docs/peoples-and-races.md (dragonkin-remnant → Dragons).
 */

export const RACES_DB_ID = '34e843c0-718f-81a3-b4c8-c0ff6839bd21';
export const CULTURES_DB_ID = '2928281c-057d-4632-8834-98cd2d873912';
export const DRAGONS_PAGE_ID = '34e843c0-718f-81ba-ac0e-f224b95a6038';

/** Lövfolk (tense but functional with Grimmvald’s border). */
export const LÖVFOLK_RACE_PAGE_ID = '34e843c0-718f-81b4-9c45-de652bc8414b';
/** Bergfolk (tribute and mining agreement with Iskuldr). */
export const BERGFOLK_RACE_PAGE_ID = '34e843c0-718f-818d-8d9b-eb68b2cb8325';

/**
 * Notion `pageProperties` for PATCH — relations (`Allied with`, `In tension with`, `Default Culture`)
 * are merged in `races-push-dragons.mjs` after resolving the Culture page id.
 */
export const pageProperties = {
  Name: { title: [{ type: 'text', text: { content: 'Dragons' } }] },
  Endonym: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'No shared collective self-name in diplomatic record. Individual dragons are known by their own names and the territory they hold; surrounding nations and scholars use the vernacular category “dragons” or territorial bynames. What they call one another when no mortals are listening is not on record.',
        },
      },
    ],
  },
  Exonyms: {
    multi_select: [{ name: 'Dragons' }, { name: 'Draak' }, { name: 'Wyrms' }],
  },
  bodyPlan: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Non-humanoid megafauna: winged quadrupedal layout in the majority of attested lineages (two pinions, four weight-bearing limbs, long torso). Serpentine or wyvern-leaning morphs exist; the unifying read is a dragon-sized animal body, not a humanoid with wings bolted on. The neck and tail are independent masses for silhouette; head may sit on a long neck or a short heavy jaw, depending on lineage.',
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
            'Dominant at distance: a wing bar, an “S” of neck–body–tail, or a coiled mass at rest. Head is a small wedge, heavy jaw, or serpent crown — never a humanoid bobble. Limbs read as columns, springs, or knuckle-walk; patience reads as a still, weight-forward stance. Identity carries in span and tail, not in facial micro-detail.',
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
            'Story scale runs from “building” to “hill” for adults; in game art they may be multi-tile bosses, distant silhouettes, or reduced icons. Thorax and shoulder anchor flight muscle; haunches drive ground movement and launch. Tail is a counterweight and expressive limb. Age and rank show in span, scarring, and horn-crest development more than a humanoid growth chart — and multi-century sleep is a documented state, not failure.',
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
            'Scales, plates, or glass-smooth hide; metallic, deep forest, sea-glass, or rust-iron palette by lineage. Patina, scar-grooves, and edge highlight sell age. Eyes often carry a hard catch-light (predation / attention) without cartoon glow. Hoard- and territory-signalling colour is canon at the People level: what reads as “mine” in metal, glass, and arrangement is a narrative beat, not a uniform paint job.',
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
            'Long snout or short crushing jaw; visible teeth at rest is temperament, not species rule. Horns, frills, or crests vary by individual. Nares are large; optional subtle heat-shimmer or moisture at speech for close shots. Ears, if present, are small; the head sell at sprite scale is outline and muzzle line, not ears.',
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
            'Chest dominated by flight musculature where wings are present; forelimbs may be gracile manipulators, heavy rakes, or knuckle-walk columns. Breath weapons (fire, frost, salt-spray, etc.) are not assumed for every individual — default them off unless a Character brief demands them. Tail function: balance, lunge, and slow posture language. Hoarding behaviour: dexterous enough to sort and curate; exact manipulator anatomy left to lineages.',
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
            'Strong individual and territorial identity: named holders in Mistheim (forest edge, high peaks, drowned coast, highlands, steppe) are expected to read as different silhouettes. Sexual dimorphism optional. “Young” vs “ancient” is not a clean size ladder — multi-century sleep, weathering, and scale patina are the age cues. Regional humidity, altitude, and coast salt may bias colour; avoid collapsing every dragon into one European fantasy template.',
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
            'Vision favours long range, motion, and high-contrast edges — territory and approach paths first. Smell for metal, blood, salt, and Myst residue is often above ordinary megafauna; wind and thermals matter for patrolling. Hearing is good but secondary to vision at sprite read.',
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
            'Generational to mortal nations; individuals can outlive many kingdoms. Prolonged torpor and centuries-long rest are part of the diplomatic baseline — waking one without cause is a serious incident. No fixed “prime” window in the record; some have been asleep so long that surface maps changed around them.',
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
            'At 64px (or multi-tile): one wing diagonal, neck arc, or tail curl carries ID before the face. At 32px, prefer icon or off-map — do not pack a full boss into a single humanoid tile. Head = small wedge with one eye glint. Scales: 1px dither at most; block colour + edge highlight over micro-scale. If only one read fits, choose wing or tail, not teeth.',
        },
      },
    ],
  },
  'Lore Status': { select: { name: 'draft' } },
};

/** Page body — origin; People narrative. */
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
              'Dragons in Mistheim are old powers: highly individual, territorial, and not framed as cartoon villains. They have goals that do not map onto mortal moral categories easily. The People row describes category anatomy, default visual language, and shared narrative baselines; named territorial holders and odd Classes (e.g. a [Patron] in one border case) live in character lore, not a single “species stat block.”',
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
              'Five major territories are currently recognised, each named for the holder and treated as roughly sovereign for diplomacy — not because dragons negotiated a tidy map, but because enough nations learned the cost of crossing those bounds. The eastern forest’s southern edge meets Lövfolk land with a tense, working border. The northern spine’s peaks overlap Bergfolk ground under tribute arrangements for low-slope mining. The deep southern coast holds drowned ruins of interest; Pandor requests and unofficial expeditions are part of the story beat. Other holders are in the highlands and open steppe with little living memory contact but remain in the Accords for completeness.',
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
              'AXES.md scores: Tradition +1, Survival +2, Tight +1, High–low context +1, Honor mode; top values Territory, Sovereignty, Hoard, Patience. Patience is both timeline (torpor) and signal (stillness) — useful for art direction and encounter framing.',
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
              'Cultures, hoard contents, and settlement layout are not locked here. `dragonkin-remnant` (Dragon Remnants) in macro-world is the default culture link for soft-weighted settlement hints toward Dragons per docs/peoples-and-races.md. The linked Notion culture row is named for hoard settlement patterns. This page is the Race DB anatomy and origin narrative; dress props and encampment fiction belong to culture briefs.',
          },
        },
      ],
    },
  },
];
