/**
 * English for distance instead of rings (#1752, switch `distance-not-rings`, distance-words.ts).
 *
 * Two kinds of key:
 * - **`<key>.dist`**: the same string as `<key>` with its rings said as distances, with the same
 *   `{vars}`. The page draws through `distanceT` (sim-words.ts), which asks for `<key>.dist` first
 *   when the switch is on, so no view has to pick between them.
 * - **New keys** (`ring.at.*`, `ring.from.*`): the parts a sentence fills in with the switch on.
 *
 * A `log.*.dist` key is also a template `simLine` reads the sim's English with, as any `log.*` is:
 * its English is exactly what `unring` makes of the line the sim used to write.
 */
export const distance = {
  // ── The distances themselves (exploration.ts rings 1–3, and past them) ───
  'ring.1.dist': 'Close by',
  'ring.2.dist': 'Half a day out',
  'ring.3.dist': 'A day out',
  'ring.the.1.dist': 'the land close by',
  'ring.the.2.dist': 'the land half a day out',
  'ring.the.3.dist': 'the land a day out',
  // After a deed or a place ("Fetched 4 water half a day out."): the sim's ` in the far ring`.
  'ring.at.1': 'close by',
  'ring.at.2': 'half a day out',
  'ring.at.3': 'a day out',
  'ring.travel.dist': '+{n}h there and back',
  'ring.lockedTip.dist': 'Know the land nearer in first',
  // Where the distances are measured from: where you are until camp is made, then camp.
  'ring.from.here': 'from where you are',
  'ring.from.camp': 'from camp',
  'map.cell.beyond.dist': 'overnight away',

  // ── Headings, notes and tips ─────────────────────────────────────────────
  'head.land.dist': 'THE LAND — what you know, by how far it is',
  'yield.explore.dist': 'look around: new ground further out at least suspected, known ground a little clearer',
  'yield.lookout.dist': 'the land +1 level · see over the land further out',
  'land.outOfReach.dist': 'Out of reach — know the land nearer in first.',
  'land.howTo.dist': 'Scout for the overview, survey to firm it up, and work the land for the detail. The land close by runs thin as you work it; push outward for richer ground.',
  'land.learnMore.dist': 'Scout for the overview and places further out, survey to firm it up and make the distances sure, and work the land for the detail. The land close by runs thin as you work it; push outward for richer ground.',
  'map.need.home.dist': 'to know home ground better (all the land close by observed: explore it more, survey it, or work it)',
  'map.unknown.dist': 'Unknown ground. Scout further out to learn it.',
  'map.drawnCompass.dist': "Drawn true to the compass: what's within two hours of camp, the land you've glimpsed (dim), and the land you know (bright).",
  'map.reachNote.dist': "You see what's within two hours of camp; scout further out to glimpse more (dim), and survey or work the land to know it (bright).",
  'encui.where.dist': 'D{n} · {ring} · {clock}',
  'encui.memoryFullHtml.dist': '🧠 Memory: <b>{held} of {room}</b> places — full. You\'d let go of <b>{place}</b> ({ring}) first.',
  'pins.fx.fishing.dist': '+{n} water and fish there',
  'pins.fx.forage.dist': '+{n} food gathered there',
  'pins.fx.stone.dist': '+{n} stone quarried there',
  'pins.fx.eerie.dist': 'that ground feels worse',
  'pins.fx.eerieMuch.dist': 'that ground feels much worse',
  'pins.fx.wonder.dist': 'that ground is no worse in the dark',
  'pins.fx.calm.dist': 'that ground feels calmer',
  'pins.fx.calmMuch.dist': 'that ground feels much calmer',

  // ── The play API's refusals (session.ts, in English with the switch on) ──
  'api.no.badRing.dist': '"{q}" isn\'t a distance for {action} (@1 close by, @2 half a day out, @3 a day out).',
  'api.no.notOnLand.dist': '"{q}" isn\'t a distance for {action}: it isn\'t done out on the land.',
  'api.no.wayExplore.dist': "You don't know the way that far out yet (@{ring}): explore the land nearer in first.",
  'api.no.wayScout.dist': "You don't know the way that far out yet (@{ring}): scout the land nearer in first.",
  'api.no.blockedRing.dist': "Can't {action} at @{ring} now: {why}.",

  // ── The sim's lines, as `unring` says them (templates for simLine) ───────
  'reason.noGameIn.dist': "you haven't seen any game{where}",
  'reason.untrackedIn.dist': 'no game tracked{where} yet',
  'log.scout.2.dist': 'Pushed out half a day — new forage and timber, and paths leading on.',
  'log.explore.2.dist': 'Walked out half a day and looked around — forage, timber, and paths leading on.',
  'log.lookout.over.dist': 'Climbed high{where} and looked out — the ground sharpens below, and you can see over {theRing}.',
  'log.letGo.dist': 'You let it go: {w}{where}.',
  'say.unlock.scout.dist': "You've walked enough of this land to sweep a whole stretch of land in one go. You can scout now.",
  'say.manual.tally-book.dist': "Under a fallen hide-hut half a day out: a trapper's tally-book, pages of tracks and patient notes.",
  'w.unlock.scout.verb.dist': 'scout a whole stretch of land',
  'w.harm.stiff-knee.does.dist': 'the long walks out cost more',
  'w.unease.distant.dist': 'the land a day out',
} as const satisfies Record<string, string>;
