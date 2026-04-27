/**
 * Notion field copy for the `Fae` (Hollow Courts) Races page (#743).
 * Source: WORLD.md (Hollow Courts, deals, inns, Lövfolk relation, Fae art direction),
 * AXES.md (Tradition +2, Survival +1, Tight +2, Context +2, Face; Exchange, Bargain, Memory, Possibility),
 * docs/race-and-culture.md, docs/peoples-and-races.md.
 *
 * The deprecated Kristallbundna entry describes a crystal-bound *lineage* within this People;
 * this row is the general court baseline before culture-specific costume, architecture, and politics.
 */

export const FAE_PAGE_ID = '34e843c0-718f-813b-925a-fae4d8244f8a';

export const RACE_PAGE_IDS = {
  lovfolk: '34e843c0-718f-81b4-9c45-de652bc8414b',
};

export const pageProperties = {
  Name: { title: [{ type: 'text', text: { content: 'Fae' } }] },
  id: { rich_text: [{ type: 'text', text: { content: 'fae' } }] },
  Endonym: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'The Court of What Was and the Court of What May Be do not publish a single public ethnonym. Insiders name themselves to the deal, the layer, or the court — and what is said in plain speech to outsiders is not assumed to be the first language they use among themselves. Other peoples’ words ("Fae," "Hollow Courts," "faeries") are exonyms in wide circulation.',
        },
      },
    ],
  },
  Exonyms: {
    multi_select: [{ name: 'Fae' }, { name: 'faeries' }, { name: 'Hollow Courts' }],
  },
  bodyPlan: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Quasi-humanoid: two arms, two legs, upright biped, human-near scale. The Hollow Courts People is an umbrella, not a single breed: the baseline reads *people-shaped first*, then *liminal* — a silhouette that can stand beside a mortal without wings, chitin, or a second set of arms. Some lineages bind Myst into matter (crystal, bone-deep resonance); that sub-lineage is documented on the Kristallbundna spec and remains Fae, not a separate People. This row describes the default unmodified body plan; layered geometry and "wrong room" space belong to culture and set dressing.',
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
            'A lean vertical with a slightly *too* calm outline: narrow torso, unhurried shoulder line, a head that does not fidget. At 32px, identity comes from stillness and one deliberate asymmetry (hair, cowl, or ear) before face detail. Not a 2×2 "sparkle-fae" head with wings; not the stock human peasant default — something in the column reads *threshold* (longer neck, a hair stroke that sits a pixel off-centre) without adding limbs.',
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
            'Adults commonly present in a 6.5–7.5 head range, lean, with weight carried as if the floor were optional. Court children are rarely foregrounded in records; when shown, they should read lanky with slightly larger eyes, not a round "storybook fae" chibi. Elders do not need to *look* frail: age can show as calmer stillness, finer surface detail, and an uncanny unweathered line to the mouth — "re-layering" in lore terms rather than stoop. Sex variation overlaps a wide envelope like other humanoid peoples.',
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
            'Cool undertones first: moonlit ash, mist-blue, river-silver, with grey-green for grove-edge layers. Skin often reads as *not quite sun-weathered* the way a farmer is — a matte, low-scatter base; optional "wrong" rim light in illustration is not mandatory at sprite scale. Hair can be fine, heavy, or sparse; colour tends desaturated. Species tells stay subtle: a slightly too-precise hairline, a uniform stillness, or a faint crescent of shadow that does not match the light source. No default glitter, scale mail, or full-body pattern unless a specific lineage calls for it.',
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
            'A human-readable facial plane with an uncannily even baseline. Eyes forward, often a touch large; pupils stay round unless art direction for a story beat says otherwise. Ears: subtle elongation is allowed, but avoid the tall, leaf-thin sylvan-elf read — that is Lövfolk-adjacent packaging, not the Hollow Courts’ default. Nose, jaw, and mouth stay within a mortal band; the expression default is *composed* and hard to read at a glance, which is the uncanny, not a separate muzzle. Horns, antennae, and crown accessories are not baseline anatomy unless tied to a named lineage in lore.',
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
            'Internally, enough goes on for sustained Rasa work and for centuries-scale memory to feel plausible: five digits, plantigrade stance, no second skeleton. They do not map neatly onto a mortal metronome for fatigue, sleep, and wound reporting — the compact keeps those beats off-screen unless a story needs them. Lineages that "wear" their Myst (e.g. crystal bonded to bone) are documented on the kristallbundna line; the general Fae row does not add plates, stingers, or webbing as defaults.',
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
            'By court affinity, art may lean *cool and archival* (What Was) vs *lean-forward and about-to-happen* (What May Be) — on this row, that is a tone tag, not a sub-race stat block. Sex: same overlapping silhouettes as other peoples. Age: often reads "wrong" in the other direction (too unweathered) rather than too young. Regional variation is *layer* language (forest edge, inn back-room, under-bridge) as much as map geography. Crystal-heavy individuals defer to the Kristallbundna spec for faceting and spires.',
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
            'Tuned to dim, layered, and half-indoor light — under-canopy, twilight, lamplight in old rooms, "faceted" court interiors. Open high sun can read visually flat, which is a fiction beat, not a medical claim. Hearing notices intent in small sounds: a latch, a step on wood that has been stepped on for centuries. Rasa-anchored emotional acuity is high in lore; the row does not add a new organ — record exceptional tells on Characters when needed.',
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
            'Long enough that a thousand years of context in dialogue is plausible. Mortal-style senescence is the wrong idiom: change is often described as re-layering or moving further into a court, not "retirement" and greying first. A precise public band is not fixed — secrecy is part of the canon texture.',
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
            'At 32px: 3px lean torso, 2px head, one off-centre hair or drape line, two dark eye pixels with a cool catch if you can spare it — no wing silhouettes, no particle glitter as the only read. "Liminal" = narrow column + one wrong-detail shadow. For crystal lineages, follow the dedicated Kristallbundna spec (crown spires, shoulder nubs). Merge fingers unless a pose needs separation; do not lean on a single skintone difference from Markfolk as the only species cue — proportion and stillness carry Fae first.',
        },
      },
    ],
  },
  'Lore Status': { select: { name: 'draft' } },
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
              'The Hollow Courts exist in the liminal: forest edge, the hour before dawn, the under-side of a bridge, the back room of an inn that has been open long enough. Their territory is layered over other peoples’ land; they have been in those places longer than the maps that name the owners. There are two loose courts. The Court of What Was orients to memory, debt, and the past. The Court of What May Be orients to potential and unspent Myst. They are not a tidy government of each other; they trade, uneasily and constantly, in what they value.',
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
              'Fae work predates Runescript in the same way a river predates a bridge: the language is not foreign to them, but their inscriptions *feel* like contracts written by someone who also wrote the fine print. In practice, their magic is Rasa-forward — personal, long-carrying, and hard to copy from a textbook. The Pandor have tried; their notes are accurate and useless, like a colour name for a dream.',
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
              'Fae *make* deals — goods are someone else’s department. A fair exchange of names, time, or truth, bound so firmly that the Class system cannot unbind it, is the through-line. Inns are one of the few places they will sit across a table with anyone; a true [Innkeeper] and a court leader are understood to do the same work by different means — sanctuary, witness, a place where stories can land.',
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
              'Lövfolk relations are the documented neighbour case: fae courts sit under several old groves; the Lövfolk did not invite them, and neither side can make the other leave — polite, layered, unresolved. The Old Accords ask nations to stay out of unsanctioned court entry; the price of ignoring that has been learned often enough. The visual legacy row for crystal-bound fae (Kristallbundna) and the crystal-resonance settlement culture in code both fold here for canon naming — see docs/peoples-and-races.md.',
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
              'Mood: layered, ancient, binding — Face-mode on high context; exchange is never only social. Visual anchors: liminal *person*, not a glitter sprite; *threshold* before costume; wrong-depth stillness, not a monster silhouette. This page is bare anatomy and default surface. Deals, non-Euclidean court rooms, and shifting "cloth" that is not really cloth sit in story and culture entries.',
          },
        },
      ],
    },
  },
];
