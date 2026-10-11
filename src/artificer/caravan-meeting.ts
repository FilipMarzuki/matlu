/**
 * Meeting the caravan (#1355): at the thaw the spring caravan comes up the valley, and before
 * the Warden climbs on there is a short dialogue with Bodil, the caravan master: who you are,
 * who's selling, and how you'll pay your way.
 *
 * A meeting is a tiny dialogue tree. Each step has options built like encounter options
 * (encounters.ts): requirements, costs, odds that stats and talents move, shown in words; and
 * a seeded outcome, so the same Warden making the same choice always gets the same answer.
 * An outcome leads to the next step, onto the wagon, or away (you let them pass).
 *
 * What the meeting settles — trust won or lost, the fare paid, help promised — is handed to
 * `createRoad` as a `Boarding`. Pure data and pure functions, like the rest of the sim core.
 */

import { chanceOf, oddsWord, unmet, type OddsMods, type OddsWord, type Requirement } from './encounters';
import { GRADES, type Grade } from './crafting';
import { seedOf } from './talents';
import { streamFor } from './rng';
import type { Region1State, Stores } from './region1';

/** How the ride was paid for. */
export type Fare = 'goods' | 'marks' | 'work' | 'word' | 'craft';

/** Where a meeting is. */
export type MeetingStepId = 'greet' | 'fare' | 'fare-again';

/** What an outcome does to the meeting. */
export interface MeetingEffect {
  /** What is said or happens. */
  text: string;
  /** Where the meeting goes next: another step, onto the wagon, or away. */
  next: MeetingStepId | 'board' | 'stay';
  /** Trust changes, by traveller id, applied when you board. */
  trust?: Readonly<Record<string, number>>;
  fare?: Fare;
  /** `help` promised before the first village. */
  owesHelp?: number;
}

export interface MeetingOption {
  id: string;
  label: string;
  /** What it needs, as for an encounter — plus marks in hand, or a tool you made at this grade or better. */
  requires?: Requirement & { marks?: number; madeGrade?: Grade };
  /** Paid when chosen. */
  cost?: { stores?: Partial<Record<keyof Stores, number>>; marks?: number };
  /** Base chance of success, 0–1 (1 is a sure thing). */
  odds: number;
  mods?: OddsMods;
  success: MeetingEffect;
  /** For an option that can go wrong. */
  fail?: MeetingEffect;
}

export interface MeetingStep {
  id: MeetingStepId;
  /** Who is speaking (a traveller id). */
  speaker: string;
  text: string;
  options: readonly MeetingOption[];
}

/** Help promised for a free ride; unpaid by the first village, it costs this much of Bodil's trust. */
export const OWED_HELP = 2, UNPAID_HELP_TRUST = 15;

const BODIL = 'cv-bodil', PIM = 'cv-pim', RUNA = 'cv-runa';

/** The fare options: paying, working, talking, showing your craft. The second ask leaves out the last two. */
const PAY_GOODS: MeetingOption = {
  id: 'hides', label: 'Pay in hides', requires: { stores: { hides: 2 } }, cost: { stores: { hides: 2 } }, odds: 1,
  success: { text: 'Bodil weighs the hides in her hands and nods. "Fair. Climb up."', next: 'board', fare: 'goods', trust: { [BODIL]: 5 } },
};
const PAY_RATIONS: MeetingOption = {
  id: 'rations', label: 'Pay in rations', requires: { stores: { rations: 4 } }, cost: { stores: { rations: 4 } }, odds: 1,
  success: { text: '"Smoked meat in spring is worth more than marks," says Bodil, and hands it to the cook.', next: 'board', fare: 'goods', trust: { [BODIL]: 5 } },
};
const PAY_MARKS: MeetingOption = {
  id: 'marks', label: 'Pay in marks', requires: { marks: 8 }, cost: { marks: 8 }, odds: 1,
  success: { text: 'Bodil counts the marks twice and pockets them. "Last wagon. Mind the goat."', next: 'board', fare: 'marks' },
};
const WORK: MeetingOption = {
  id: 'work', label: 'Work your passage', odds: 1,
  success: { text: `"Then you drive oxen and pitch camp. ${OWED_HELP} days of it, before Hollowford." Bodil holds out a hand to shake on it.`, next: 'board', fare: 'work', owesHelp: OWED_HELP },
};
const TALK: MeetingOption = {
  id: 'talk', label: 'Talk your way on', odds: 0.35, mods: { stats: { cha: 0.04 }, talents: { silverTongue: 0.3 } },
  success: { text: 'Bodil laughs in spite of herself. "Get on, then. That story is fare enough, and you can tell it again at supper."', next: 'board', fare: 'word', trust: { [BODIL]: 5 } },
  fail: { text: '"Nice try." Bodil folds her arms. "Everyone has a story up here. Pay, or work."', next: 'fare-again', trust: { [BODIL]: -5 } },
};
const SHOW: MeetingOption = {
  id: 'show', label: 'Show her something you made', requires: { madeGrade: 'fine' }, odds: 1,
  success: { text: 'Bodil turns it over in her hands and whistles. Pim the tinker climbs down to look too. "Someone who makes things like this rides free."', next: 'board', fare: 'craft', trust: { [BODIL]: 10, [PIM]: 10 } },
};

export const MEETING_STEPS: Readonly<Record<MeetingStepId, MeetingStep>> = {
  greet: {
    id: 'greet', speaker: BODIL,
    text: 'A line of wagons comes up the thawing valley, mud to the axles. The woman at the front reins in and stares at you. "Someone\'s alive up here. Twenty-two springs I\'ve come up this valley, and most years there\'s no one."',
    options: [
      { id: 'hail', label: 'Hail them, and tell them about the winter', odds: 1,
        success: { text: 'Bodil listens to all of it, nodding at the hard parts. "You\'ll be wanting a ride down, then."', next: 'fare', trust: { [BODIL]: 5 } } },
      { id: 'merchant', label: 'Ask who is selling', odds: 1,
        success: { text: 'A Viddfolk woman leans out of the painted wagon, humming a route-song. "Runa. I buy what the winter left you and sell what it didn\'t." Bodil snorts. "Trade on the road. First — do you want a ride?"', next: 'fare', trust: { [RUNA]: 5 } } },
      { id: 'pass', label: 'Let them pass', odds: 1,
        success: { text: 'You watch the wagons roll on up the valley and out of sight. The Reach is quiet again.', next: 'stay' } },
    ],
  },
  fare: {
    id: 'fare', speaker: BODIL,
    text: '"There\'s room on the last wagon. Nobody rides free, though: pay your way, or work it."',
    options: [PAY_GOODS, PAY_RATIONS, PAY_MARKS, WORK, TALK, SHOW],
  },
  'fare-again': {
    id: 'fare-again', speaker: BODIL,
    text: '"So. Pay, or work?"',
    options: [PAY_GOODS, PAY_RATIONS, PAY_MARKS, WORK],
  },
};

/** One line of the meeting, for the journal: who said it (null for what you did), and what. */
export interface MeetingLine { speaker: string | null; text: string }

export interface Meeting {
  step: MeetingStepId;
  /** Where it ended: onto the wagon, or you let them pass. Null while it goes on. */
  ended: 'board' | 'stay' | null;
  lines: MeetingLine[];
  /** Trust changes so far, by traveller id. */
  trust: Record<string, number>;
  /** What was paid. */
  paid: { stores: Partial<Record<keyof Stores, number>>; marks: number };
  fare: Fare | null;
  owesHelp: number;
  /** The last choice and how it went, for a screen to show. */
  last: { option: string; label: string; success: boolean; text: string } | null;
}

/** What the meeting hands to the road. */
export type Boarding = Pick<Meeting, 'trust' | 'paid' | 'fare' | 'owesHelp' | 'lines'>;

/** Open the meeting at the thaw. Only a Warden who survived the winter meets the caravan. */
export function openMeeting(reach: Region1State): Meeting {
  if (reach.outcome?.kind !== 'survived') throw new Error('only a Warden who survived the winter meets the caravan');
  const step = MEETING_STEPS.greet;
  return { step: step.id, ended: null, lines: [{ speaker: step.speaker, text: step.text }], trust: {}, paid: { stores: {}, marks: 0 }, fare: null, owesHelp: 0, last: null };
}

/** The step the meeting is on. */
export const meetingStep = (m: Meeting): MeetingStep => MEETING_STEPS[m.step];

/** Why an option can't be taken, or null if it can. */
export function meetingUnmet(reach: Region1State, o: MeetingOption): string | null {
  const r = o.requires;
  const need = Math.max(r?.marks ?? 0, o.cost?.marks ?? 0);
  if (need && (reach.marks ?? 0) < need) return `needs ${need} marks`;
  if (r?.madeGrade && !reach.tools.some(t => GRADES.indexOf(t.grade) >= GRADES.indexOf(r.madeGrade!))) return `needs a ${r.madeGrade} or better thing you made`;
  // The rest (stores, skills, stats, talents, tools) works as for an encounter.
  return unmet(reach, { ...o, success: o.success, fail: o.fail ?? o.success });
}

/** The current step's options as the Warden sees them: whether each can be taken, and the odds in words. */
export function meetingOptions(reach: Region1State, m: Meeting): { option: MeetingOption; unmet: string | null; odds: OddsWord }[] {
  return meetingStep(m).options.map(option => ({ option, unmet: meetingUnmet(reach, option), odds: oddsWord(meetingChance(reach, option)) }));
}

/** An option's chance of success for this Warden. */
export const meetingChance = (reach: Region1State, o: MeetingOption): number =>
  chanceOf(reach, { ...o, success: o.success, fail: o.fail ?? o.success });

/** The safest option open: the best odds, a free one before one that costs. Always one (working your passage is free and sure). */
export function safestMeetingOption(reach: Region1State, m: Meeting): MeetingOption {
  const cost = (o: MeetingOption): number => (o.cost?.marks ?? 0) + Object.values(o.cost?.stores ?? {}).reduce<number>((n, x) => n + (x ?? 0), 0);
  const open = meetingStep(m).options.filter(o => !meetingUnmet(reach, o) && o.success.next !== 'stay');
  return open.reduce((best, o) => {
    const d = meetingChance(reach, o) - meetingChance(reach, best);
    return d > 0 || (d === 0 && cost(o) < cost(best)) ? o : best;
  }, open[0]);
}

/**
 * Make a choice. Pays its cost, rolls its seeded outcome (sure options always succeed), and
 * moves the meeting on. An option that isn't there or can't be taken changes nothing but the
 * last line, which says why.
 */
export function chooseInMeeting(reach: Region1State, m: Meeting, optionId: string): Meeting {
  if (m.ended) return m;
  const o = meetingStep(m).options.find(x => x.id === optionId);
  const why = o ? meetingUnmet(reach, o) : `there's no "${optionId}" here`;
  if (!o || why) return { ...m, last: { option: optionId, label: o?.label ?? optionId, success: false, text: `Not possible — ${why}.` } };
  const next: Meeting = { ...m, lines: [...m.lines, { speaker: null, text: o.label }], trust: { ...m.trust }, paid: { stores: { ...m.paid.stores }, marks: m.paid.marks } };
  for (const [k, n] of Object.entries(o.cost?.stores ?? {})) next.paid.stores[k as keyof Stores] = (next.paid.stores[k as keyof Stores] ?? 0) + (n ?? 0);
  next.paid.marks += o.cost?.marks ?? 0;
  const p = meetingChance(reach, o);
  const success = p >= 1 || !o.fail || streamFor(seedOf(reach.character.id), reach.day, `caravan:${m.step}:${o.id}`)() < p;
  const e = success ? o.success : o.fail!;
  for (const [id, d] of Object.entries(e.trust ?? {})) next.trust[id] = (next.trust[id] ?? 0) + d;
  if (e.fare) next.fare = e.fare;
  next.owesHelp += e.owesHelp ?? 0;
  next.lines.push({ speaker: MEETING_STEPS[m.step].speaker, text: e.text });
  next.last = { option: o.id, label: o.label, success, text: e.text };
  if (e.next === 'board' || e.next === 'stay') next.ended = e.next;
  else {
    next.step = e.next;
    next.lines.push({ speaker: MEETING_STEPS[e.next].speaker, text: MEETING_STEPS[e.next].text });
  }
  return next;
}

/** What the road needs from a meeting that ended on the wagon; null while it goes on, or if you let them pass. */
export function boardingOf(m: Meeting): Boarding | null {
  return m.ended === 'board' ? { trust: m.trust, paid: m.paid, fare: m.fare, owesHelp: m.owesHelp, lines: m.lines } : null;
}
