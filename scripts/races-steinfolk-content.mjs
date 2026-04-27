/**
 * Notion field copy for the `Steinfolk` Races page (#738).
 * Source: WORLD.md (minotaurs of the five strongholds, Femhörn, flood-crisis builders)
 * and AXES.md (Tradition −1, Survival −1, Tight 0, Context −1, Dignity; Work, Solidity,
 * Patience, Continuity).
 */

export const RACES_DB_ID = '34e843c0-718f-81a3-b4c8-c0ff6839bd21';
export const STEINFOLK_PAGE_ID = '34e843c0-718f-817e-874c-e4651216ce75';

/** Race DB relation targets (canonical stub rows) — Races database. */
export const RACE_PAGE_IDS = {
  bergfolk: '34e843c0-718f-818d-8d9b-eb68b2cb8325',
  markfolk: '34e843c0-718f-81f0-8427-cf8b7f1d2a1e',
};

export const pageProperties = {
  Name: { title: [{ type: 'text', text: { content: 'Steinfolk' } }] },
  Endonym: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'No single ethnonym across all five strongholds. The nation-name is the Femhörn (the Five Horns). Stronghold clusters use descriptive local terms — those at the river-delta junction call themselves Flodkraft; the mountain-pass stronghold uses Passkrav. Collectively they accept "Steinfolk" (stone-people) as accurate and have never replaced it with their own.',
        },
      },
    ],
  },
  Exonyms: {
    multi_select: [
      { name: 'Steinfolk' },
      { name: 'the Five Horns' },
      { name: 'Femhörnfolk' },
      { name: 'Builders' },
      { name: 'Flodvaktare' },
    ],
  },
  bodyPlan: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Quasi-humanoid: two arms, two legs, plantigrade upright biped with bovine-adjacent cranial features. The body plan reads "large person with horns and a wide skull" — not a bull head transplanted onto a human torso, but a coherent People with communicative faces and upright carriage. No tail, wings, or extra limbs. Heavy frame optimised for vertical load and sustained manual labour in stone and water environments.',
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
            'Wide, heavy column: deep chest, broad shoulders, thick neck, and a head that reads massive and horned. Substantially heavier than Markfolk or Bergfolk baselines; the silhouette says "load-bearing" before clothing or context does. At 32px: two horn pixels rising from a wide head mass are the primary species read; torso is 3–4px wide with a deep chest block. The stance is settled — weight through the full foot, no forward lean.',
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
            'Adults run 7–8 heads tall and heavy — not just height but mass: deep chest, wide pelvis, pillar legs, forearms thickened by sustained heavy work. Development is slow; a Steinfolk is not considered experienced until their third or fourth decade. Neither sex has a dramatically different silhouette — both run large and thick-framed with full overlap. Elders show no height loss; the visible ageing cues are horn engravings accumulating (social read) and a greying of skin at temple and shoulder.',
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
            'Matte skin in dark-earth to warm-grey tones — stone-dust and outdoor work roughen the surface permanently. No iridescence, scales, or pelt; short vellus only. Some individuals show natural grey-tan patterning on the upper back or shoulders that reads as stone-dust permanent. Horns are dense, dark bone material — unmarked in youth, progressively engraved at project milestones in adults; an elder\'s horns are extensively marked and readable as a career record.',
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
            'Wide bovine-adjacent skull: poll broader than temples, eyes wide-set with a lateral field that reads calm and watchful rather than predatory. Horns rise from the poll — typically curving outward and then forward, though arc shape varies by individual. Jaw square and capable; the muzzle is shortened enough that expression reads clearly — not a snout. Nose broad with a flat bridge. Ears lower-set and rounded compared to most Peoples. At 32px: wide head with two horn pixels above and a thick-neck block below; wide-set two-pixel eye pair.',
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
            'Heavy skeleton optimised for vertical load and sustained manual work: deep lumbar, thick femurs, ankles built for weight transfer on stone and gravel. Hands are large with thick fingers — designed for grip strength and tool use in heavy materials; not delicate but more precise than the size implies. Plantigrade and stable; no hooves. The permanent postural adaptation in working adults is a slightly forward shoulder-set and a wide stance — not a hunch, just load-bearing normal.',
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
            'Sex: silhouette overlaps almost completely; both present as large and heavy-framed. Age: juveniles (calves in informal usage) have proportionally larger heads and stub horns; adolescents gain height before full shoulder width; elders are marked primarily by horn engravings — many milestones reads as experienced and respected, not physically diminished. Regional: minimal across the five strongholds; skin tone shifts toward lighter grey at the northern mountain-pass stronghold and is slightly warmer at the southern coastal one.',
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
            'Standard humanoid range. The wide lateral eye placement provides broad peripheral vision — useful for structural inspection and site awareness — but not a predator or combat sense. Hearing is good at low-frequency structural sounds (stone settling, timber creak, water-flow change beneath a floor), developed by generations of maintenance work. No echolocation, heat-pit, or elevated chemical sensing.',
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
            '150–200 years; development is slow by Mistheim standards — adulthood is reached around age 25 but full physical development (horn arc complete, full shoulder width) continues into the early thirties. The intellectual prime runs 40–120, which is when most major structural projects are undertaken. Ageing shows first as skin greying at temple and shoulder, and a slight settling of the horn curvature — the face does not hollow rapidly; the Steinfolk age the way stone does, gradually and without drama.',
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
            'At 32px: the horns and mass sell Steinfolk — prioritize a 3–4px wide torso block, two-pixel wide-set eye pixels (lateral feel), and two horn pixels rising from a wide head. Work apron reads as a rectangular canvas-colour block over the torso, slightly darker than the skin tone. For elder characters add one or two fine horizontal cut-lines on each horn pixel to suggest engravings. Avoid elegant or slender reads; this People is load-bearing and the silhouette should say so before any clothing or face pixel lands.',
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
              'The Steinfolk were in Mistheim before the continent had its current drainage. Their oral tradition — sparser than the Pandor\'s but older than most Peoples\' written records — speaks of a time before the Five Strongholds, when they were more dispersed and their building was more modest. What changed was the catastrophic flood series of five centuries ago: three seasons of river failure, two coastline collapses, and the destruction of most of the continent\'s lowland infrastructure. The Steinfolk came. Not because anyone asked first — because the rivers needed fixing and the Steinfolk knew how.',
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
              'When it was over, they stayed. Each stronghold is built at the problem-point that summoned it: the river-delta junction, the avalanche-prone mountain pass, the silting harbour, the rotted bridge crossing, the geographic centre whose reason the Steinfolk have never explained and nobody has pressed them on. The Femhörn — the Five Horns — is not a monarchy or a parliament. Each stronghold is self-governing; the annual convening is a logistics meeting, not a senate. Decisions are made slowly, consensus is expected, and the Steinfolk do not consider this a flaw.',
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
              'The Steinfolk are the people who fix things and stay to maintain what they fixed. Every major river junction in Mistheim has a Steinfolk [Engineer] or [Bridgekeeper] on site, doing the work nobody else learned because they always assumed the Steinfolk would handle it. The Steinfolk are aware of this. They have not made it a bargaining position. They have not decided whether this is dignity or missed opportunity.',
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
              'Their ritual life is built around what they have made. The founding stone of every major project is inscribed with the date, the builder\'s name, the purpose, and the commissioners — these stones are structural, not symbolic; they are load-bearing elements that also happen to be records. A craftsperson\'s most important ceremony is laying the first stone of a project that matters. Death rites involve adding one stone to whatever the deceased built; if nothing remains, a memorial stone is cut and placed somewhere meaningful. An elder\'s horns carry engraved marks for each significant project completion — reading them is reading a career.',
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
              'The Steinfolk have been called in crisis, helped, and not called again until the next crisis so many times that they have stopped expecting acknowledgment. What they track instead is data: who called, what was wrong, what was fixed, what was not. A Steinfolk [Engineer] who has rebuilt the same flood wall four times does not express frustration about it. She notes, for the record, what would prevent it being rebuilt a fifth. Nations that have been dismissive of the Steinfolk discover, eventually, that the Steinfolk remember — not as grievance, as record.',
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
              'AXES.md scores: Tradition −1, Survival −1, Tight 0, Context −1, Dignity mode; top values Work, Solidity, Patience, Continuity. The Dignity mode means status comes from what you have built and maintained, not from who is watching — reputation is earned in the structure, not in the announcement. The low Context score (−1) is consistent with a culture that documents everything in foundation stones and milestone-engravings rather than relying on implicit shared understanding; Steinfolk communication tends toward explicit and recorded. The Tight score of 0 reflects the five-stronghold structure: functionally independent, cooperating out of practical alignment, not identity solidarity.',
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
              'The Building Alliance (Bergfolk, Steinfolk, Markfolk) is documented in the Factions DB. The Femhörn five-stronghold structure and representative Classes — [Engineer], [Bridgekeeper], [Stoneshaper], [Flood-Warden], [Structural Keeper] — are detailed in WORLD.md. Default Culture is ironborne-encampment in macro-world/cultures.json. The species read at 32px is horns and work-apron mass, in that order.',
          },
        },
      ],
    },
  },
];
