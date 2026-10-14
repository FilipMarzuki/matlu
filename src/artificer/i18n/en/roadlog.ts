/**
 * The road's journal in English (#1709, phase 3 of #1685): every line road.ts (and what it asks of
 * asks.ts, knowledge-questions.ts, rapport.ts, consistency.ts) writes, as templates the page reads
 * the sim's English back through. How templates and their parts work is in ./journal.ts; the road
 * adds `{who}` (someone on the road, by name), `{quest}` (a quest's title), `{rewards}` (what a
 * quest paid), `{qabout}` (what a free question was about), `{level}` (a skill level) and
 * `{talentlow}` (a talent's name, lowercased).
 *
 * What people say inside the quotes is looked up whole (./people.ts, ./encounters.ts): a line from
 * what everyone knows, a rumour, a lie or a people's ways that isn't in the catalog yet stays
 * English inside the Swedish frame (#1709 lists them for a follow-up).
 */

import { ROAD_ORGS } from '../../orgs';
import { HARM_NAME } from '../../injuries';
import { arrivalLines, VILLAGE_ECONOMY } from '../../economy';
import { DEED_WORDS } from '../../encounters';

type DerivedKey = `w.${string}` | `say.${string}`;

const derived = Object.fromEntries([
  // An organisation mid-sentence ("the Compact's business").
  ...Object.values(ROAD_ORGS).map(o => [`w.org.${o.id}`, o.name.replace(/^The /, 'the ')]),
  // An old harm as a healer names it ("stiff knee").
  ...Object.entries(HARM_NAME).map(([h, n]) => [`w.harmshort.${h}`, n.replace(/^an? /, '')]),
  // What a deed was, for an option it opens ("only if you've put a lost herald right").
  ...Object.entries(DEED_WORDS).map(([d, w]) => [`w.deed.${d}`, w]),
  // What arriving tells of a village's economy (#1599): its scene, story, fuel and market, in one line.
  ...Object.keys(VILLAGE_ECONOMY).map(v => [`say.arrival.${v}`, arrivalLines(v)!.join(' ')]),
]) as Record<DerivedKey, string>;

export const roadlog = {
  ...derived,

  // Things people say that the road's own code writes (consistency.ts, road.ts).
  'say.road.hedged': "I never know where I stand with you. I'll want a little more on it.",
  'say.road.fair': 'You always pay fair, so I know where we stand.',
  'say.road.hard': "You'll drive it hard, I know. No point dancing about it: here's my price.",
  'say.road.expect': 'I know what to expect of you.',
  'say.road.regular': "Your word's good with me. You'll have the regular's rate.",
  'say.road.lastTime': 'Last time you promised the same.',
  'say.road.comeBack': 'Come back when you can follow it.',
  'w.spring': 'spring',
  // The same sayings as words, for two said together ("You always pay fair... Your word's good with me...").
  'w.says.hedged': "I never know where I stand with you. I'll want a little more on it.",
  'w.says.fair': 'You always pay fair, so I know where we stand.',
  'w.says.hard': "You'll drive it hard, I know. No point dancing about it: here's my price.",
  'w.says.expect': 'I know what to expect of you.',
  'w.says.regular': "Your word's good with me. You'll have the regular's rate.",
  'log.road.says': '{w} {w2}',
  'log.road.askNothing': 'Ask: nothing to ask about — set a focus on a topic, a skill or a concept first.',

  // ── Onto the wagon, and the days of the road ───────────────────────────────
  'log.road.said': '{who}: {say}',
  'log.road.you': 'You: {say}',
  'log.road.boarded': 'You climb onto the last wagon as Greywind Reach falls behind, the valley green with {w}. Mistheim is {n} days down the road.',
  'log.road.ragged': "The winter took a lot out of you. It'll be days on the wagon before you're right.",
  'log.road.watch': 'You watch the road go by.',
  'log.road.passDay': 'You pass the day in {place}.',
  'log.road.rollsOut': 'The caravan rolls out at dawn, leaving {place} behind.',
  'log.road.reaches': 'The caravan reaches {place}. It stays {n} days.',
  'log.road.bodil.one': "Bodil hasn't forgotten the {n} day of help you promised and never gave. She doesn't say a word about it, which is worse.",
  'log.road.bodil.other': "Bodil hasn't forgotten the {n} days of help you promised and never gave. She doesn't say a word about it, which is worse.",
  'log.road.cargo': 'Your body gives out. The caravan carries you on as cargo — this journey is over.',
  'log.road.killed': 'Killed by what met you on the road.',

  // ── People ─────────────────────────────────────────────────────────────────
  'log.road.quote': '{who}: "{say}"',
  'log.road.notYet': '{who} talks of small things, and watches you. Not yet.',
  'log.road.easyHour': 'You pass an easy hour with {who}.',
  'log.road.warmer': '{who} is warmer to you than you thought.',
  'log.road.cooler': '{who} is cooler to you than you thought.',
  'log.road.regular': '{who} knows your face by now, and greets you as a regular.',
  'log.road.wordWarms': "Word reaches {who} that you've done right by {who2}. It warms them to you.",
  'log.road.wordCools': "Word reaches {who} that you've taken {who2}'s side. They think the less of you for it.",
  'log.road.alreadyTold': '{who} has already told you what they know about {about}.',
  'log.road.referral': '{who} thinks, and shakes their head. "I couldn\'t tell you — {who2} would know."',
  'log.road.dontKnow': '{who} thinks, and shakes their head. "I don\'t know much about {about}."',
  'log.road.kept': '{who} looks away. "That\'s {w}\'s business, and not for outsiders."',
  'log.road.askLater': '{who} looks at you a long moment. "Maybe. Ask me again when I know you better."',
  'log.road.deflect': '{who} thinks it over. "{say}"',
  'log.road.asked': 'You ask {who} about {qabout}. {line}',
  'log.road.doubt': "{line} Something in how {who} says it doesn't sit right with you.",
  'log.road.confront': 'You tell {who} what you\'ve heard. {who2}: "{say}"',
  'log.road.confrontThen': 'You tell {who} what you\'ve heard. {who2}: "{say}" Then: "{say2}"',
  'log.road.keepMore': '{who} will keep more from you now.',
  'log.road.wordReach': 'Word of it will reach {names}, who think well of {who}.',
  'log.road.changed': "That isn't what {who} told you before. Your journal has both.",
  'log.road.clash': "That doesn't square with what {names} told you about {say}. Your journal has both.",
  'log.road.lead': "A lead: {who} at {place}, about {about}. {who2} sent you; it's in your quest log.",
  'log.road.leadRoad': "A lead: {who}, about {about}. {who2} sent you; it's in your quest log.",
  'log.road.heardAbout': '{who} has heard about {say} already.',
  'log.road.orgHears': 'Word of it will go round {w}: its people will know what you did.',

  // ── Trade ──────────────────────────────────────────────────────────────────
  'log.road.sold': 'Sold {good} to {who} for {n} marks.',
  'log.road.soldN': 'Sold {n} {good} to {who} for {m} marks.',
  'log.road.soldGrade': 'Sold {grade} {good} to {who} for {n} marks.',
  'log.road.bought': 'Bought {n} {good} from {who} for {m} marks.',

  // ── Quests ─────────────────────────────────────────────────────────────────
  'log.road.takeOn': '{who}: "{say}" You take on {quest}.',
  'log.road.questDone': '{who}: "{say}" {quest} done — {rewards}.',
  'log.road.expired': '{quest} is left undone — {who} watches the caravan go.',
  'log.road.handed': 'You hand {n} {good} to {who}, as promised.',
  'log.road.failedDelivery': 'You reach {who} without the {good} {who2} trusted you with. Word will get back.',

  // ── Hands free ─────────────────────────────────────────────────────────────
  'log.road.mended': 'Mended the {good} — {grade} again.',
  'log.road.helped': 'You help drive the oxen and pitch camp at dusk. The cook slips you an extra portion.',
  'log.road.passageLeft': "That's a day of your passage worked off; {n} to go before Hollowford.",
  'log.road.passageDone': 'Your passage is worked off. Bodil nods to you at supper.',

  // ── Healers and teachers ───────────────────────────────────────────────────
  'log.road.harmLore': '{who} looks at your {w}: "{say}"',
  'log.road.tends': '{who} tends your {w}.',
  'log.road.tendsSet': '{who} tends your {w} and sets it properly — it will heal straight.',
  'log.road.tendsFree': '{who} tends your {w} — no charge between friends',
  'log.road.tendsSetFree': '{who} tends your {w} and sets it properly — it will heal straight — no charge between friends',
  'log.road.paid': '{line} ({n} marks)',
  'log.road.free': '{line} — no charge between friends',
  'log.road.shakesHead': '{who} shakes their head at {tech}: "{say}"',
  'log.road.taughtBy': 'Taught by {who}: {tech} — {how}.',
  'log.road.showsRecipe': '{who} shows you how to make the {good}.',
  'log.road.talksThrough': '{who} talks you through {concept} — it makes more sense now.',
  'log.road.watches': '{who} watches you work a while. "{say}"',
  'log.road.verdict.knows': "You're a {level} at {skill} — and you know it.",
  'log.road.verdict.knowsAn': "You're an {level} at {skill} — and you know it.",
  'log.road.verdict': "You're a {level} at {skill}, whatever you think.",
  'log.road.verdictAn': "You're an {level} at {skill}, whatever you think.",
  'log.road.gift': '{who}: "You have a {talentlow}. Has no one ever told you?"',
  'log.road.giftAn': '{who}: "You have an {talentlow}. Has no one ever told you?"',

  // ── Why a road action can't be done (after "Sell: skipped — ...") ──────────
  'reason.road.noOne': "there's no one called {id} here",
  'reason.road.camp': 'Not here: that is camp work, and you are a guest in the village',
  'reason.road.wagon': 'Not from the wagon',
  'reason.road.noTrader': 'No one here is trading',
  'reason.road.dontHave': "you don't have {n} {good}",
  'reason.road.noGood': 'you have no {good} to sell',
  'reason.road.noGoodGrade': 'you have no {grade} {good} to sell',
  'reason.road.doesntSell': "{who} doesn't sell {good}",
  'reason.road.costs': '{n} {good} costs {m} marks; you have {h}',
  'reason.road.notOffering': 'no one here is offering "{id}"',
  'reason.road.notTaken': 'you haven\'t taken on "{id}"',
  'reason.road.backHome': '{quest} is for {who}, back in their village',
  'reason.road.questNeeds': '{quest} {why}',
  'reason.road.nothingToAsk': 'nothing to ask about — set a focus on a topic, a skill or a concept first',
  'reason.road.questionsOff': 'free questions are off in this game',
  'reason.road.questioned': "you've asked {who} your question this stay",
  'reason.road.nothingToTell': "you've nothing to tell {who} about that",
  'reason.road.notOnRoad': "{good} can't be made on the road",
  'reason.road.dontKnowHow': "you don't know how to make {good} yet",
  'reason.road.nothingToMend': 'nothing needs mending',
  'reason.road.resting': 'the caravan is resting in the village; there is nothing to drive or pitch',
  'reason.road.noHealer': "there's no healer called {id} here",
  'reason.road.healerNothing': '{who} finds nothing that needs her',
  'reason.road.healerTended': '{who} finds nothing that needs her — your injuries are already tended',
  'reason.road.healerFee': '{who} asks {n} marks for her care; you have {m}',
  'reason.road.noTeacher': 'no one called {id} teaches here',
  'reason.road.doesntTeach': "{who} doesn't teach {id}",
  'reason.road.alreadyKnow': 'you already know {id}',
  'reason.road.understand': 'you already understand {concept} as far as it goes',
  'reason.road.lessonFee': "{who}'s lesson costs {n} marks; you have {m}",
  'reason.road.appraised': '{who} has already told you what they think',
  'reason.road.notComeAcross': "you haven't come across {about} yet",
  // A quest's needs (quests.ts canComplete).
  'reason.quest.fetch': 'needs {n} {good} — you have {m}',
  'reason.quest.craft': 'needs a {grade} or better {good}',
  'reason.quest.repair': 'needs {concept} rank {n}',
  'reason.quest.scout': 'needs scouting level {n}',
  'reason.quest.deliver': 'it completes when the caravan reaches the next village',
  // An encounter's option you can't take (encounters.ts unmet), also the option's greyed tooltip.
  'reason.enc.cantThink': "you can't think straight",
  'reason.enc.skill': 'needs {skillid} {n}',
  'reason.enc.gift': "needs a gift you don't have",
  'reason.enc.stat': 'needs {statshort} {n}',
  'reason.enc.tool': 'needs a {good}',
  'reason.enc.kit': 'needs a {kitlow}',
  'reason.enc.focus': 'needs your mind on {keywords}',
  'reason.enc.knows': 'needs you to know about {keywords}',
  'reason.enc.deed': "only if you've {w}",
  'reason.enc.deedNone': "only if you've done something you haven't",
  'reason.enc.marks': 'needs {n} marks',
  'reason.enc.stores': 'needs {n} {good}',
  'reason.enc.memoryFull': 'your memory is full — let a place go first',
  'reason.enc.pinned': 'you already remember it',
  'reason.enc.made': 'needs a {grade} or better thing you made',
  'reason.enc.notPossible': 'Not possible — {why}.',
} as const;

/** Every key above, the ones built from the sim's tables included (for the Swedish file's type). */
export type RoadlogKey = keyof typeof roadlog | DerivedKey;
