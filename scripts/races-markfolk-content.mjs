/**
 * Notion field copy for the `Markfolk` Races page (#736).
 * Source: WORLD.md (orcs of the southern plains, Merkförbund, river delta farmers)
 * and AXES.md (Tradition 0, Survival −1, Tight −1, Context 0, Dignity; Work, Mutual-aid,
 * Hospitality, Patience).
 */

export const RACES_DB_ID = '34e843c0-718f-81a3-b4c8-c0ff6839bd21';
export const MARKFOLK_PAGE_ID = '34e843c0-718f-81f0-8427-cf8b7f1d2a1e';

/** Race DB relation targets — Races database. */
export const RACE_PAGE_IDS = {
  steinfolk: '34e843c0-718f-817e-874c-e4651216ce75',
  viddfolk:  '34e843c0-718f-8158-a595-c82d2e85c046',
};

export const pageProperties = {
  Name: { title: [{ type: 'text', text: { content: 'Markfolk' } }] },
  Endonym: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Within the Merkförbund, the most common self-name is Merkfolk — from "merk," a delta-Matlu term for the mineral-rich silt water that settles between tributaries and makes the soil. Individual community names also circulate: the main-tributary settlements call themselves Flodsborn; the high-plain outfarms use Markvakt (field-warden). The nation calls itself the Merkförbund (the Merk-Alliance) and accepts "Markfolk" as the northern exonym without protest, since protesting it would require caring more about the northerners\' vocabulary than about the harvest.',
        },
      },
    ],
  },
  Exonyms: {
    multi_select: [
      { name: 'Markfolk' },
      { name: 'Merkfolk' },
      { name: 'Orcs' },
      { name: 'Plainsborn' },
      { name: 'Flodfolk' },
    ],
  },
  bodyPlan: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Quasi-humanoid: two arms, two legs, upright biped. The external label applied by northern peoples is "orcs," a term the Markfolk find neither offensive nor accurate — they use it in trade contexts because it\'s what the buyer expects, then revert to their own names. The frame is large and muscular, adapted for sustained agricultural work in a river delta environment: wide palms, broad feet, long torso relative to leg length. No wings, tail, or extra limbs. The defining feature is the lower jaw, which carries two outward-curving tusk points.',
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
            'Wide-shouldered column with a heavy torso and a head that reads broad and tusk-bearing. The lower jaw carries two outward-curving tusk points — at 32px these are the primary species read. Build is heavier than human or Deepwalker baseline but without the extreme horn-and-mass read of the Steinfolk. The stance is upright and grounded — weight distributed through the full foot, no forward lean. At 32px: 3px wide torso block, a wide head with two small outward tusk pixels at the chin, wide-set eye pair.',
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
            'Adults run 5.5–6.5 heads tall, heavy through chest and shoulder, with a long torso relative to leg length. The agricultural baseline means wide palms, thick forearms, and broad feet — built for sustained repetitive work in wet clay soil rather than sprint or combat. Both sexes run large-framed with full silhouette overlap; the difference is in subtle facial structure rather than mass or height. Ageing reads in tusk color: near-white in young adults through cream and ivory, settling to amber-yellow in elders. An elder\'s tusks are a social cue; a young farmer with already-amber tusks is considered to have had a good, hard life.',
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
            'Matte skin from swamp-olive through warm brown, shifting toward green-grey in deeper delta communities and warmer ochre-brown in upland outfarms. No scales, pelt, or iridescence; short vellus only. Species-specific patterning: some individuals carry a faint lateral stripe at the cheekbone, a natural melanin variation consistent with millennia of river-delta sun and wind. Tusks are the surface\'s social read: near-white in young adults, cream then ivory then amber-yellow in elders.',
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
            'Wide skull with a slightly heavier jaw than human baseline, carrying two lower-jaw tusks that angle outward and slightly forward — the primary species identifier at any scale. Eyes wide-set, dark, reading calm and watchful rather than predatory. Nose broad and flat with strong nostrils useful for reading soil condition and river-water quality (tied to Rasa-based agricultural sensing). Brow ridge moderate — present but not beetle-browed. Ears standard humanoid in shape and placement. The default facial expression reads as unimpressed-and-attentive; this is not unfriendliness, it is the face of someone evaluating whether the situation warrants comment.',
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
            'Standard upright humanoid skeleton, heavier and wider than human baseline. Hands are broad with thick fingers well-suited to tool use in soil and river environments; fine work is possible but not the primary build. Lumbar and lower limb adapted for long hours standing in variable-grip terrain — clay bank, flood plain, shallow tributary. The classic Markfolk field posture is a slight forward lean from the hips when stationary: not a hunch, just the body defaulting to its working position after thirty years of it.',
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
            'Sex: minimal silhouette difference; both present as large-framed and wide-shouldered with full overlap. Age: children (called "seedlings" in the confederation\'s dry-comedy tradition) have proportionally larger heads, stub tusks barely past the gum line, and rounder facial features; adult tusks become the species read around age 12–15. Elders are identified primarily by amber-yellow tusk color and a settled, quiet quality to the face. Regional: delta communities run darker-skinned and green-toned; northern outfarm settlements shade warmer brown; the high-plain Markvakt communities are slightly lighter with less green cast.',
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
            'Standard humanoid vision and hearing. With years of [Watermaster] practice, hearing develops sensitivity to water-sound changes — experienced practitioners can detect drainage irregularities in the sound of a tributary before the change is visible on the surface. Smell develops sensitivity to soil chemistry and river-water quality through sustained Rasa-based agricultural work; this is trained attunement rather than biological difference, and a Markfolk [Farmer] without the practice has the same olfactory baseline as any other People. No echolocation, heat pits, or elevated chemical sensing.',
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
            '80–120 years, which other Peoples regard as short and the Markfolk regard as sufficient. Development reaches physical adulthood around age 18; the craft and intellectual prime runs 30–70, which is when most [Watermaster] levels are earned and most major irrigation projects are undertaken. Ageing reads in tusk color and in a settled quality to the face — not dramatic physical decline until very late. The Merkförbund\'s dry-comedy tradition holds that a Markfolk farmer who has reached eighty and is still working their own levees has made their point.',
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
            'At 32px: the tusks sell Markfolk — two 1-pixel lower-jaw protrusions angling outward from the chin block are the primary species read. Torso is 3px wide, substantial but not Steinfolk-massive. Skin is olive-green to warm brown; pick one and hold it within a set. The stance is wide-footed and grounded; no warrior lean. For [Watermaster] characters, a slight forward hip-tilt reads as "watching the water." Elder tusk pixels: swap near-white to amber-yellow. Avoid snarling or combat-ready reads — the default Markfolk expression is unimpressed-but-attentive, which at 32px means flat brow, forward-facing eyes, no open mouth.',
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
              'The Merkförbund is not named after a king, a founder, or a victory. It is named after the river system — "merk" is an old delta word for the still, silt-heavy water between tributaries, where the soil builds up and becomes the most fertile ground on the continent. The confederation takes its identity from the land it manages rather than from the people who manage it. This is considered perfectly reasonable in the southern plains and slightly uncanny everywhere else.',
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
              'The Markfolk have been in the river delta for as long as the delta has been habitable. Their oral histories go back twelve centuries — not mythology at the start, but records: flood years, drought years, when the third tributary shifted west, when the eastern levee was first constructed, which council voted to route the secondary channel and which three members dissented and why they were wrong. Markfolk memory is agricultural memory. The ancestors are in the soil, the levees, and the drainage channels. You maintain them because they are yours, not because anyone is watching.',
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
              'The Merkförbund is a confederation of forty-three cities and two hundred farming communities, governed by a rotating council that meets in a different city each year. It is, in the words of a Pandor [Scholar] who studied it for twelve years and then spent another three trying to explain it to his colleagues, "the most effective administrative structure in Mistheim that nobody from outside has ever taken seriously." This is because rotating agricultural councils made up of farmers who have strong opinions about irrigation do not look impressive to delegations from nations with thrones.',
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
              'The cultural response to a thousand years of being underestimated is not bitterness. It is a very dry comedy tradition built on the observation that the same nations that do not respect farming are the same nations that need Markfolk grain to make it through winter. The humor is almost never expressed to outsiders. It is the running commentary the confederation keeps to itself, told in field-songs, in community festivals, and in the very dry way a [Watermaster] describes a levee problem to someone who just assured her it was not serious. The punchline is usually that the problem is not serious, if you have been managing it for forty years.',
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
              'Dignity mode means status comes from yields, from [Watermaster] levels, from the quality of your levee network — not from who is watching when you earn it. A Level 35 [Watermaster] who redirected a tributary to save three townships and did not mention it to anyone is more respected inside the Merkförbund than a Level 10 [Knight] who announced his victory in the council chamber. The Markfolk [Watermaster] and [Farmer] Classes reach levels that other nations find embarrassing to acknowledge, given how little cultural respect they assign to farming. The Lövfolk, who employ Level 15 [Herbalists] in positions of great cultural prestige, do not discuss the comparison. The Markfolk have noticed that they do not discuss it.',
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
              'The Markfolk use Rasa for agriculture, which sounds surprising until you watch a Level 30 [Watermaster] stand at a river junction, feel for where the water wants to go, and redirect a tributary with a single spoken phrase. She has been doing this for forty years. She knows what it feels like when the river is wrong and what it feels like when it is right. The [Watermaster] Class is significantly Rasa-based. The Markfolk do not have a separate word for this because it has never occurred to them that irrigation would work any other way.',
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
              'AXES.md scores: Tradition 0, Survival −1, Tight −1, Context 0, Dignity mode; top values Work, Mutual-aid, Hospitality, Patience. The Tradition 0 score reflects a genuine tension: farming methods evolve with evidence (new strains, better drainage geometry, Rasa refinements), but soil memory and ancestral technique pull against pure empiricism — neither side wins. The Survival −1 reflects the material reality of river farming: yields matter, scarcity is seasonal, and the culture is organized around managing it. The Tight −1 means deviance is tolerated inside the confederation — you can fail your field this season, be eccentric, move between communities — but chronic non-contribution to shared water infrastructure is the one thing that earns lasting social damage. The Context 0 is a mixed read: Markfolk communicate plainly and explicitly within the confederation (records-focused, council minutes kept in triplicate) but are very high-context with outsiders; the dry-comedy register is invisible to anyone who does not already know what they are looking at.',
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
              'The Merkförbund structure (43 cities, 200 farming communities, rotating council) and representative Classes — [Watermaster], [Farmer], [Herd-caller], [Riverkeeper], [Clay-shaper] — are detailed in WORLD.md. The Building Alliance (Bergfolk, Steinfolk, Markfolk) is documented in the Factions DB. Default Culture is fieldborn in macro-world/cultures.json (fieldborn: Markfolk 1.0). Allied with: Steinfolk (genuine mutual respect; both understand the river-infrastructure dependency runs both ways). In tension with: Viddfolk (sixty-year-running grazing-rights dispute on the eastern steppe border; no war, no conclusion). Bergfolk: essential trade relationship (ore for food) with a recurring foothills boundary dispute that neither side has permanently resolved. The species read at 32px is lower-jaw tusks; tusk amber-yellow is the primary elder cue.',
          },
        },
      ],
    },
  },
];
