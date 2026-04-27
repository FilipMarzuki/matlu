/**
 * Notion field copy for the Constructs Race DB page (#747).
 * Source: WORLD.md §"The Constructs — the Unmade and Remade", AXES.md, docs/peoples-and-races.md
 * (workshop-collective + refuge-keepers racePreferences for Constructs).
 */

export const RACES_DB_ID = '34e843c0-718f-81a3-b4c8-c0ff6839bd21';
export const CULTURES_DB_ID = '2928281c-057d-4632-8834-98cd2d873912';
export const CONSTRUCTS_PAGE_ID = '34e843c0-718f-8130-9632-f9c08b7efae6';

/** Canonical 15 Races DB rows (draft) — relation targets. */
export const PANDOR_RACE_PAGE_ID = '34e843c0-718f-81cc-8fdf-db6824a6ddd0';
export const BERGFOLK_RACE_PAGE_ID = '34e843c0-718f-818d-8d9b-eb68b2cb8325';

/**
 * Notion `pageProperties` for PATCH — relations (`Allied with`, `In tension with`, `Default Culture`)
 * are merged in `races-push-constructs.mjs` after resolving the Culture page id.
 */
export const pageProperties = {
  Name: { title: [{ type: 'text', text: { content: 'Constructs' } }] },
  id: { rich_text: [{ type: 'text', text: { content: 'constructs' } }] },
  Endonym: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'No single collective self-name. Individuals may go by maker-given designations, purpose-titles, site names, or no personal name; the Pandor census uses external labels. Where older Constructs are treated as persons in practice, some prefer archival or craft-lineage address over a spec label.',
        },
      },
    ],
  },
  Exonyms: {
    multi_select: [{ name: 'Constructs' }, { name: 'Golems' }, { name: 'Guardian-golems' }],
  },
  bodyPlan: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Not one chassis — the People is a legal and narrative category (made, animated, purpose-bound). The majority of documented forms in Mistheim are humanoid or near-humanoid (biped, two manipulators) so they can work doors, tools, and stairs built for other Peoples. Guardians bound to a site or haulers with quadruped layouts also exist. Material varies: dressed stone, iron and bronze casings, timber frames, Rune-etched plates, and mixed Bergfolk shop output. Extra limbs, integrated tools, and fixed “mask” faces are all in-bounds; the common read is “built body,” not a shared organic species.',
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
            'Two art families at tile scale. (1) Pre-age and long-active Constructs: a slightly irregular upright column with asymmetry in shoulders or crown — one joint bulge, a weather-edge jag, or a small crest/runestone tab that sells age and individuality. (2) Bergfolk-made, newer: blockier, more uniform trapezoid; rivet or seam lines as a horizontal mid-torso tick; flatter, tool-proportional head. Both read as “thing-that-moves” before micro-face: avoid soft flesh curves; prefer plane breaks and edge highlights.',
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
            'Heights follow human door scale unless a design is site-specific. Older bodies often look maintenance-worn: uneven plating thickness, a slight forward cant from centuries of one task. Bergfolk workshop lines are compact and serviceable (roughly 5.5–7.0 heads), with even shoulders and a stable low stance. “Age” in Constructs is not growth but wear and retooling — some gain complexity (Classes, new articulation) without resembling adolescence. No default child-form; juvenile appearance would only appear if a maker built a small chassis.',
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
            'Matte to satin: stone-dust, oiled metal, or lacquered wood. Colour is culture and maker palette — workshop collective towns lean on charcoal, blue-grey steel, and mana-granite sheen, but Constructs are not locked to it. Corrosion, dust ring, and fine crack lines read as time, not as disease. Joints can show a darker interstitial shadow or a thin Myst-residue seam where Runes are refreshed. No warm skin, fur, or organic blush unless deliberately simulated by the maker (rare, uncanny if overdone).',
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
            'Extremely variable. Common patterns: a flat feature plane or shallow mask (optical apertures as lens pits or visor bands); optional low relief that suggests eyes and brow without emulating living muscle; a few long-service units carry near-human planes for speech and sign in mixed company. Ears, hair, and flexible lips are not assumed — if present, they are built features. The head is often the first place a viewer reads “Golem/Construct” at sprite scale, so prefer simple geometry and one bright catch-light over detailed micro-expression.',
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
            'Mechanical, rune-bound, and Myst-articulated systems — not a shared internal biology. Joints are visibly articulated (pivot, ball, or sliding segments). Some units carry integrated tools or weapon-limb mounts. Older Constructs may have developed Classes; Bergfolk new builds described in canon do not, while scholars watch earlier models with unease. Damage reads as dents, chips, and cracked seams rather than bruising. Maintenance equals identity drift: replaced plates and updated Runes are still the same “person” under Compact debate.',
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
            'Heterogeneous by population: twenty-two of forty-three active documented predate the current age; the rest include Bergfolk-fabrication lines. Within a workshop batch, forms may be near-identical; across Mistheim, silhouettes differ widely. Regional variation is expressed through maker marks, Rune hand, and patina, not a gene pool. Assign individual Character entries for named Constructs; this row is the category envelope.',
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
            'Implemented per build: optical, resonance, and tactile channels are the usual set for human-scale work. The scholarly record does not assume organic hearing, chemical smell, or taste — but many long-service Guardians and Keepers are equipped for speech and eavesdropping in crowd noise. Myst-linked sensitivity may appear as a faint vibration in plating when Runes or ambient Myst shift; that is a design/age trait, not a single standard organ. No one catalog fits all forty-three.',
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
            'Open-ended in principle: the oldest active documented is on the order of eleven hundred years. The Bergfolk-made cohort is too new for a “natural” end-of-service curve in lore. Deactivation, dispersal, or long sleep are possibilities for some designs; the dominant story beat is persistent operation and slow change (wear, re-plating, new Classes) rather than human-style senescence.',
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
            'At 32px: two reads — legacy (1–2 seam pixels, asymmetric corner chip on head/shoulder, one vertical crack stroke) vs workshop (flat head block, one horizontal mid-body seam, uniform grey-metal fill). Torsos read one shade darker at joints. Eyes = two same-size dark squares or a single visor line — not soft pupils. If colour is limited, use silhouette + one edge highlight; never rely on fleshtone. Same tile height as humanoid hero; width can be +1px for stocky guard builds. Fingers: merged mitten unless a pose needs a gap.',
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
              '“Constructs” is an umbrella for made things: animated, purpose-bound, and durable enough to be counted in the world like persons — whether a Shelved forerunner, a pre-age method nobody still understands, or modern Bergfolk manufacture. The oldest active in Mistheim may predate the current age; origin lines are not settled in canon and can stay disputed in fiction.',
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
              'The Pandor have documented forty-three active Constructs; twenty-two of those are older than the current age. Most work as Guardians of unpopular sites — ruins, roads, and structures that need steady upkeep. Some have become Scholars or Keepers. One, the Librarian, has been Vitstad’s primary archivist for two hundred years, which the Everstill take as unremarkable and which visitors sometimes need a moment to process.',
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
              'Bergfolk-made Constructs are newer, more uniform, and purpose-built; in WORLD.md they do not yet show Classes, while the Bergfolk study older models that do. Under the Compact of Knowing, the Pandor treat Constructs as persons; that classification is contested by the Bergfolk, who also build Constructs and are uneasy about the precedent for their latest output. The older Constructs, having been “persons in the practical sense” for longer than the debate has existed, find the law mostly academic.',
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
              'AXES.md scores (Tradition 0, Survival +1, Tight 0, Context 0, Mode Dignity) are first-pass: values listed as Purpose, Persistence, Recognition, Craft-lineage. The population is mixed (ancient independents vs shop-new), so per-Character entries may override the People baseline when needed.',
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
              'Clothes, workshop kit, and settlement layout belong to culture (e.g. workshop-collective in macro-world). This page locks category anatomy, default visual reads, and narrative baseline for the Constructs People row. Default Culture in Notion: Workshop-Towns / workshop-collective, matching docs/peoples-and-races.md.',
          },
        },
      ],
    },
  },
];
