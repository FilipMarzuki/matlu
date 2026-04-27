/**
 * Notion field copy for the `Pandor` Races page (#739).
 * Source: WORLD.md §"The Pandor", Alliances, resource geography, clothing/architecture; AXES.md;
 * docs/race-and-culture.md; docs/peoples-and-races.md. Anatomy text refined from the deprecated
 * stub row, aligned to giant-panda lineage on an upright humanoid frame.
 */

export const RACES_DB_ID = '34e843c0-718f-81a3-b4c8-c0ff6839bd21';
export const PANDOR_PAGE_ID = '34e843c0-718f-81cc-8fdf-db6824a6ddd0';

export const pageProperties = {
  Name: { title: [{ type: 'text', text: { content: 'Pandor' } }] },
  Endonym: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Diplomatic text and the Compact of Knowing use the collective name "Pandor" for the people as a whole. In everyday speech, kloster and archive affiliation matter more than a single ethnonym — a scholar is "of Mistklostret" or named by discipline before they are "a Pandor" in the casual sense.',
        },
      },
    ],
  },
  Exonyms: {
    multi_select: [
      { name: 'Pandor' },
      { name: 'panda-scholars' },
      { name: 'highland archivists' },
    ],
  },
  bodyPlan: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Quasi-humanoid: upright biped with two arms, two legs, and five digits on hands and feet; plantigrade. Torso is deep and barrel-chested relative to humans; limbs thick but still within scholar-labourer scale rather than giant mass-class. No tail, no extra limbs, no secondary muzzle that replaces a readable humanoid face at sprite scale — ursine identity comes from markings, ear shape, fur length, and cranial roundness. Legacy id pandor in settlement data points at this People; it is species anatomy, not a culture id.',
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
            'Short, wide oval on thick legs: a broad head cap with two rounded ear lumps and a high-contrast "mask" band across the eyes — reads as ink on cream before any muzzle detail.',
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
            'Adults are compact and heavy-boned: about 5–5.5 heads tall (stocky), broad shoulders and hips, short neck, weight through the full foot. Children carry a larger head on a shorter torso and limbs; the face mask reads softer at the edges. Adolescents lengthen in the legs before the chest finishes widening. Elders keep upright posture; fur at the ears and mask margin greys or thins, temples hollow slightly, and the hand reads bonier under coat.',
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
            'Dense underfur with longer guard hairs; ground colours run warm cream, rice-paper ivory, and cool mist-grey, with charcoal, soot, or deep umber for the classic periorbital "spectacle," ear fronts, and often forearms or shoulders as species pigment (not cosmetics). Nose leather and palmar/plantar skin can read pink-brown to blue-grey. No scales, plates, or bare hide patches except nose and digital pads implied under fur.',
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
            'Face is broad and round with a short upper lip and shallow snout projection — less pronounced than a real giant panda, enough for sprite clarity. Eyes sit within the dark mask band; pupils round like a human\'s. Ears are round-tipped, wide-set, and thickly furred. Jaw is wide; teeth follow human layout without enlarged carnivore canines. No horns; a slightly raised cap of longer occipital fur is allowed.',
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
            'Plantigrade feet with a strong arch and thick digital pads under fur; hallux present and load-bearing. Hands favour grip and fine work: sturdy wrists, palms a bit broad, fingers shorter relative to palm than a lanky human. Rib cage is wide for stature (comfortable sustained walking in thin highland air at a mundane, anatomical level — not a magical trait). Fur bulk adds silhouette width without extra bones or limbs.',
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
            'Sex: adult silhouettes overlap; on average one pattern runs squarer at the shoulders and jaw, another slightly wider pelvis, with full overlap. Age: young children — oversized head, large ears, soft mask edges; tweens — gangly leg growth; adults — filled chest; seniors — silvering at mask rim and ear tufts, finer guard hair, slight retraction of cheek fluff. Regional: cooler highland lineages may read greyer cream and sharper mask contrast; milder valleys may read warmer ivory and softer band edges — paint as gradient variants only.',
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
            'Vision is human-typical in daylight and twilight; the mask is pigment, not a night-vision organ. Hearing benefits from small, mobile pinnae under fur. Smell modestly above human baseline for ink, paper sizing, damp bamboo, and loam — express with nostril flare, not a wet carnivore nose.',
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
            'Near-adult proportions by about 16–18 years; prime roughly 20–50; ageing shows grey or silver at mask margins and ears, thinning cheek mane, and more pronounced fur lines at the eyes. Typical span into the 70s; no exceptional longevity.',
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
            'At 32px, sell Pandor with two dark ear pixels or one rounded ear arc, a bold eye mask (paired wedges or a shallow U), and a torso one pixel wider than a human hero of the same tile height. Scallop the head outline for fur; keep the face to one bright eye pair inside the mask. Hands and feet are three-lobe blobs unless a pose needs fingers. No micro-muzzle — mask + ears carry the species read.',
        },
      },
    ],
  },
  'Lore Status': { select: { name: 'draft' } },
};

/** Page body — origin, People narrative, and visual scope (robes/kloster are culture). */
export const pageBodyBlocks = [
  {
    object: 'block',
    type: 'heading_2',
    heading_2: { rich_text: [{ type: 'text', text: { content: 'Origin' } }] },
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
              'The Pandor live in the central highlands: bamboo ridges, mist-filled valleys, standing stones. Their settlements, kloster, are scholarly communities that are archive, school, and local government at once. The largest, Mistklostret, sits at the highest permanent mist-line and has been continuously inhabited for six hundred years. They are not a nation in the political sense. They are party to the Compact of Knowing, which grants their scholars safe passage, archive access, and formal immunity across most major powers in exchange for a commitment to share knowledge with anyone who asks. Treaties and maps know them as a single people; on the ground, their identity is tied to which archive trained you.',
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
              'What they make: records first — they have been writing things down since before many current nations existed — plus cartography (the most accurate maps of the continent) and, as a tertiary industry, a mist-fermented grain drink brewed at the kloster that is served at serious negotiations across Mistheim. Resources: bamboo, highland mineral springs, ancient ruins from several previous ages. Scarce: metal, farmland. They know more about the Dry than any other people; their archives include small "thins" from earlier ages, and they have not published what those accounts imply.',
          },
        },
      ],
    },
  },
  {
    object: 'block',
    type: 'heading_2',
    heading_2: { rich_text: [{ type: 'text', text: { content: 'People' } }] },
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
              'A destroyed text, a burned archive, or a scholar who dies without passing work on are treated as genuine harms — on a par with violence — because losing a record is a moral failure, not a mistake. That care makes the Pandor the party every nation trusts to keep secrets: they also maintain sealed records, time-locked archives, and information tiers older than the Class machinery. The cost is a reputation for delay and thoroughness when a neighbour wants a quick verdict. Representative Classes include Chronicler, Cartographer, Keeper, Archivist, and Myst-Reader. Runescript, in their hands, is documented like engineering: commented, versioned, exhaustive — the way engineers treat documentation, not the way bards improvise a verse.',
          },
        },
      ],
    },
  },
  {
    object: 'block',
    type: 'heading_2',
    heading_2: { rich_text: [{ type: 'text', text: { content: 'Relations' } }] },
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
              'The Compact of Knowing links them with the Lövfolk, the Deepwalkers, and the Everstill of Vitstad in a non-military knowledge-sharing and legal framework; Constructs are treated as persons under the Compact in Pandor law — a classification others dispute. The Deepwalkers and Pandor share a strong working alliance: both fear the Dry, both anchor memory in institutions (oral law vs written archive). Lövfolk and Pandor depend on each other: the Pandor need access to living tree archives, the Lövfolk need neutral ground; courtesy papers over a deeper tension. Bergfolk respect craft but find Pandor scholarship uncomfortable — it produces nothing you can hold. Goblins and the informal intelligence mesh trade into Pandor logistics quietly; the Merfolk have yet to answer a formal knowledge-exchange after thirty years of asking.',
          },
        },
      ],
    },
  },
  {
    object: 'block',
    type: 'heading_2',
    heading_2: { rich_text: [{ type: 'text', text: { content: 'Cultural-axes note' } }] },
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
              'AXES.md (first pass): Tradition 0, Survival +1, Tight +2, High/Low Context +1, Mode Dignity — top values Knowledge, Memory, Neutrality, Honesty. The document notes the Pandor update records constantly yet treat record-loss as sacred-harm level failure; that is a 0 on Tradition–Reason with explanation, not a +2.',
          },
        },
      ],
    },
  },
  {
    object: 'block',
    type: 'heading_2',
    heading_2: { rich_text: [{ type: 'text', text: { content: 'Mood and visual references' } }] },
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
              'Mood: still concentration, archive hush, mist-grey patience — panda-lineage scholars, not feral bears or mascot caricature. Visual anchors: giant panda colour logic on a stocky, upright humanoid frame; see WORLD.md "panda scholars of the highland mist" and docs/peoples-and-races.md. Robes, scroll gear, kloster architecture, and brewing are culture. This page and the property fields above lock bare species surface, proportions, and markings; clothing and building belong to the Pandor Watersteads culture and other lore pages.',
          },
        },
      ],
    },
  },
];
