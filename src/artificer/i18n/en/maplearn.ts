/**
 * English for learning the map (#1754, map-learning.ts, switch `map-learning`): the first day's
 * look around, what the map still needs, the Draw your map action and its placement session.
 *
 * The journal lines, the reasons and the needs are the sim's own English, word for word
 * (map-learning.test.ts checks), so the page reads them back and the AI reads the same words.
 */
export const maplearn = {
  // ── The action ─────────────────────────────────────────────────────────────
  'act.drawmap': 'Draw your map',
  'yield.drawmap': "sit down at camp and place what you've found on a map of your own",
  'reason.mapNotYet': 'not yet: a few nights here, enough places found in enough directions, and something to draw on',
  'reason.mapDrawn': "you've drawn your map already",
  // ── The journal (map-learning.ts LOOK_AROUND_LINE, PLACED_LINE) ────────────
  'log.lookAround': "You stop and look around before anything else, and note what lies in which direction from here, and about how far. There's no map of this land; for now you know it only as directions and distances.",
  'log.mapPlaced': "You place each thing you've found by its direction and distance from camp. What you find from now on goes on the map too.",

  // ── What the map still needs (map-learning.ts NEED_TEXT): {m} the threshold, {n} so far ──
  'map.need.nights': 'a few nights here first ({m}; {n} so far)',
  'map.need.places': 'more places found ({m}; {n} so far: explore, survey, find places to camp)',
  'map.need.directions': 'places found in more directions ({m}; {n} so far)',
  'map.needsSep': ', ',

  // ── The session ────────────────────────────────────────────────────────────
  'mapl.ready': "You've slept a few nights here and found enough places: you can sit down and draw your map.",
  'mapl.open': '🗺️ DRAW YOUR MAP',
  'mapl.title': 'Draw your map',
  'mapl.intro': "Place each thing you've found where it lies from camp (⛺ in the middle, north at the top), by what you know of it: its direction and how far. Near enough counts.",
  'mapl.how': 'Tap a place in the list, then the square where it goes. With a keyboard: Tab to the grid, move with the arrow keys, and press Enter to place.',
  'mapl.list': 'What you found',
  'mapl.placed': 'placed',
  'mapl.progress': '{n} of {m} placed',
  'mapl.pick': 'Pick a place from the list first.',
  'mapl.right': '{name}: about there. Placed.',
  'mapl.hint.dir': 'Not there: {name} was {was} of camp, not {tapped}.',
  'mapl.hint.nearer': '{name} is nearer camp than that: {time}.',
  'mapl.hint.further': '{name} is further from camp than that: {time}.',
  'mapl.hint.full': 'Not quite. You remember {name} clearly: {was}, {time}.',
  'mapl.done': "Everything you've found is on the map. Drawing it out takes a while at camp.",
  'mapl.drawIt': 'DRAW IT ({h} h)',
  'mapl.later': 'LATER',
  'mapl.close': 'Close',
  'mapl.gridLabel': 'Your map: camp in the middle, north at the top',
  'mapl.cellCamp': 'Camp',
  'mapl.cellEmpty': 'Empty square, {dir}',
  'mapl.cellHas': '{names}, {dir}',
  'mapl.n': 'N',
  'mapl.e': 'E',
  'mapl.s': 'S',
  'mapl.w': 'W',
  'mapl.spot': 'place to camp',
  // What you found, by name.
  'mapl.name.stream': 'The stream',
  'mapl.name.lake': 'The lake',
  'mapl.name.marsh': 'The boggy ground',
  'mapl.name.birch': 'The birch wood',
  'mapl.name.pine': 'The pine forest',
  'mapl.name.open': 'The open ground',
  'mapl.name.high': 'The higher ground',
  'mapl.name.cave': 'The cave',
  'mapl.name.tree': 'The treeline',
  'mapl.name.river': 'The riverbank',
  'mapl.name.hill': 'The hilltop',
} as const;
