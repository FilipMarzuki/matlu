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

import {
  ACTIONS, blockedReason, SITES, DAY_HOURS, REGION1_MILESTONES, DISCOVERIES, BUILD_COST,
  readinessInput, warmth, winterReady, winterOutlook, nightFuel, tripOdds, dangerOf, FISH_CATCH, CABIN_FEVER_FROM, queueHours, queueId, survivalLockOf,
  tripLoad, coldCapacity, spoilage, type ActionId, type Region1State, type TripLoad,
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

RESPONDING
Each turn you get an observation. Reply with ONLY a JSON object, no prose, matching:
{
  "thoughts": string (one or two sentences: your plan for today),
  "site": "cave" | "tree" | "river" | "hill" | null (settle or move camp before the day; null = no change),
  "focus": "concept:<name>" | "goal:shelter|larder|explore" | "skill:<name>" | "none" | null (what your mind works on; null = keep),
  "eating": "full" | "half" | "none" | null (how you eat from tonight; null = keep),
  "queue": [ { "action": string, "ring": 1 | 2 | 3, "options": [ { "key": string, "value": string } ] } ]
}
Use action ids exactly as listed. "ring" matters only for land actions (use 1 otherwise). "options" lets you pick choices shown for an action (e.g. {"key":"target","value":"small"} for hunt); use [] for defaults. Moving camp (site) after building abandons the shelter.`;

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
  // Talents (#1263): only the ones the Warden knows about — never the hidden one, nor any tier.
  const knownTalents = s.character.talents.filter(t => t.known);
  const hiddenCount = s.character.talents.length - knownTalents.length;
  if (s.character.talents.length) lines.push(`TALENTS: ${knownTalents.map(t => `${TALENTS[t.id].name} (${TALENTS[t.id].blurb})`).join(' · ') || 'none known'}${hiddenCount ? ` · ${hiddenCount} hidden talent, not yet discovered` : ''}${s.character.lastStandUsed ? ' — last stand used' : ''}`);
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
      lines.push(`- ${id}${ringTag} · ${queueHours(queueId(id, r), s)}h · ${hint}${odds ? ` · ${odds} odds now` : ''}${why ? ` · BLOCKED: ${why}` : ''}${danger ? ` · DANGER: ${danger}` : ''}${load ? ` · ${loadWords(load)}` : ''}`);
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
