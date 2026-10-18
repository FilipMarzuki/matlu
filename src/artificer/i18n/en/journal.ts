/**
 * The journal in English (#1709, phase 3 of #1685): every line a day at camp writes in the log, as
 * the LATEST list, the full JOURNAL, the timer and the thaw's worst nights show it.
 *
 * The log keeps the sim's English (the save, the AI observation and the API read it, and their tests
 * pin it), so nothing here changes what's saved. The page reads each line back at display time
 * (sim-words.ts `simLine`), in this order:
 *
 * 1. **A line said whole** (an encounter's text, a talent's hint, a quirk's line): looked up by its
 *    English among the `say.*`, `enc.*`, `person.*`... keys. The `say.*` ones here are built from
 *    the sim's own tables, so they can't drift from what the sim says.
 * 2. **A template** (`log.*`): the sentence with `{parts}` where it varies. A part's name says what
 *    it can be, and the page reads it back and says it in the viewer's language:
 *    `{n}` `{m}` `{h}` a number · `{nth}` an ordinal ("2nd") · `{where}` "" or " in the far ring" ·
 *    `{good}` a store or a tool · `{grade}` · `{skill}` · `{tech}` a technique · `{talent}` ·
 *    `{stat}` · `{weather}` · `{concept}` · `{recipe}` · `{w}` one of the `w.*` words below ·
 *    `{say}` a line said whole (or read as a sentence of its own) · `{line}`/`{why}` a sentence of
 *    its own · `{head}` an action's or option's name heading a refusal · anything else is a name,
 *    and stays as written. A digit after a part's name (`{say2}`) makes a second one of its kind.
 * 3. Neither: the line shows as the sim wrote it, in English, rather than guessed at.
 *
 * sim-words.test.ts plays runs through and checks each line it reads back gives the sim's English
 * again exactly, so a template can't quietly drift from the sim.
 */

import { HINTS, TALENT_IDS } from '../../talents';
import { QUIRKS, FEAR_OF } from '../../quirks';
import { SKILLS } from '../../skills';
import { GAIN_WORDS, STAT_IDS } from '../../stats';
import { INSTINCT_LINE } from '../../panic';
import { SPOOK_LINE, DISCOVERIES, GRADE_LINE, REGION1_MILESTONES } from '../../region1';
import { FINDS } from '../../exploration';
import { EXPLORE_UNLOCKS, QUARRY_UNLOCK, STONE_GATHER_FIND_NOTE } from '../../action-unlocks';
import { HUNT_UNLOCK, FISH_UNLOCK, BOW_UNLOCK } from '../../hunting-gear';
import { MANUALS } from '../../techniques';
import { PIN_WORDS, PLACE_NAME } from '../../pins';
import { WEATHER_STEPS } from '../../luck';
import { HARM_NAME, HARM_WORDS } from '../../injuries';
import { WORD } from '../../experiment';
import { SURFACE_WORDS } from '../../descriptive-map';
import { GREW } from '../../growing';
import { NAMES } from '../../load';

type DerivedKey = `say.${string}` | `w.${string}`;

/** Lines and words straight from the sim's tables. */
const derived = Object.fromEntries([
  ...TALENT_IDS.flatMap(id => (['vague', 'closer', 'reveal'] as const).map(step => [`say.hint.${id}.${step}`, HINTS[id][step]])),
  ...Object.entries(QUIRKS).map(([id, q]) => [`say.quirk.${id}`, q.revealed]),
  ...Object.entries(INSTINCT_LINE).map(([r, l]) => [`say.instinct.${r}`, l]),
  ...Object.entries(SPOOK_LINE).map(([r, l]) => [`say.spook.${r}`, l]),
  ...EXPLORE_UNLOCKS.flatMap(u => [[`say.unlock.${u.action}`, u.line], [`w.unlock.${u.action}.verb`, u.verb], [`w.unlock.${u.action}.how`, u.how]]),
  // Quarrying before the cleave (#1816, `stone-gathering`): hidden, and the flint seam's note names gathering.
  ['w.unlock.quarry.verb', QUARRY_UNLOCK.verb], ['w.unlock.quarry.how', QUARRY_UNLOCK.how], ['w.find.stone.gather.note', STONE_GATHER_FIND_NOTE],
  // Hunting, fishing and the bow before their gear or skill (#1821, `hunting-gear`): hidden, saying what opens them.
  ['w.unlock.hunt.verb', HUNT_UNLOCK.verb], ['w.unlock.hunt.how', HUNT_UNLOCK.how], ['w.unlock.fish.verb', FISH_UNLOCK.verb], ['w.unlock.fish.how', FISH_UNLOCK.how],
  ['w.unlock.bow.verb', BOW_UNLOCK.verb], ['w.unlock.bow.how', BOW_UNLOCK.how],
  ...MANUALS.flatMap(m => [[`say.manual.${m.id}`, `${m.found}.`], [`w.manual.${m.id}`, m.name.toLowerCase()]]),
  ...Object.entries(SKILLS).map(([id, s]) => [`w.felt.${id}`, s.felt]),
  ...STAT_IDS.map(id => [`w.gain.${id}`, GAIN_WORDS[id]]),
  ...DISCOVERIES.map(d => [`w.disc.${d.recipe}`, d.how]),
  ...Object.entries(FINDS).flatMap(([d, f]) => [[`w.find.${d}`, f!.name.toLowerCase()], [`w.find.${d}.note`, f!.note]]),
  ...Object.entries(PIN_WORDS).map(([k, w]) => [`w.pin.${k}`, w]),
  ...Object.entries(PLACE_NAME).map(([k, w]) => [`w.place.${k}`, w]),
  ...Object.entries(FEAR_OF).map(([k, w]) => [`w.fear.${k}`, w]),
  ...Object.entries(WEATHER_STEPS).flatMap(([wx, byDomain]) => Object.entries(byDomain ?? {}).map(([d, [, why]]) => [`w.luck.${wx}.${d}`, why])),
  ...Object.entries(GRADE_LINE).map(([g, l]) => [`w.thaw.${g}`, l]),
  ...Object.entries(HARM_NAME).flatMap(([h, n]) => [[`w.harm.${h}`, n], [`w.harm.${h}.does`, HARM_WORDS[h as keyof typeof HARM_WORDS]]]),
  ...Object.entries(WORD).map(([k, w]) => [`w.stuff.${k}`, w]),
  ...Object.entries(SURFACE_WORDS).map(([k, w]) => [`w.surface.${k}`, w]),
  ...Object.entries(GREW).map(([k, w]) => [`w.grew.${k}`, w]),
  ...Object.entries(NAMES).flatMap(([k, [one, many]]) => [[`w.load.${k}.one`, one], [`w.load.${k}.other`, many]]),
  ...REGION1_MILESTONES.map(m => [`w.mile.${m.id}`, m.name]),
]) as Record<DerivedKey, string>;

export const journal = {
  ...derived,

  // ── Small words the templates share ────────────────────────────────────────
  // An ordinal's ending ("2nd night running"), by the English ending.
  'ord.st': '{n}st',
  'ord.nd': '{n}nd',
  'ord.rd': '{n}rd',
  'ord.th': '{n}th',
  // Where a trip went, after its line: " in the far ring".
  'ring.in': 'in {ring}',
  // Words a template picks among (`{w}`): an accident's ground, an injury's severity, its name as you know it.
  'w.spot.wet': 'on wet stone',
  'w.spot.dark': 'in the dark',
  'w.spot.loose': 'on loose ground',
  'w.sev.minor': 'minor',
  'w.sev.serious': 'serious',
  'w.sev.grave': 'grave',
  'w.inj.sprain': 'sprained ankle',
  'w.inj.hand': 'hurt hand',
  'w.inj.cut': 'deep cut',
  'w.inj.light.sprain': 'light sprain',
  'w.inj.light.hand': 'light hurt hand',
  'w.inj.light.cut': 'light cut',
  'w.inj.bad.sprain': 'bad sprain',
  'w.inj.bad.hand': 'bad hurt hand',
  'w.inj.bad.cut': 'bad cut',
  'w.inj.plain.sprain': 'ankle',
  'w.inj.plain.hand': 'hand',
  'w.inj.short.sprain': 'sprain',
  'w.inj.short.cut': 'cut',
  'w.inj.body': 'body',
  'w.luck.blizzard': 'the blizzard had buried everything',
  'w.luck.picked': 'the ground there is picked over',
  'w.luck.bare': 'there was almost nothing left there',
  'w.luck.knewJust': 'you knew just where to look',
  'w.luck.knew': 'you knew where to look',
  'w.luck.learned': "what you've learned paid off",
  'w.luck.light': 'the light was going',
  'w.luck.bow': 'the bow reached game a sling never could',
  'w.load.heavy': 'with a heavy load',
  'w.load.staggering': 'staggering under the load',
  'w.load.barely': 'barely able to carry it',
  'w.thin.deadfall': 'the deadfall is getting thin',
  'w.compass.yes': 'true to the compass',
  'w.compass.no': 'as near as you can judge without a compass',
  'w.small': 'small game',
  'w.deer': 'deer',
  'w.thirst': 'thirst',
  'w.starvation': 'starvation',
  'w.Thirst': 'Thirst',
  'w.Hunger': 'Hunger',
  'w.night.lamp': 'By headlamp.',
  'w.night.fire': 'By firelight.',
  'w.night.strain': 'Straining in the dark.',
  // The road's verbs, heading a refusal ("Sell: skipped — ...").
  'w.verb.talk': 'Talk',
  'w.verb.ask': 'Ask',
  'w.verb.question': 'Question',
  'w.verb.tell': 'Tell',
  'w.verb.sell': 'Sell',
  'w.verb.buy': 'Buy',
  'w.verb.accept': 'Accept',
  'w.verb.complete': 'Complete',
  'w.verb.craft': 'Craft',
  'w.verb.study': 'Study',
  'w.verb.tend': 'Tend',
  'w.verb.help': 'Help',
  'w.verb.heal': 'Heal',
  'w.verb.learn': 'Learn',
  'w.verb.appraise': 'Appraise',
  'w.verb.choice': 'Choice',

  // ── A trip out on the land ─────────────────────────────────────────────────
  'log.scout.1': 'Scouted the near ground — you can see where food, water, wood and stone lie.',
  'log.scout.2': 'Pushed out to the far ring — new forage and timber, and paths leading on.',
  'log.scout.3': 'Reached the distant hills — and glimpsed the pass out of the Reach.',
  'log.explore.1': 'Walked out and looked around — you know now roughly where food, water, wood and stone lie.',
  'log.explore.2': 'Walked out to the far ring and looked around — forage, timber, and paths leading on.',
  'log.explore.3': 'Walked out as far as the distant hills — and glimpsed the pass out of the Reach.',
  'log.explore.again': "Walked the ground{where} again and looked closer — it's a little clearer now.",
  'log.tooDark': 'Too dark to make anything out{where} — the hours pass and you learn nothing.',
  'log.fogged': "Fog lies thick{where} — you can't see past your own hand, and learn nothing.",
  'log.survey': 'Surveyed carefully{where} — every trip there yields more now.',
  'log.track': 'Tracked a deer herd{where} — you can hunt there.',
  'log.gather': 'Gathered {n} raw food{where}.',
  'log.gather.fiber': 'Gathered {n} raw food and {m} fiber{where}.',
  'log.gather.blind': 'Wandered, not knowing where to look — gathered {n} raw food{where}.',
  'log.gather.blindFiber': 'Wandered, not knowing where to look — gathered {n} raw food and {m} fiber{where}.',
  'log.hunt.none': 'Hunted {w}{where} and took nothing.',
  'log.hunt.small': 'Took small game{where} — {n} raw food.',
  'log.hunt.deer': 'Brought down a deer{where} — {n} raw food and a hide.',
  'log.water': 'Fetched {n} water{where}.',
  'log.water.melt': 'Melted {n} water from snow{where} ({m} firewood).',
  'log.wood': 'Cut {n} firewood and {m} materials{where}.',
  'log.fish': 'Fished through the ice{where} — {n} raw food.',
  'log.fish.none': 'Sat over a hole in the ice{where} and caught nothing.',
  'log.quarry': 'Broke out {n} stone{where}.',
  'log.gatherstone': 'Gathered {n} stone{where}.',
  // Traps, and a hunt that ends on its kill or hunts on (#1821, `hunting-gear`).
  'log.traps': 'Set a line of traps{where}: snares along the game trails, to check by morning.',
  'log.traps.caught': 'By morning your traps{where} held small game — {n} raw food.',
  'log.traps.none': 'By morning your traps{where} were empty.',
  // Meat at camp (#1823, `camp-scavengers`): storing it, and what animals took of it.
  'log.storemeat.cache': 'Put {n} raw meat under a cairn of heavy stones, out of reach.',
  'log.storemeat.hung': 'Hung {n} raw meat high in a tree with cord, out of reach.',
  'log.meat.foxAway': 'While you were away, a fox got at the meat: {n} raw food gone, and its tracks all round camp.',
  'log.meat.ravens': 'While you were away, ravens got at the meat: {n} raw food gone, and their tracks all round camp.',
  'log.meat.foxNight': 'A fox got at the meat in the night: {n} raw food gone, and its tracks all round camp by morning.',
  'log.meat.wolves': 'Wolves came into camp in the night. You lay still while they tore at the meat, and by first light all of it was gone.',
  'log.meat.bear': 'A bear came into camp in the night. You lay frozen while it ate, and by first light all the meat was gone.',
  'log.meat.bearStored': 'A bear came into camp in the night and got at the meat you\'d put by: {n} raw food gone.',
  'log.huntEnded': 'The kill came {h}h into the hunt: you headed home with it, and the rest of the time is yours.',
  'log.huntOn': 'The catch was light enough to stow, so you hunted on — and took more: {n} raw food.',
  // Sinew a catch gave (#1821, hunting-gear.ts `sinewNote`), after the catch's own line.
  'log.sinew': '{line} Kept {n} sinew.',
  'log.huntOn.none': 'The catch was light enough to stow, so you hunted on, but nothing more came.',
  'log.lookout': 'Climbed high{where} and looked out — the ground sharpens below.',
  'log.lookout.over': 'Climbed high{where} and looked out — the ground sharpens below, and you can see over the {ringword} ring.',
  'log.tomorrow': '{line} Tomorrow looks like {weather}.',
  'log.dim.failing': '{line} The light was failing.',
  'log.dim.lost': '{line} Most of it lost to the dark.',
  'log.found': '{line} You know this ground well now — found a {w} ({w2}).',
  'log.blizzard.killed': 'You went out into the blizzard{where} and lost the way back. They find you at the thaw.',
  'log.blizzard.lost': 'Lost in the white for hours — you dropped everything you carried to find the way home.',
  'log.blizzard.bitten': 'The blizzard bit deep: frostbitten fingers, a face that burns.',
  'log.blizzard.rough': 'A rough few hours in the blizzard, but you came back.',
  // A session of chosen length (#1668): its trips, and why it stopped.
  'log.session.one': '{n} trip, {h}h of work{rest}',
  'log.session.other': '{n} trips, {h}h of work{rest}',
  'log.session.walk': ' and {h}h walking{rest}',
  'log.session.thin': '; {w}{rest}',
  'log.session.enough': ', enough, and home.',
  'log.session.notWorth': ', not worth going back.',
  'log.session.end': '.',
  // Luck (#1314).
  'log.luck.good': 'A good haul: {w}.',
  'log.luck.goodPlain': 'A good haul — luck was with you.',
  'log.luck.poor': 'A poor trip — {w}.',
  'log.luck.poorPlain': "A poor trip — it just wasn't there today.",
  'log.luck.empty': 'Came back with nothing — {w}.',
  'log.luck.emptyPlain': 'Came back with nothing. Some days are like that.',
  // Carrying it home (#1291).
  'log.leave': 'You leave {loads} behind — too much to carry.',
  'log.walkedHome': 'Walked home {w} ({n} min slower).',
  'log.walkedHomeTrips': 'Walked home {w} on some of the trips ({n} min slower in all).',
  'log.pushedPast': 'Pushed past empty — it cost your health.',

  // ── At camp ────────────────────────────────────────────────────────────────
  'log.preserve.smoke.one': 'Smoked and salted {n} food into {m} winter ration.',
  'log.preserve.smoke.other': 'Smoked and salted {n} food into {m} winter rations.',
  'log.preserve.dry.one': 'Air-dried {n} food into {m} winter ration.',
  'log.preserve.dry.other': 'Air-dried {n} food into {m} winter rations.',
  'log.studied': 'Studied {concept} — {n} insight (rank {m}).',
  'log.studiedNight': 'Studied {concept} — {n} insight (rank {m}). {w}',
  'log.experiment.nothing': "Turned over what you have — nothing in it you don't already know how to use. More to work with might show you more.",
  'log.experiment.came': 'Experimented with {stuff} — and it came.',
  'log.experiment.cameMind': 'Experimented with {stuff}, your mind on it — and it came.',
  'log.experiment.hint': "Experimented with {stuff}. You think there's a way to make something of it, if you keep at it.",
  'log.experiment.closer': 'Experimented with {stuff} — closer, you think.',
  'log.experiment.closerMind': 'Experimented with {stuff}, your mind on it — closer, you think.',
  'log.workedOut.tried': 'Worked out: {Recipe} — trying things with {stuff}, you found how it goes together.',
  'log.workedOut.study': 'Worked out: {Recipe} — your study of {concept} shows the way.',
  'log.workedOut.how': 'Worked out: {Recipe} — {w}.',
  'log.tinker': 'Worked at the bench — the body eased while the mind spent.',
  'log.rest': 'Sat a while and let the ache settle.',
  'log.rest.pad': 'Sat a while on your sit pad and let the ache settle.',
  'log.rest.comic': '{line} The rain drums on and you read your comic cover to cover, again.',
  'log.site': 'Chose the {site} as your ground.',
  'log.site.moved': 'Chose the {site} as your ground — the old shelter is left behind.',
  'log.tarp': 'You string the tarp between two trees and peg it down low — a roof, of sorts.',
  'log.raised': 'Raised {grade} {recipe} — tier {n}, {m}% warm.',
  'log.raised.a': 'Raised a {grade} {recipe} — tier {n}, {m}% warm.',
  'log.coldPit': 'Dug a cold pit and lined it with stone — it keeps {n} raw food cold.',
  'log.coldPitSlows': 'Dug a cold pit and lined it with stone — it keeps {n} raw food cold and slows the rot.',
  // Each camp keeps what you built there (#1753).
  'log.pitLeft': 'You leave {n} raw food in the cold pit.',
  'log.shelterStands': 'Your shelter here still stands.',
  'log.shelterWeathered': 'Your shelter here still stands, a little weathered.',
  'log.pitBack': 'You take {n} raw food back out of the cold pit.',
  'log.pitSpoiledAway': '{n} raw food in the cold pit went bad while you were away.',
  'log.pitThere': 'The cold pit here is as you left it.',
  'log.crafted': 'Crafted {grade} {recipe}.',
  'log.crafted.a': 'Crafted a {grade} {recipe}.',
  'log.crafted.goodGear': 'Crafted {grade} {recipe}. Good gear for the winter.',
  'log.crafted.crudeGear': "Crafted {grade} {recipe}. Crude — it won't hold up through a winter.",
  'log.crafted.goodGearA': 'Crafted a {grade} {recipe}. Good gear for the winter.',
  'log.crafted.crudeGearA': "Crafted a {grade} {recipe}. Crude — it won't hold up through a winter.",
  'log.craftFailed': 'The {recipe} came apart in your hands — materials wasted. Too foggy for fine work.',
  'log.craftFailed.salvaged': 'The {recipe} came apart in your hands — materials wasted (salvaged {cost}). Too foggy for fine work.',
  'log.claimNot': "Can't stake a claim yet: {why}.",
  'log.skipped': '{head}{where}: skipped — {why}.',
  // Stopped partway (#1815, stop-action.ts): what the action kept, by where it was stopped.
  'log.stopOut': '{head}{where}: stopped on the way out and turned back — nothing to show for it.',
  'log.stopNone': '{head}{where}: stopped before it was done — nothing to show for it.',
  'log.stopSeen': '{head}{where}: stopped partway — you saw some of what was there.',
  'log.stopPart': '{head}{where}: stopped after {h}h of the work — headed home with what you had.',
  'log.stopCamp': '{head}: stopped — nothing made, and nothing used up.',
  // A hunt stopped (#1815): before its moment of the kill, or after it.
  'log.stopGaveUp': '{head}{where}: stopped — you gave up before anything came.',
  'log.stopKilled': '{head}{where}: stopped — you had already brought it down, and headed home with all of it.',
  'log.choiceSkipped': 'Choice: skipped — there\'s no "{id}" here.',
  'log.milestone': 'Milestone — {w}',
  'log.heirloomTeaches': 'The {good} teaches you what its maker knew: {list}.',
  'log.heirlooms': 'Someone was here before you. Left for you: {tools}.',
  'log.carryLearned': 'You carry what you learned: {n} recipes.',
  'log.carryLearnedRanks': 'You carry what you learned: {n} recipes and {ranks}.',
  'log.grown': "You're {n} now — grown, and as strong as you'll be.",
  'log.taller': "You're {n} now — taller than last winter.",
  'log.tallerGrew': "You're {n} now — taller than last winter, {w}.",
  'log.morning': 'Morning: {weather}.',
  'log.mapDrawn': "Back at camp you sit down with {w} and draw what you know of the land, {w2}. You have a map of your own now, of what you've seen.",

  // ── Skills, techniques, talents, stats ─────────────────────────────────────
  'log.skillUp': '{w} — {skill} comes easier.',
  'log.humbled': 'The more you learn of {skill}, the more you see how little you know.',
  'log.planning': 'Halfway through the work you catch yourself already thinking about the next job, and the one after. You can plan ahead now.',
  'log.tech.self': "You've worked out {tech} — {how}.",
  'log.tech.manual': 'From {w}: {tech} — {how}.',
  'log.tech.taught': 'Taught: {tech} — {how}.',
  'log.tech.page': 'Learned from the page: {tech} — {how}.',
  'log.tech.selfColon': "You've worked out: {tech} — {how}.",
  'log.beyond': "Some of it is beyond you for now — you'll come back to it as your {skill} grows.",
  'log.gift': 'You have a gift: {talent}.',
  'log.tierUp': 'Something in you has settled; it comes easier than it did.',
  'log.statUp': '{w} — {stat} {n}.',
  'log.wear': '{w} has left its mark — Constitution {n}.',
  'log.overtrained': 'You pushed harder than one night can mend — {n}h of it went for nothing.',

  // ── Accidents, injuries and pain ───────────────────────────────────────────
  'log.acc.nick': 'The tool slips and nicks your hand.',
  'log.acc.handStiff': 'The tool slips and opens your hand — it will be stiff for days.',
  'log.acc.handCut': 'The tool slips — a bad cut across your hand.',
  'log.acc.sprain': 'You turn your ankle {w} — a sprain. It will slow you for days.',
  'log.acc.bruise': 'You stumble {w} — a bruise, nothing worse.',
  'log.acc.cut': 'You slip {w} — a bad cut.',
  'log.acc.lostStream': 'You go down hard {w} on the way back, and lose the haul in a stream.',
  'log.acc.lost': 'You go down hard on the way back, and lose the haul.',
  'log.acc.snaps': 'You go down hard, and your crude {good} snaps under you.',
  'log.acc.toolHit': "You go down hard, and your {good} takes the fall — it's {grade} now.",
  'log.acc.severity': '{line} ({w})',
  'log.acc.dead': 'The wound goes bad, and there is no one to help. Dead of an accident.',
  'log.aggravate.knows': 'You push on through it, and something gives — your {w} is worse now (grave).',
  'log.aggravate': 'You push on through it, and something gives — your {w} hurts far worse now.',
  'log.pain.agony': 'Agony — your {w} screams at every step. You should stop.',
  'log.pain.sharp': "Pain shoots through your {w} — it's sharp now.",
  'log.pain.nightAgony': 'The pain in your {w} keeps you awake half the night.',
  'log.pain.night': 'Your {w} throbs all night.',
  'log.heal.mending': 'Your {w} is mending.',
  'log.heal.mendingSev': 'Your {w} ({w2}) is mending.',
  'log.heal.mendingNights.one': 'Your {w} is mending — about {n} more good night.',
  'log.heal.mendingNights.other': 'Your {w} is mending — about {n} more good nights.',
  'log.heal.mendingSevNights.one': 'Your {w} ({w2}) is mending — about {n} more good night.',
  'log.heal.mendingSevNights.other': 'Your {w} ({w2}) is mending — about {n} more good nights.',
  'log.heal.not': "Your {w} didn't mend tonight — it needs food, water and warmth.",
  'log.heal.clean': 'Your {w} has healed clean.',
  'log.heal.harm': 'Your {w} has healed, but it has left you with {w2}: {w3}.',
  'log.fester': "The {w} has gone bad overnight — hot, red and angry. It's grave now.",
  'log.treat.dressing': 'You clean the {w} and dress it from the first-aid kit — {w2}.',
  'log.treat.cloth': 'You wash the {w} and bind it with a strip of cloth — {w2}.',
  'log.treat.hide': 'You wash the {w} and bind it with soft hide — {w2}.',
  'log.treat.splint': 'You splint the {w} with a straight stick and lash it firm — {w2}.',
  'log.treat.herbs': 'You crush yarrow and plantain into a poultice for the {w} — {w2}.',
  'w.treat.good': 'well done; it will mend faster',
  'w.treat.fair': 'it will mend a little faster',

  // ── Fear and encounters ────────────────────────────────────────────────────
  'log.heart': 'Your heart is hammering.',
  'log.panic': 'Panic. You can barely think.',
  'log.option': '{head}: {say}',
  'log.meantTo': 'You meant to {opt}. {say}',
  'log.crash': "Afterwards the strength drains out of you all at once, and your hands won't stop shaking.",
  'log.fear.gained': "Something in you won't forget this. {fear} will frighten you now.",
  'log.fear.fadedOne': "You notice {w} doesn't frighten you the way it did.",
  'log.fear.fadedMany': "You notice {w} don't frighten you the way they did.",
  'log.reprieve': "It should have been the end of you. It isn't. Condition 1 — that was your one reprieve.",
  'log.killedBy': 'Killed by {say}.',
  'log.killedByUnknown': 'Killed by what you met out there.',
  'log.revisit': 'You go back by {w} you remembered.',
  'log.carving': 'Back by the carving. Knowing what you are looking for, you see more in it this time.',
  'log.letGo': 'You let it go: {w} in the {ringword} ring.',
  'log.learnSelf': 'You learn something about yourself: {id}.',

  // ── The night ──────────────────────────────────────────────────────────────
  'log.snareLine': 'The snare line caught something — 1 raw food.',
  'log.wet': 'Wet through and miserable after a day out in the rain.',
  'log.wetSocks': 'Wet through and miserable after a day out in the rain — at least there are dry socks.',
  'log.cabin': 'Cabin fever — too many days inside these walls. Your thoughts go round in circles.',
  'log.fireKept': 'Kept the fire in through a {n} °C night — {m} firewood.',
  'log.fireShort': 'The firewood ran out in the night ({n} of the {m} it needed). The cold crept in.',
  'log.fireNone': 'No firewood — a fireless night at {n} °C.',
  'log.lean': 'Half rations — a lean night.',
  'log.fasting': 'Fasting — the food stays untouched.',
  'log.fastingRun': 'Fasting — the food stays untouched ({nth} night running).',
  'log.hungry': 'Hungry — no food.',
  'log.hungryRun': 'Hungry — no food ({nth} night running).',
  'log.thirsty': 'Thirsty — no water.',
  'log.thirstyRun': 'Thirsty — no water ({nth} night running).',
  'log.awake': 'You lie awake a long time, listening to the dark.',
  'log.sleepless': 'A sleepless night: every sound out there is something coming.',
  'log.coldNight': 'A cold, broken night — the exposure bites.',
  'log.dangerousNight': 'Dangerously cold: you lie shivering, and the cold goes deep.',
  'log.lastStand': 'Everything in you says stop. You refuse. You wake, somehow — Condition 1. That was your one reprieve.',
  'log.kasa': 'A hot drink from your kåsa by the fire.',
  'log.thermos': 'Hot blackcurrant from the thermos — still warm, somehow.',
  'log.thermosLast': 'The last of the thermos. It tastes of home.',
  'log.stove': 'A hot meal on the Trangia.',
  'log.stoveLast': 'A hot meal on the Trangia — the last of the fuel.',
  'log.pillow': "Your own pillow. It helps more than you'd have thought.",
  'log.sweets': 'You eat the Saturday sweets, every one. For a while the world is bearable.',
  'log.phone': 'Your phone dies in the night. There was never any signal out here anyway.',
  'log.spoiled': '{n} raw food went bad.',
  'log.diedOf.thirst': "You lie down in the night and don't get up. Dead of thirst ({n} nights without water).",
  'log.diedOf.hunger': "You lie down in the night and don't get up. Dead of starvation ({n} nights without food).",
  'log.diedCold': "The fire is long dead and the cold comes in. You don't wake. Dead of the cold.",
  'log.collapseFound': "Your body gives out and you collapse. The caravan's traders, coming up the thawing valley, find you barely alive — this season is over.",
  'log.collapseWinter': 'Your body gives out and you collapse in the snow. No one comes into the Reach in winter — the wolves find you first.',
  'log.collapse': 'Your body gives out and you collapse. No one passes this way — a bear finds you first.',
  'log.thaw': 'The ice breaks on the streams. You made it through the winter — {w}',
  'log.caravanComes': 'The caravan comes up the thawing valley, wheels deep in the mud. There is room on the last wagon.',
  'log.winterCame': 'Snow in the night, and it stays. Winter has come — hold on until the thaw.',
  'log.backAches': "Your back aches from yesterday's loads.",
  'log.locked': 'Survival takes over your thoughts — {lock}. Your focus will have to wait.',
  'log.unlocked': 'The pressure eases — your focus returns to {focus}.',
  'log.eat.half': 'You put yourself on half rations — a meal every other night.',
  'log.eat.none': 'You stop eating. The food stays where it is.',
  'log.eat.full': 'Back to full rations.',
  'log.cantFocus': "You can't turn your mind to {about} — {why}.",
  // The camp's own line (camp-view.ts CAMP_LINE, #1691), added as the journal is drawn.
  'say.camp.now': 'You have a camp now.',
  // Why an exploring action isn't yours yet (action-unlocks.ts subActionLock).
  'reason.unlock': "you don't know how to {w} yet — {w2} ({Skill})",
} as const;

/** Every key above, the lines built from the sim's tables included (for the Swedish file's type). */
export type JournalKey = keyof typeof journal | DerivedKey;
