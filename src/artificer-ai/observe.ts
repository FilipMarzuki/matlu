/**
 * What an AI player sees (#1226): a static rules prompt and a per-day text
 * observation of Region 1.
 *
 * Pure and deterministic — no network, no randomness — so the same state
 * always renders the same text. That keeps the rules prompt byte-stable for
 * prompt caching and makes transcripts reproducible.
 *
 * The observation deliberately mirrors what the web page shows a human:
 * the numbers, the yield hints and the "why can't I do that" reasons, so the
 * model plays the same game a person does rather than a privileged one.
 */

import { kitItem, kitSupplies } from '../artificer/kit';
import { isYoung, YOUNG_PRACTICE } from '../artificer/growing';
import { STATS, STAT_IDS } from '../artificer/stats';
import {
  ACTIONS, blockedReason, SITES, DAY_HOURS, REGION1_MILESTONES, DISCOVERIES, BUILD_COST,
  readinessInput, warmth, winterReady, winterOutlook, nightFuel, tripOdds, dangerOf, FISH_CATCH, CABIN_FEVER_FROM, queueHours, queueId, survivalLockOf,
  tripLoad, tripUnease, tonightsFright, coldCapacity, spoilage, type ActionId, type Region1State, type TripLoad,
} from '../artificer/region1';
import { pillars } from '../artificer/readiness';
import { BASELINE } from '../artificer/vitality';
import { SKILL_IDS, LEVELS, perceivedLevel } from '../artificer/skills';
import { techniqueById, manualById } from '../artificer/techniques';
import { TALENTS } from '../artificer/talents';
import { focusKey, UNRELIABLE_BELOW } from '../artificer/focus';
import { seasonOf } from '../artificer/winter';
import { nightTemp } from '../artificer/weather';
import { maxLoad, comfortableLoad, strainRecovery, GEAR_ITEMS, EXHAUSTED_DRAIN, type Haul } from '../artificer/load';
import { ROUTE, ROAD_DAYS, ROAD_CRAFTS, WAGON_CRAFT_HOURS, HELP_HOURS, peopleHere, legOf, daysLeftOnLeg, villageOf, questsHere, tradeTerms, lessonFee, type RoadState } from '../artificer/road';
import { peopleOf, personById, TRAVELLERS, TALK_HOURS, LESSON_HOURS, APPRAISE_HOURS } from '../artificer/villages';
import { questById, canComplete, type QuestTemplate } from '../artificer/quests';
import { encounterById, optionsFor, stepOf, type EncounterOption } from '../artificer/encounters';
import { THREAT_WORDS, STATE_WORDS, DARK_FADES } from '../artificer/panic';
import { QUIRKS, quirkName, isFear, FEAR_FADES } from '../artificer/quirks';
import { meetingOptions, meetingStep, type Meeting } from '../artificer/caravan-meeting';
import { INJURY_NAME, INJURY_COST, HARM_NAME, HARM_WORDS } from '../artificer/injuries';
import { pinCapacity, maxInterest, pinEffect, placeName, tripPinNote, letGoFirst } from '../artificer/pins';
import { sellPrice, buyPrice, isGood, KIND_OF, TRADE_HOURS } from '../artificer/trade';
import { RINGS, RING_NAME, TRAVEL_HOURS, RICHNESS, LEVEL_NAME, FINDS, domainsOf, level, reachable, tripYield, hasFind, supplyWord, type Domain, type Ring } from '../artificer/exploration';

/**
 * The rules and the response contract. Static on purpose: it goes in the
 * system prompt and is cached, so never interpolate anything per-run here.
 */
export const RULES = `You are playing "Greywind Reach", the first region of the Artificer: a survival-crafting game played one day at a time.

GOAL
Survive the winter. You arrive alone with almost nothing on day 1. Autumn (days 1-30) is for preparing: the snow falls on day 31, and winter lasts until the thaw on day 61. Days go on as before through winter — darker, colder, harder — and you live on what you built and stored. Reach the thaw alive and the run ends graded by your Condition: hale (70+), worn (40-69) or broken (under 40). Dying or collapsing before then is the worst result. There are no exits: you can't leave Greywind Reach before spring.
Freezing nights burn firewood: 1, plus 1 for every full 5 C of frost (a warm shelter burns up to a third less). A freezing night without enough fire costs Condition — about 8 at -5 C, 20 at -15 C, less with shelter and sound cold gear — and a few in a row kill. When the cold is deep (day mean below -5 C) the streams are frozen hard: fetching water means melting snow, 1 firewood a trip.
A good winter needs a larder (raw food, then preserved rations, one a night), water, firewood, a warm shelter (a clear midwinter night is about -19 C and needs about 87% warmth not to be a cold night; a fire kept in all night adds 15%, so a 75%-warm shelter with a fire is enough. A cold night costs 4 Condition plus 3 for every 10% the shelter falls short, and heals nothing), and a body in good shape. The WINTER OUTLOOK line tells you how many nights your stores last.

HOW A DAY WORKS
You plan the day as a queue of actions. Each costs hours and drains Vigor (body) and/or Clarity (mind). A day has 14 waking hours; an action starts only if hours remain, so the last one may run past 14. Unrun actions are dropped — plan one day at a time. At night you eat 1 food and drink 1 water, then sleep; a warmer shelter recovers more. Water is critical, food less so. A night without water: Vigor and Clarity recover only 30%, and you lose 10 x (nights running without water) Condition and 8 x Clarity — three dry nights cost 60 Condition, a fourth is usually fatal. A night without food: Vigor recovers 50%, Clarity 80%, and you lose 1 x (nights running) Condition and 3 x Clarity. One missed meal doesn't stop capacity growing; no water, or two hungry nights running, does. Condition only heals on nights with both food and water. If Condition reaches 0 overnight the run ends at once: dead if you had gone 2+ nights without water or 5+ without food, otherwise collapsed — and no one comes into the Reach, so a collapse is death too (a bear in autumn, wolves in winter) unless the spring caravan is within 3 days of arriving and its traders find you. Death ends the character. Rations (preserved food) are eaten only when there's no raw food left. Raw food spoils: each night a fifth of the raw food not kept cold goes bad (rounded up) — half that on nights near freezing (2 °C or below), none in a hard frost (−5 °C or below). A cold pit at camp keeps 8 raw food cold (12 at the river), and in winter the snow keeps 6 more. Rations never spoil. What a trip can bring home is limited: you can lift at most 40 + 3 x (STR − 10) stones, and a load's bulk (weight x awkwardness) must fit that too. Weights per unit: raw food 1, rations 0.5, water 2, firewood 2, materials 1, stone 3, hide 3; loose food, water, firewood and materials are awkward (x1.5–1.6), stone x1.3, hides x1.4 — a waterskin makes water x1.0. Whatever won't fit is left behind, heaviest first. Carrying gear (basket, backpack, harness, sled) makes loads less awkward but never raises the max; crude gear gives half the benefit; a sled is taken only when it helps. A comfortable load is 40% of your max (16 stones of bulk at STR 10); above that you are overloaded, and on a far-ring trip the walk home takes 30% longer and costs 60% more Vigor per unit over comfortable (a load twice the comfortable one: 1.3× the time, 1.6× the Vigor). Each overloaded hour builds strain (overload ratio − 1 per hour): each point cuts the next night's Vigor recovery by 10% (at most half), each night halves it, and waking with 3+ leaves you exhausted — all work drains 15% more that day. You choose how to eat ("eating" in your reply): full (a meal every night), half (a meal every other night — a lean night costs 1 Condition and wears the Vigor cap down, but no hunger builds; it makes a larder last twice as long), or none (fast, even with food). Being cooped up three or more days in a row — never out on the land, no study or crafting — brings cabin fever, which wears the Clarity cap down until you get out or get absorbed in work. Pushing a pool past empty costs Condition. Condition heals slowly (a few points a night) only on nights you ate and drank, slept in shelter 50%+ warm, and never pushed past empty; a light, restful day doubles it.

SKILLS
Seven skills improve by use: every hour of work trains the skill it uses (woodcraft: wood, wooden builds, shovel; foraging: gather; hunting: hunt, track, snare; stonework: quarry, stone knife, stone walls; fieldcraft: water, preserve; scouting: scout, survey, look out; handcraft: cold gear, parka, waterskin, bedroll, tinker). Levels: Novice 5h, Apprentice 20h, Adept 60h, Journeyman 150h, Skilled 400h, Expert 1,000h, Veteran 3,000h, Professional 10,000h, Master, Grandmaster, and beyond human: Paragon, Mythic, Transcendent. A focused skill practises 3x faster. Higher skill in a field means lighter work, more yield, better tool use and better craft grades. You only know how good you THINK you are — beginners overrate themselves, the getting-good underrate themselves — so judge by results. Skills carry into the next run.
Techniques are what a skill level looks like in practice (e.g. reading the grain, still hunting, smoke curing): each gives a concrete edge (yield, lighter work, better grades). Easy ones you work out alone with practice, hard ones take much longer alone, and some can only be taught — by a teacher or a manual found while scouting the far rings. A manual also makes practice in its skill more efficient. Past Adept, practising alone gets steadily slower; knowing the techniques of your level speeds the climb.

FOCUS
Your mind works on one thing, set with "focus" in your reply (null keeps it, "none" clears it). concept:<name> — that concept gains 0.3 insight per hour you work each day. goal:shelter|larder|explore — matching actions (shelter: build, wood; larder: hunt, gather, preserve; explore: scout, survey, lookout, track) yield +1 and drain 10% less. skill:<name> — that skill practises 3x as fast. A focus costs 4 Clarity a night and is halved below 30 Clarity. It locks to SURVIVAL (water, gather, hunt, wood, build, preserve get the bonus; learning pauses) after a night without water, 2+ without food, Condition under 40, or in the last 3 days of autumn if you're not ready.

THE LAND
Snow lies on the ground in winter and deepens with each snowfall: deep snow makes the walk out and wood cutting take up to half again as long. Once the cold is deep (from about day 36) the lake ice is thick enough to fish through (fish: a slow, steady catch). A winter storm is a blizzard. You can still go out, but everything out there takes half again as long, hauls come back poorer, and the cold may frostbite you, lose you in the white (and your haul with it), or kill you outright; further rings are worse, sound cold gear helps. Camp work (crafting, study, rest) is safe.
Every gathering trip (gather, hunt, water, wood, quarry, fish) has luck: it comes back empty, poor (half), ordinary or good (1.5x). The odds of the hour are shown per action ("good / fair / poor / bad odds now"): weather (rain, fog and storms spoil foraging and hunting; snow buries forage but shows the tracks; wind and storms bring down dead wood), the land's supply (scarce or bare ground is worse), your skill and techniques, and the light set them. Luck is fixed per hour, so the same trip at the same hour always comes out the same.
Each ring's forage, game, timber, water and stone is a supply (plenty / thinning / scarce / bare) that your trips draw down and the land regrows overnight: quickly in early autumn (days 1-15), slowly in late autumn, hardly at all in winter. Yields follow the supply. Rest an overworked ring; push outward when the near one runs thin.
Three rings around camp: near (home), far (+3h travel), distant (+6h travel). Outer rings are richer (x1.5, x2). A ring is reachable once the ring inside it is scouted.
Each ring has domains (forage, timber, stone, water, game; routes beyond home) known at a level: unknown, suspected, observed, detailed.
- scout: everything in that ring at least suspected. survey: at least observed (richer trips). track: game observed (you can hunt deer there).
- lookout: that ring +1 level (up to observed) and the next ring comes into view, routes included — from the far ring this reveals the pass.
- Working a domain (gather, wood, quarry, water, hunt) teaches it toward detailed, which yields a find (+2 on those trips). Foraging unknown ground yields half but explores it.
- Every trip depletes that ring's domain a little, so the near ring runs thin; push outward.

CRAFTING
Crafts (build, coldPit, coldGear, knife, snare, waterskin, bedroll, shovel, basket, backpack, harness, sled) are graded crude / sound / fine / masterwork by how clear your head is (Clarity), your bench (a roofed shelter is a tier-1 bench) and your tools. Crafting while foggy can fail and waste materials. Many recipes must first be discovered (by observation, finds, or the study action). Crude cold gear won't hold up through a winter; a hide parka holds even when crude.

ACCIDENTS
Out on the land you can get hurt: about 1% per hour of work and walking, three times that in full dark, more in rain, fog, snow and storms (a storm 2.5x), 1.5x if you set out with Vigor under 20 or Clarity under 30, less with skill — never above 35% for one trip. Crafting is safer (0.5% an hour, double for knapping or a blade; worse in the dark without a fire). Rest and study are safe. Each hour has a fixed fortune, so the same work at the same hour turns out the same; moving risky work to a better hour or better weather is how you avoid it. An accident is a bruise (-2 Condition), a bad cut (-5), or a lost haul; in the worst conditions also a damaged tool (the tool the work uses drops a grade, a crude one breaks) or a sprain (physical work and walking cost 1.3x Vigor while it lasts), and a bad cut can be deep (it bleeds 1 Condition a night). At the bench, a bad slip can hurt your hand (crafting takes 1.3x as long).
INJURIES are minor (60%), serious (30%) or grave (10%; 1.5x instead of 1.3x) — one step worse if you set out with Vigor under 20. They heal in points (minor 2, serious 6, grave 10): each night you ate, drank and slept warm heals 1, 2 after a light restful day, scaled by Constitution; a hungry, thirsty or cold night heals nothing. Heavy work (wood, quarry, hunt, build, ring 3) on a serious sprain, or crafting with a serious hurt hand, has a 15% chance to make it grave. A grave injury heals into an OLD WOUND that stays with the character for every later run: a stiff knee (walking to the far rings costs 1.1x Vigor), a weak grip (crafts a step worse at the edge of a grade) or a scar (2 Clarity lost on cold nights). Rest a serious injury rather than work through it.
THE PACK: you set out on a weekend hike with your patrol, so you have what you packed. The knife, water bottle and sleeping bag count as your knife, waterskin and bedroll; the backpack is a sound backpack. Each item's effect is listed on the PACK line; some things run out (dressings, headlamp battery, matches, the thermos, stove fuel, the sweets).
GROWING UP: you start as a child (11–14) and each new run of the same character is a year older. Your stats are lower now than they will be: each grows a little every year toward the adult stats chosen at creation, and is full at 18 (the body lags most: STR and CON). Every effect uses your stats as they are now. Under 18, skills learn 1.2x as fast.
TREATMENT: "treat" (1h, at camp) tends your worst untreated injury: with a first-aid kit dressing if you have one (any injury, one step better), otherwise improvised — bind a cut (1 materials, or a hide for a better dressing), splint a sprain (1 firewood + 1 materials), ease a hurt hand with herbs (1 food). How well depends on your First aid skill: a fair treatment heals +1 a night, a good one +2 (only on nights that heal at all). A treated injury can't be worsened by work, and an untreated serious deep cut can fester overnight (10%: grave, -5 Condition). Each injury is treated once. Treating practises First aid.

ENCOUNTERS
Out on the land (more often in the far rings, and in the dark) you may meet something: an animal, a find, a person. At most one a day. It pauses the day, and you choose what to do from the options shown. Each option says what it costs and needs, and its odds in words: safe (nothing can go wrong), likely, risky, desperate. Odds follow your stats, skills, talents and tools. The outcome is fixed for that encounter and choice. Some failures hurt badly; a few can kill. After your choice the rest of the day runs.

FEAR AND PANIC
Things look as dangerous as they seem to YOU, not as they are: the unknown, the dark or a storm, a foggy mind (Clarity under 30) and a hurt body (Condition under 40) make them look worse; meeting the same thing again and again, and skill in its field, make them look smaller. Your nerve (from WIL, and some talents) is what you can hold. If something looks one step past your nerve you are SHAKEN: careful options (fine judgement, stalking, talking) go one odds word worse, and the fright costs some Clarity. Two or more steps past and you PANIC: careful options close, and your body may override your choice with its instinct — your panic response, a quirk you may not know yet (fighters lash out, runners bolt, freezers lock up and lose hours, appeasers give something away). Shaken or panicked, adrenaline makes STR and AGI count higher for the moment. After a panic comes a crash: Vigor and Clarity drop, your hands shake (crafts a grade worse that day) and you sleep badly. A panic that ends badly can leave a lasting fear of that kind of thing; facing it calmly a few times fades it.
The environment frightens too. Out on the land, dusk and dark, fog, storms and blizzards, the distant ring, and winter after dark all add up (ground you know well helps): shaken, the work wears the mind harder; panicked, something out there may spook you off the land — what you do then is your panic response. At night, no shelter, no fire, bad weather and winter make it hard to sleep (a lived-in camp and a warm shelter with the fire kept in help): an uneasy night returns less Clarity, a sleepless one much less, and some Vigor. The observation marks trips and nights that will frighten you.

PLACES AND MEMORY
Out on the land you sometimes come across a place worth remembering (a sheltered hollow, a deep pool, a berry thicket, a stone outcrop, a strange carving, a sunlit glade). It comes as an encounter: "remember" pins it, if your memory has room. You can hold 2 places (+1 per 2 INT above 10, fewer below, at least 1), plus 1 per true level of the Memory skill, which grows by remembering places (1h each) and by going back to rings where you remember one (1h, once a day). A remembered place pays off in its ring: a fishing spot +1 to water and fishing, a berry thicket +1 to gathering, an outcrop +1 to quarrying; a peaceful place makes the ring less frightening, an eerie one more; something that awed you keeps the ring no worse in the dark; a sheltered hollow in ring 1 makes a shelter you build while you remember it warmer. When memory is full, let a place go with "forget": "<pin id>". From Apprentice Memory you can weigh places with "interest" (1–2 stars; 3 from Adept): a 3-star place counts double. Places are forgotten when the run ends; Memory, the skill, carries on.

RESPONDING
Each turn you get an observation. Reply with ONLY a JSON object, no prose, matching:
{
  "thoughts": string (one or two sentences: your plan for today),
  "site": "cave" | "tree" | "river" | "hill" | null (settle or move camp before the day; null = no change),
  "focus": "concept:<name>" | "goal:shelter|larder|explore" | "skill:<name>" | "none" | null (what your mind works on; null = keep),
  "eating": "full" | "half" | "none" | null (how you eat from tonight; null = keep),
  "forget": "<pin id>" | null (let a remembered place go, before the day; null = none),
  "interest": [ { "pin": "<pin id>", "stars": 0 | 1 | 2 | 3 } ] (weigh remembered places once Memory allows; [] = none),
  "queue": [ { "action": string, "ring": 1 | 2 | 3, "options": [ { "key": string, "value": string } ] } ]
}
Use action ids exactly as listed. "ring" matters only for land actions (use 1 otherwise). "options" lets you pick choices shown for an action (e.g. {"key":"target","value":"small"} for hunt); use [] for defaults. Moving camp (site) after building abandons the shelter.
When an encounter pauses the day, reply instead with ONLY {"thoughts": string, "choice": "<option id>"}.`;

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const fl = (x: number): number => Math.floor(x + 1e-9);
const r0 = (x: number): number => Math.round(x);

/** One-line yield hint per land action in a ring (same numbers the sim uses). */
function landHint(s: Region1State, id: ActionId, r: Ring): string {
  const ty = (d: Domain, base: number, per: number): number => tripYield(s.explore, r, d, base, per);
  const fb = (d: Domain): number => (hasFind(s.explore, r, d) ? 2 : 0);
  switch (id) {
    case 'gather': return `+${ty('forage', 3, 2)} food${fb('forage') ? ' +2 materials' : ''}`;
    case 'hunt': return `deer +${ty('game', 7, 0) + fb('game')} food & a hide (needs game observed); small game ~+${ty('game', 3, 1) + fb('game')} food (needs game suspected)`;
    case 'water': return `+${ty('water', 4, 1) + (s.site === 'river' && r === 1 ? 2 : 0) + fb('water')} water`;
    case 'wood': return `+${ty('timber', 4, 1) + (s.site === 'tree' && r === 1 ? 1 : 0) + fb('timber')} firewood, +${ty('timber', 2, 1)} materials`;
    case 'quarry': return `+${ty('stone', 3, 1) + fb('stone')} stone`;
    case 'fish': return `about +${FISH_CATCH * RICHNESS[r]} food through the ice (needs thick lake ice: the deep cold)`;
    case 'scout': return 'everything there at least suspected';
    case 'survey': return 'everything there observed';
    case 'track': return 'game observed';
    case 'lookout': return 'ring +1 level, next ring comes into view';
    default: return '';
  }
}

const CAMP_HINT: Partial<Record<ActionId, string>> = {
  preserve: '2 raw food -> 1 ration (smoke: up to 3; dry: up to 2)',
  build: 'next shelter stage (see options)',
  coldGear: 'cold gear for the winter',
  coldPit: 'a cold pit at camp: keeps 8 raw food (12 at the river) from spoiling · 4 stone + 2 materials',
  knife: 'hunt -15% vigor, quicker preserving',
  snare: '+1 food every night',
  waterskin: '+1 water per trip',
  bedroll: '+6 clarity overnight',
  shovel: 'build -20% vigor',
  basket: 'raw food and materials awkwardness 1.0 (2 materials)',
  backpack: 'everything 20% less awkward, never below 0.8 (a hide + 2 materials)',
  harness: 'firewood awkwardness 1.1, stone and hides 1.0 (a hide + 1 material)',
  sled: 'stone, firewood and hides count half their weight on snow or rings 1-2 (0.8 in ring 3); the sled adds 4 when taken (5 materials)',
  study: 'a third of your clarity -> concept insight (rank 1 reveals recipes)',
  tinker: 'rests body, spends mind',
  rest: 'recovers a little',
  treat: 'tends your worst untreated injury (1h): a first-aid dressing, or improvised — a cut with 1 materials (or a hide), a sprain with 1 firewood + 1 materials, a hurt hand with 1 food',
};

const haulWords = (h: Haul): string => (Object.keys(h) as (keyof Haul)[]).filter(k => (h[k] ?? 0) > 0).map(k => `${h[k]} ${k}`).join(', ');

/** A trip's expected load in words (#1297) — the same as the queue preview a person sees (#1296). */
export function loadWords(l: TripLoad): string {
  const left = haulWords(l.left);
  const how = left ? `too much to carry: leaves ${left} behind` : l.ratio <= 1 ? 'comfortable' : !l.walk ? 'heavy, but camp is close' : l.ratio <= 1.5 ? 'heavy' : l.ratio <= 2 ? 'staggering' : 'barely able to carry it';
  const help = l.wouldHelp.length && (left || (l.ratio > 1 && l.walk)) ? `; a ${l.wouldHelp[0]} would help` : '';
  return `load ${how} (brings ~${haulWords(l.haul)}, bulk ${Math.round(l.cumbersome)}/${Math.round(l.max)})${help}`;
}

/** The LOAD line (#1297): what you can carry, your gear, and strain. */
function loadLine(s: Region1State): string {
  const st = s.character.stats;
  const gear = s.tools.filter(t => (GEAR_ITEMS as readonly string[]).includes(t.item)).map(t => `${t.item} (${t.grade})`);
  const strain = s.strain ?? 0;
  const state = s.today.exhausted ? `EXHAUSTED today — all work drains ${Math.round((EXHAUSTED_DRAIN - 1) * 100)}% more`
    : strain > 0.05 ? `strain ${strain.toFixed(1)} (tonight's Vigor recovery −${Math.round((1 - strainRecovery(strain)) * 100)}%)` : 'no strain';
  return `LOAD: max ${maxLoad(st)} stones · comfortable ${Math.round(comfortableLoad(st))} · carrying gear: ${gear.length ? gear.join(', ') : 'none'} · ${state}`;
}

/** The COLD STORAGE line (#1297): raw food kept cold vs exposed, and tonight's spoilage. Only where it spoils. */
function coldLine(s: Region1State): string | null {
  if (s.config.world.weather !== 'seeded') return null;
  const t = nightTemp(s.day, s.weatherToday, s.config.calendar);
  const sp = spoilage(s.stores.rawFood, coldCapacity(s, t), t);
  return `COLD STORAGE: ${sp.kept} raw food kept cold (capacity ${coldCapacity(s, t)}${s.site && s.coldPitAt === s.site ? ', cold pit' : ', no cold pit'}) · ${sp.exposed} exposed · ${sp.spoiled ? `${sp.spoiled} will go bad tonight` : 'nothing will spoil tonight'}`;
}

/** Render the full per-day observation. `notes` carries harness feedback (dropped entries, an invalid reply…). */
export function observe(s: Region1State, notes: readonly string[] = []): string {
  const cal = s.config.calendar;
  const season = seasonOf(s.day, cal);
  const v = s.vitals;
  const st = s.stores;
  const lines: string[] = [];

  lines.push(`DAY ${s.day} — ${season === 'autumn' ? `autumn, snow on day ${cal.winterDay} (${cal.winterDay - s.day} days)` : `winter, thaw on day ${cal.thawDay} (${cal.thawDay - s.day} days)`}.`);
  lines.push(`Hours used today: ${s.hoursToday}/${DAY_HOURS}.`);
  // Learned planning (#1350): until the first level-up, one action per reply.
  if (!s.canPlan) lines.push("PLANNING: not yet — you take things one at a time. Put ONE action in the queue (only the first runs); you'll be asked again after it. An empty queue ends the day. The first time a skill levels up, you'll be able to plan whole days.");
  for (const n of notes) lines.push(`NOTE: ${n}`);
  lines.push('');
  // Capacities and Condition round DOWN: 99.6 shown as "100" read as meeting a 100 threshold it doesn't (#1230).
  lines.push(`VITALS: Vigor ${r0(v.vigor.current)}/${fl(v.vigor.cap)} · Clarity ${r0(v.clarity.current)}/${fl(v.clarity.cap)} · Condition ${fl(v.condition)}/100`);
  const dep = s.deprivation;
  if (dep.hungry || dep.thirsty) lines.push(`DEPRIVATION: ${[dep.hungry ? `${dep.hungry} night(s) without food` : '', dep.thirsty ? `${dep.thirsty} night(s) without water` : ''].filter(Boolean).join(', ')} — another night without costs more Condition.`);
  lines.push(`EATING: ${s.eating ?? 'full'} rations${(s.cabinDays ?? 0) > 0 ? ` · ${s.cabinDays} day(s) cooped up${(s.cabinDays ?? 0) >= CABIN_FEVER_FROM ? ' — cabin fever' : ''}` : ''}`);
  lines.push(`STORES: food ${st.rawFood} · water ${st.water} · firewood ${st.firewood} · materials ${st.materials} · rations ${st.rations} · stone ${st.stone} · hides ${st.hides}`);
  const cold = coldLine(s);
  if (cold) lines.push(cold);
  if (s.config.world.carrying !== false) lines.push(loadLine(s));

  const t = s.config.thresholds;
  const ps = pillars(readinessInput(s), t);
  const pv: Record<string, string> = {
    larder: `${st.rations}/${t.larder} rations`, shelter: `${Math.floor(warmth(s) * 100)}%/${pct(t.warmth)} warmth`,
    fuel: `${st.firewood}/${t.fuel} firewood`, body: `vigor capacity ${fl(v.vigor.cap)}/${BASELINE}, clarity capacity ${fl(v.clarity.cap)}/${BASELINE}, condition ${fl(v.condition)}/${t.condition}`,
  };
  lines.push(`READINESS (a rough guide): ${winterReady(s) ? 'WINTER-READY' : 'not ready'} — ${ps.map(p => `${p.key} ${p.done ? 'OK' : 'needs'} (${pv[p.key]})`).join('; ')}`);
  const o = winterOutlook(s);
  const nights = (n: number): string => `${n} night${n === 1 ? '' : 's'}`;
  lines.push(`WINTER OUTLOOK: ${o.nightsToThaw} nights to the thaw · food ${nights(o.foodDays)} · water ${nights(o.waterDays)} · firewood ${nights(o.fuelDays)} (${o.fuelToThaw} needed to the thaw, tonight ${nightFuel(s)}) · shelter ${o.warmthMargin >= 0 ? 'warm enough' : `${Math.ceil(-o.warmthMargin * 100)}% short`} for a midwinter night`);

  lines.push(`CAMP: ${s.site ? `${SITES[s.site].name} (max ${pct(SITES[s.site].warmth)}), shelter tier ${s.tier}/2${s.shelterGrade ? ` ${s.shelterGrade}` : ''}${s.shelter.type ? ` ${s.shelter.type}` : ''}${s.shelter.walls ? ` + ${s.shelter.walls} walls` : ''}` : 'none yet'}. Sites: ${(Object.keys(SITES) as (keyof typeof SITES)[]).map(k => `${k} ${pct(SITES[k].warmth)}`).join(', ')}. First shelter stage costs ${BUILD_COST[0]} materials.`);
  lines.push(`TOOLS: ${s.tools.length ? s.tools.map(x => `${x.item} (${x.grade})`).join(', ') : 'none'} · sound cold gear: ${s.coldGear ? 'yes' : 'no'}`);
  const undiscovered = DISCOVERIES.filter(d => !s.known.includes(d.recipe)).map(d => `${d.name} (${d.concept})`);
  lines.push(`RECIPES KNOWN: ${s.known.join(', ')}${undiscovered.length ? ` · not yet: ${undiscovered.join(', ')}` : ''}`);
  const concepts = Object.entries(s.concepts).filter(([, p]) => p.rank > 0 || p.insight > 0).map(([id, p]) => `${id} rank ${p.rank}`);
  if (concepts.length) lines.push(`CONCEPTS: ${concepts.join(', ')}`);
  // Background (#1398): a scout, trained in first aid, camp chores, map and compass.
  if (s.character.background === 'scout') lines.push('BACKGROUND: a young scout, out on a weekend hike when this began — trained in first aid, camp chores, and map and compass; knows the cold (cold nights cost 25% less, blizzard exposure a step safer)');
  // The hike kit (#1400): what was packed, and what's left of what runs out.
  if (s.kit) {
    const left = kitSupplies(s.kit, s.dressings ?? 0);
    lines.push(`PACK (what you brought on the hike): ${s.kit.items.map(id => `${kitItem(id).name} — ${kitItem(id).effect}`).join('; ')}${left.length ? ` | LEFT: ${left.join(', ')}` : ''}`);
  }
  // Growing up (#1399): the age, and each stat now and grown.
  const { age, adult } = s.character;
  if (age !== undefined && adult) lines.push(`AGE: ${age}${isYoung(age) ? ` — still growing (skills learn ${YOUNG_PRACTICE}x as fast)` : ' — grown'} · STATS now (grown up): ${STAT_IDS.map(k => `${STATS[k].short} ${s.character.stats[k]}${adult[k] !== s.character.stats[k] ? ` (${adult[k]})` : ''}`).join(', ')}`);
  // Talents (#1263): only the ones the Warden knows about — never the hidden one, nor any tier.
  const knownTalents = s.character.talents.filter(t => t.known);
  const hiddenCount = s.character.talents.length - knownTalents.length;
  if (s.character.talents.length) lines.push(`TALENTS: ${knownTalents.map(t => `${TALENTS[t.id].name} (${TALENTS[t.id].blurb})`).join(' · ') || 'none known'}${hiddenCount ? ` · ${hiddenCount} hidden talent, not yet discovered` : ''}${s.character.lastStandUsed ? ' — last stand used' : ''}`);
  // Quirks (#1365): the ones you know, your fears and how far you've come facing them — never the hidden ones.
  const quirksLine = quirkLine(s);
  if (quirksLine) lines.push(quirksLine);
  // Tonight (#1365): if going to bed now would be a fearful night, and why.
  const tonight = tonightsFright(s);
  if (tonight && tonight.state !== 'calm') lines.push(`TONIGHT: looks ${THREAT_WORDS[tonight.perceived]} (${tonight.reasons.join(', ')}) — ${tonight.state === 'shaken' ? 'an uneasy night: less Clarity back' : 'a sleepless night: much less Clarity and some Vigor back'}. Shelter, a fire, a camp you know all help.`);
  // Pins (#1381): the places you remember, how much room is left, and what each does.
  lines.push(pinsLine(s));
  // Injuries (#1286): what still hurts, and for how long.
  if (s.injuries?.length) lines.push(`INJURIES: ${s.injuries.map(i => `${i.severity} ${INJURY_NAME[i.kind]} (${i.kind === 'sprain' ? `physical work and walking cost ${INJURY_COST[i.severity]}x Vigor` : i.kind === 'hand' ? `crafting takes ${INJURY_COST[i.severity]}x as long` : 'costs 1 Condition a night'}), ${Math.ceil(i.heal)} healing to go${i.treated ? `, treated (${i.treated})` : i.severity === 'serious' ? ' — untreated: heavy work could make it grave' : ', untreated'}`).join(' · ')}${s.dressings ? ` · first-aid dressings: ${s.dressings}` : ''}`);
  // Lasting harms (#1392): what grave injuries left.
  if (s.character.harms?.length) lines.push(`OLD WOUNDS: ${s.character.harms.map(h => `${HARM_NAME[h]} (${HARM_WORDS[h]})`).join(' · ')}`);
  const lock = survivalLockOf(s);
  lines.push(`FOCUS: ${focusKey(s.focus)}${lock ? ` — LOCKED TO SURVIVAL (${lock}): survival actions +1 yield and lighter, focused learning paused` : ''}${s.vitals.clarity.current < UNRELIABLE_BELOW ? ' — unreliable (Clarity under 30: effects halved)' : ''}`);
  // Self-assessed only: the AI, like the player, never sees its true skill (#1241).
  const practised = SKILL_IDS.filter(id => (s.skills[id] ?? 0) > 0);
  lines.push(`SKILLS (self-assessed — your true level may differ): ${practised.length ? practised.map(id => `${id} ${LEVELS[perceivedLevel(s.skills, id)]}`).join(', ') : 'none yet — every hour of work trains the skill it uses'}`);
  const known = s.techniques.map(id => techniqueById(id)?.name).filter(Boolean);
  lines.push(`TECHNIQUES: ${known.length ? known.join(', ') : 'none yet'}${s.manuals.length ? ` | MANUALS: ${s.manuals.map(id => manualById(id)?.name ?? id).join(', ')}` : ''}`);

  lines.push('');
  lines.push('THE LAND:');
  for (const r of RINGS) {
    const open = reachable(s.explore, r);
    // Supply (#1304): what the land still holds — trips draw it down, the season regrows it.
    const known = domainsOf(r).map(d => `${d} ${LEVEL_NAME[level(s.explore, r, d)]}${d === 'routes' ? '' : ` · ${supplyWord(s.explore.supply[r][d])}`}`).join(', ');
    const finds = domainsOf(r).filter(d => hasFind(s.explore, r, d)).map(d => FINDS[d]?.name).join(', ');
    lines.push(`- ring ${r} ${RING_NAME[r].toLowerCase()} (+${TRAVEL_HOURS[r]}h travel)${open ? '' : ' [not reachable yet]'}: ${known}${finds ? ` · finds: ${finds}` : ''}`);
  }

  lines.push('');
  lines.push('ACTIONS (id · hours · effect · BLOCKED reason if it would be skipped now):');
  for (const id of Object.keys(ACTIONS) as ActionId[]) {
    const def = ACTIONS[id];
    const rings: Ring[] = def.ringed ? RINGS.filter(r => reachable(s.explore, r)) : [1];
    for (const r of rings) {
      const why = blockedReason(s, id, r);
      const ringTag = def.ringed ? ` ring ${r}` : '';
      const hint = def.ringed ? landHint(s, id, r) : (CAMP_HINT[id] ?? '');
      const odds = tripOdds(s, id, r);
      const danger = why ? null : dangerOf(s, id, r);
      // What the trip would bring home and how heavy it is (#1297) — as the queue preview shows a person.
      const load = why ? null : tripLoad(s, queueId(id, r));
      // How it would feel out there now (#1365): shaken or panicked, and why — as the queue preview shows a person.
      const u = why ? null : tripUnease(s, queueId(id, r));
      const unease = u && u.state !== 'calm' ? ` · UNEASE: ${u.reasons.filter(x => x !== 'ground you know').join(', ')} — ${u.state === 'shaken' ? "you'll be shaken" : 'you may panic'}` : '';
      // What a place you remember does for this trip (#1381), as the queue preview shows a person.
      const pin = def.ringed ? tripPinNote(s.pins, id, r) : null;
      lines.push(`- ${id}${ringTag} · ${queueHours(queueId(id, r), s)}h · ${hint}${odds ? ` · ${odds} odds now` : ''}${why ? ` · BLOCKED: ${why}` : ''}${danger ? ` · DANGER: ${danger}` : ''}${load ? ` · ${loadWords(load)}` : ''}${unease}${pin ? ` · ${pin}` : ''}`);
    }
    const groups = def.options?.(s, {}) ?? [];
    for (const g of groups) {
      lines.push(`    options "${g.key}": ${g.choices.map(c => `${c.value} (${c.label}: ${c.blocked ?? c.note})`).join(' | ')}`);
    }
  }

  lines.push('');
  const done = REGION1_MILESTONES.filter(m => s.milestones.includes(m.id)).map(m => m.name);
  lines.push(`MILESTONES: ${done.length}/${REGION1_MILESTONES.length}${done.length ? ` (${done.join(', ')})` : ''}`);

  const yesterday = s.log.filter(l => l.day === s.day - 1 || l.day === s.day);
  if (yesterday.length) {
    lines.push('');
    lines.push('JOURNAL (latest):');
    for (const l of yesterday.slice(-14)) lines.push(`- D${l.day} ${l.text}`);
  }
  return lines.join('\n');
}

// ── The road (#1251) ────────────────────────────────────────────────────────

/**
 * The road's rules, sent once as the first road message (the Region 1 rules stay the
 * system prompt, so the cached prefix is untouched). Static, like RULES.
 */
export const ROAD_RULES = `THE CARAVAN ROAD — you survived the winter. The spring caravan carries you to Mistheim: travel days on the wagon, and stays of a few days in three villages (Hollowford, Saltmere, Kestrel Gate). The caravan keeps its own schedule — it moves on whether you're ready or not.

Each day: choose road actions in order; they run until the day's 16 hours are spent, then you sleep. On the wagon the caravan waters you; in a village you drink your own water. Food comes from your stores every night as before. Nights on the road are never cold.

PEOPLE: each villager has a role and a trust in you (0–100). Talking (${TALK_HOURS}h) raises trust and, as trust allows, they share what they know. Trust 50+ makes someone a contact who remembers you next time.
TRADE: one currency, marks. Each village has a trader. "sell:<item>" sells one (a tool, or a store good); "sell:<item>:<n>" sells n of a good; "sell:<tool>:<grade>" picks which copy. "buy:<good>:<n>" buys n. Grade sets the price; a trader pays half again for what they want; trust 50+ gets a friend's rate. ${TRADE_HOURS}h each.
QUESTS: people who trust you (15+) ask for help. "accept:<quest>" (no time) then "complete:<quest>" once you can: bring goods, hand over a well-made item, repair (needs a concept rank), scout, or deliver to the next village (completes on arrival). A quest pays marks and a lot of trust; one left open when the caravan leaves is lost, and trust with it.
TEACHERS: "learn:<teacher>:<technique|recipe|concept>" (${LESSON_HOURS}h, a fee in marks — free for a friend, trust 40+); a technique too far beyond your true skill is refused. "appraise:<teacher>" (${APPRAISE_HOURS}h, once per village) tells you your true level in their skill. While a teacher of a skill is in the village, practice in it counts in full.
HANDS AND MIND (anywhere on the road): "craft:<recipe>" makes a known recipe from your stores (${WAGON_CRAFT_HOURS}h, no building), "study:<concept>" studies as in the Reach, "tend" mends worn gear. ON THE WAGON: talk to your fellow travellers (the tinker and herbwife teach a little of their craft as they talk), and "help" drive and pitch camp (${HELP_HOURS}h, hard work, the cook gives you an extra portion). Gathering, felling, building and scouting are not possible from the wagon.
ALSO: "rest" (a few hours' rest), "wait" (let the day pass).

Reply with ONLY a JSON object: {"thoughts": "<one or two sentences>", "actions": ["<action id>", ...]}. An action the sim can't do is skipped and the journal says why.`;

const questNeeds = (q: QuestTemplate): string => {
  const n = q.needs;
  switch (n.kind) {
    case 'fetch': return `bring ${n.qty} ${n.item}`;
    case 'craft': return `hand over a ${n.grade} or better ${n.item}`;
    case 'repair': return `repair: ${n.concept} rank ${n.rank}, ${n.hours}h`;
    case 'scout': return `scout: ${n.hours}h out + ${n.walk}h walking${n.minScouting ? `, scouting ${n.minScouting}+` : ''}`;
    case 'deliver': return `carry ${n.qty} ${n.item} (handed to you) to ${personById(n.recipient)?.name ?? n.recipient} in ${n.to}`;
  }
};
const questReward = (q: QuestTemplate): string =>
  [`${q.reward.marks} marks`, q.reward.item && `${q.reward.item.qty} ${q.reward.item.item}`, q.reward.recipe && `the ${q.reward.recipe} recipe`].filter(Boolean).join(', ');

/** What an option asks of you, in a few words: its hours and the goods it uses. */
function optionCost(o: EncounterOption): string {
  const parts = Object.entries(o.cost?.stores ?? {}).map(([k, n]) => `${n} ${k === 'rawFood' ? 'food' : k}`);
  if (o.cost?.marks) parts.push(`${o.cost.marks} marks`);
  if (o.cost?.hours) parts.push(`${o.cost.hours}h`);
  return parts.join(', ');
}

/**
 * Render a pending encounter (#1348): where and when, what you see, how you stand, and each
 * option with its cost, then its odds in words — or what it needs, when you can't take it.
 * Empty when nothing is waiting.
 */
export function observeEncounter(s: Region1State, notes: readonly string[] = []): string {
  const p = s.pending;
  const t = p ? encounterById(p.id) : undefined;
  if (!p || !t) return '';
  const v = s.vitals, st = s.stores;
  const lines = [
    // On the caravan road (#1349) there are no rings, and marks are part of what you have.
    p.action === 'road'
      ? `ENCOUNTER — road day ${p.day}, on the caravan road. The day waits until you choose.`
      : `ENCOUNTER — day ${p.day}, ${String(Math.floor(p.hour) % 24).padStart(2, '0')}:00, ring ${p.ring} ${RING_NAME[p.ring].toLowerCase()}, while out to ${ACTIONS[p.action as ActionId]?.name.toLowerCase() ?? p.action}. The day is paused until you choose.`,
    ...notes.map(n => `NOTE: ${n}`),
    stepOf(t, p.step).text,
    // Your read and how you stand (#1365): how dangerous it looks to you — not what it is.
    `YOUR READ: it looks ${THREAT_WORDS[p.perceived ?? t.threat]}. ${STATE_WORDS[p.state ?? 'calm']}`,
    `VITALS: Vigor ${r0(v.vigor.current)}/${fl(v.vigor.cap)} · Clarity ${r0(v.clarity.current)}/${fl(v.clarity.cap)} · Condition ${fl(v.condition)}/100 · hours used today ${s.hoursToday}/${DAY_HOURS}`,
    ...(quirkLine(s) ? [quirkLine(s)!] : []),
    `STORES: food ${st.rawFood} · water ${st.water} · firewood ${st.firewood} · materials ${st.materials} · rations ${st.rations} · hides ${st.hides}${p.action === 'road' ? ` · marks ${s.marks ?? 0}` : ''}`,
    'OPTIONS (id: what you do — cost — odds):',
    ...optionsFor(s, t).map(({ option, unmet, odds }) => {
      const cost = optionCost(option);
      const harder = option.careful && p.state === 'shaken' && !unmet ? ' (harder: you are shaken)' : '';
      return `- ${option.id}: ${option.label}${cost ? ` — costs ${cost}` : ''} — ${unmet ? `NOT AVAILABLE (${unmet})` : odds}${harder}`;
    }),
    'Reply with ONLY {"thoughts": "<one sentence>", "choice": "<option id>"}.',
  ];
  return lines.join('\n');
}

/**
 * Meeting the caravan (#1357), shown like an encounter: who is speaking, the conversation so far,
 * and the answers you can give — each with its cost, what it needs, and its odds in words.
 */
export function observeMeeting(reach: Region1State, m: Meeting, notes: readonly string[] = []): string {
  const step = meetingStep(m);
  const who = (id: string | null) => (id ? TRAVELLERS.find(t => t.id === id)?.name ?? id : 'You');
  const st = reach.stores;
  const lines = [
    `THE CARAVAN — the thaw, day ${reach.day}. Before you climb aboard, ${who(step.speaker)} has questions.`,
    ...notes.map(n => `NOTE: ${n}`),
    ...m.lines.slice(-6).map(l => `${who(l.speaker)}: ${l.text}`),
    `STORES: food ${st.rawFood} · water ${st.water} · rations ${st.rations} · hides ${st.hides} · marks ${reach.marks ?? 0}`,
    'OPTIONS (id: what you do — cost — odds):',
    ...meetingOptions(reach, m).map(({ option, unmet, odds }) => {
      const cost = [...Object.entries(option.cost?.stores ?? {}).map(([k, n]) => `${n} ${k === 'rawFood' ? 'food' : k}`), ...(option.cost?.marks ? [`${option.cost.marks} marks`] : [])].join(', ');
      const away = option.success.next === 'stay' ? ' (you stay behind: no road)' : '';
      return `- ${option.id}: ${option.label}${cost ? ` — costs ${cost}` : ''} — ${unmet ? `NOT AVAILABLE (${unmet})` : odds}${away}`;
    }),
    'Reply with ONLY {"thoughts": "<one sentence>", "choice": "<option id>"}.',
  ];
  return lines.join('\n');
}

/** The places you remember, in a line (#1381): memory used of capacity, then each pin and what it does. */
export function pinsLine(s: Region1State): string {
  const pins = s.pins ?? [];
  const room = pinCapacity(s), top = maxInterest(s.skills);
  const full = pins.length >= room ? ` — FULL (to remember another, forget one first; least interesting and oldest: ${letGoFirst(pins)!.id})` : '';
  const each = pins.map(p => `${p.id} = ${placeName(p)}, ring ${p.ring}${p.feeling ? `, ${p.feeling}` : ''}${p.interest ? `, ${p.interest} star${p.interest > 1 ? 's' : ''}` : ''}: ${pinEffect(p)}`);
  return `PINS (memory ${pins.length}/${room}${top ? `, interest up to ${top} stars` : ', interest not yet'})${full}: ${each.length ? each.join(' · ') : 'none — places worth remembering turn up out on the land'}`;
}

/** Known quirks and fears, in a line (#1365); null when there's nothing known to tell. */
function quirkLine(s: Region1State): string | null {
  const qs = s.character.quirks ?? [];
  const known = qs.filter(q => q.known && !isFear(q.id)).map(q => `${quirkName(q.id)} (${QUIRKS[q.id]?.blurb ?? ''})`);
  const fears = qs.filter(q => isFear(q.id)).map(q => `${quirkName(q.id)} (makes it look worse; faced calmly ${q.faced ?? 0} of ${q.id === 'fear:dark' ? DARK_FADES : FEAR_FADES} times)`);
  const hidden = qs.filter(q => !q.known).length;
  if (!known.length && !fears.length && !hidden) return null;
  return `QUIRKS: ${[...known, ...fears].join(' · ') || 'none known'}${hidden ? ` · ${hidden} not yet known (how you react when it's too much)` : ''}`;
}

/** Render a road day's observation (#1251). `notes` carries harness feedback, as in Region 1. */
export function observeRoad(r: RoadState, notes: readonly string[] = []): string {
  const lines: string[] = [];
  const leg = legOf(r);
  const left = daysLeftOnLeg(r);
  const village = villageOf(r);
  const next = ROUTE.slice(r.leg + 1).find(l => l.kind === 'village');
  lines.push(`ROAD DAY ${r.day} of ${ROAD_DAYS} — ${leg.kind === 'village' ? `in ${leg.name}; the caravan leaves ${left === 1 ? 'tomorrow at dawn' : `in ${left} days`}` : `on the wagon to ${leg.to} (${left} day${left === 1 ? '' : 's'})`}${next && leg.kind === 'village' ? `; next: ${next.kind === 'village' ? next.name : ''}` : ''}.`);
  lines.push(`Hours used today: ${r.hoursToday}/${DAY_HOURS}.`);
  for (const n of notes) lines.push(`NOTE: ${n}`);
  lines.push('');
  const v = r.vitals, st = r.stores;
  lines.push(`VITALS: Vigor ${r0(v.vigor.current)}/${fl(v.vigor.cap)} · Clarity ${r0(v.clarity.current)}/${fl(v.clarity.cap)} · Condition ${fl(v.condition)}/100`);
  lines.push(`STORES: food ${st.rawFood} · water ${st.water} · firewood ${st.firewood} · materials ${st.materials} · rations ${st.rations} · stone ${st.stone} · hides ${st.hides}`);
  lines.push(`MARKS: ${r.marks}`);
  lines.push(`TOOLS: ${r.tools.length ? r.tools.map(x => `${x.item} (${x.grade})`).join(', ') : 'none'}`);
  const concepts = Object.entries(r.concepts).filter(([, p]) => p.rank > 0).map(([id, p]) => `${id} rank ${p.rank}`);
  lines.push(`CONCEPTS: ${concepts.length ? concepts.join(', ') : 'none ranked'} · TECHNIQUES: ${r.techniques.map(id => techniqueById(id)?.name ?? id).join(', ') || 'none'}`);
  const practised = SKILL_IDS.filter(id => (r.skills[id] ?? 0) > 0);
  lines.push(`SKILLS (self-assessed): ${practised.length ? practised.map(id => `${id} ${LEVELS[perceivedLevel(r.skills, id)]}`).join(', ') : 'none'}`);

  const active = Object.entries(r.quests).filter(([, st]) => st === 'active').map(([id]) => questById(id)!).filter(Boolean);
  if (active.length) {
    lines.push('');
    lines.push('YOUR QUESTS:');
    for (const q of active) {
      const why = canComplete(q, r);
      lines.push(`- ${q.id} "${q.title}" for ${personById(q.giver)?.name} — ${questNeeds(q)} · ${q.needs.kind === 'deliver' ? 'completes on arrival' : q.village !== village ? `back in ${q.village}` : why ? `not yet: ${why}` : 'ready to complete'}`);
    }
  }

  if (!village) {
    lines.push('');
    lines.push('ON THE WAGON WITH YOU (id · role · trust) — talk to pass the road; trade, quests and lessons wait for the next village:');
    for (const p of peopleHere(r)) lines.push(`- ${p.id} · ${p.name}, ${p.role} · trust ${Math.round(r.trust[p.id] ?? 0)} · ${(r.told[p.id] ?? 0) < p.lore.length ? 'has more to tell' : 'has told you all they know'}${p.concept ? ` · knows ${p.concept}` : ''}`);
  }
  const crafts = r.known.filter(id => ROAD_CRAFTS[id]);
  lines.push(`YOU CAN CRAFT ON THE ROAD: ${crafts.join(', ') || 'nothing you know'} (recipes cost stores as in the Reach)`);
  if (village) {
    lines.push('');
    lines.push('PEOPLE HERE (id · role · trust · what they have for you):');
    for (const p of peopleOf(village)) {
      const told = r.told[p.id] ?? 0;
      const more = told < p.lore.length ? 'has more to tell' : 'has told you all they know';
      const quest = questsHere(r).find(q => q.giver === p.id);
      const extras = [more, p.teaches && `teaches ${p.teaches.skill}`, quest && `offers quest ${quest.id}`].filter(Boolean).join(' · ');
      lines.push(`- ${p.id} · ${p.name}, ${p.role} · trust ${Math.round(r.trust[p.id] ?? 0)} · ${extras}`);
    }
    const offered = questsHere(r);
    if (offered.length) {
      lines.push('');
      lines.push('QUESTS ON OFFER:');
      for (const q of offered) lines.push(`- ${q.id} "${q.title}" from ${personById(q.giver)?.name} — ${questNeeds(q)} · reward ${questReward(q)}`);
    }
    const t = tradeTerms(r);
    if (t) {
      lines.push('');
      lines.push(`TRADER: ${t.trader} (${t.name}) wants ${t.wants.join(' and ')} goods (pays ×1.5) · trust ${Math.round(t.trust)}${t.trust >= 50 ? ' (friend’s rate)' : ''}`);
      lines.push(`  sells (marks each): ${t.sells.map(g => `${g} ${buyPrice(g as never, 1, t)}`).join(' · ')}`);
      const goods = Object.entries(r.stores).filter(([k, n]) => n > 0 && isGood(k)).map(([k]) => `${k} ${sellPrice(k, 'sound', 1, t)}`);
      const tools = r.tools.filter(x => KIND_OF[x.item]).map(x => `${x.item} (${x.grade}) ${sellPrice(x.item, x.grade, 1, t)}`);
      lines.push(`  would pay you: ${[...goods, ...tools].join(' · ') || 'nothing — you have nothing to sell'}`);
    } else lines.push('No one here is trading.');
    for (const p of peopleOf(village).filter(x => x.teaches)) {
      const tt = p.teaches!;
      const fee = lessonFee(r, p.id);
      const techs = tt.techniques.map(id => `${id}${r.techniques.includes(id) ? ' (known)' : ''}`).join(', ');
      lines.push(`TEACHER ${p.id} (${p.name}, ${tt.skill}) — lesson ${fee ? `${fee} marks` : 'free (friend)'}: techniques ${techs}${tt.recipes.length ? ` · recipes ${tt.recipes.map(x => `${x}${r.known.includes(x) ? ' (known)' : ''}`).join(', ')}` : ''}${tt.concept ? ` · concept ${tt.concept}` : ''}${r.appraised.includes(p.id) ? ' · has appraised you this stay' : ''}`);
    }
  }

  const recent = r.log.filter(l => l.day >= r.day - 1);
  if (recent.length) {
    lines.push('');
    lines.push('JOURNAL (latest):');
    for (const l of recent.slice(-14)) lines.push(`- D${l.day} ${l.text}`);
  }
  return lines.join('\n');
}
