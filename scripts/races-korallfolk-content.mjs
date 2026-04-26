/**
 * Notion field copy for the `korallfolk` Races page (#691).
 * Legacy settlement id korallfolk maps to Merfolk (Djupvolk) in `docs/peoples-and-races.md`.
 * Pushed with `node scripts/races-upsert-korallfolk.mjs`; cache from `npm run races:sync`.
 */

export const RACES_DB_ID = '34e843c0-718f-81a3-b4c8-c0ff6839bd21';

export const pageProperties = {
  Name: { title: [{ type: 'text', text: { content: 'Korallfolk' } }] },
  id: { rich_text: [{ type: 'text', text: { content: 'korallfolk' } }] },
  bodyPlan: {
    rich_text: [
      {
        type: 'text',
        text: {
          content:
            'Quasi-humanoid upper body with a single continuous tail from the hip: two arms, humanoid torso, neck, and head; no separate legs. The caudal body is an elongate peduncle and fluke homologous to a fish or small cetacean tail — not octopoid arms, not crustacean segments, and not a serpent with visible belly scales only. Matches Mistheim Merfolk (Djupvolk) read for deep channels and reef margins. Legacy id korallfolk is anatomy only, not a culture.',
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
            'A short upright torso block sitting on a long tapering tail — reads as an inverted “Y” or fish-arrow at 32px: head dot or wedge, shoulders, then a widening-to-narrow stroke to a two-lobe fluke tick.',
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
            'Adults are about 6.5–7.5 heads tall if the tail is counted along the curve: compact rib cage, slightly long waist into a thick muscular peduncle, then a lunate fluke with a shallow notch. Torso proportions are human-baseline for shoulders and arms; the hip line is smooth into scales rather than a human pelvis break. Children carry a larger cranium on a shorter peduncle and a rounded, almost paddle-like fluke; adolescents add tail length before the chest finishes widening. Elders may read slightly thicker through the peduncle base with a softer fluke edge and more pronounced lateral-line dots — still mobile, not frail.',
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
            'Face, neck, and upper chest: matte skin from dusk-violet through grey-teal to sun-flecked sand-rose near the surface; subtle countershade (lighter ventral) even on the torso. From mid-torso onto the tail: fine overlapping cycloid scales, denser toward the fluke; palette shifts cooler and more iridescent along the flank — petrol blue, reef jade, bruised plum — without metallic armour plating. Species pigment only: soft branch-coral mottling, scattered pale spot clusters, or a narrow dorsal stripe; patterns read as biology, not cosmetics or clothing.',
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
            'Human facial plan: forward-set eyes with a generous corneal highlight for low-light water; lids tolerate particulate water without obvious nictitating membrane at sprite scale. Ears small, low on the skull, with a thickened tragus that can read as a slight “valve” lip — not long elf ears. Nose and lips within human range but nasal bridge slightly low; nostrils can flare wide for a breath at the surface. Jaw and teeth human in layout — no carnivore muzzle. Optional low dorsal crest or ridge of flexible fin tissue from mid-skull to nape (species marker, not a horn).',
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
            'Spine continues through the peduncle; pelvis is shortened into the tail root — no femora. Paired fluke lobes with robust hypural fan; a subtle lateral line of shallow pits runs each flank from rib cage to fluke for pressure and vibration. Webbing may extend one-third along the digits as a soft membrane — functional, not costume. Paired respiratory slits lie along the lower lateral torso behind the rib cage (not on the neck); at rest they are narrow seam lines. Hands retain four fingers and thumb with human phalangeal count.',
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
            'Sex: adults share one silhouette; on average one pattern runs slightly broader through the peduncle base and deltoids, another a touch narrower waist root into tail, with full overlap. Age: young show big head, short tail, rounded fluke; teens stretch the peduncle and sharpen the fluke; adults carry full flank mottle; seniors fade contrast in the mottle, add fine creasing at the eyes, and may show a slightly thicker tail root. Regional: shallow-reef lineages skew warmer, sand-rose and copper mottle; trench-adjacent lineages skew cooler, indigo flank and smaller flank spots — soft gradients for art, not hard sub-races.',
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
            'Vision biased to blue-green spectrum and motion in dim water; bright surface glare handled with tight squint and highlight-heavy eyes rather than a second eyelid at low resolution. The lateral line maps vibration and pressure gradient along the tail — useful for currents, schools, and distant movement. Hearing favors low frequency through tissue conduction; the middle ear is pressure-adapted at a mundane anatomical level. Chemoreception near the oral/lip line is modestly above human for waterborne cues — show as expressive nostril flare, not whiskers.',
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
            'Juvenile growth is slower than surface humans: tail near adult length by mid-teens, torso “filled” into the early twenties; prime endures a long midlife. Ageing first shows as desaturated flank mottle, thinning of the dorsal crest if present, slight retraction at the jaw angle, and a softer trailing edge on the fluke. Lifespan runs longer than typical human spans in calm deep currents; exact years are lore elsewhere — visually, elders keep posture but read weathered like sun-bleached coral.',
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
            'At 32px, sell Merfolk with a 4–6px torso stack, 1–2px head, and a tail wedge 2–3px wide tapering to a 2px fluke fork. One row of lateral-line dots or a single mid-flank highlight carries species; hair as one back-sweep stroke or omit for clarity. Waist-to-tail transition is one pixel pinch. Webbing is optional 1px triangles between fingers. Do not micro-paint gill slits — imply with a darker lateral seam if needed. Palette contrast matters more than face detail.',
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
              'Mood: reef-shadow twilight, pressure-quiet, slow currents. Visual anchors: classical merfolk tail with Matlu deep-ocean palette — coral mottle and lateral line, not pirate costume or shell armour baked into the body. Fictional anatomy for the Matlu multiworld; aligns to WORLD.md Merfolk (Djupvolk). Legacy id korallfolk maps to Merfolk in settlement data.',
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
              'Clothes, pressure-jewellery, architecture, and trade kit are culture. This page locks bare species surface, tail plan, and default pigment only.',
          },
        },
      ],
    },
  },
];
