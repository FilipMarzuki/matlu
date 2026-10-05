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
  ACTIONS, SITES, DAY_HOURS, REGION1_MILESTONES, DISCOVERIES, BUILD_COST,
  readinessInput, warmth, winterReady, routeKnown, queueHours, queueId,
  type ActionId, type Region1State,
} from '../artificer/region1';
import { pillars } from '../artificer/readiness';
import { availableChoices, crossingPrepared, phaseOf, resolveOutcome, CROSSING_NEEDS } from '../artificer/winter';
import { RINGS, RING_NAME, TRAVEL_HOURS, LEVEL_NAME, FINDS, domainsOf, level, reachable, tripYield, hasFind, type Domain, type Ring } from '../artificer/exploration';

/**
 * The rules and the response contract. Static on purpose: it goes in the
 * system prompt and is cached, so never interpolate anything per-run here.
 */
export const RULES = `You are playing "Greywind Reach", the first region of the Artificer: a survival-crafting game played one day at a time.

GOAL
You arrive alone with almost nothing and winter is coming. Get winter-ready before the snow:
- Larder: 10+ rations (preserved food — not today's meals).
- Shelter: warmth 60%+ (site potential x how far the build has come x build quality).
- Fuel: 12+ firewood.
- Body & mind: Vigor and Clarity capacity at 100+ and Condition 70+.
A caravan camps nearby on days 10-12; winter arrives on day 13. From day 10 you may take an exit:
- caravan (days 10-12 only): leave with traders. Winter-ready = thrive; otherwise ragged.
- solo: cross the winter road alone. Needs road-worthy cold gear, 6+ rations, Condition 60+, Vigor capacity 95+, AND the pass seen in the distant ring. Unprepared = turned back with permanent frostbite.
- winter: stay. Winter-ready = wintered well; otherwise a grim winter.
Best outcomes: thrive (caravan while winter-ready), then crossed or wintered.

HOW A DAY WORKS
You plan the day as a queue of actions. Each costs hours and drains Vigor (body) and/or Clarity (mind). A day has 14 waking hours; an action starts only if hours remain, so the last one may run past 14. Unrun actions are dropped — plan one day at a time. At night you eat 1 food and drink 1 water (going without costs Condition and recovery), then sleep; a warmer shelter recovers more. Pushing a pool past empty costs Condition. Condition heals slowly (a few points a night) only on nights you ate and drank, slept in shelter 50%+ warm, and never pushed past empty; a light, restful day doubles it.

THE LAND
Three rings around camp: near (home), far (+3h travel), distant (+6h travel). Outer rings are richer (x1.5, x2). A ring is reachable once the ring inside it is scouted.
Each ring has domains (forage, timber, stone, water, game; routes beyond home) known at a level: unknown, suspected, observed, detailed.
- scout: everything in that ring at least suspected. survey: at least observed (richer trips). track: game observed (you can hunt deer there).
- lookout: that ring +1 level (up to observed) and the next ring comes into view, routes included — from the far ring this reveals the pass.
- Working a domain (gather, wood, quarry, water, hunt) teaches it toward detailed, which yields a find (+2 on those trips). Foraging unknown ground yields half but explores it.
- Every trip depletes that ring's domain a little, so the near ring runs thin; push outward.

CRAFTING
Crafts (build, coldGear, knife, snare, waterskin, bedroll, shovel) are graded crude / sound / fine / masterwork by how clear your head is (Clarity), your bench (a roofed shelter is a tier-1 bench) and your tools. Crafting while foggy can fail and waste materials. Many recipes must first be discovered (by observation, finds, or the study action). Crude cold gear won't do for the solo crossing; a hide parka holds even when crude.

RESPONDING
Each turn you get an observation. Reply with ONLY a JSON object, no prose, matching:
{
  "thoughts": string (one or two sentences: your plan for today),
  "site": "cave" | "tree" | "river" | "hill" | null (settle or move camp before the day; null = no change),
  "exit": "caravan" | "solo" | "winter" | null (take an exit now instead of playing the day; only when listed as open),
  "queue": [ { "action": string, "ring": 1 | 2 | 3, "options": [ { "key": string, "value": string } ] } ]
}
Use action ids exactly as listed. "ring" matters only for land actions (use 1 otherwise). "options" lets you pick choices shown for an action (e.g. {"key":"target","value":"small"} for hunt); use [] for defaults. Moving camp (site) after building abandons the shelter.`;

const pct = (x: number): string => `${Math.round(x * 100)}%`;
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
  coldGear: 'cold gear for the solo crossing',
  knife: 'hunt -15% vigor, quicker preserving',
  snare: '+1 food every night',
  waterskin: '+1 water per trip',
  bedroll: '+6 clarity overnight',
  shovel: 'build -20% vigor',
  study: 'a third of your clarity -> concept insight (rank 1 reveals recipes)',
  tinker: 'rests body, spends mind',
  rest: 'recovers a little',
};

/** Render the full per-day observation. `notes` carries harness feedback (dropped entries, a closed exit…). */
export function observe(s: Region1State, notes: readonly string[] = []): string {
  const cal = s.config.calendar;
  const ph = phaseOf(s.day, cal);
  const exits = availableChoices(s.day, cal);
  const v = s.vitals;
  const st = s.stores;
  const lines: string[] = [];

  lines.push(`DAY ${s.day} — ${ph === 'prep' ? `autumn, caravan arrives day ${cal.caravanOpen}` : ph === 'caravan' ? `caravan here until day ${cal.caravanClose}` : ph === 'postCaravan' ? 'caravan gone' : 'winter'}. Winter day ${cal.winterDay}.`);
  lines.push(`Hours used today: ${s.hoursToday}/${DAY_HOURS}.`);
  for (const n of notes) lines.push(`NOTE: ${n}`);
  lines.push('');
  lines.push(`VITALS: Vigor ${r0(v.vigor.current)}/${r0(v.vigor.cap)} · Clarity ${r0(v.clarity.current)}/${r0(v.clarity.cap)} · Condition ${r0(v.condition)}/100`);
  lines.push(`STORES: food ${st.rawFood} · water ${st.water} · firewood ${st.firewood} · materials ${st.materials} · rations ${st.rations} · stone ${st.stone} · hides ${st.hides}`);

  const t = s.config.thresholds;
  const ps = pillars(readinessInput(s), t);
  const pv: Record<string, string> = {
    larder: `${st.rations}/${t.larder} rations`, shelter: `${pct(warmth(s))}/${pct(t.warmth)} warmth`,
    fuel: `${st.firewood}/${t.fuel} firewood`, body: `capacity ${r0(v.vigor.cap)}/${r0(v.clarity.cap)}, condition ${r0(v.condition)}/${t.condition}`,
  };
  lines.push(`READINESS: ${winterReady(s) ? 'WINTER-READY' : 'not ready'} — ${ps.map(p => `${p.key} ${p.done ? 'OK' : 'needs'} (${pv[p.key]})`).join('; ')}`);

  lines.push(`CAMP: ${s.site ? `${SITES[s.site].name} (max ${pct(SITES[s.site].warmth)}), shelter tier ${s.tier}/2${s.shelterGrade ? ` ${s.shelterGrade}` : ''}${s.shelter.type ? ` ${s.shelter.type}` : ''}${s.shelter.walls ? ` + ${s.shelter.walls} walls` : ''}` : 'none yet'}. Sites: ${(Object.keys(SITES) as (keyof typeof SITES)[]).map(k => `${k} ${pct(SITES[k].warmth)}`).join(', ')}. First shelter stage costs ${BUILD_COST[0]} materials.`);
  lines.push(`TOOLS: ${s.tools.length ? s.tools.map(x => `${x.item} (${x.grade})`).join(', ') : 'none'} · cold gear road-worthy: ${s.coldGear ? 'yes' : 'no'} · pass seen: ${routeKnown(s) ? 'yes' : 'no'}`);
  const undiscovered = DISCOVERIES.filter(d => !s.known.includes(d.recipe)).map(d => `${d.name} (${d.concept})`);
  lines.push(`RECIPES KNOWN: ${s.known.join(', ')}${undiscovered.length ? ` · not yet: ${undiscovered.join(', ')}` : ''}`);
  const concepts = Object.entries(s.concepts).filter(([, p]) => p.rank > 0 || p.insight > 0).map(([id, p]) => `${id} rank ${p.rank}`);
  if (concepts.length) lines.push(`CONCEPTS: ${concepts.join(', ')}`);

  lines.push('');
  lines.push('THE LAND:');
  for (const r of RINGS) {
    const open = reachable(s.explore, r);
    const known = domainsOf(r).map(d => `${d} ${LEVEL_NAME[level(s.explore, r, d)]}${s.explore.worked[r][d] ? ` (worked ${s.explore.worked[r][d]}x)` : ''}`).join(', ');
    const finds = domainsOf(r).filter(d => hasFind(s.explore, r, d)).map(d => FINDS[d]?.name).join(', ');
    lines.push(`- ring ${r} ${RING_NAME[r].toLowerCase()} (+${TRAVEL_HOURS[r]}h travel)${open ? '' : ' [not reachable yet]'}: ${known}${finds ? ` · finds: ${finds}` : ''}`);
  }

  lines.push('');
  lines.push('ACTIONS (id · hours · effect · BLOCKED reason if it would be skipped now):');
  for (const id of Object.keys(ACTIONS) as ActionId[]) {
    const def = ACTIONS[id];
    const rings: Ring[] = def.ringed ? RINGS.filter(r => reachable(s.explore, r)) : [1];
    for (const r of rings) {
      const why = def.gate?.(s, r, {}) ?? null;
      const ringTag = def.ringed ? ` ring ${r}` : '';
      const hint = def.ringed ? landHint(s, id, r) : (CAMP_HINT[id] ?? '');
      lines.push(`- ${id}${ringTag} · ${queueHours(queueId(id, r), s)}h · ${hint}${why ? ` · BLOCKED: ${why}` : ''}`);
    }
    const groups = def.options?.(s, {}) ?? [];
    for (const g of groups) {
      lines.push(`    options "${g.key}": ${g.choices.map(c => `${c.value} (${c.label}: ${c.blocked ?? c.note})`).join(' | ')}`);
    }
  }

  lines.push('');
  if (exits.length) {
    const canCross = routeKnown(s) && crossingPrepared({ coldGear: s.coldGear, rations: st.rations, vitals: v });
    // Spell out what each exit would give today: models misread "caravan = thrive" as unconditional.
    const ifTaken = exits.map(c => `${c} → ${resolveOutcome(c, { ready: winterReady(s), canCross, vitals: v }).kind}`).join(', ');
    lines.push(`EXITS OPEN: ${exits.join(', ')}. If taken today: ${ifTaken}. Solo crossing prepared: ${canCross ? 'yes' : `no (needs road-worthy cold gear, ${CROSSING_NEEDS.rations}+ rations, condition ${CROSSING_NEEDS.condition}+, vigor capacity ${CROSSING_NEEDS.vigorCap}+, pass seen)`}.`);
  } else {
    lines.push('EXITS: none yet (from day 10).');
  }

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
