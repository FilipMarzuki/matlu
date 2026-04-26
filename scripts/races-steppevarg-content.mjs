/**
 * Notion field copy for the `steppevarg` Races page (#698).
 * Kept in-repo so the sync cache matches authored canon without duplicating long strings in two places.
 */

export const RACES_DB_ID = '34e843c0-718f-81a3-b4c8-c0ff6839bd21';

export const pageProperties = {
  Name: { title: [{ type: 'text', text: { content: 'Steppevarg' } }] },
  id: { rich_text: [{ type: 'text', text: { content: 'steppevarg' } }] },
  bodyPlan: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Non-humanoid: centauroid six-limb layout — humanoid torso, arms, and head on a broad waist atop a rangy ungulate lower body (four hooved legs, barrel, tail). Matches Mistheim Viddfolk canon (open-steppe centaurs). Legacy id steppevarg labels the demographic historically tied to steppe-camp settlements before Peoples-name consolidation; it is anatomy only, not a culture.',
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
            'Long, low equine base with a compact upright torso riding above the withers — one diagonal from hoof-line to crown when moving; mane or crest stroke plus a thin head wedge reads "steppe runner" at sprite scale before any face detail.',
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
            'Adults are lean and leggy: humanoid torso within normal human proportions, joined to dry muscle over long cannons and upright pasterns; withers sit near or slightly above human shoulder height when square. Foals and children show oversized head on a small barrel, short shanks, and a higher, shorter torso — clearly juvenile. Elders hold posture but the topline may soften; cheeks hollow slightly, tail root thins; mane and tail bleach or silver while the human face shows weather lines and deeper folds — there is no separate equine head to muzzle-grey.',
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
            'Equine half: short coat in dusty buckskin, clay tan, pale dune, or cool grey with optional black points; countershaded belly; dorsal stripe or shoulder ghost-marking allowed as species pigment only. Human skin on the torso where exposed: wind- and sun-roughened tan to ruddy brown. Mane and tail are coarse brush, often sun-bleached at tips; fetlock feather absent or minimal for this lineage. No scaled or armoured integument.',
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
            'Human facial plan on the torso (no secondary equine head): eyes set for horizon scanning, slightly wide-set; ears human but a touch taller and more mobile than baseline, good for wind and distant hoof-fall. Nose and jaw within human range; teeth human occlusion — no enlarged canines or lupine muzzle. Hair at the human nape flows into the equine crest mane as one continuous strip — the main silhouette join cue.',
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
            'Broad muscular waist ties human spine to equine withers; rib cage spans both segments for endurance. Long sloping shoulder into elastic pasterns; hard hooves; full equine tail. No wings, no extra limbs, no serpentine tail. Heat-adapted: large nasal turbinates implied by slightly tall nasal bridge and wide nares for dust and sustained exertion (anatomical, not magical).',
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
            'Sex: adults share one build envelope; on average one pattern runs heavier neck and crest under the torso, another slightly wider spring of rib, with full overlap. Age: foals — long legs, small barrel, big head, no adult mane length; yearlings — awkward limb length; adults — filled chest and haunch; seniors — silvering mane/tail and human temple grey, thinner mane, possible dip behind withers. Regional: open-steppe lineages read paler and leggier; sheltered-grass variants may show a touch more fetlock hair — soft gradients for sprites, not hard sub-races.',
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
            'Vision biased toward motion and long sightlines under bright sky; glare tolerance useful. Hearing: human pinnae, strong lateral localisation. Smell broadly human — not bloodhound-grade. Low-frequency vibration through hooves and long bones aids awareness of herd and ground tremor at a mundane, anatomical level (no extrasensory claim).',
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
            'Human-adjacent schedule: torso and legs near adult proportions by about 16–18 years; prime from roughly 20–45; ageing shows silvering mane and tail on the equine body, leaner haunch, more pronounced wither, and lined human skin on the torso. Typical span into the 60s–70s; no exceptional longevity.',
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
            'At 32px, sell centaur first: a short horizontal bar or W of legs under a 3–4px torso block; head 2px with one ear or mane slash; one-pixel tail whip off the rear. Continuous mane stroke from occiput down the back is the fastest species read. If palette is tight, merge four hooves into two dark strokes and rely on torso-over-quad overlap. No micro-face — silhouette and mane line carry identity.',
        },
      },
    ],
  },
};

/** Page body — mood, references, and scope note. */
export const pageBodyBlocks = [
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
              'Mood: heat shimmer, long horizon, dust under hoof. Visual anchors: classical centaur read with steppe-pony conformation — rangy, drought-tough, route-runner — not wolf-headed hybrids or full-fantasy armour plates. Fictional anatomy for the Matlu multiworld; aligns to WORLD.md Viddfolk (centaurs of the open steppe). Legacy id steppevarg maps to Viddfolk in settlement data.',
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
              'Clothes, route-weaves, kit, and architecture are culture. This page locks bare species surface and body plan only.',
          },
        },
      ],
    },
  },
];
