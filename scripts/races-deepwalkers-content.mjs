/**
 * Notion field copy for the `Deepwalkers` Race DB page (#740).
 * Source: WORLD.md §"The Deepwalkers — coastal peoples of the long memory";
 * AXES.md (Tradition +1, Survival -1, Tight +1, Context +1, Honor; Memory, Adaptation, Witnessing, Oath);
 * docs/race-and-culture.md, docs/peoples-and-races.md.
 */

export const RACES_DB_ID = '34e843c0-718f-81a3-b4c8-c0ff6839bd21';
export const DEEPWALKERS_PAGE_ID = '34e843c0-718f-8138-878f-d4fc27cbe8b3';
export const CULTURES_DB_ID = '2928281c-057d-4632-8834-98cd2d873912';

/** Canonical Races DB stubs used as relation targets. */
export const RACE_PAGE_IDS = {
  pandor: '34e843c0-718f-81cc-8fdf-db6824a6ddd0',
  merfolk: '34e843c0-718f-8162-a913-dde20e72c756',
};

export const pageProperties = {
  Name: { title: [{ type: 'text', text: { content: 'Deepwalkers' } }] },
  id: { rich_text: [{ type: 'text', text: { content: 'deepwalkers' } }] },
  Endonym: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Tidekin — the collective self-name for the dozen coastal clan-confederations. Individual clans carry their own names; "Tidekin" is used when speaking of the whole. "Deepwalkers" is the exonym coined by inland peoples who first observed them in sea-caves and tidal structures.',
        },
      },
    ],
  },
  Exonyms: {
    multi_select: [{ name: 'Deepwalkers' }, { name: 'Tidekin' }, { name: 'coastal Keepers' }, { name: 'salt-folk' }],
  },
  bodyPlan: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Humanoid: two arms, two legs, upright biped at the standard Mistheim human scale — they build at the same door heights as Markfolk, share tables in inns, and pass through architecture built for the common baseline. No fins, gills, extra limbs, or skeletal deviations from standard humanoid. Species identity reads through occupational build (heavier lower limb, broad foot) and posture rather than a divergent body plan.',
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
            'Medium humanoid column, slightly stockier through the lower leg and ankle than the Markfolk baseline. Salt-weathered posture — weight distributed forward and low, stable on tidal flats and wet decking. No crests, tail, projecting ears, or wing tells. At 32px the read is "broad-footed laborer variant of the human column"; one extra pixel block at the calf or ankle plus a flatter foot stance is enough.',
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
            'Adults run 6–7 heads tall, medium-to-stocky with pronounced lower-leg and ankle mass from lifetime salt-water labor. Hands broad with strong grip; Achilles tendon visible in large art from repeated diving and tidal-flat footing. Shoulders level and wide for balance on unstable surfaces; torso moderate depth. Children and elders follow standard humanoid proportion; no separate sprite grammar required. Elders retain their wide stance but show reduced muscle volume and more prominent tendon marks at the wrist and ankle.',
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
            'Skin tones biased to weathered coastal ranges — tanned warm beige through deep brown-copper; years of salt exposure often bleaches hair toward straw-grey or salt-white earlier than Markfolk lineages. No species-specific patterning, scales, lichen marks, or structural colour variation. Fine vellus on forearms and shins; scalp hair commonly kept short or bound. Leather-oil and salt residue are occupational tells in large art, not species anatomy.',
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
            'Standard humanoid face layout; eyes medium-set, habitually narrowed slightly from tidal glare and salt spray — suggest with a shallow squint baseline in large art, round pupils at sprite scale. Ears rounded, set level with the eyes, within human range — no elongation, points, or structural difference from Markfolk. Hair commonly short or pulled back; [Keepers] wear a clan-encoded braid on the left wrist (identity documentation, not head anatomy). No horns, crests, tusks, or enlarged jaw.',
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
            'Organ layout standard humanoid. Lower limbs show occupational adaptation: ankles and feet with broader metatarsals and pronounced tendons in detailed art, from decades of wet-ground, tidal-flat, and stilt-platform work. Hands show callus patterns from line-work, salt-packing, and diving. No gills, fins, secondary respiratory adaptation, or deep-ocean morphology at this surface-lineage baseline — Deepwalkers breathe air. Rasa sensitivity extends to emotional imprinting in oral-memory retention: [Keepers] carry bound-oath weight in their Skills, which reads as physical exhaustion when corrupted (not lost words but lost certainty, felt as disorientation). The Dry strips this first.',
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
            'Sex silhouettes overlap fully at sprite scale; occupational class varies the read more than sex in large art — a [Salt-Master] reads stocky-through-forearm regardless. [Keepers] distinguished by wrist seal-rings and memory-braid. Northern harbour lineages run slightly paler with more salt-bleached hair; southern delta lineages somewhat warmer and darker — a soft gradient, not a separate People split. [Divers] may show ear and sinus notes in character lore (pressure adaptation), but these have no visible anatomy change at sprite scale.',
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
            'Vision optimised for coastal contrast: strong at reading surface reflections, tidal-flat movement, and low-light conditions near water; the habitual squint against salt glare is a cultural baseline, not a structural organ difference. Hearing well-tuned for precise spoken-word registration — oral memory demands exact recall, so a [Keeper]\'s listening posture is active and focused, not passive. Smell has a salt-and-tide baseline; [Keepers] report that the Dry alters the perceived smell of old oaths (narrative Rasa sense, not a structural organ). No echolocation, sonar, or deep-water adaptation.',
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
            'Physical maturation 15–18 years; prime broadly 18–50; ageing reads as reduced muscle volume, lighter hair bleached further by salt, and more prominent tendon marks at wrist and ankle from lifetime salt work. Typical span 55–75 years. No exceptional longevity — [Keepers] do not live longer than other Deepwalkers; their authority comes from accumulated memory and witnessed treaties, not extended youth.',
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
            'At 32px: same tile height as Markfolk baseline. Distinguish by broader lower-leg block (one extra pixel at calf/ankle), slightly wider foot stance (2px vs 1–2px), and a desaturated salt-weathered palette — matte warm brown to dark copper, pulled toward grey rather than the Markfolk warmer mid-tone. Skin is matte, not oiled. If [Keeper] class is needed, a hairline braid mark on the left forearm or a dot-ring detail at the wrist reads at 32px with strong line discipline. No fins, scales, or blue tinting — those belong to Merfolk. Eyes slightly narrowed (remove one pixel from upper-lid height in large art only).',
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
              'The Deepwalkers are the coastal and cave peoples of the long memory. Their histories go back further than any written record: they have been keeping the oral archive since before the Class system was formalised, before Runescript was standardised, before the nations that employ their [Keepers] had names. The land they occupy is transitional — between sea and shore, between surface and deep, between the world that was and the world that is. They hold that threshold with the same careful attention they bring to a treaty.',
          },
        },
      ],
    },
  },
  {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: 'The Tidekin' } }],
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
              'The Deepwalkers do not have a single nation. They have the Tidekin — a collective term for a dozen coastal clan-confederations that share a legal tradition, a language, and a great deal of mutual suspicion. What unifies them is the oral memory system: every [Keeper] participates in the same living archive, maintained across all the clans simultaneously. A [Keeper] in the northern harbours and one in the southern delta are holding the same treaty, word-for-word, in the same form it was first spoken. This is not metaphor and not ceremony. It is the infrastructure.',
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
              'Their settlements are built half on land and half over water — on stilts, floating platforms, and structures that can be abandoned and re-established if the sea demands it. They are not nomadic. They are flexible. Stilt-towns that have occupied a stretch of coast for a century look permanent; ones built in the last thirty years look like they arrived last week and may leave. The aesthetic that emerges is spare and functional, except for the piling anchors, which are carved with clan marks and tide records — the only element the Deepwalkers treat as permanent.',
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
              'The Deepwalkers make salt, navigation charts, and legal services. The salt trade supplies most of the continent and has for centuries. Their [Navigator] Classes produce maritime charts that are not maps exactly, but annotated memories of how the sea moves in particular conditions at particular points — intelligible only to trained readers, but precise in ways that compass-and-survey methods cannot replicate. Their [Keeper] services are employed by every major nation: a contract witnessed by a Deepwalker [Keeper] is considered legally binding in a way that signed paper alone is not, because the [Keeper] does not just remember the words. They carry the emotional weight of the signing — a Rasa imprint from the moment of agreement. They know when a treaty has been broken before anyone tells them.',
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
              'Memory is not metaphor for the Deepwalkers. It is the thing the culture rewards most and fears losing most. Deepwalker corruption looks like forgetting — the Dry strips their Skills first where memory intersects with Myst, and a [Keeper] whose Skills are corrupted does not lose their voice. They lose their certainty. They begin to misremember. This is treated as one of the worst things that can happen to a person. The Dry is their existential enemy in a way that purely material scarcity is not.',
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
              'Relations with the Pandor are a strong alliance: the Compact of Knowing is a legal knowledge-sharing framework that both the Deepwalker [Keepers] and Pandor [Archivists] maintain. They are the two peoples most actively terrified by the Dry, for related reasons. Relations with the Merfolk are complicated: both claim authority over the same deep places — sea-caves, tidal channels, sunken ruins — and neither fully acknowledges the other\'s claim. This tension is mostly cold and mostly managed, except when a particular ruin becomes economically significant.',
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
              'AXES.md scores for Deepwalkers: Tradition +1, Survival -1, Tight +1, High/Low Context +1, Mode Honor — values Memory, Adaptation, Witnessing, Oath. Tradition +1 reflects genuine investment in ancestral methods (oral memory, Keeper lineages) balanced against their need to adapt physically to shifting coasts. Survival -1 reflects scarcity discipline: fish, salt, and sea-access are plentiful but metal, stone, and farmland are always constrained. Tight +1 and Context +1 reflect norm enforcement through witnessed oath and layered communication — a [Keeper] with thirty seal-rings is a walking archive of what everyone in the region has promised.',
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
              'Clothing, stilt architecture, and material culture belong to narrative and culture pages. This row locks default Deepwalker anatomy and sprite reads. Legacy `human` settlement data assigned Deepwalkers and Markfolk the same slug; the `coastborn` and `harborfolk` cultures in cultures.json now carry explicit Deepwalker weights (0.3 and 0.4 respectively). Default Culture in code: `harborfolk` / Harbor Towns, which carries the highest Deepwalker racePreference and the water-integrated, elevated-construction settlement traits matching the stilt-town lore.',
          },
        },
      ],
    },
  },
];
