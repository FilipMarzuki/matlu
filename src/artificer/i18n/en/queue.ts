/**
 * English for the queue's warnings and the status chips' tooltips (#1709, phase 3 of #1685, the
 * part phase 2 left over): a session's plan, a blizzard's danger, work that strains an injury, how
 * uneasy a trip or a night will be, what a remembered place does for a trip, and the pain, night
 * and injury chips. Also the encounter screen's and the caravan meeting's own words (encounters'
 * texts are in ./encounters.ts).
 *
 * A session's plan (region1.ts sessionNote) and a danger (dangerOf) arrive as finished English, so
 * they're templates (`log.plan.*`, `reason.danger.*`) the page reads back like the journal's.
 */

import { PATCHES } from '../../action-length';
import { THREAT_WORDS, STATE_WORDS } from '../../panic';

type DerivedKey = `w.${string}` | `threat.${number}` | `say.${string}`;

const derived = Object.fromEntries([
  ...Object.entries(PATCHES).filter(([, d]) => d.perHour > 0).flatMap(([p, d]) => [[`w.patch.${p}.thin`, `the ${d.name} is getting thin`], [`w.patch.${p}.stripped`, `the ${d.name} is stripped`]]),
  ...Object.entries(THREAT_WORDS).map(([n, w]) => [`threat.${n}`, w]),
  ...Object.entries(STATE_WORDS).map(([s, w]) => [`say.state.${s}`, w]),
]) as Record<DerivedKey, string>;

export const queue = {
  ...derived,

  // ── A session's plan (#1668): its trips, the haul, what's thinning ─────────
  'log.plan.one': '{n} trip{rest}',
  'log.plan.other': '{n} trips{rest}',
  'log.plan.about': ', about {amounts}{rest}',
  'log.plan.little': ', little to show for it{rest}',
  'log.plan.thin': ', {w}{rest}',
  // ── A blizzard (#1315), for a Warden sharp enough to see it ────────────────
  'reason.danger.far': 'a blizzard, and a long way out — you may not come back',
  'reason.danger.near': 'a blizzard — out in this you could freeze, or never come back',
  // ── Work that could make an injury worse (#1395) ───────────────────────────
  'log.risk': '🩹 could make your {w} worse',
  'queue.strainTip': 'A serious, untreated injury: heavy work (or crafting, for a hand) has a 15% chance to make it grave. Treat it first.',
  // ── How it will feel out there (#1364) ─────────────────────────────────────
  'queue.uneasy': "you'll be uneasy",
  'queue.mayPanic': 'you may panic',
  'queue.uneaseTip': 'The work wears the mind harder',
  'queue.uneaseTipPanic': 'The work wears the mind harder, and something out there could send you running',
  'w.unease.dark': 'dark',
  'w.unease.dusk': 'dusk',
  'w.unease.blizzard': 'blizzard',
  'w.unease.fog': 'fog',
  'w.unease.storm': 'storm',
  'w.unease.distant': 'the distant ring',
  'w.unease.wolves': 'wolves about',
  'w.unease.known': 'ground you know',
  'w.unease.noShelter': 'no shelter',
  'w.unease.noFire': 'no fire',
  'w.unease.warm': 'a warm shelter, the fire in',
  'w.unease.home': 'home',
  // ── What a remembered place does for a trip (#1380) ────────────────────────
  'queue.pin.yield': '{place}: +{n} {what}',
  'queue.pin.calmer': '{place}: calmer',
  'queue.pin.uneasy': '{place}: uneasy',
  'queue.pin.fish': 'fish',
  // ── The status chips' tooltips ─────────────────────────────────────────────
  'chip.painSharp': 'Work drains your mind {x}x; tonight costs {n} Clarity. Working through a bad injury makes it sharper.',
  'chip.painSharpSlow': 'Work drains your mind {x}x and takes {h}x as long; tonight costs {n} Clarity. Working through a bad injury makes it sharper.',
  'chip.painAche': 'An ache. Working through a bad injury would make it sharper.',
  'chip.nightTip': 'Tonight looks {threat}: {why}. {what} Shelter, a fire, a camp you know — each helps.',
  'chip.nightUneasy': "You'll lie awake: less Clarity back.",
  'chip.nightSleepless': 'A sleepless night: much less Clarity and some Vigor back.',
  'chip.injNights.one': '~{n} NIGHT',
  'chip.injNights.other': '~{n} NIGHTS',
  'chip.injUnsure': " You can't tell how bad it is — the pain is your guide.",
  // An injury as you understand it (injuries.ts injuryWords), in its parts.
  'inj.sev.minor': 'minor',
  'inj.sev.serious': 'serious',
  'inj.sev.grave': 'grave',
  'inj.bad.light': 'light',
  'inj.bad.bad': 'bad',
  'inj.felt.sprain': 'walking and heavy work are harder',
  'inj.felt.hand': 'crafting is slower',
  'inj.felt.cut': 'it bleeds a little each night',
  'inj.cost.cut': 'costs 1 Condition a night',
  'inj.cost.sprain': 'physical work and walking cost {x}x',
  'inj.cost.hand': 'crafting takes {x}x',
  'inj.nights.one': 'about {n} more good night to heal',
  'inj.nights.other': 'about {n} more good nights to heal',
  'inj.treated': 'treated ({how})',
  'inj.treated.fair': 'fair',
  'inj.treated.good': 'good',
  'inj.untreated': 'untreated',
  'inj.risk': 'heavy work could make it worse',
  'inj.riskChance': 'heavy work could make it worse ({n}% each time)',
  'inj.festers': 'watch it — untreated, it could go bad',
  'inj.mark': 'it will leave its mark when it heals',
  'inj.name': '{sev} {name}',

  // ── The encounter screen (#1347) ───────────────────────────────────────────
  'encui.animal': 'AN ANIMAL',
  'encui.find': 'A FIND',
  'encui.person': 'SOMEONE',
  'encui.place': 'A PLACE',
  'encui.safe': 'safe',
  'encui.likely': 'likely',
  'encui.risky': 'risky',
  'encui.desperate': 'desperate',
  'encui.safeTip': 'nothing can go wrong',
  'encui.likelyTip': 'it should go well',
  'encui.riskyTip': 'it could go either way',
  'encui.desperateTip': 'it will probably go badly',
  'encui.roadDay': 'ROAD DAY {n} · ON THE ROAD',
  'encui.where': 'D{n} · {ring} RING · {clock}',
  'encui.looksHtml': 'It looks <b>{threat}</b>.',
  'encui.shakenTip': 'Fine judgement is harder with your heart going like this',
  'encui.shaken': 'harder — shaken',
  'encui.marks': '{n} marks',
  'encui.waits.one': 'The rest of the day waits: {n} action queued.',
  'encui.waits.other': 'The rest of the day waits: {n} actions queued.',
  'encui.chose': 'You chose:',
  'encui.seeEnd': 'SEE HOW IT ENDED',
  'encui.continue': '▶ CONTINUE THE DAY',
  'encui.carryOn': '✓ CARRY ON',
  'encui.label': 'Encounter',
  'encui.memoryHtml': '🧠 Memory: <b>{held} of {room}</b> places',
  'encui.memoryFullHtml': '🧠 Memory: <b>{held} of {room}</b> places — full. You\'d let go of <b>{place}</b> ({ring} ring) first.',
  'encui.letGo': 'Let it go',
  'say.truth.bluff': 'Looking back, it was only ever bluffing.',
  'say.truth.notBad': 'Looking back, it was never as bad as it looked.',
  'say.truth.worse': 'Only afterwards do you see how dangerous that was.',
  // ── Meeting the spring caravan (#1356) ─────────────────────────────────────
  'meetui.head': '🛞 THE SPRING CARAVAN · DAY {n}',
  'meetui.caravan': 'The caravan',
  'meetui.you': 'You',
  'meetui.board': '🛞 CLIMB ABOARD',
  'meetui.boardOwes': "🛞 CLIMB ABOARD — YOU OWE {n} DAYS' HELP",
  'meetui.stay': 'WATCH THEM GO',
  'meetui.label': 'Meeting the caravan',
} as const;

/** Every key above (for the Swedish file's type). */
export type QueueKey = keyof typeof queue | DerivedKey;
