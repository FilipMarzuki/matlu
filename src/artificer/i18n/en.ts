/**
 * English: the master catalog (#1704). Every key the page can ask for is defined here, and
 * `Key` (index.ts) is derived from this object, so adding a string starts here.
 *
 * How keys are named, so later phases (#1685: the opening and camp, the road, generated text) can
 * follow along:
 * - `area.thing`, lowercase area first: `top.*` the header, `tab.*` tab labels, `btn.*` buttons
 *   used in more than one place, `head.*` section headings, `help.*`, `dev.*`, `picker.*`, ...
 *   A phase adds its own areas (`camp.*`, `road.*`, `story.*`) and, if a block grows long, its own
 *   file merged in here (e.g. `...camp` from `./en/camp`), keeping one `en` object.
 * - `{name}` placeholders for anything that varies. The caller escapes vars that go into HTML.
 * - A key ending in `Html` holds markup (trusted: it's ours). Every other string is plain text.
 * - Plurals are two keys, `.one` and `.other`, chosen by the caller: Swedish and English happen
 *   to agree on "one vs the rest", so nothing cleverer is needed for these two languages.
 * - Names stay names: Greywind Reach, Hollowford, Saltmere, Tobin... are the same in every language.
 */
import { opening } from './en/opening';
import { kit } from './en/kit';
import { camp } from './en/camp';
import { map } from './en/map';
import { road } from './en/road';
import { people } from './en/people';
import { journal } from './en/journal';
import { roadlog } from './en/roadlog';
import { encounters } from './en/encounters';
import { claims, claimsHand } from './en/claims';
import { queue } from './en/queue';
import { history } from './en/history';
import { tabs } from './en/tabs';
import { lore } from './en/lore';
import { api } from './en/api';

/** The strings that live in this file rather than an area file under ./en/. */
const core = {
  // ── The language picker: the very first screen ─────────────────────────────
  // Each language's own name and call to play, drawn in that language whatever is chosen.
  'lang.name': 'English',
  'lang.play': 'Play in English',
  'picker.title': 'Choose your language',
  'picker.note': 'You can change it later under ? (help).',

  // ── How numbers are written (#1711, i18n/index.ts numText) ─────────────────
  'fmt.decimal': '.',
  'fmt.group': ',',

  // ── The header ─────────────────────────────────────────────────────────────
  'top.yourWarden': 'Your Warden',
  'top.run': 'RUN',
  'top.day': 'DAY',
  'top.playAi': 'PLAY WITH YOUR AI',
  'top.playAiTip': 'Let your AI play Greywind Reach',
  'top.week': '📅 THIS WEEK',
  'top.weekTip': "This week's world: the one everyone, people and AIs, plays this week",
  'top.weekChipTip': "This week's world ({week}): everyone, people and AIs, plays this one until Monday 00:00 UTC",
  'top.help': 'Help',
  'top.newSave': '↺ NEW SAVE',
  'top.features': '🧪 FEATURES',
  'top.experiment': '🧪 EXPERIMENT',
  'top.experimentTip': 'This run plays with experimental features: {names}. They may change, or go.',
  'top.roadTitleHtml': '🛞 THE CARAVAN <span class="mark">ROAD</span>',
  'top.marks': 'MARKS',
  'top.roadDay': 'ROAD DAY',
  'top.autumn.one': 'AUTUMN · SNOW IN {n} DAY',
  'top.autumn.other': 'AUTUMN · SNOW IN {n} DAYS',
  'top.thaw': 'THE THAW',
  'top.winter.one': 'WINTER · THAW IN {n} DAY',
  'top.winter.other': 'WINTER · THAW IN {n} DAYS',

  // ── The status bar under the header ────────────────────────────────────────
  // The three vitals. Swedish keeps one word for each everywhere (see sv.ts's glossary).
  'status.vig': 'VIG',
  'status.cla': 'CLA',
  'status.res': 'RES',
  'status.today': 'TODAY',
  'status.hungryTip': 'Nights in a row without food',
  'status.thirstyTip': 'Nights in a row without water',
  'status.hungry': 'HUNGRY',
  'status.thirsty': 'THIRSTY',
  'status.focus': 'FOCUS',
  'status.survival': 'SURVIVAL',
  'status.survivalTip': 'Survival has taken over your thoughts',
  'status.focusTip': 'What your mind is working on',
  'status.frayed': 'frayed',
  'status.frayedTip': 'Clarity under {n} — focus is unreliable',
  'status.rations': 'RATIONS',
  'status.full': 'FULL',
  'status.half': 'HALF',
  'status.none': 'NONE',
  'status.fullTip': 'A meal every night',
  'status.halfTip': 'A meal every other night: stretches the larder, wears the body',
  'status.noneTip': 'Fasting: the food stays untouched',
  'status.tapToChange': '{tip} — tap to change',
  'status.ready': 'WINTER-READY',
  'status.notReady': 'NOT READY',
  'status.short': 'FALLING SHORT',
  'status.holding': 'HOLDING',
  'status.outlookTip': 'The winter outlook',

  // ── Tabs ───────────────────────────────────────────────────────────────────
  'tab.plan': 'PLAN',
  'tab.camp': 'CAMP',
  'tab.land': 'LAND',
  'tab.map': 'MAP',
  'tab.history': 'HISTORY',
  'tab.warden': 'WARDEN',
  'tab.progress': 'PROGRESS',
  'tab.road': 'ROAD',
  'tab.quests': 'QUESTS',
  'tab.journal': 'JOURNAL',
  'tab.dev': 'DEV',

  // ── Section headings ───────────────────────────────────────────────────────
  'head.actionsQueue': 'ACTIONS — tap to add to the queue',
  'head.actionsNow': 'ACTIONS — tap to do it now',
  'head.queue': 'THE QUEUE',
  'head.queueNew': 'THE QUEUE — NEW: PLAN AHEAD',
  'head.oneThing': 'ONE THING AT A TIME',
  'head.latest': 'LATEST',
  'head.makeCamp': 'MAKE CAMP — pick your ground',
  'head.tools': 'TOOLS & KNOWLEDGE',
  'head.warden': 'THE WARDEN',
  'head.stores': 'STORES',
  'head.site': 'SITE & SHELTER',
  'head.land': 'THE LAND — what you know, ring by ring',
  'head.pins': 'PINS — places you remember',
  'head.landDescribed': 'THE LAND — what you know of it, from camp',
  'head.yourMap': "YOUR MAP — drawn from what you've seen",
  'head.reachMap': 'THE REACH — a map of what you know',
  'head.history': 'THE REACH — its history',
  'head.lordships': 'THE LORDSHIPS NOW',
  'head.lordship': 'Lordship',
  'head.people': 'People',
  'head.heldBy': 'Held by',
  'head.artificer': 'ARTIFICER',
  'head.rank': 'RANK',
  'head.focus': 'FOCUS',
  'head.statsAge': 'STATS — age {age}, still growing',
  'head.statsGrown': 'STATS — age {age}, grown',
  'head.stats': "STATS — what you're built for",
  'head.carrying': 'CARRYING — what a trip can bring home',
  'head.pack': 'THE PACK — what you brought on the hike',
  'head.wounds': 'OLD WOUNDS — what the body remembers',
  'head.talents': 'TALENTS',
  'head.quirks': 'QUIRKS — how you are, as far as you know it',
  'head.skills': 'SKILLS — improve by doing, more with focus; techniques come by practice or teaching',
  'head.concepts': 'CONCEPTS — deepen by study and craft',
  'head.roadKeeps': 'THE ROAD — marks & contacts',
  'head.season': 'THE SEASON',
  'head.outlook': 'WINTER OUTLOOK',
  'head.milestones': 'MILESTONES',
  'head.pastRuns': 'PAST RUNS',
  'head.journal': 'JOURNAL',
  'head.roadJournal': 'JOURNAL — THE ROAD',
  'head.roadLast': 'THE LAST OF THE ROAD',
  'head.records': 'THE RECORDS',
  'head.features': '🧪 FEATURES — DEV MODE',
  // The action palette's groups.
  'group.explore': 'EXPLORE',
  'group.provision': 'PROVISION',
  'group.build': 'BUILD',
  'group.craft': 'CRAFT TOOLS',
  'group.carry': 'CARRYING GEAR',
  'group.think': 'THINK & RECOVER',
  'group.ringNote': '· {ring} ring',
  // The focus picker's groups.
  'focus.goal': 'GOAL',
  'focus.skill': 'SKILL',
  'focus.concept': 'CONCEPT',
  'focus.material': 'MATERIAL',
  'focus.place': 'PLACE',
  'focus.group': 'GROUP',
  'focus.person': 'PERSON',
  'focus.quest': 'QUEST',
  'focus.job': 'JOB',
  'focus.none': 'No focus',

  // ── The queue and the day ──────────────────────────────────────────────────
  'queue.today': 'TODAY',
  'queue.day': 'DAY {n}',
  'queue.options': 'Options',
  'queue.remove': 'Remove',
  'queue.empty': 'Empty — tap actions to plan. A day is {hours} waking hours; the queue spills into the next day and you sleep between.',
  'queue.todayHours': 'Today',
  'queue.spans.one': 'Spans <b>{n}</b> day',
  'queue.spans.other': 'Spans <b>{n}</b> days',
  'queue.spent': 'The day is spent.',
  'queue.tapNow': 'Tap an action to do it now.',
  'btn.runDay': '▶ RUN THE DAY',
  'btn.passDay': '☾ PASS THE DAY',
  'btn.runAll': '⏭ RUN WHOLE QUEUE',
  'btn.clear': 'CLEAR',
  'btn.endDay': '☾ END THE DAY',
  'btn.newWarden': '✦ NEW WARDEN',
  'btn.newWardenTip': 'Someone new — they start with the tools this Warden left',
  'btn.backToMap': '← BACK TO THE MAP',
  'btn.enter': 'ENTER {name}',

  // ── The day on a timer ─────────────────────────────────────────────────────
  'timer.label': 'The day plays out',
  'timer.day': 'DAY {n}',
  'timer.days': ' · {n} OF {total} DAYS',
  'timer.speed': 'Speed',
  'timer.skip': '⏭ SKIP',
  'timer.skipTip': 'Finish now (Esc)',
  'timer.action': 'This action',

  // ── The opening's controls (its words are in ./en/opening.ts) ──────────────
  'intro.label': 'Arrival',
  'intro.skip': 'SKIP ›',
  'intro.next': 'CONTINUE ▸',
  'intro.begin': 'BEGIN ▸',
  'intro.offWeGo': 'OFF WE GO ▸',

  // ── Help ───────────────────────────────────────────────────────────────────
  'help.ledeHtml': 'You arrive alone with almost nothing, and <b>winter is coming</b>. Lay in a <b>larder</b>, build a <b>winter-proof shelter</b>, stock <b>fuel</b> and keep body &amp; mind sound. Plan each day as a <b>queue of actions</b> and run it. Each action costs <b>hours</b> and spends <b>Vigor</b> (body) / <b>Clarity</b> (mind). Each night you eat and drink: <b>water is critical</b> — a few dry nights wreck body and mind — while <b>food</b> can be skipped for a while at a slower cost. Every night in a row without either hurts more. Scout first, then push outward — working the land teaches you its detail. The snow comes on day {winterDay}, and there is no way out until spring: <b>live through the winter to the thaw</b>. Progress saves in this browser.',
  'help.language': 'LANGUAGE',

  // ── Dev mode: the ⚙ gate and the features panel ────────────────────────────
  'dev.label': 'Developer',
  'dev.on': 'Dev mode is on in this browser.',
  'dev.leave': 'LEAVE DEV MODE',
  'dev.password': 'Developer password',
  'dev.placeholder': 'password',
  'dev.unlock': 'UNLOCK',
  'dev.wrong': 'Not that.',
  'dev.noHash': 'No password is set for this build.',
  'dev.featOn': 'ON',
  'dev.featOff': 'OFF',
  'dev.thisRun': 'this run: <b>{state}</b>',
  'dev.runOn': 'on',
  'dev.runOff': 'off',
  'dev.rules': 'rules: from the next new game',
  'dev.looks': 'looks: now',
  'dev.featuresNoteHtml': "Kept in this browser, and used by the text console too. Add <code>?dev=truths</code> to also see what the game hides: each skill's true level, each person's true trust, and the rule behind each thing in the pack. Dev mode is off for players and opens with the password behind the ⚙ in the help panel.",
  // The look picker (#1719): preview any of the nine era looks.
  'dev.looksHead': 'LOOK PREVIEW',
  'dev.lookGame': "THE GAME'S LOOK ({look})",
  'dev.lookNote': 'Showing: {look}. A preview only changes this page: the game, its save and its run log never see it.',
  // The nine era looks (#1717): three eras, three steps each.
  'look.scout-1': 'Field journal',
  'look.scout-2': 'Cartographer',
  'look.scout-3': 'Surveyor',
  'look.steampunk-1': "Tinkerer's bench",
  'look.steampunk-2': 'Brass engine',
  'look.steampunk-3': 'Soot and steam',
  'look.rune-1': 'Etched slate',
  'look.rune-2': 'Waking runes',
  'look.rune-3': 'Full rune tech',

  // ── The records box at the end of a run ────────────────────────────────────
  'records.working': 'Working out how this run compares…',
  'records.sent': 'In the records.',
  'records.compare': "See how it compares with everyone's ›",
  'records.nickname': 'Nickname',
  'records.nicknameLabel': 'Your nickname on the records',
  'records.send': 'SEND TO THE RECORDS',
  'records.sending': 'SENDING…',
  'records.replayNote': 'The server plays your run again from the start before it counts. Only a nickname is kept, one word of letters.',
  'records.unreachable': "The records can't be reached right now. Try again in a while.",
  'records.failed': 'Something went wrong ({status}). Try again in a while.',

  // ── This week's world ──────────────────────────────────────────────────────
  'weekly.unreachable': "This week's world can't be reached right now. Try again in a while.",
  'weekly.leave': "Leave this run and start this week's world? This run can't be picked up again.",
} as const satisfies Record<string, string>;

/**
 * Every area by name: this file's own strings (`core`) and each file under ./en/. They are spread
 * into one object, so a key two areas both define would silently keep only the later one
 * (#1714: the road's `end.died` hid the camp's). duplicates.test.ts checks with `duplicateKeys` that no
 * key is defined twice.
 */
export const enAreas = { core, opening, kit, camp, map, road, people, journal, roadlog, encounters, claims, claimsHand, queue, history, tabs, lore, api };

export const en = {
  ...core,
  // ── Phase 2 (#1707): the opening, the pack, a day at camp, the map ─────────
  ...opening,
  ...kit,
  ...camp,
  ...map,

  // ── Phase 3 (#1709): the road and its people, the journal, encounters ──────
  ...road,
  ...people,
  ...journal,
  ...roadlog,
  ...encounters,
  ...claims,
  ...claimsHand,
  ...queue,

  // ── Phase 4 (#1711): the Reach's history, lore answers, the remaining tabs ─
  ...history,
  ...tabs,
  ...lore,
  ...api,
} as const satisfies Record<string, string>;
