/**
 * Notion field copy for the Dragons Race DB page (#745).
 * Source: WORLD.md §"The Dragons — the territorial powers", AXES.md,
 * docs/peoples-and-races.md (dragonkin-remnant culture mapping).
 */

export const RACES_DB_ID = '34e843c0-718f-81a3-b4c8-c0ff6839bd21';
export const DRAGONS_PAGE_ID = '34e843c0-718f-81ba-ac0e-f224b95a6038';

/** Relation targets used by races-push-dragons.mjs. */
export const LOVFOLK_RACE_PAGE_ID = '34e843c0-718f-81b4-9c45-de652bc8414b';
export const GIANTS_RACE_PAGE_ID = '34e843c0-718f-81a3-be7c-df0e97ec4cdf';

/**
 * Notion `pageProperties` for PATCH.
 * Relations (`Allied with`, `In tension with`, `Default Culture`) are merged
 * in races-push-dragons.mjs — Default Culture is already set and preserved.
 */
export const pageProperties = {
  Name: { title: [{ type: 'text', text: { content: 'Dragons' } }] },
  Endonym: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Drekar (archaic; transcribed from a deep-tongue self-designation recorded once when Iskuldr was asked directly). Individual dragons are addressed by territory-name or personal name. No collective self-designation is in regular use — "Drekar" is a Pandor transcription, not a term any dragon has been heard to apply to others.',
        },
      },
    ],
  },
  Exonyms: {
    multi_select: [{ name: 'Dragons' }, { name: 'Drakes' }, { name: 'Drakar' }],
  },
  bodyPlan: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Non-humanoid. Quadrupedal with a distinct pair of membranous wings attached behind the shoulder-girdle, making a hexapodal ground frame. The forelimbs are primary weight-bearing limbs; at rest, several named dragons have shown a capability for careful manipulation with the forepaw talons. Body elongated: neck long, chest deep, tail roughly matching the body in length and muscular to the midpoint. Documented scale spans from confirmed large-horse size (the smallest known contact) to the footprint of a small building (Saltmara, upper estimate). Flight is the norm in canon descriptions.',
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
            'A long horizontal mass, not a vertical one. Key elements from back to front: tail taper; pronounced dorsal ridge; wing-fold as a triangular secondary mass above the hind quarter; rising neck arc; skull-heavy head. At 64 px the primary reads are the neck curve, the wing silhouette, and a single bright eye highlight. The horizontal mass is meant to fill or exceed tile width. Skull prognathic and distinctly non-mammalian: the head reads "dragon" before any colour does.',
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
            'Built for endurance and territorial control rather than speed. Chest depth dominates: the rib cage anchors both the foreleg and the massive pectoral groups required for flight on a body this size. Forelimbs heavier and more developed than hindlimbs; hindlimbs nimble for ground grip and standing launch. Neck musculature reads visibly even at low resolution — the neck must carry a large skull at extension. Individual builds vary by century: Iskuldr reads wider-necked and broader-chested; Grimmvald reads longer and more sinuous; Saltmara broadest overall. These are documented individual profiles, not sub-race splits.',
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
            "Scaled throughout. Fine overlapping plates on neck and face; large interlocking tiles on back, flanks, and tail. Underbelly scales are lighter, more flexible, and occasionally iridescent at close range. Colour is strongly individual and develops a resonance with the territory over decades — not genetic in a mammal sense but documented as a real pattern: Grimmvald deep forest-green and black, Iskuldr pale grey and blue-white, Saltmara storm-blue with grey underlayer. Dvergfast and Rödrök are uncontacted in living memory. Older dragons show scale scarring, growth ridges, and panel weathering that functions as a personal record. No fur, feather, or hair anywhere except optional sensory barbels around the jaw in coastal-territory lineages.",
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
            'Elongated and skull-heavy with a pronounced prognathic jaw. Brow ridge significant and structural: anchors the eye socket and, in most named individuals, the base of a crest or horn arrangement. Nostrils wide and forward-facing on the snout. Eyes large, laterally placed with slight forward overlap; pupils slit vertically; gold, amber, or deep green typical. Horns or crest structures are present in at least four of the five named dragons and grow throughout life — individually characteristic. No external ears; hearing is conducted through cranial bone structure. Jaw hinge is wider than external shape suggests; documented opening angle is extreme.',
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
            'Hexapodal: four legs and two wings as distinct limb pairs; the wings do not fold from the forelimbs. All six attach to a large shoulder-girdle complex — the densest structural region. Tail is load-bearing and prehensile at the base, tapering to a narrower tip; used for balance, grip, and display depending on individual and context. Pandor records note consistent warmth in territory-marking proximity and documented heat discharge from at least Grimmvald and Iskuldr\'s jaws; whether this generalises across all dragons is not established.',
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
            'Strongly individuated. No two named dragons are described as visually similar in coloration, horn arrangement, or movement pattern. Territory-resonance colouration develops over decades of occupation and is a reliable individual signature. Age reads as greater individual complexity — more elaborate crest structures, denser scar patterning, deeper colour development — not as senescence. The five named individuals are each a distinct visual profile; assign Character entries for each named dragon rather than treating this row as a source of visual uniformity.',
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
            "Vision range extreme; binocular forward and wide-field peripheral. They detect Myst movement — Saltmara's rearrangement of ruin sites and Iskuldr's apparent awareness of Bergfolk mining depth at lower altitude both indicate non-visual environmental sensing at range. Territorial scent markers are estimated at kilometre-scale by Pandor fieldwork. Hearing: exact capability undocumented but conversational engagement at distances that surprise surface Peoples is on record. Deep-sleeping dragons retain some sensory function; waking one through acoustic disturbance alone is a recorded incident from two centuries back.",
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
            "Unknown upper bound. The five named dragons are each estimated between three and twenty centuries by Pandor cross-reference, with significant uncertainty on the higher estimates. Physical maturation in the current age is not documented; no juvenile contact is on record. The Everstill archive contains one oblique previous-age reference to a young dragon, too fragmented to use as a data point. Dragons sleep for decades at a stretch; some are known to have slept for centuries. Whether this is a biological cycle or voluntary is not resolved. No dragon has been observed to die of age.",
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
            'At 64 px this is a large creature tile; expect to fill or exceed the boundary. Three reads in priority order: (1) neck arc from shoulder to skull, (2) wing-fold mass above the hind quarter, (3) single bright eye highlight. Scale texture cannot resolve at 64 px — use two or three tonal zones (dorsal dark, flank mid, belly light) as body-shape signal. Horns or crest markers are the individual signature; design them to read in 1–3 pixels. No leg detail needed; silhouette mass is the read. Reserve scar lines and horn texturing for portrait art at higher resolution.',
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
              'Dragons are among the oldest beings present in Mistheim and, by extension, in the broader world record. Pandor archives — which cover three previous ages in varying completeness — contain no period in which no dragons are mentioned. Whether they predate the current age\'s configuration, emerged with it, or arrived from somewhere else is not established; no dragon has provided this information in a form anyone has been able to verify. The Everstill archive has a fragment from a previous-age source describing what appears to be a young dragon; the fragment ends before anything useful about origin is said, and the Everstill scholar who found it noted that this is probably not a coincidence.',
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
              'Five major territories are currently recognised — Grimmvald (eastern forest south edge), Iskuldr (northern mountain spine), Saltmara (deep southern coast), Dvergfast (central highlands), Rödrök (open steppe). Each is treated as a sovereign boundary under the Old Accords: a continent-wide agreement to avoid warfare in Dragon or Giant territory, established not by negotiation but by accumulated experience. No one signed the Accords. They are observed because the cost of not observing them has been demonstrated enough times.',
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
              'Dragons do not form a society or coordinate policy. The term "People" is a courtesy of the Pandor classification system, applied because the alternatives were taxonomically worse. Grimmvald has a [Patron] Class, which no one can explain; several young Lövfolk have received his patronage and come back changed. The relationship with Lövfolk land along his territory boundary is described in Pandor records as "tense but functional." Iskuldr accepts tribute from the Bergfolk in the form of fine tools; he keeps them and has not used any of them, which the Bergfolk read as approval. Saltmara holds three sunken ruin sites of archaeological significance, ignores formal Pandor requests for access, and has allowed unofficial Deepwalker expeditions to return undamaged — two came back with notes indicating the ruins had been recently reorganised. Dvergfast and Rödrök have had no meaningful surface-people contact in living memory.',
          },
        },
      ],
    },
  },
  {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: 'The Hoard' } }],
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
              'What surface Peoples call hoarding is, from available evidence, a long-term accumulation of meaningful objects rather than material wealth in the economic sense. Iskuldr keeps the tribute tools. Saltmara\'s ruins are organised, not raided. Grimmvald\'s patronage gifts have returns, not ransoms. The pattern across documented contact suggests a relationship to ownership closer to archival custody than acquisition — the Hoard is a record, and records are not the same as treasure. This interpretation is not universally accepted among scholars, and it is notable that the scholars who dispute it most strongly are the ones who have spent the most time thinking about what Saltmara might be doing with three intact ruin sites.',
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
              'AXES.md scores (Tradition +1, Survival +2, Tight +1, Context +1, Mode Honor) are first-pass estimates. The framework is an imperfect fit for entities operating on century-scale timescales whose "culture" is strongly individual rather than collective. Values listed as Territory, Sovereignty, Hoard, Patience. Honor mode reflects that territorial violations must be answered — this is documented — but the frame of "status earned through deeds" may not fully apply at this scale.',
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
              'Default Culture in Notion: dragonkin-remnant (from docs/peoples-and-races.md; already linked). Lair structure, territorial architecture, and hoard arrangement belong to that culture entry. This page covers canonical biology, visual baseline, and People narrative for the Dragons row. Assign individual Character entries (Grimmvald, Iskuldr, Saltmara, Dvergfast, Rödrök) for named dragons rather than using this row as a visual template — variation between individuals is significant.',
          },
        },
      ],
    },
  },
];
