/**
 * Notion field copy for the Deepwalkers Races page (#740).
 * Source: WORLD.md, AXES.md, docs/race-and-culture.md. Cache: `npm run races:sync`.
 */

export const RACES_DB_ID = '34e843c0-718f-81a3-b4c8-c0ff6839bd21';
export const CULTURES_DB_ID = '2928281c-057d-4632-8834-98cd2d873912';
export const DEEPWALKERS_PAGE_ID = '34e843c0-718f-8138-878f-d4fc27cbe8b3';

/** Pandor / Merfolk race pages in the Races DB (same slugs as races-fae-content / races-everstill). */
export const PANDOR_RACE_PAGE_ID = '34e843c0-718f-81cc-8fdf-db6824a6ddd0';
export const MERFOLK_RACE_PAGE_ID = '34e843c0-718f-8162-a913-dde20e72c756';

export const pageProperties = {
  Name: { title: [{ type: 'text', text: { content: 'Deepwalkers' } }] },
  id: { rich_text: [{ type: 'text', text: { content: 'deepwalkers' } }] },
  Endonym: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Lineages use harbor- and water-names among themselves. The confederate umbrella in formal speech is Tidekin (the coastal clan-confederations that share a legal tradition and language). The Mistheim register name “Deepwalkers” is the treaty and trade-table exonym other peoples use in writing.',
        },
      },
    ],
  },
  Exonyms: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Neutral: salt-people, wave-witnesses, shore-merchants (Viddfolk trade cant). Dismissive inland: “tide-mouths” or “rope-lawyers.” Merfolk and Deepwalkers each use the other’s register name; overlap on deep-shelf and cave-mouth access is the live tension, not the label.',
        },
      },
    ],
  },
  bodyPlan: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Humanoid: two arms, two legs, upright biped on the unmodified baseline shared with Markfolk. Deepwalkers are not a second species — they are littoral, karst, and half-submerged lineages: feet for wet stone and pilings, hands for net, line, and salvage, posture for ramps, gangways, and low cave mouths. No tail, wings, gills, or extra limbs. Default Culture in code for many rows: coastborn / harbor-style settlements sample Markfolk and Deepwalker weights; this page is the named People for coastal/cave [Keeper] memory tradition.',
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
            'Medium column, slightly low center of gravity: weight through ankle and midfoot, shoulders level, head steady — “planted on bad footing” at sprite scale. Not a wide plough-stance (Markfolk) or a tall wind-wedge (Vindfarare). Forearm and hand mass can read a touch squarer from rope and cold-water work without changing tile height.',
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
            'Adults about 6–6.5 heads tall: moderate build, sometimes a slightly shorter leg line than inland farmer baselines, with grip-strong forearms and a stable knee/ankle read. Children follow humanoid juvenile curves; teens widen in hand and shoulder before height settles. Elders: weather and sun on skin and knuckles more than height loss. Cave-and-stilt work does not require a second body type — it shows in stance and hand mass.',
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
            'Palette: sea-grey, kelp undertone, salt-pale, weathered wood brown, and sun-faded harbor blue. Skin often a half-step cooler and more weather-tight than inland baselines — fine dryness from brine and wind, not fish scales. Optional faint high-sun freckle on nose bridge and shoulders; ruddier joint pads and knuckles from rope. Hair human-normal; salt can read as light tips in illustration.',
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
            'Eyes forward, medium, round pupils; in bright art a slightly relaxed upper lid against glare (not a separate organ). Ears human, level with the eye line; may read a little thickened from wind. Nose and jaw within human range. No horns, nictitating membranes, gill slits, or ear-fins. Oral legal memory, Rasa, and [Keeper] Skills are not visible on the bare row.',
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
            'Baseline humanoid organs and proportions. Habitual differences vs field-lineages (soft, not universal): (1) lateral ankle and foot slightly broader for stone, piling, and wet ramps; (2) forearm and thenar development from line, oar, and net; (3) durable palmar pads; (4) comfortable breathing in damp cold air at a mundane level — not amphibious, not deep-pressure adapted. Karst lineages may show a more flexible spine for low crawl under rock while default locomotion remains biped.',
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
            'Sex: adult silhouettes overlap; on average one pattern slightly squarer at shoulder, another slightly wider at hip. Age: infants and children human-typical proportions; elders show rope-weathered forearms, salt-and-sun at temple and cheek, silver without a sharp height drop. Regional: storm-north can read a touch more compact; warm-current ports slightly longer-limbed — paint as soft gradient variants, not sub-races.',
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
            'Vision: good with foam edge, sparkle, and contrast on water; not a nocturne specialist. Hearing: human localisation; cries and wind carry at the shore. Smell/taste modestly above baseline for brine, ozone, shellfish, and low-tide mud — use a normal nose plane, not a snout. Rasa-anchored treaty memory and [Keeper] certainty are cultural and Class-tied, not a fifth sense on this anatomy row.',
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
            'Maturation about 16–20 years, prime roughly 20–50, then visible ageing dominated by sun, brine, and labor on skin and hands. Typical human span 60s–80s. Lore: corruption strikes memory-Skills and witness-certainty first — not a different biological clock on this page.',
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
            'At 32px: 3px torso, 2px head, one salt-weather highlight pixel (cheek or forearm), feet two pixels wide with centered weight. Hands optional one pixel wider than Markfolk when visible. No default wet specular. Seal rings, braids, jars, and stilt town reads are culture ([Keeper], Tidekin) — not required for bare-species identity.',
        },
      },
    ],
  },
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
              'The Deepwalkers are humanoid peoples of Mistheim’s coastlines, river mouths, sea-facing cliffs, and the karst cave systems that thread beneath. They are not one nation. The Tidekin — the collective term for a dozen coastal clan-confederations — shares a legal tradition, a language, and a great deal of mutual suspicion, yet the binding practice is the oral memory system: every Deepwalker [Keeper] participates in a living archive maintained across the clans. A [Keeper] in a northern harbor and one in a southern delta can recall the same treaty in the form it was first spoken. Biology on this row is the shared humanoid baseline; the People’s story is water, law, and witness — not a separate “deep-sea” body plan.',
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
              'Where they live, settlements are half on land and half over water: stilts, floating platforms, structures that can be unlashed and re-established if the sea demands. That is not nomadism; it is flexibility. They make salt, navigation, and legal services — the salt trade supplies much of the continent; [Navigator] work reads as annotated memory of how the sea moves; contracts witnessed by a Deepwalker [Keeper] carry binding force beyond paper alone. Resources: fish, salt, sea access, coastal salvage. Scarce: metal, stone, inland farmland. For them memory is not metaphor: it is what the system rewards and what they most fear to lose. Corruption can look like forgetting; a corrupted [Keeper] does not only lose their voice — they lose certainty and begin to misremember. Representative Classes include [Keeper], [Navigator], [Salt-Master], [Tide-Warden], and [Diver].',
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
              'Relations: strong alliance with the Pandor through the Compact of Knowing — shared legal framework between Deepwalker [Keepers] and Pandor [Archivists], and a shared fear of the Dry. With Merfolk (Djupvolk) the relationship is long and fraught: both claim authority over the same deep places, and neither fully accepts the other’s claim.',
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
              'AXES.md: Tradition +1, Survival −1, Tight +1, High/Low context +1, Mode Honor — top values Memory, Adaptation, Witnessing, Oath.',
          },
        },
      ],
    },
  },
  {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: 'Visual and scope' } }],
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
              'Salt-treated kit, seal rings, memory-charts, and stilt architecture are culture. This Races page locks default anatomy, surface variation, and sprite reads for the Deepwalker People. Default Culture in Notion: Coastborn (coastborn) per docs/peoples-and-races.md and macro-world/cultures.json racePreferences.',
          },
        },
      ],
    },
  },
];
