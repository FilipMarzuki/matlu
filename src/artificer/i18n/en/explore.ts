/**
 * English for exploring in a direction (#1839, directed-explore.ts, switch `directed-explore`): the
 * Explore action's `way` choice, the compass in its chooser, and the journal's lines for heading out,
 * looking around away from camp and walking back.
 *
 * The `opt.*` and `log.*` lines are the sim's own English, word for word (directed-explore.ts
 * `WAY_TEXT` and the lines `headOut`, `lookHere` and `walkBackLine` write; explore-i18n.test.ts
 * checks), so the page reads them back and the AI reads the same words.
 */
export const explore = {
  // ── The choice (an option group on the queued Explore) ──────────────────────
  'opt.way': 'Which way',
  'opt.way.here': 'Look around',
  'opt.way.hereAway': 'Look around here',
  'opt.way.camp': 'Look around camp',
  'opt.way.n': 'North',
  'opt.way.ne': 'North-east',
  'opt.way.e': 'East',
  'opt.way.se': 'South-east',
  'opt.way.s': 'South',
  'opt.way.sw': 'South-west',
  'opt.way.w': 'West',
  'opt.way.nw': 'North-west',
  'opt.way.hereNote': 'a little of the land in every direction, out to the distance you choose; you stay where you are',
  'opt.way.campNote': 'walk back to camp first ({h}h), then look around there',
  'opt.way.headNote': 'head out that way and end the day out there: you find what lies that way, and learn nothing of the other directions',

  // ── The compass in the distance chooser ─────────────────────────────────────
  'compass.head': 'Which way?',
  'compass.aria': 'Explore: which way',
  'compass.look': 'Look around',
  'compass.lookTip': 'A little of the land in every direction; you stay where you are',
  'compass.camp': 'Around camp',
  'compass.headTip': 'Head out {dir}: you end the day out there',
  'compass.n': 'N',
  'compass.ne': 'NE',
  'compass.e': 'E',
  'compass.se': 'SE',
  'compass.s': 'S',
  'compass.sw': 'SW',
  'compass.w': 'W',
  'compass.nw': 'NW',

  // ── The journal ─────────────────────────────────────────────────────────────
  'log.headout': 'Headed {heading}, about {h} hours out, looking about as you went.',
  'log.headout.edge': 'Headed {heading}, but the land runs out that way — you came back to where you set out.',
  'log.headout.found': 'Out that way: {Biome}, {bearing}, {walk} from where you set out.',
  'log.headout.night': "You'll sleep out here tonight, away from camp, unless you walk back.",
  'log.lookhere': 'Looked around where you stand, out to about {h} hours each way.',
  'log.walkback': 'Walked back to camp first, about {h} hours.',
  // A heading, as `log.headout` names it.
  'heading.n': 'north',
  'heading.ne': 'north-east',
  'heading.e': 'east',
  'heading.se': 'south-east',
  'heading.s': 'south',
  'heading.sw': 'south-west',
  'heading.w': 'west',
  'heading.nw': 'north-west',
} as const satisfies Record<string, string>;
