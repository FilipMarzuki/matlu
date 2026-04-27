/**
 * Notion field copy for the `Bergfolk` Races page (#734).
 * Source: WORLD.md (dwarves of the northern holds, Dyprike confederation, runesmiths)
 * and AXES.md (Tradition −1, Survival −1, Tight +2, Context −1, Honor; Mastery,
 * Craft-lineage, Continuity, Solidity).
 */

export const RACES_DB_ID = '34e843c0-718f-81a3-b4c8-c0ff6839bd21';
export const BERGFOLK_PAGE_ID = '34e843c0-718f-818d-8d9b-eb68b2cb8325';

/** Race DB relation targets — Races database. */
export const RACE_PAGE_IDS = {
  steinfolk: '34e843c0-718f-817e-874c-e4651216ce75',
  lovfolk:   '34e843c0-718f-81b4-9c45-de652bc8414b',
  markfolk:  '34e843c0-718f-81f0-8427-cf8b7f1d2a1e',
};

export const pageProperties = {
  Name: { title: [{ type: 'text', text: { content: 'Bergfolk' } }] },
  Endonym: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Within the Dyprike, the most common self-name is Dypfolk — from "dyp," meaning deep, referencing the underground hold-cities rather than the mountain slopes that surface peoples see. Surface nations use Bergfolk (mountain people) because they encounter the mountains, not the depth. Individual holds also use their own hold-names for community identity: a Bergfolk from Hammerfast is Hammerfastborn before they are Dypfolk. The confederation is called the Dyprike (the Deep Kingdom), which is slightly ironic given that no hold cedes meaningful authority to any other.',
        },
      },
    ],
  },
  Exonyms: {
    multi_select: [
      { name: 'Bergfolk' },
      { name: 'Dwarves' },
      { name: 'Holdborn' },
      { name: 'Dypfolk' },
    ],
  },
  bodyPlan: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Quasi-humanoid: two arms, two legs, upright biped. Significantly shorter and denser than human baseline — built for underground holds and forge-work rather than open terrain. Wide through the chest, thick-limbed, low center of gravity. No wings, tail, or extra limbs. The defining physical adaptation is compactness: Bergfolk navigate narrow carved passages without difficulty that a taller people would find impassable. The external label applied by many surface peoples is "dwarves," which the Bergfolk use in trade contexts because it communicates efficiently, and then set aside.',
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
            'Wide, squat column — shorter than human baseline by roughly a head and a half, but substantially wider through chest and shoulder. The head is large relative to the torso, broad-browed, usually with significant beard mass below the jaw. At 32px: 3px wide torso but noticeably shorter height than human-baseline sprites; strong horizontal shoulder line; wide head block with a heavy brow ridge pixel. The primary species read is the width-to-height ratio — Bergfolk read compact and grounded, not tall.',
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
            'Adults run 4–5 heads tall: substantially shorter than human baseline, wide through chest and shoulder, dense muscle mass suited to forge-work and stone-cutting. Legs are shorter relative to torso than in human proportion; center of gravity is low. Both sexes present as compact-framed with full silhouette overlap; the difference is minor and reads in facial structure and beard density rather than mass. Ageing reads in beard color (dark through iron-grey to chalk-white) and in the accumulated rune-work on personal tools — an elder\'s belt-clasp carries forty years of additions.',
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
            'Skin ranges from pale grey-white in deep-hold communities through warm iron-grey and ashen rose in higher-altitude or surface-trade settlements. No scales, pelt, or iridescence; matte skin throughout. Mineral dust from forge and stonework settles into pores over a working lifetime, giving elders a slightly grained appearance. Hair is dense and dark in youth, fading through iron-grey to chalk-white in elders; facial hair is near-universal in adults and culturally significant — length, braid pattern, and ornamentation carry hold-specific codes.',
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
            'Wide skull with a heavy brow ridge — present but not over-pronounced. Eyes forward-facing, deep-set under the brow, adapted to mana-granite glow and forge-light; surface-world daylight is manageable but the deep eye-socket provides natural shielding. Irises run dark brown through pale grey. Nose broad and slightly flattened from generations of underground air. Jaw heavy and square; beard and sideburn mass is near-universal in adults and acts as a social readable — length, braid pattern, and embedded clasp-work all carry meaning within a hold. Ears small and close to the skull with no pointed silhouette.',
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
            'Compact, dense-boned skeleton — shorter than human baseline but with greater skeletal mass overall. Shoulders are wide relative to height, with thick trapezius and deltoid mass from sustained overhead forge-work. Hands are the defining anatomical feature: wide palms with short, thick fingers capable of both heavy hammer strikes and fine rune-carving — the fingertip sensitivity developed through decades of rune-craft exceeds what the hand shape suggests. Classic forge posture is a widened stance with weight forward; in hold corridors the gait is economical and unhurried, adapted to narrow passages.',
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
            'Sex: adults share one silhouette envelope — both compact and wide-shouldered with full overlap. Facial hair is the primary readable difference: one pattern runs heavier beard mass from early adulthood; the other tends shorter or braided-close. Neither pattern is exclusive. Age: children (called "ingots" in Dyprike informal speech) are proportionally round-headed with soft features and no beard; adolescent hold-apprentices develop the wide-shoulder profile first, then fill into it over years of forge-work. Elders are identified by chalk-white beard or hair and by the density of rune-work accumulated on personal tools. Regional: deep-hold communities run paler through grey-white; higher-altitude or surface-trade settlements shade warmer towards iron-rose.',
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
            'Vision adapted to mana-granite light and forge-glow — the eye is comfortable at close-focus work with a preference for steady artificial light over variable surface conditions; surface daylight is functional but Bergfolk blink more in direct sun than surface peoples. No true dark-vision: Bergfolk underground environments are lit, not dark. Hearing attuned to stone resonance — an experienced [Runesmith] can judge a metal piece by its struck tone before visual inspection, and a [Deepminer] can hear structural stress in rock that others would not register. Tactile: fingertip sensitivity from rune-carving is exceptional; an experienced [Runesmith] can feel imperfections in metal or grain variations in stone that visual inspection would miss. No echolocation, heat pits, or elevated chemical sensing.',
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
            '200–280 years, which explains how eight centuries of craft tradition compounded across only three or four master generations. Development reaches physical adulthood around age 25–30; the craft prime runs 60–200, during which most [Runesmith] levels are earned and most significant hold-works built. Ageing reads in beard-whitening and in accumulated rune-density on personal tools — an elder whose tools are so rune-covered that new additions require the old ones to be refined into finer script is understood to have made everything worth making. Death before 200 is considered a hold\'s loss, not merely a personal one. A master [Runesmith]\'s tools are buried with them; removing someone\'s tools without permission is the closest thing the Dyprike has to a taboo.',
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
            'At 32px: the width-to-height ratio sells Bergfolk — torso is 3px wide but the sprite stands noticeably shorter than human-baseline sprites (aim for about 2/3 the height). Beard mass below the chin is 1–2px and is the primary face-read alongside the wide-brow block. Skin runs grey-white to iron-rose; avoid the warmth common to surface-adapted peoples. Heavy brow is a 1px dark ridge above the eye block. For [Runesmith] characters, a single rune-stroke on the tool or belt-clasp at 1px implies the full vocabulary. Elder reads: chalk-white beard pixel, denser tool-rune marks. Avoid orange-red hair — Bergfolk hair runs dark brown to chalk-white. The wide-stance, forward-weight forge posture is the default read.',
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
              'The Dyprike was not founded by a king or a conqueror. It was founded by a collapse. Three hundred years before the oldest surviving hold-records, a tunnel-failure sealed eight communities under the northern mountain spine for eleven years. They could not reach each other by the old routes. They could not be reached from outside. What came out when the passes were finally re-cut was a confederation that had, over eleven years of forced isolation, arrived at the same solution independently in each hold: share the rune-scripts or everyone dies.',
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
              'This is the hold-culture\'s origin story, verified or not. The Bergfolk tell it straight. There is nothing in it to be embarrassed about. Eight communities went in. Eight came out, and they had a trade pact. The Dyprike has been operating on the same logic since.',
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
              'The Bergfolk measure status by what you have made. Not your parents\' work. Not your hold\'s reputation. What you have personally built, forged, inscribed, or cut. A Level 2 [Laborer] who inherited a hold seat sits lower at the communal table than a first-generation [Runesmith] who levelled through forty years of craft. This is not a metaphor. Seating at hold communal dinners is assigned by Level and craft achievement. Visitors who do not know this sometimes sit down wrong. The Bergfolk notice and say nothing.',
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
              'The Dyprike is a confederation of independent holds — the "kingdom" in Dyprike is diplomatic fiction; no hold cedes meaningful authority to any other. What they share is the rune-script tradition, the trade-road maintenance, and an agreement not to go to war with each other more than once per generation, which has held, approximately. What they do not share is precedence. A master [Runesmith] from one hold carries no formal authority in another. What they carry is their work, and their work speaks for itself.',
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
              'Runescript is the Bergfolk\'s defining technology. The runes are not ornament — they are engineering language. A rune on a hammer specifies how the force should transfer through the metal. A rune on a mana-conducting block tells the current the path it is permitted to take. [Runesmiths] learn to read the runes before they learn to write them; the script has a grammar, and the grammar has been accumulating for eight centuries. A Level 20 [Runesmith] in the Dyprike has access to techniques that nowhere else has rediscovered. This is not because the Bergfolk are born with special aptitude. It is because they have been doing it continuously, in the same holds, building on the same foundations, for eight hundred years.',
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
              'The Bergfolk use Rasa less than any other people, and those who use it well tend not to mention it to other Bergfolk. Their cultural framework treats Runescript as the only legitimate magical tradition — not because other traditions are wrong, exactly, but because they are foreign, and foreign tools belong in the category of things you track carefully and depend on as little as possible. A [Runesmith] who uses Rasa to find the right state of mind before a difficult inscription has not broken any rule. They have simply done something that, in a hold context, is no one else\'s business.',
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
              'AXES.md scores: Tradition −1, Survival −1, Tight +2, Context −1, Honor mode; top values Mastery, Craft-lineage, Continuity, Solidity. Tradition −1 (not −2) reflects that Bergfolk craft methods genuinely evolve with evidence — better alloys, refined rune-grammar, new geological surveys — but lineage and tool-taboo pull it back from full empiricism; a craftsperson does not discard their master\'s methods lightly, the script accumulates rather than resets. Survival −1 reflects a hold culture that is not materially precarious — geothermal heat, deep-mine resources, long-established trade — but operates as if scarcity is one cave-in away; this is structural caution, not actual emergency. Tight +2 means norms are enforced and deviance is visible: a craftsperson who abandons a commission, misuses rune-scripts, or takes someone else\'s tools without permission finds social consequences arrive before formal ones do. Context −1 reflects plain speech: what a Bergfolk craftsperson means, they say; political subtext exists between holds but the default register is direct.',
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
              'The Dyprike (confederation of holds) and representative Classes — [Runesmith], [Stoneshaper], [Deepminer], [Brewmaster], [Forgekeeper] — are detailed in WORLD.md. The Building Alliance (Bergfolk, Steinfolk, Markfolk) is documented in the Factions DB. Default Culture is mountainhold in macro-world/cultures.json (mountainhold: Bergfolk 1.0). Allied with: Steinfolk (Building Alliance; mutual craft respect — they build at a scale the Bergfolk supply for). In tension with: Lövfolk (the eastern hardwood dispute — the Lövfolk want it preserved, the Bergfolk want it for charcoal and construction; centuries old, neither side has moved); Markfolk (the southern foothills boundary dispute — trade is essential and ore-for-food runs both ways, but the line between Markfolk farms and Bergfolk mining claims has never fully settled). The species read at 32px is compact width-to-height ratio and beard mass; chalk-white beard pixel is the elder cue.',
          },
        },
      ],
    },
  },
];
