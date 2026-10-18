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

  // ── Keeping a heading (#1868, compass-heading.ts, switch `compass-heading`) ──
  // Why heading out is blocked, and why the needle compass can't be made now (compass-heading.ts HEADING_TEXT).
  'reason.heading.canMake': 'you need something to keep a heading: a compass, or a needle you can magnetise — you have {w} (Make a needle compass); on a clear day the sun can do',
  'reason.heading.nothing': 'you need something to keep a heading: a compass, or a needle you can magnetise — you have neither, and no needle or fish hook; on a clear day the sun can do',
  'reason.heading.stale': 'your needle compass has lost its pull — stroke it on wool again (Make a needle compass); on a clear day the sun can do',
  'reason.needle.need': 'needs a needle (a sewing kit) or the hook from a hook and line',
  'reason.needle.fresh': 'your needle compass still holds its pull',
  'reason.needle.packed': 'your map and compass keep a heading already',
  // The journal: making the needle compass, the shadow stick's marks, and a trip that drifted.
  'log.needle.made': 'Stroked {w} on {w2}, one way, forty times, and floated it on a chip of birch bark in {w3}: it swung round to point north. You have a needle compass.',
  'log.needle.refreshed': 'Stroked {w} on {w2} again and floated it in {w3}: it has its pull back.',
  'log.heading.sun': "Marked the tip of a stick's shadow twice, a while apart, to find your bearings: about {h} hours more.",
  'log.heading.drift': 'The needle wandered as you went: you meant to head {heading}, and ended up heading {heading2}.',
  'log.heading.sunDrift': 'The shadow line was rough: you meant to head {heading}, and ended up heading {heading2}.',
  // What the needle compass is made with, as the lines above name it.
  'w.needle.needle': 'the needle from your sewing kit',
  'w.needle.hook': 'the hook from your hook and line',
  'w.needle.underlayer': 'your wool underlayer',
  'w.needle.mittens': 'your wool mittens',
  'w.needle.hair': 'your hair',
  'w.needle.kasa': 'your kåsa',
  'w.needle.pool': 'a still pool',
  // The play API's word on what keeps the Warden's heading today (#1868), after Explore's ways.
  'api.heading.compass': 'you keep your heading by the map and compass',
  'api.heading.needle': 'you keep your heading by your needle compass, which may drift a direction off; its pull lasts {n} more day(s)',
  'api.heading.sun': 'you keep your heading by the sun with a shadow stick today: half an hour more each time',
  // The compass in Explore's chooser, greyed (#1868): a heading over why.
  'compass.locked': 'Only Look around for now',
} as const satisfies Record<string, string>;
