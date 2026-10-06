/**
 * Region 1.5 villages and people (#1246, epic #1235).
 *
 * Each village on the caravan road is a handful of people. Each has a role, a
 * culture (from `macro-world/cultures.json` — cultures are race-agnostic), one
 * need, and a few lore lines they share only as they come to trust you.
 * Trust is per person, 0–100. Trade, quests and teaching (#1247–#1249) build
 * on it.
 *
 * Written for the lore pass (#1253) from WORLD.md, WORLD_LORE.md and
 * docs/peoples-and-races.md: every person is one of the Mistheim Peoples living
 * in a real culture, and what they tell you is true of the world. The places
 * and people are new; nothing they say should contradict canon.
 * Pure data plus pure helpers; road.ts holds the state.
 */

import type { SkillId } from './skills';

export type Role = 'trader' | 'teacher' | 'healer' | 'elder' | 'smith' | 'hunter' | 'caravaneer' | 'tinker';

/** What a person wants: an item, or a job done. Quests (#1248) are built from these. */
export type Need = { kind: 'item'; item: string; qty: number } | { kind: 'job'; job: string };

/** A lore line, shared once trust reaches `at`. */
export interface LoreLine { at: number; text: string }

/**
 * What a teacher can teach (#1249): techniques in their skill (only within TEACH_REACH of your
 * true level), recipes, and a concept lesson. Practice in their skill while they're in the
 * village counts as guided.
 */
export interface Teaching {
  skill: SkillId;
  techniques: readonly string[];
  recipes: readonly string[];
  concept?: string;
}

/** One of the 15 Mistheim Peoples (docs/peoples-and-races.md), by its canonical TitleCase id. */
export type People = 'Bergfolk' | 'Lövfolk' | 'Markfolk' | 'Viddfolk' | 'Steinfolk' | 'Pandor' | 'Deepwalkers' | 'Merfolk' | 'Goblins' | 'Fae' | 'Giants' | 'Dragons' | 'Everstill' | 'Constructs' | 'Remnants';

export interface Person {
  id: string;
  name: string;
  role: Role;
  /** Who they are: one of the Mistheim Peoples. */
  people: People;
  /** A culture id from macro-world/cultures.json — how they live, whatever their People. */
  culture: string;
  /** One line: how they come across. */
  personality: string;
  need: Need;
  /** 3–5 lines, in the order they're told, each gated by trust (0 / 25 / 50 / 75). */
  lore: readonly LoreLine[];
  /** Set for anyone who teaches (#1249) — not only the `teacher` role: a smith or a hunter can too. */
  teaches?: Teaching;
  /** A fellow traveller's craft (#1245): each lore line they share gives a little insight in it. */
  concept?: string;
}

export interface Village {
  id: string;
  name: string;
  /** The cultures that shape the place (cultures.json ids), most of it first. */
  cultures: readonly string[];
  /** What it looks like from the wagon. */
  landscape: string;
  /** What the corruption has done nearby (WORLD_LORE.md's nine borders). */
  corruption: string;
  /** Why the caravan stops here. */
  why: string;
  people: readonly Person[];
}

const p = (id: string, name: string, role: Role, people: People, culture: string, personality: string, need: Need, lore: [number, string][], teaches?: Teaching): Person =>
  ({ id, name, role, people, culture, personality, need, lore: lore.map(([at, text]) => ({ at, text })), ...(teaches ? { teaches } : {}) });

/**
 * The three villages on the road out of Greywind Reach (ids match road.ts's ROUTE). The road
 * comes down off the northern spine's foothills — where the Bergfolk holds give way to Markfolk
 * fields — skirts the edge of the open steppe, and passes the last wall before Mistheim's
 * settled lowlands. Every People and culture here is canon; the places and people are new.
 */
export const VILLAGES: Readonly<Record<string, Village>> = {
  hollowford: {
    id: 'hollowford', name: 'Hollowford', cultures: ['fieldborn', 'ridgefolk'],
    landscape: 'Terraced barley on the last foothills, stone-walled sheepfolds, and a wide, shallow river crossed on a line of stepping stones.',
    corruption: 'Above the village the high fields have gone grey-violet and hard. The plough rings on them, and nothing roots.',
    why: 'It is the only ford before the spring flood rises. The caravan crosses here or waits a month.',
    people: [
      p('hf-maren', 'Maren', 'elder', 'Markfolk', 'fieldborn', 'Dry as a summer field; counts everything twice and forgives slowly.',
        { kind: 'job', job: 'mend the ford stones' }, [
          [0, 'The ford was here before the village. We only built where the river let us.'],
          [25, 'Every spring the caravan brings someone half-dead out of the Reach. You look better than most.'],
          [50, 'The high fields have gone grey. Not frost — stone, from underneath. The plough rings on it, and nothing roots.'],
          [75, 'My mother kept a field up there. When the grey reached it, she moved the fence down the hill and never spoke of it again. That is how we lose land here: one fence at a time.'],
        ]),
      p('hf-tobin', 'Tobin', 'trader', 'Goblins', 'caravan-folk', 'Quick, cheerful, and always listening for what something is really worth.',
        { kind: 'job', job: 'carry hides to Saltmere' }, [
          [0, 'Hides, salt, a good knife — I buy what travels well.'],
          [25, 'The prices in Saltmere are honest. The Pandor there write every sale in a book, and nobody argues with the book.'],
          [50, 'Kestrel Gate takes a toll on everything that moves. Sell before you get there.'],
          [75, 'The Compact pays better for news than for hides. Where the ground is going grey, which wells have turned — someone always wants to know.'],
        ]),
      p('hf-isa', 'Isa', 'healer', 'Lövfolk', 'grovekin', 'Unhurried and exact; she listens to a wound before she touches it.',
        { kind: 'item', item: 'rawFood', qty: 4 }, [
          [0, 'Sit. Let me see those hands — frost leaves marks you don\'t feel yet.'],
          [25, 'Willow bark for pain, pine resin for wounds. The Reach grows both, if you know where to look.'],
          [50, 'Where I come from, healing is spoken, not brewed. Lately the words come slower, as if the Myst were further away. In the east they have started calling it the Dry.'],
          [75, 'I came out of the Reach once, too — half-dead on the spring wagon, sixty years ago. I never went back. You learn what you can carry, and you leave the rest.'],
        ], { skill: 'foraging', techniques: ['greens', 'roots', 'fungi'], recipes: [] }),
      p('hf-orrin', 'Orrin', 'smith', 'Bergfolk', 'ridgefolk', 'Gruff, generous with advice, and impossible to rush.',
        { kind: 'item', item: 'firewood', qty: 4 }, [
          [0, 'Bring me good stone and I\'ll show you an edge.'],
          [25, 'A crude tool is a promise you\'ll fix it later. Make it sound the first time.'],
          [50, 'In the Dyprike they ask what you have made, not whose child you are. I left a hold seat for this forge. Nobody here has asked me why.'],
          [75, 'My grandmother\'s hold sold mana-granite to half the world. The seams run thinner every year. The holds do not say so out loud.'],
        ], { skill: 'woodcraft', techniques: ['grain', 'notching', 'seasoning'], recipes: [], concept: 'sharpening' }),
    ],
  },
  saltmere: {
    id: 'saltmere', name: 'Saltmere', cultures: ['waterstead', 'harborfolk', 'steppe-camp'],
    landscape: 'A long salt lake under a huge sky, white crust at its edges, drying racks for fish, and the first grass of the open steppe beyond.',
    corruption: 'The north end of the mere has gone too still and faintly violet. No birds drink there, and the fish that wash up float belly-up.',
    why: 'Salt for the caravan\'s meat, sweet water from the Pandor wells, and the first stretch of road the Viddfolk keep.',
    people: [
      p('sm-hedda', 'Hedda', 'trader', 'Deepwalkers', 'harborfolk', 'Loud, warm, and never quite finished with an argument.',
        { kind: 'item', item: 'rations', qty: 3 }, [
          [0, 'Salt fish, salt pork, salt everything. The mere gives and we keep.'],
          [25, 'A ration smoked well lasts the winter. Smoked badly, a week.'],
          [50, 'My people remember for a living — on the coast a [Keeper] can recite a family back thirty generations. I came inland to forget a little. It didn\'t work.'],
          [75, 'The caravan master owes me three barrels from two springs ago. I\'ll get them. Deepwalkers remember debts longest of all.'],
        ]),
      p('sm-anselm', 'Anselm', 'teacher', 'Pandor', 'waterstead', 'Patient, precise, and delighted by any question nobody has asked him before.',
        { kind: 'job', job: 'copy out a ledger' }, [
          [0, 'Most people learn by burning their fingers. Some learn by watching.'],
          [25, 'We write down every winter the Reach gives back. Yours will be in the book tonight.'],
          [50, 'Under the Compact of Knowing I must tell anyone who asks what the book says. Very few ask.'],
          [75, 'The book says the mere was sweet water once. The salt came in with an age that ended. Ages end here more often than people like to think.'],
        ], { skill: 'handcraft', techniques: ['weave', 'sewing', 'patterns'], recipes: ['hide-parka', 'waterskin'], concept: 'sealing' }),
      p('sm-yrsa', 'Yrsa', 'hunter', 'Viddfolk', 'steppe-camp', 'Few words, sharp eyes, and no patience for people who hurry.',
        { kind: 'job', job: 'scout the mere shore' }, [
          [0, 'The mere birds come at dusk. Patience gets you more than arrows.'],
          [25, 'Snow tells you everything an animal did. Mud lies.'],
          [50, 'This shore is a route-claim. Under the Vidde Accords my people keep the road, and every nation lets us. It is the oldest promise in Mistheim.'],
          [75, 'Our [Heralds] used to ride the ley-lines along this valley faster than wind. This year they rode like anyone else.'],
        ], { skill: 'hunting', techniques: ['sign', 'stalking', 'dressing'], recipes: ['trap-snare'] }),
      p('sm-gunnar', 'Gunnar', 'elder', 'Markfolk', 'waterstead', 'Stubborn and kind, and certain the water is trying to tell him something.',
        { kind: 'job', job: 'clear the sluice' }, [
          [0, 'The mere is lower every year. Nobody listens to old men about water.'],
          [25, 'I was a [Watermaster] in the southern delta for forty years. Water listens, if you have been patient with it long enough.'],
          [50, 'The north end has gone too still. No ripple, no birds, and the colour is wrong at dawn. I have stopped going there.'],
        ]),
      p('sm-liv', 'Liv', 'healer', 'Markfolk', 'refuge-keepers', 'Brisk and tireless; she has seen too much to be surprised.',
        { kind: 'item', item: 'waterskin', qty: 1 }, [
          [0, 'Clean water first. Everything else after.'],
          [25, 'Half the fevers on the road come from bad wells. Don\'t drink from the north end of the mere, however clear it looks.'],
          [50, 'We take in anyone the road spits out. That\'s what a refuge is.'],
        ]),
    ],
  },
  'kestrel-gate': {
    id: 'kestrel-gate', name: 'Kestrel Gate', cultures: ['wallborn', 'ironborne-encampment', 'mountainhold'],
    landscape: 'A stone wall across a narrow pass, a gatehouse with kestrels nesting in its arrow-slits, and a market crowded against the inside of the wall.',
    corruption: 'Ash comes down off the high pass on the west wind and settles grey on everything. It does not brush off, and some days the air is too heavy to hurry in.',
    why: 'Nothing goes into Mistheim\'s lowlands without passing the Gate. The caravan pays its toll and is counted here.',
    people: [
      p('kg-veit', 'Veit', 'elder', 'Steinfolk', 'wallborn', 'Formal and careful; he weighs every word as if it had a toll.',
        { kind: 'job', job: 'carry a message to Mistheim' }, [
          [0, 'Kestrel Gate keeps the road. The road keeps us.'],
          [25, 'The toll pays for the wall. The wall pays for the peace.'],
          [50, 'Mistheim is not what the caravan songs say. Go anyway.'],
          [75, 'The gate was built against something that came down the pass in an age that ended. We stopped saying what. We did not stop keeping the wall.'],
        ]),
      p('kg-sabine', 'Sabine', 'smith', 'Steinfolk', 'ironborne-encampment', 'Blunt, funny, and proud of every hinge on the gate.',
        { kind: 'item', item: 'materials', qty: 5 }, [
          [0, 'Gate hinges, cart axles, arrowheads. A smith here never runs out of work.'],
          [25, 'Good iron sings when you strike it. Bad iron argues.'],
          [50, 'The ash that came down the pass this winter settles on the anvil and won\'t brush off. I quench twice now, to be sure.'],
        ]),
      p('kg-arvid', 'Arvid', 'trader', 'Goblins', 'bazaar-folk', 'Smiling, careful, and never the first to name a price.',
        { kind: 'item', item: 'firewood', qty: 6 }, [
          [0, 'Everything has a price at the Gate. Some prices are friendship.'],
          [25, 'In the lowlands they pay silly money for tools made in the Reach. Bring something sound.'],
          [50, 'The toll-keeper drinks. Arrive at dusk.'],
          [75, 'The Compact has mapped ruins no surface nation has found. Some of them are opening on their own now, seals that held for ages. Nobody will say why.'],
        ]),
      p('kg-runa', 'Runa', 'teacher', 'Bergfolk', 'mountainhold', 'Severe, then suddenly kind; she teaches the way the mountain does.',
        { kind: 'job', job: 'gather mountain herbs' }, [
          [0, 'A mountain teaches slowly and forgives nothing.'],
          [25, 'Stonework is patience with a hammer.'],
          [50, 'The dry-stone walls of the hold have stood three hundred years without a drop of mortar.'],
          [75, 'In the holds, what you make is who you are. Make something that will outlast you, and you will never quite be gone.'],
        ], { skill: 'stonework', techniques: ['cleave', 'knapping', 'drystone'], recipes: [], concept: 'joinery' }),
    ],
  },
};

/**
 * Fellow travellers (#1253): the caravan's own people, met on the wagon between villages.
 * They have no trade, quest or lessons — only company, and what they know of the road.
 * They tell their lines in order, trust or no (#1245): the road is long, and talk is free.
 * The tinker and the herbwife know a craft, and each line teaches a little of it.
 */
export const TRAVELLERS: readonly Person[] = [
  p('cv-bodil', 'Bodil', 'caravaneer', 'Markfolk', 'caravan-folk', 'The caravan master: tireless, practical, and fond of every wagon like a relative.',
    { kind: 'job', job: 'keep the wagons rolling' }, [
      [0, 'Twenty-two springs I\'ve brought this caravan up the valley. Most years someone is waiting. Some years no one is.'],
      [0, 'We stop at every inn we can reach before dark. Under an innkeeper\'s roof no one draws a blade, and the cold stays outside. That is older than any kingdom.'],
      [0, 'I owe Hedda three barrels. She will tell you. She tells everyone.'],
    ]),
  { ...p('cv-pim', 'Pim', 'tinker', 'Goblins', 'bazaar-folk', 'A goblin tinker who talks to the axles and is usually right about them.',
    { kind: 'job', job: 'mend what breaks' }, [
      [0, 'Axles, buckles, lamp-wicks — if it breaks between villages, it\'s mine to fix.'],
      [0, 'Big folk call the edge of things the margin. We call it home. You can fix nearly anything with what other people throw away.'],
      [0, 'Old seals in the ruins are giving way where the Myst runs thin. The Compact is busier than it has been in a hundred years.'],
    ]), concept: 'leverage' },
  { ...p('cv-ottilia', 'Ottilia', 'healer', 'Lövfolk', 'grovekin', 'The caravan\'s herbwife: soft-spoken, ancient, and quietly amused by everyone.',
    { kind: 'job', job: 'tend the travellers' }, [
      [0, 'Drink, eat, sleep. Most of what ails travellers is one of those three, missing.'],
      [0, 'A healing word works better when it is true. I cannot tell you that you will be well. I can tell you that you are not alone.'],
      [0, 'The corruption does not make things evil. It makes them more of what they already were: more afraid, more hungry. Remember that when something on the road looks at you wrong.'],
    ]), concept: 'sealing' },
  // The caravan's merchant (#1355): she trades from her painted wagon on travel days. In a village she leaves it to the village trader.
  p('cv-runa', 'Runa', 'trader', 'Viddfolk', 'caravan-folk', 'A Viddfolk route-singer who keeps the caravan\'s accounts in songs instead of ledgers.',
    { kind: 'item', item: 'materials', qty: 6 }, [
      [0, 'Every road has a song, and every song has the prices in it. That is how my people remember both.'],
      [0, 'Winter people always have stone and timber to sell and no idea what it is worth. Lucky for you, I am honest. Mostly.'],
      [0, 'The high plains are moving. Whole herds walk east now, away from the grey. A route-singer has to learn new verses every year.'],
    ]),
];

/** What the road ends at (#1253): the arrival, in words. */
export const MISTHEIM_ARRIVAL = 'The road comes down out of the last hills into Mistheim\'s lowlands: river roads, smoke from inn chimneys, more people in one market square than in all three villages together. The caravan rolls through the gate. You made it.';

/** Trust a person starts at in the first village (#1246): the caravan master vouches for a thriving Warden. */
export const BASE_TRUST: Readonly<Record<'thrive' | 'ragged', number>> = { thrive: 20, ragged: 10 };
/** Word travels: the next village starts this share of your average trust in the last one higher. */
export const WORD_TRAVELS = 0.1;
/** A talk takes this long. */
export const TALK_HOURS = 2;
/** Trust a talk earns while someone still has something to tell you, and after (diminishing from this). */
export const TALK_TRUST = 5, TALK_TRUST_TOLD = 2;
export const MAX_TRUST = 100;

/** Trust at which someone on the road becomes a contact who remembers you next time (#1250). */
export const CONTACT_TRUST = 50;

/** A lesson (#1249) takes this long, and costs this many marks — free once the teacher's trust reaches FRIEND_LESSON. */
export const LESSON_HOURS = 4, LESSON_FEE = 6, FRIEND_LESSON = 40;
/** Insight a concept lesson gives. */
export const LESSON_INSIGHT = 6;
/** An honest appraisal takes this long; once per teacher per village stay. */
export const APPRAISE_HOURS = 1;

/** The people of a village, or none outside one. */
export const peopleOf = (villageId: string | null): readonly Person[] => (villageId ? VILLAGES[villageId]?.people ?? [] : []);

/** Who `id` is, anywhere on the road. */
export const personById = (id: string): Person | undefined => Object.values(VILLAGES).flatMap(v => v.people).find(x => x.id === id);

/** The trust a village's people start at: the arrival's base, the Warden's Charisma (#1255), and the word from the last village. */
export const startingTrust = (arrival: 'thrive' | 'ragged', chaBonus: number, word: number): number =>
  Math.max(0, Math.min(MAX_TRUST, BASE_TRUST[arrival] + chaBonus + word));

/** The word that travels ahead of you (#1246): a tenth of your average trust in the village you're leaving, rounded. */
export const wordFrom = (trusts: readonly number[]): number => (trusts.length ? Math.round(WORD_TRAVELS * trusts.reduce((a, b) => a + b, 0) / trusts.length) : 0);

/**
 * One talk (pure): trust rises, and the person shares the next lore line if trust (before this talk) has
 * reached its gate. Once everything is told, talks still help, but less each time: 2, 1, 0.67…
 */
export function talk(person: Person, trust: number, told: number, idleTalks: number): { trust: number; told: number; idleTalks: number; line: string } {
  const next = person.lore[told];
  if (next && trust >= next.at) {
    return { trust: Math.min(MAX_TRUST, trust + TALK_TRUST), told: told + 1, idleTalks, line: `${person.name}: "${next.text}"` };
  }
  if (next) {
    // Something left to tell, but not yet: they're warming to you.
    return { trust: Math.min(MAX_TRUST, trust + TALK_TRUST), told, idleTalks, line: `${person.name} talks of small things, and watches you. Not yet.` };
  }
  return { trust: Math.min(MAX_TRUST, trust + TALK_TRUST_TOLD / (1 + idleTalks)), told, idleTalks: idleTalks + 1, line: `You pass an easy hour with ${person.name}.` };
}
