/**
 * Notion field copy for the `Viddfolk` Race DB page (#737).
 * Source: WORLD.md §"The Viddfolk — centaurs of the open steppe";
 * AXES.md (Tradition +1, Survival 0, Tight +1, Context +1, Honor; Memory, Trust, Neutrality, Mobility);
 * docs/race-and-culture.md, docs/peoples-and-races.md.
 */

export const RACES_DB_ID = '34e843c0-718f-81a3-b4c8-c0ff6839bd21';
export const VIDDFOLK_PAGE_ID = '34e843c0-718f-8158-a595-c82d2e85c046';

/** Canonical Races DB stubs used as relation targets. */
export const RACE_PAGE_IDS = {
  goblins: '34e843c0-718f-81c2-bffa-f3a9c7bc119c',
  markfolk: '34e843c0-718f-81f0-8427-cf8b7f1d2a1e',
};

export const pageProperties = {
  Name: { title: [{ type: 'text', text: { content: 'Viddfolk' } }] },
  Endonym: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Viddfolk — they name themselves after the vidd, the wide open expanse of the high steppe. The name functions as both endonym and exonym: the Viddfolk run the continent\'s communication network and have standardised their own name across every nation that employs their [Heralds]. There is no gap between what they call themselves and what others call them.',
        },
      },
    ],
  },
  Exonyms: {
    multi_select: [
      { name: 'Route-singers' },
      { name: 'The Heralds' },
      { name: 'Steppe-runners' },
    ],
  },
  bodyPlan: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Centauroid — equine lower body with humanoid upper torso. Four-legged stance, two arms. The equine body is lean-muscled for sustained long-distance gaits rather than draft strength. The humanoid upper torso angles forward slightly from the withers, giving the whole figure a forward-leaning running posture even at rest. No wings, extra limbs, or appendages beyond the four horse legs and two human arms. The widest body plan in the Mistheim People roster — a centaur occupies roughly the footprint of a horse.',
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
            'Horizontal equine mass with a forward-angled humanoid torso rising from the front shoulders. At any resolution, the four-legged profile makes them the widest body plan among the People — a Viddfolk at 32px occupies a 6–8px wide footprint, instantly distinct from every biped. The human torso is a medium-narrow column above the horse barrel; the total silhouette reads as "horse with rider fused at the waist" but the proportions are more integrated than that description implies.',
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
            'Adults stand at about horse-height at the withers. The equine body is lean and bred for distance — not heavy-barreled draft but lighter plains-running proportions with good shoulder extension. Human upper body is rangy and long-armed, shaped by a life of carrying message cylinders, ley-line instruments, and route-song tablets. Children have an oversized head on a leggy foal body; teens grow into adult proportions through the legs before the upper body catches up. Elders carry more grey in coat and mane, may show reduced barrel depth, but posture remains upright and the pace deliberate rather than frail.',
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
            'Coat colours across the full steppe-plains range — black, deep bay, chestnut, dun, roan, and pale grey. Human-analogous skin and hair of the upper body follows the coat tone family (darker coat, warmer skin; grey coat, cooler or more weathered skin tone). No species-specific surface markings beyond the standard coat pattern. Cultural markings, not anatomy: route-encoded woven chest panels and mane and tail braiding carry clan, route, and seniority information — at 32px these collapse to a colour accent stripe and a textured mass respectively.',
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
            'Humanoid face on a horse neck — eyes set wider on the face than baseline humanoid, giving broader peripheral coverage suited to open terrain. Ears set higher and more mobile than Markfolk or Deepwalker baseline, capable of swivelling to localise sound at a distance — an instinct legible in large art as a slight outward tilt at rest, directional when alert. Hair kept in braids of information-bearing complexity; a senior [Herald]\'s mane carries more braid weight than most characters will ever see decoded. No horns, tusks, or facial structure outside standard humanoid range above the neck.',
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
            'Centauroid: standard humanoid torso, arms, and head above the withers; equine spine, ribcage, and four-chambered locomotive body below. The equine lower body provides a sustained trot that outpaces any bipedal runner and allows hours of route-covering without rest — this is the mechanical basis of their communication network advantage. High-level [Heralds] develop sensitivity to ley-line Myst current through the hooves — a felt resonance described as a "pull" in the direction of faster flow. This is a Rasa-adjacent skill developed through memorisation and route-running, not a separate anatomical organ. The Dry strips this first: a corrupted [Herald]\'s fastest route becomes their slowest.',
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
            'Sex: adult coat and silhouette overlap fully — one pattern on average reads broader through the barrel, another lighter through the hindquarters, with full individual overlap. Age: foals are noticeably leggy and large-headed; yearlings grow barrel before withers-height stabilises; adult proportions hold for decades. Elders show mane and tail greying before coat, then a slight reduction in barrel depth and a more deliberate pace — not frailty but care. Regional: western steppe lineages run slightly heavier in coat and build than eastern ridge-adjacent lineages, a soft gradient rather than a separate People split.',
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
            'Excellent peripheral vision from wide-set humanoid eyes — they read threat and movement across open terrain before bipeds do. Hearing tuned for both precise speech registration (memorisation demand, as with [Keepers]) and low-frequency ground vibration: hoofbeats, herd movement, and distant weather front passage. Wind-reading is a trained skill in [Steppe Scouts] and senior [Heralds], not an anatomical enhancement — they are not supernaturally good at weather; they have spent their lives learning to read it. Ley-line sensitivity is Rasa-adjacent and skill-based, as described under Anatomy.',
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
            'Physical maturation around 20–25 years for both equine and humanoid components — rapid foal-phase growth slows once full height is reached. Prime broadly 25–65. Elders carry the network\'s most complex memorised routes and typically remain active into their 70s; withdrawal from route-running usually precedes death by a decade, with the elder shifting to Speaking-Ground facilitation and the teaching of young route-learners. Lifespan somewhat longer than the Markfolk baseline.',
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
            'At 32px: a centaur reads as a horizontal equine block 6–8px wide with a humanoid torso 2–3px tall above the front. The equine body must occupy most of the tile footprint — the wide horizontal base distinguishes them from every biped in the People roster without any face detail. Coat palette is the primary species tell: steppe-dun, bay, or roan separates Viddfolk from Deepwalkers and Markfolk immediately. Route-cloth panels appear as a 1–2px colour stripe across the humanoid chest; the route-colour encoding does not render at 32px but the accent is enough. Mane braid collapses to a 1–2px textured mass at the humanoid neckline. Tail is 2–3px horizontal at rear, slightly upward-curved. Four legs resolve to two-pixel columns at sprite scale, forward pair slightly more prominent than rear in standard side-facing stance.',
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
              'The Viddfolk did not invent the routes. The routes were already there — ley-line flows and steppe paths that the landscape had made — and the Viddfolk were the people who learned to read them. When exactly this began is not recorded, because the Viddfolk do not record things. They remember them. The oldest [Heralds] carry route-songs that predate the founding of every nation they now serve.',
          },
        },
      ],
    },
  },
  {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: 'The Vidde Accords' } }],
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
              'The agreement that formalised the Viddfolk\'s position is called the Vidde Accords. It is the oldest continually observed treaty in Mistheim. Every nation signed it — not because anyone compelled them to, but because everyone understood that the alternative was no reliable long-distance communication at all. The Viddfolk negotiated from a position of being needed and used it to secure not territorial sovereignty but route-sovereignty: the right to travel any path they had historically traveled, regardless of which nation\'s land it crossed.',
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
              'The Vidde Accords are maintained by the Viddfolk themselves. They are the only party that remembers the full text. Other nations have copies. The copies diverge. Only the Viddfolk route-songs contain the binding version, which everyone is aware of and no one quite likes.',
          },
        },
      ],
    },
  },
  {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: 'What They Make' } }],
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
              'Nothing that can be warehoused. The Viddfolk run Mistheim\'s only reliable long-distance communication network. Their [Heralds] carry messages, contracts, and diplomatic correspondence at speeds no mounted rider matches — not because of superior horses, but because high-level [Heralds] learn to ride the ley-lines. A Myst-current running along a river valley makes a Viddfolk [Herald] move like wind.',
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
              'They also make decisions. This is not something they would describe as a product, but it functions as one. When two nations want to negotiate, they call a Viddfolk [Herald-of-Holding] to facilitate. The system works because the Viddfolk have no territorial interest in the outcome and have demonstrated, over centuries, that they will carry a message accurately even between parties that are actively at war. They do not take sides. They take the road.',
          },
        },
      ],
    },
  },
  {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: 'Memory as Infrastructure' } }],
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
              'The Viddfolk\'s oral tradition is not cultural ornament. It is the operating system. Maps are memorised as songs. Treaty terms are embedded in stories. Genealogies of every major family in every nation they deal with are carried in the heads of senior [Heralds]. The route-song system encodes not just paths but current-state: which ley-line flows strongly this season, which crossings are seasonal, what the northern passes do in late autumn. A [Herald] running a new route is not consulting a map. They are performing a memory, live.',
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
              'The question of who becomes a [Herald] is not inherited. It is earned. A young Viddfolk who cannot demonstrate the memorisation standard by adulthood is not excluded from their community — [Route-Keepers], [Steppe Scouts], and [Wind-Readers] are all respected — but they do not run the routes. This creates a culture in which memory is treated as the highest skill and forgetting is treated as a moral failing in a way that strikes outsiders as harsh.',
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
              'The Viddfolk are diplomatically neutral and known to be. Other nations maintain embassies in capital cities; the Viddfolk maintain routes through them. When two nations are at war, the Viddfolk continue running messages between them, charging both sides, and delivering everything accurately. They have not been attacked for this. Attacking a Viddfolk [Herald] mid-route is considered one of the few reliable ways to bring all nations simultaneously against you, because all of them need the network.',
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
              'Their arrangement with the Goblin Compact is the most functional political relationship either party has. The goblins provide information from ruins and marginal places that no one else can access; the Viddfolk carry it to people who can use it, taking a percentage. Neither side has acknowledged this arrangement officially.',
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
              'The tension with the Markfolk is about grazing. The Viddfolk need the eastern steppe for their route-claims; the Merkförbund wants to extend farming into it. No war, but the negotiation has been ongoing for sixty years and no one expects it to conclude. The Viddfolk route-songs have incorporated the contested boundary positions for three generations. The songs have not changed.',
          },
        },
      ],
    },
  },
  {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: 'The Dry\'s Effect' } }],
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
              'The ley-lines are thinning. [Heralds] who used to run the major routes in three days are taking four, five. The Viddfolk have kept this internal — an admission of slowing would damage the trust their economy is built on. The route-songs are being quietly recalculated. The new timings have not been shared with clients.',
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
              'A corrupted [Herald] is not a violent one. They lose ley-line sensitivity first: routes they could feel become routes they must navigate by memory alone. Then they begin to mistime. Then the songs start to collapse — not the words, which stay, but the knowing of what the words mean. A route-singer who has forgotten which mountain the song is describing is still singing. They are no longer a [Herald].',
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
              'AXES.md scores for Viddfolk: Tradition +1, Survival 0, Tight +1, Context +1, Honor — values Memory, Trust, Neutrality, Mobility. Tradition +1: route-songs are inherited and treated as sacred, but the songs are updated when routes change — practical Tradition, not rigid. Survival 0: the steppe provides grazing and the ley-lines provide speed; scarcity is not their primary operating pressure, though the Dry is beginning to change that. Tight +1: memorisation standards enforced harshly internally; external relations kept scrupulously neutral. Context +1: a Viddfolk [Herald] decodes route-cloth colour and braid pattern in seconds from fifty metres — all communication is encoded and layered. Mode Honor: trust is built through demonstrated reliability over time and maintained through route-keeping. Breaking a delivery oath is the worst thing a Viddfolk can do.',
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
              'Clothing, Speaking-Ground layout, and material culture (route-song tablets, message cylinders, ley-line instruments) belong to narrative and culture pages. This row locks default Viddfolk anatomy and sprite reads. The centauroid body plan is unique in the canonical 15 Peoples — it must read as a horse-width horizontal base at every sprite resolution, never as a biped. Default Culture in Notion: "Viddfolk route-culture" (steppe-camp derived, already linked). In cultures.json, both steppe-camp (1.0 Viddfolk) and windfarer-eyrie (0.7 Viddfolk, 0.3 Bergfolk) carry Viddfolk population weight.',
          },
        },
      ],
    },
  },
];
