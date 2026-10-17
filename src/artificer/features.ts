/**
 * Feature switches (#1579): a new feature can be tried, switched off and on, and marked as an
 * experiment in the game while it's new, before it settles into the game for good.
 *
 * Two kinds:
 * - **rules** features change what can happen in a run (free questions can pass a trust gate and
 *   hand you a lead). A run's rule features are fixed when it starts and saved with it, in its
 *   world (`WorldConfig.features`), so a replay plays the same game and its record says what was on.
 *   Switching one changes the next new game, never the one being played.
 * - **ui** features only change how the game looks; they switch live, per browser.
 *
 * Pure: the registry and how a run's saved switches read. Where a player's own choices are kept
 * (the browser) is the app's business (artificer-app/feature-choices.ts).
 */

export type FeatureStage = 'experimental' | 'beta' | 'stable';
export type FeatureKind = 'rules' | 'ui';

export interface FeatureDef {
  id: string;
  name: string;
  /** One line on what it does, for the dev panel and the API's rules. */
  note: string;
  stage: FeatureStage;
  kind: FeatureKind;
  /** On in a new game unless the player switches it off. */
  default: boolean;
  /**
   * How a run saved before this feature had a switch reads: on for a feature that shipped before
   * its switch (its runs had it), off for one that arrives with its switch (they couldn't have).
   */
  absent: boolean;
  /** The issue it came from. */
  issue: number;
}

export const FEATURES: readonly FeatureDef[] = [
  {
    id: 'free-questions', name: 'Free questions', stage: 'experimental', kind: 'rules', default: true, absent: true, issue: 1575,
    note: 'On the road, ask anyone one question in your own words, once per stay. Questions are kept to improve the game.',
  },
  {
    id: 'referrals', name: 'Referrals', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1609,
    note: 'Asked about something they don\'t know, a person names someone nearby who would.',
  },
  {
    // Its own switch, not `free-questions`: with it a free question stops passing the trust gates
    // (#1575's rule) and answers the way the knowledge model does, which is a different game, so
    // a run from before it (absent: false) must keep playing its questions the old way on replay.
    id: 'knowledge-questions', name: 'Questions people answer from what they know', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1611,
    note: 'A free question is matched to what the person knows, their People\'s and culture\'s ways too, and answered as an ask is: trust opens what they\'ll say, and someone who doesn\'t know may send you to someone who does.',
  },
  {
    // A rules feature: it changes what people can tell you (more topics answered, other referrals,
    // other leads), so a run from before it (absent: false) keeps today's answers on replay.
    id: 'scope-facts', name: 'What everyone knows', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1610,
    note: 'People know what their village, the road, and their trade know: ask about a village, the road, a trade or who does what, not only what one person has to say.',
  },
  {
    // A rules feature: it moves the trust at which people voice their views (culture-lore.ts
    // `effectiveCandour`), so a run from before it (absent: false) keeps today's voicing on replay.
    id: 'candour-by-place', name: 'Candour shaped by place', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1619,
    note: 'Where people are changes how openly they speak their minds: blunter in a hard place or harsh weather, more careful under a strict lord or in uneasy times.',
  },
  {
    // A rules feature: it changes prices, what's offered and the quests (economy.ts), so a run
    // from before it (absent: false) keeps today's market and jobs on replay.
    id: 'village-economies', name: 'Village economies', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1599,
    note: 'Each village lives on its own trade: what it makes is cheap there, what it lacks is dear and sells well, and each has a job that comes from its work.',
  },
  {
    // A rules feature: it changes what people can tell you (their organisations' facts, at their
    // organisations' gates, opened further by your standing with them), so a run from before it
    // (absent: false) keeps today's answers on replay. Membership itself needs no switch: on its
    // own it changes no answer, and its signs are the ones noticing already had.
    id: 'organisations', name: 'Organisations', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1587,
    note: 'People belong to organisations (the Compact, the Vidde Accords, the Compact of Knowing, the Bergfolk holds): members know what their organisation knows, keep its secrets from outsiders or are bound to tell, and a deed told to one member is known to them all.',
  },
  {
    // A rules feature: it changes who someone on the road is (villages.ts `asPlayed`: Maren of
    // Hollowford is Riksfolk, a human), so what they answer for their People and which topics
    // open. A run from before it (absent: false) keeps Maren a Markfolk orc on replay.
    id: 'humans-on-the-road', name: 'Humans on the road', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1631,
    note: 'Humans walk the road: Maren of Hollowford is Riksfolk, one of the two human Peoples, and speaks for them.',
  },
  {
    // A rules feature: it changes what people say about each other (their own view, which can be
    // wrong) and how warmly someone first meets you (word from a friend you helped), so a run from
    // before it (absent: false) keeps today's answers and welcomes on replay.
    id: 'ties', name: 'Ties between people', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1588,
    note: 'People on the road have kin, friends, rivals and debts: ask one about another and you hear their own opinion, which can be wrong, and helping someone warms their friends to you before you meet.',
  },
  {
    // A rules feature: it changes what people say (a lie instead of "not yet", a rumour as it reached
    // them) and adds the journal's lines, so a run from before it (absent: false) keeps today's
    // answers on replay.
    id: 'rumours-and-lies', name: 'Rumours and lies', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1580,
    note: 'Not everyone tells the truth: rumours grow as they travel, and some people lie for a reason (a secret they keep, a friend they cover for, a sale) until they trust you. Your journal keeps who said what, and flags it when two accounts clash.',
  },
  {
    // A rules feature: it changes how a rumour reads at each hop (a name swapped, the teller's
    // culture bending it, an organisation passing it carefully or loosely) and adds two rumours,
    // so a run from before it (absent: false) keeps #1580's drift on replay. It bends rumours, so
    // it does nothing without `rumours-and-lies`.
    id: 'rumour-drift', name: 'How rumours bend', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1589,
    note: 'A rumour bends with whoever tells it: a name can swap for someone of the same People, a loss-averse people tell it worse and an honour-bound one stakes their word on it, and a secret kept by an organisation can leak through a member who talks for a living.',
  },
  {
    // A rules feature: it changes what a place's people tell of their old history (world/old-history.ts:
    // a count grown, a place blurred, a name swapped within its house, one telling per People), so
    // a run from before it (absent: false) keeps the history as it was told on replay. Play reads
    // the remembered and regional facts with `history-in-play` (#1656).
    id: 'old-history-drift', name: 'Old history bends with age', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1650,
    note: 'Old stories bend as they pass from one generation of tellers to the next: short-lived Peoples tell an old plague bigger and in the wrong place, long-lived ones may still have someone who saw it, and a loss-averse village remembers it worse.',
  },
  {
    // A rules feature: it changes what people can tell you (their village's and country's history,
    // history-in-play.ts), who they'd refer you to and what the journal holds, so a run from before
    // it (absent: false) keeps today's answers on replay. With `old-history-drift` on too, each
    // person tells an old event their own People's way.
    id: 'history-in-play', name: 'People tell their history', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1656,
    note: 'Ask the people of a road village about their past (who holds the place, the old plague, the famine, the wars, what happened here) and they answer from what their village and its country remember: the long-lived may have seen it, the short-lived tell it as it reached them.',
  },
  {
    // A rules feature: it changes who tells what (the caravan tells the countries' legends), which
    // story "what happened here" answers with, and how the journal names and hedges a telling, so a
    // run from before it (absent: false) keeps #1656's answers on replay. It changes how history is
    // told, so it does nothing without `history-in-play`.
    id: 'history-retold', name: 'Eyewitnesses, legends and the best story', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1658,
    note: 'Someone who saw an old event says so, the caravan knows the old legends of the countries along the road, "what happened here?" gets the most memorable story a person knows, and the journal names each event.',
  },
  {
    // A rules feature: it changes trust (coming back to a shop, a fair purchase, help that reaches
    // someone's kin and friends and cools their rival) and what people say of each other (grudges),
    // so a run from before it (absent: false) keeps today's trust and answers on replay. What it does
    // along ties needs `ties` on too.
    id: 'grudges-and-help', name: 'Grudges, and what helping does', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1659,
    note: 'Some people hold a grudge, and it colours what they say of the other, sometimes unfairly. Help warms people: coming back to their shop day after day, a fair trade, a job done for them or for their kin. Help someone and their rival, or whoever holds a grudge against them, cools towards you.',
  },
  {
    // A rules feature: it changes what asking a liar again does once you've heard otherwise (they
    // come clean, or trust drops and their friends hear of it), so a run from before it (absent:
    // false) keeps a caught liar sticking to their story on replay. It acts on lies, so it does
    // nothing without `rumours-and-lies`.
    id: 'caught-lies', name: 'What a caught lie costs', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1660,
    note: 'Heard otherwise and asked again, a liar answers for it as their reason was: one who covered for a friend or kept their people\'s business comes clean and says why; one who lied for gain trusts you less, guards their secrets more, and their friends hear of it.',
  },
  {
    // A rules feature: it changes what a queued gathering action can be (a chosen length, played as
    // trips, with patches that thin and recover: action-length.ts), so a run from before it
    // (absent: false) keeps every action at its usual length on replay. Even on, an action with no
    // length chosen plays exactly as before.
    id: 'action-length', name: 'Choose how long', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1668,
    note: 'Gathering food, wood, stone, water or fish can take as long as you choose (1–4 hours, the rest of the day, or until you have enough), played as trips out and back: carrying and the walk decide how many fit, and deadfall, berries and a fishing spot thin as you work them and come back over the days.',
  },
  {
    // A rules feature: it changes who can tell you a rumour (everyone it reached, claims.ts
    // `reachOf`, not only its path) and how an organisation's member answers about its business (they
    // deflect, naming it; standing with it counts), so a run from before it (absent: false) keeps
    // today's answers on replay. Its rumours are bent ones, so that half needs `rumour-drift` too.
    id: 'reach-and-secrets', name: 'Who knows a rumour, and who keeps a secret', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1661,
    note: 'A rumour that has travelled the road is known by more of its people, and arrives more bent; one close to its source is known by fewer, and told truer. A member of a secretive organisation keeps its business from outsiders until they trust you enough, though what leaked through gossip is anyone\'s to tell.',
  },
  {
    // A rules feature: it changes prices (an erratic record is hedged, a trusted one gets the
    // regular's rate), how open people are (consistency.ts `recordGate`) and what they say, so a
    // run from before it (absent: false) keeps today's terms and answers on replay. Its record is
    // the deed list `grudges-and-help` keeps, so it does nothing without that switch.
    id: 'consistency', name: 'What people come to expect of you', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1663,
    note: 'People learn your track record (fair dealing, kept word, the side you take) and word of it travels with friends, kin and the caravan. A steady record, even a hard one, gets expected terms; an erratic one gets hedged prices and wary answers. Only a record of dealing well earns the regular\'s rate and confidences.',
  },
  {
    // A rules feature: it changes what a Warden can do (one Explore action where there were four,
    // the others learned by level or a starting talent; crafts you haven't worked out refused as
    // unknown; an Experiment action that can teach them), so a run from before it (absent: false)
    // keeps every action as it was on replay.
    id: 'action-visibility', name: 'Learn your actions as you go', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1690,
    note: 'You start with one Explore action: scouting, surveying, looking out and tracking come as you get better at them (or from day one with a talent for it). Actions you don\'t know yet are hidden, ones you can\'t do right now are greyed out with the reason, and Experiment, with what you have at hand, can work out what you don\'t know yet.',
  },
  {
    // A rules feature: it adds rumours made from the run's own world (run-rumours.ts: its told
    // history, the road's ties and organisations) and sometimes a fourth liar from a pool (claims.ts
    // `liesFor`), so a run from before it (absent: false) keeps the written rumours and three liars
    // on replay. Its rumours bend and travel as the written ones do and are told from the history,
    // so they need `rumours-and-lies`, `rumour-drift` and `history-in-play` too; the pooled liar
    // needs `rumours-and-lies`.
    id: 'run-rumours', name: 'Rumours from this run\'s world', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1662,
    note: 'Each run has rumours of its own, made from its history and its people: a quarrel at the market, a debt, a secret that leaked, the news from the country, an old disaster told bigger. Which of the road\'s people lie to you changes from run to run too.',
  },
  {
    // A rules feature: it changes what the Warden knows of the land and how it's shown (a
    // description in words until they draw their own map, descriptive-map.ts), and adds a journal
    // line when the map is drawn, so a run from before it (absent: false) keeps the Reach map on replay.
    id: 'descriptive-map', name: 'Draw your own map', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1686,
    note: 'There\'s no map of this world at the start: you know the land as a scout would tell it ("the stream is west, a quarter hour or so"), exact with the compass and rough without. Know home ground well and have something to draw on (the notebook, a hide, birch bark), and you draw a map of your own, showing only what you\'ve seen.',
  },
  {
    // A rules feature: it changes what the 30 odd things in the pack do (kit.ts `hasExtra`: a warmer
    // night in the family tent, quicker scouting with binoculars, the duct tape's one repair…), so a
    // run from before it (absent: false) plays them as weight only on replay. The items themselves
    // are on the list either way: off, they're in the pack and weigh what they weigh, and that's all.
    id: 'pack-extras', name: 'The odd things in the pack do something', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1727,
    note: 'Some of the funny, maybe useful and weird things you can pack turn out to help a little: a family tent is warmer, binoculars find the way faster, duct tape mends a tool once, a magnifying glass lights the fire in the sun. Others are just heavy.',
  },
  {
    // A rules feature, though the sim is untouched (weather-words.ts only reads state): it changes
    // what the Warden and the AI are told (the weather and season in words, the calendar earned),
    // so a run from before it (absent: false) keeps the strip and its numbers on replay.
    id: 'weather-words', name: 'The weather in words', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1729,
    note: 'No calendar and no thermometer at the start: the weather and the season are told in words ("cloudy and windy; you can see your breath in the morning; the first snow can\'t be far off"). Keep a tally of the days (the notebook, or a week of notches) and you know the day and about how long to the snow; once you\'ve seen the first snow, the season strip.',
  },
  {
    // A rules feature, though the sim is untouched (time-words.ts only reads state): it changes
    // what the Warden and the AI are told (the time of day in words in the queue box, a task's
    // length as "all morning" instead of "4h"), so a run from before it (absent: false) keeps the
    // hours on replay.
    id: 'time-words', name: 'The time of day in words', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1740,
    note: 'No watch that keeps this world\'s time: the queue box says when in the day it is ("early morning, the sun just up"), how long each task takes ("part of the morning", "the afternoon and into the evening") and when you\'d be done ("around dusk"), following the day\'s real light, instead of hours.',
  },
  {
    // A rules feature: it changes what can happen in a run (camp is made by an action, at real places
    // on the Reach that you've explored, and what you can tell of them), so a run from before it
    // (absent: false) keeps the four sites and the free choice of them on replay.
    id: 'camp-as-action', name: 'Make camp is an action, at places you know', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1732,
    note: 'Making camp is an action like any other, with the walk there and the setting up. Only places you have explored are offered, each a real place on the land: a cave in the high ground, the edge of a wood, the stream\'s bank, open heath. Your Intelligence, skills and Keen Eye decide how well you can read a place before you camp there.',
  },
  {
    // A rules feature, though the sim is untouched (camp-sites.ts `siteRating` only reads state): it
    // changes what the Warden and the AI are told (each place to camp rated great, good or poor from
    // the Warden's reading of it, and the counts on the Make camp action), so a run from before it
    // (absent: false) shows no ratings on replay.
    id: 'camp-site-ratings', name: 'Places to camp rated great and good', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1756,
    note: 'Each place to camp you know is rated from what you believe about it (its shelter from the wind, water, wood, dry ground and any danger you spotted): great, good or poor. The Make camp action shows how many great (★) and good (✓) places you know. A quick look can overrate a place; camping there shows what it\'s really like.',
  },
  {
    // A rules feature: it changes what spoils overnight (region1.ts `nightSpoilage`: the cold pit's
    // food rots too, slowly, its fraction carried in `pitRot`), so a run from before it (absent:
    // false) keeps a pit that stops the rot on replay.
    id: 'cold-pit-slows', name: 'The cold pit slows the rot', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1757,
    note: 'A cold pit keeps raw food cold and slows the rot, but doesn\'t stop it: food in the pit spoils at about a third of the open rate (a quarter at the river), faster on mild nights and slower in frost.',
  },
  {
    // A rules feature, though what you can reach and what a trip costs are untouched (the rings stay
    // in the sim, distance-words.ts): it changes what the Warden, the AI and the API are told (the
    // rings said as distances, the land told from camp once it's made) and the English the journal
    // keeps, so a run from before it (absent: false) keeps its rings on replay.
    id: 'distance-not-rings', name: 'Distance, not rings', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1752,
    note: 'No more "rings": the land is told by how far it is. Close by, half a day out (there and back), a day out, and overnight away past that, measured from where you are until you make camp, and from camp after that, so the distances follow camp when it moves.',
  },
  {
    // A rules feature: it changes what moving camp does (region1.ts `moveCamp`: the camp you leave is
    // kept by its spot id in `siteBuilds`, the camp you go to restored from it, and the cold pit's food
    // stays in the pit), so a run from before it (absent: false) leaves its builds behind on replay.
    // It needs `camp-as-action` (spot ids); without it, it does nothing.
    id: 'camp-builds-per-site', name: 'Each camp site keeps what you built there', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1753,
    note: 'Moving camp no longer leaves your shelter and cold pit behind for good: each place you camp keeps what you built there, and it\'s there when you come back. A shelter left long weathers a little. The cold pit\'s food comes with you when you go, unless you choose to leave it in the pit: then it stays there (and keeps spoiling slowly, as it would in the pit), and it\'s yours again when you camp there.',
  },
  {
    // A rules feature: it changes when the drawn map comes (map-learning.ts: no longer by itself once
    // home ground is known, but by a Draw your map action behind a few nights and enough places found,
    // which writes `mapLearned`) and adds the first day's journal line, so a run from before it
    // (absent: false) keeps #1686's automatic map on replay. It draws #1686's map, so it does nothing
    // without `descriptive-map`.
    id: 'map-learning', name: 'Learn the map', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1754,
    note: 'At first you know the land only as directions and distances. After a few nights, once you\'ve found enough places in enough directions and have something to draw on, you sit down and place what you found on a blank map, by its direction and distance from camp; near enough counts. Doing it gives you your own map, and what you find later goes on it too.',
  },
  {
    // A rules feature: it changes how warm a camp is (region1.ts `warmth`, built-warmth.ts: the site's
    // natural shelter plus what you build, softly less its wind or damp, and a bed), and what the
    // Warden, the AI and the API are told of a site (its natural shelter and what it needs, not a
    // ceiling), so a run from before it (absent: false) keeps the four ceilings on replay.
    id: 'built-warmth', name: 'Warmth comes from what you build', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1763,
    note: 'A site no longer caps how warm camp can get: a cave shelters you a lot with nothing built, a treeline some, a riverbank little and a hilltop not at all, and a proper wood shelter with a fire makes any of them warm enough. The hilltop\'s wind costs a little until walls are built well enough to stop it, the riverbank\'s damp until the floor is off the wet ground, and a bed keeps you off the cold ground.',
  },
  {
    // A rules feature: it changes which nights are cold (region1.ts endDay, thermal.ts: a heat
    // balance on ISO 11079 IREQ, clo, ISO 23537 bag ratings and ASTM F3340 pad R-values instead of
    // the warmth fraction), how much firewood a night asks (judged where you sleep), and what the
    // Warden, the AI and the API are told of tonight, so a run from before it (absent: false) keeps
    // the warmth fraction on replay.
    id: 'thermal-model', name: 'Nights as a heat balance', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1770,
    note: 'A night at camp is worked out the way cold-weather gear is rated: the air, wind and fire where you sleep against what you wear, sleep in and lie on. A cave stays about +4 °C all winter (each cave its own, within a degree), still and damp, and its rock needs a good pad; wind on a hilltop makes the night colder than the air; walls and a fire inside them warm the air. A better sleeping bag or pad helps as much as its rating says.',
  },
  {
    // A rules feature: it changes what a Warden can do (a lighter "Gather stones" action, region1.ts
    // `gatherstone`, and "Quarry stone" hidden until they know the cleave, techniques.ts), so a run
    // from before it (absent: false) keeps quarrying from day one on replay.
    id: 'stone-gathering', name: 'Gather stones before you quarry', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1816,
    note: 'You start by picking loose stones off the ground, out of the riverbed and from the scree: lighter work than quarrying, about half the stone, more by the river or on the hill. It trains Stonework, and once you\'ve found the cleave (stone has seams) you can quarry stone as before.',
  },
  {
    // A rules feature: a stop is a move in the run's log ("the queue's action N, stopped at hour h"),
    // replayed by playing the day again from the morning with that action cut short (stop-action.ts),
    // so a run from before it (absent: false) has no such move and plays as it always did.
    id: 'stop-action', name: 'Stop an action partway', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1815,
    note: 'While the day plays out, Stop ends the action running at that moment. On the walk out you turn back with nothing; water brings nothing until it\'s fetched; a hunt\'s kill comes when it comes, sometimes straight away: stopped after it you have the whole catch, before it nothing; wood, forage, stone and fish bring a share for the work done; exploring keeps what you\'d seen; on the walk back you have it all; at camp nothing is made or used up. The rest of the queue stays queued.',
  },
  {
    // A rules feature: it changes what a Warden can do (a new "Set traps" action, region1.ts `traps`,
    // that catches overnight; hunting hidden until a sling or bow, fishing until a hook and line; a
    // hunt ending on its kill), so a run from before it (absent: false) hunts and fishes as it did.
    id: 'hunting-gear', name: 'Traps first; hunting and fishing need gear', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1821,
    note: 'You start with traps: set a line of snares where you have seen game, and by morning there may be a hare in one. Hunting actively needs a sling (small game) or later a bow (deer too, and better odds); fishing needs a hook and line. A kill ends the hunt and you walk home with it, the hours left over yours, unless the catch fits in a comfortable load: then you stow it and hunt on. The odds are shown in words: good odds, fair odds, a long shot.',
  },
  {
    // A rules feature (#1823, with #1859's protection rating): it counts the raw meat at camp (`meat`,
    // `meatStored`), draws thefts on long absences and at night from streams of its own, and adds
    // Store the meat, so a run from before it (absent: false) keeps its meat untouched as it did.
    id: 'camp-scavengers', name: 'Meat at camp draws animals', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1823,
    note: 'Raw meat from hunting and traps left at camp can draw animals: on a long trip away a fox or ravens may take some, and at night too, unless a fire burns (asleep at camp, the risk is halved). Store the meat (hung with cord or under a stone cache) keeps it safe; smoked or dried rations are always safe. Rarely, at night, wolves or a bear take all the meat lying out, and the fright costs Clarity. How well the meat is protected is said in a word: lies open, fairly safe, well protected, secure.',
  },
  {
    // A ui feature, and temporary (#1736): it only shows a control on the page, so it switches live
    // and no run saves it. Remove it (and the switcher in main.ts / looks.ts) once #1723 picks the
    // look from the game.
    id: 'look-switcher', name: 'Look switcher', stage: 'experimental', kind: 'ui', default: true, absent: false, issue: 1736,
    note: 'Temporary, for reviewing era looks: a small switcher in the header shows any of the nine looks (or the game\'s own). The choice is kept in this browser, never in the save.',
  },
  {
    // A ui feature (#1793, the guide epic #1791): the FOCUS chip and picker show the Survival path,
    // read from the state (artificer-app/survival-path.ts), so it switches live and no run saves it.
    // The play API, the console and AI players never see it.
    id: 'guide', name: 'The guide', stage: 'experimental', kind: 'ui', default: true, absent: false, issue: 1793,
    note: 'The FOCUS chip shows the Survival path and its next step (find a camp site, make camp, a roof over you, food laid by, ready for winter), and its picker lists the steps with the goal focus that helps.',
  },
  {
    // A ui feature (#1802): the page behind the boxes is drawn from the state (artificer-app/backdrop.ts),
    // saying no more than the weather box, so it switches live and no run saves it. The play API, the
    // console and AI players never see it. Off, the page is exactly as before.
    id: 'backdrop', name: 'A living backdrop', stage: 'experimental', kind: 'ui', default: true, absent: false, issue: 1802,
    note: 'Behind the boxes, a murky scene of the woods: the season, today\'s weather, the time of day and the place you camp, with the edges darkening when you\'re worn down, going red-dark before a frightening night and frosting over in the cold. The boxes keep their look.',
  },
  {
    // A ui feature (#1808): where the page's controls are drawn (artificer-app/meny.ts), so it
    // switches live and no run saves it. The play API, the console and AI players never see it.
    // Off, the header and the help panel are exactly as before.
    id: 'meny', name: 'The ⚙ Menu', stage: 'experimental', kind: 'ui', default: true, absent: false, issue: 1808,
    note: 'The header keeps only the title, the Warden, the day and the ⚙ Menu (with help and feedback): new game, profile, language, guide, look, other ways to play, experiments and dev mode are on the Menu page.',
  },
  {
    // A ui feature (#1826): where the PLAN tab puts the queue (artificer-app/plan-layout.ts), so it
    // switches live and no run saves it. The play API, the console and AI players never see it.
    // Off, the PLAN tab is laid out exactly as before.
    id: 'side-queue', name: 'The queue beside the actions', stage: 'experimental', kind: 'ui', default: true, absent: false, issue: 1826,
    note: 'On PLAN the queue stays beside the actions on every screen, phones too, and stays in view while you scroll through the actions. On a narrow screen it is compact: each task\'s icon, short name and hours, the day\'s total and when it ends. The latest journal and the camp-site picker sit below.',
  },
  {
    // A ui feature (#1828): the Menu's Sound section and the ambience it plays (artificer-app/ambience*.ts),
    // read from what the page shows, so it switches live and no run saves it. The sound itself stays
    // off until the player turns it on. The play API, the console and AI players never hear it.
    id: 'ambience', name: 'Ambient sound', stage: 'experimental', kind: 'ui', default: true, absent: false, issue: 1828,
    note: 'A Sound section in the ⚙ Menu: ambient sound made in the browser (wind, rain, snow, the fire, a stream, drips in a cave, distant thunder) that follows the weather, the time of day, where you camp and how worn your mind is. Off until you turn it on.',
  },
  {
    // A ui feature (#1824): how the header is drawn (artificer-app/meny.ts `headerRows`,
    // artificer-app/vital-words.ts), so it switches live and no run saves it. It builds on the Menu
    // (help moves into it), so it shows only with `meny` on too. The play API, the console and AI
    // players never see it. Off, the header is the one from #1808.
    id: 'two-row-header', name: 'Two-row header', stage: 'experimental', kind: 'ui', default: true, absent: false, issue: 1824,
    note: 'The header is two rows: the place, the day, the ⚙ Menu and feedback; then the Warden and Vigor, Clarity and Condition as words (Energized, Drowsy, Hurt…) in a coloured border, with bars beside them from day 8. How to play moves into the Menu.',
  },
  {
    // A ui feature (#1835): a word on LAND read from what the run already knows of each area
    // (artificer-app/land-assessment.ts), so it switches live and no run saves it. The play API, the
    // console and AI players never see it. Off, the ring headings are exactly as before.
    id: 'land-self-assessment', name: 'How well you know each area', stage: 'experimental', kind: 'ui', default: true, absent: false, issue: 1835,
    note: 'On LAND each area\'s heading says how well you feel you know it, from Unknown and A hunch up to Could work it blindfolded, with a tooltip of what would raise it.',
  },
  {
    // A ui feature (#1836): how LAND is drawn (artificer-app/land-view.ts foundLand), so it switches
    // live and no run saves it. The play API, the console and AI players never see it. Off, LAND is
    // exactly as before.
    id: 'land-found-only', name: 'LAND shows what you\'ve found', stage: 'experimental', kind: 'ui', default: true, absent: false, issue: 1836,
    note: 'LAND lists only the places you\'ve found, area by area, and the places to camp, without the knowledge chips, their key or the pin rows; at the bottom a button explores your surroundings.',
  },
  {
    // A ui feature (#1848): where the eating plan's setting is drawn (artificer-app/rations-view.ts),
    // read from the state, so it switches live and no run saves it. The play API, the console and AI
    // players never see it, and the eating rules are unchanged. Off, the RATIONS chip stays in the status bar.
    id: 'rations-warden', name: 'Rations with the Warden', stage: 'experimental', kind: 'ui', default: true, absent: false, issue: 1848,
    note: 'The RATIONS chip leaves the status bar. Until the first evening meal there is no setting; the morning after, a note says how that meal went (just right, too much, too little) and that the setting is now with the Warden; from then on it is a Rations row in the Warden\'s view.',
  },
  {
    // A ui feature (#1838): where how to play is drawn (artificer-app/journal-notes.ts), so it
    // switches live and no run saves it. It builds on the Menu (whose How to play section becomes a
    // link to the notes), so it shows only with `meny` on too. The play API, the console and AI
    // players never see it. Off, the journal and the Menu are as #1824 left them.
    id: 'journal-notes', name: 'How to play in the journal', stage: 'experimental', kind: 'ui', default: true, absent: false, issue: 1838,
    note: 'How to play is the Warden\'s own notes at the front of the journal, opened from the 📖 on the journal\'s heading; the ⚙ Menu\'s How to play links there, and the header has no ?.',
  },
  {
    // A ui feature (#1853): which view the page opens on after the intro (artificer-app/start-land.ts),
    // so it switches live and no run saves it. The play API, the console and AI players never see it.
    // Off, a new Warden starts on PLAN as before, and LAND's day-1 Explore button is #1836's.
    id: 'start-on-land', name: 'Start on LAND', stage: 'experimental', kind: 'ui', default: true, absent: false, issue: 1853,
    note: 'A new Warden starts on LAND after the intro, with the patrol leader\'s advice (scout first: find shelter and water) and an Explore button that goes to PLAN with Explore highlighted and its distance chooser open.',
  },
];

/** Switches by feature id. */
export type FeatureSwitches = Readonly<Record<string, boolean>>;

export const featureById = (id: string): FeatureDef | undefined => FEATURES.find(f => f.id === id);

/** A set of switches as saved or sent: an object of booleans. Anything else isn't one. */
export function validFeatures(x: unknown): x is Record<string, boolean> {
  return typeof x === 'object' && x !== null && !Array.isArray(x) && Object.values(x).every(v => typeof v === 'boolean');
}

/**
 * The rule features a new game plays with: every rule feature's default, then the player's own
 * choices on top. Written out in full, so the run keeps them even if a default changes later.
 * Ids that aren't rule features are left out.
 */
export function ruleFeatures(choices: FeatureSwitches = {}): Record<string, boolean> {
  return Object.fromEntries(FEATURES.filter(f => f.kind === 'rules').map(f => [f.id, typeof choices[f.id] === 'boolean' ? choices[f.id] : f.default]));
}

/** Whether a rule feature is on in a run: as the run saved it, else as runs from before its switch had it. */
export function featureOn(saved: FeatureSwitches | undefined, id: string): boolean {
  const v = saved?.[id];
  return typeof v === 'boolean' ? v : featureById(id)?.absent ?? false;
}

/** Every rule feature, on or off in a run, as `featureOn` reads it: what a record keeps. */
export const featuresOf = (saved: FeatureSwitches | undefined): Record<string, boolean> =>
  Object.fromEntries(FEATURES.filter(f => f.kind === 'rules').map(f => [f.id, featureOn(saved, f.id)]));

/** The experimental features among those on: what earns a run its 🧪. Unknown ids don't count. */
export const experimentalOn = (switches: FeatureSwitches | null | undefined): FeatureDef[] =>
  FEATURES.filter(f => f.stage === 'experimental' && switches?.[f.id] === true);

/** A ui feature as the player has it: their choice, else its default. */
export const uiFeatureOn = (choices: FeatureSwitches, id: string): boolean => {
  const f = featureById(id);
  return f?.kind === 'ui' ? (typeof choices[id] === 'boolean' ? choices[id] : f.default) : false;
};
