/**
 * Notion field copy for the `vindfarare` Races page (#702).
 * Kept in-repo so the sync cache matches authored canon without duplicating long strings in two places.
 */

export const RACES_DB_ID = '34e843c0-718f-81a3-b4c8-c0ff6839bd21';

export const pageProperties = {
  Name: { title: [{ type: 'text', text: { content: 'Vindfarare' } }] },
  id: { rich_text: [{ type: 'text', text: { content: 'vindfarare' } }] },
  bodyPlan: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Quasi-humanoid: two arms, two legs, and an upright stance matching a human baseline, but with elongated segments, slightly long feet (tarsal emphasis, not hooves), and optional low patagial skin ribbons along the flanks that never form a true wing. Enough to read as “wind-borne” without avian muzzle or beak, and not fey or draconic.',
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
            'Tall, narrow vertical wedge: a small high head, wide shoulders, long legs, and a single back-swept crest or plume on the occiput — the brace that reads as “cliff-wind” at sprite scale before any face detail does.',
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
            'Adults are tall and lean (about 7.0–7.5 heads tall) with a low body mass: wire, not brawler. Slightly forward-rolled but level shoulders, long neck, weight carried on the forefoot as if the ground is a temporary stop. Adolescents are awkwardly long in limb before the chest fills. Elders keep posture upright; the plume/crest thins, hands and face show more skin desiccation, shanks can read a touch thinner in sprite as “stick” legs.',
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
            'Palette leans cool: pale storm-grey, desaturated blue, sanded brown, and gull-off-white, with a wind-burn ruddiness on cheekbones, knuckles, and the bridge of the nose. Short, dense vellus on forearms, calves, and flanks, tufting into a longer plume/crest at the back of the skull and upper nape. A simple dorsal fade (slate on grey) is common; it is a species pattern, not clothing or body paint. No full pelts.',
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
            'Eyes are large, a bit more lateral than a human’s, with room for a thin highlighted band under the cornea to suggest a nictitating sheen against bright sky and dust. Ears are medium, mildly pointed, with a forward ridge that flows into the crest. Nose is narrow, nostrils wide and mobile. Jaw tapers; teeth are within human class — do not add predator fangs. No horns. The crest is keratinous-feather, not bony prongs.',
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
            'Beyond baseline human: (1) low patagial skin lines on the flanks, relaxed when idle; (2) very low subcutaneous fat, so tendons and muscle bands read in large art, but collapse to two or three values at 32px; (3) chest slightly wide for O₂ at altitude; (4) long toes and a useful hallux grip for ledges. No true powered flight. These traits align to high exposure (steppe, cliff) without redefining the silhouette to a new body plan.',
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
            'Sex: adults share the same build envelope; on average, one pattern runs broader shoulders and a slightly fuller crest, another runs a longer leg line, but any adult can show any mix. Age: children have large heads, short legs, and no adult crest (only a downy tuft). Teens stretch in the limbs first; the crest plumes in late adolescence. Regional: eyrie lineages can read a finger stockier and paler; open-plains lineages can read longer-legged and tanner. These are soft gradients for sprite variants, not sub-race splits.',
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
            'Vision prioritises distance, motion, and high-glare open sky. Night vision is not a specialty. Hearing favours low-frequency wind and distant wing-thrum; the pinna shape still supports lateral localisation. Smell is broadly human. Wide nostrils serve dust and rapid breathing at sustained exertion, not super tracking.',
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
            'Physical maturation about 16–18 years, prime from roughly 20–45, then clear ageing with crest thinning, weathering of hands/face, and a slight “wind-posture” forward lean that is muscular habit, not kyphosis. No extraordinary lifespan; the elderly are still mobile in favourable climates, but the sprite can communicate age with a smaller plume and a narrower stance.',
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
            'At 32px, carry identity with a two-pixel-tall head, one-bright eye highlight, one strong crest or plume stroke, a bunched shoulder line, and long legs (three- to four-pixel shanks). Flank patagial can be a single mid-tone line along the body silhouette; if the palette is tight, drop it and let crest + long legs do the work. No micro-face detail: silhouette first.',
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
              'Mood: bracing, spare, high-sun and high-wind. Visual anchors: sighthound and alpine climber, not angel or gryphon — no feathered muzzle, no second pair of limbs. Fictional race for the Matlu multiworld. Settlement data now samples Viddfolk and Bergfolk mixes for the old windfarer-eyrie culture; this page is the dedicated visual spec tied to the legacy vindfarare id for sprites and the codex.',
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
