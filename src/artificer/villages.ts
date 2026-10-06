/**
 * Region 1.5 villages and people (#1246, epic #1235).
 *
 * Each village on the caravan road is a handful of people. Each has a role, a
 * culture (from `macro-world/cultures.json` — cultures are race-agnostic), one
 * need, and a few lore lines they share only as they come to trust you.
 * Trust is per person, 0–100. Trade, quests and teaching (#1247–#1249) build
 * on it.
 *
 * Names and lore are placeholders until the lore pass (#1253).
 * Pure data plus pure helpers; road.ts holds the state.
 */

import type { SkillId } from './skills';

export type Role = 'trader' | 'teacher' | 'healer' | 'elder' | 'smith' | 'hunter';

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

export interface Person {
  id: string;
  name: string;
  role: Role;
  /** A culture id from macro-world/cultures.json. */
  culture: string;
  need: Need;
  /** 3–5 lines, in the order they're told, each gated by trust (0 / 25 / 50 / 75). */
  lore: readonly LoreLine[];
  /** Set for anyone who teaches (#1249) — not only the `teacher` role: a smith or a hunter can too. */
  teaches?: Teaching;
}

export interface Village { id: string; name: string; people: readonly Person[] }

const p = (id: string, name: string, role: Role, culture: string, need: Need, lore: [number, string][], teaches?: Teaching): Person =>
  ({ id, name, role, culture, need, lore: lore.map(([at, text]) => ({ at, text })), ...(teaches ? { teaches } : {}) });

/** The three villages on the road to Mistheim (ids match road.ts's ROUTE). Placeholder content until #1253. */
export const VILLAGES: Readonly<Record<string, Village>> = {
  hollowford: {
    id: 'hollowford', name: 'Hollowford', people: [
      p('hf-maren', 'Maren', 'elder', 'fieldborn', { kind: 'job', job: 'mend the ford stones' }, [
        [0, 'The ford was here before the village. We only built where it let us.'],
        [25, 'Every spring the caravan brings someone half-dead out of the Reach. You look better than most.'],
        [50, 'My grandmother said the Reach takes one winter in three. She never said which.'],
      ]),
      p('hf-tobin', 'Tobin', 'trader', 'caravan-folk', { kind: 'job', job: 'carry hides to Saltmere' }, [
        [0, 'Hides, salt, a good knife — I buy what travels well.'],
        [25, 'The salt road runs through Saltmere. Prices there are honest, mostly.'],
        [50, 'Kestrel Gate taxes everything that moves. Sell before you get there.'],
      ]),
      p('hf-isa', 'Isa', 'healer', 'grovekin', { kind: 'item', item: 'rawFood', qty: 4 }, [
        [0, 'Sit. Let me see those hands — frost leaves marks you don\'t feel yet.'],
        [25, 'Willow bark for pain, pine resin for wounds. The Reach grows both.'],
        [50, 'Exhaustion kills more travellers than wolves. Rest is medicine.'],
        [75, 'I came from the Reach too, once. I never went back.'],
      ], { skill: 'foraging', techniques: ['greens', 'roots', 'fungi'], recipes: [] }),
      p('hf-orrin', 'Orrin', 'smith', 'ridgefolk', { kind: 'item', item: 'firewood', qty: 4 }, [
        [0, 'Bring me good stone and I\'ll show you an edge.'],
        [25, 'A crude tool is a promise you\'ll fix it later. Make it sound the first time.'],
        [50, 'The old smiths of the ridge never quenched in water. Oil, always oil.'],
      ], { skill: 'woodcraft', techniques: ['grain', 'notching', 'seasoning'], recipes: [], concept: 'sharpening' }),
    ],
  },
  saltmere: {
    id: 'saltmere', name: 'Saltmere', people: [
      p('sm-hedda', 'Hedda', 'trader', 'harborfolk', { kind: 'item', item: 'rations', qty: 3 }, [
        [0, 'Salt fish, salt pork, salt everything. The mere gives and we keep.'],
        [25, 'A ration smoked well lasts the winter. Smoked badly, a week.'],
        [50, 'The caravan master owes me three barrels. Don\'t tell him I said so.'],
      ]),
      p('sm-anselm', 'Anselm', 'teacher', 'workshop-collective', { kind: 'job', job: 'copy out a ledger' }, [
        [0, 'Most people learn by burning their fingers. Some learn by watching.'],
        [25, 'Ask the right question and a craft opens like a door.'],
        [50, 'I kept the Reach\'s survivors\' notes for twenty years. Few wrote much.'],
        [75, 'There is a tally-book somewhere in the Reach. If you found it — you were lucky.'],
      ], { skill: 'handcraft', techniques: ['weave', 'sewing', 'patterns'], recipes: ['hide-parka', 'waterskin'], concept: 'sealing' }),
      p('sm-yrsa', 'Yrsa', 'hunter', 'steppe-camp', { kind: 'job', job: 'scout the mere shore' }, [
        [0, 'The mere birds come at dusk. Patience gets you more than arrows.'],
        [25, 'Snow tells you everything an animal did. Mud lies.'],
        [50, 'I tracked a wolf pack into the Reach once. They were following a Warden.'],
      ], { skill: 'hunting', techniques: ['sign', 'stalking', 'dressing'], recipes: ['trap-snare'] }),
      p('sm-gunnar', 'Gunnar', 'elder', 'waterstead', { kind: 'job', job: 'clear the sluice' }, [
        [0, 'The mere is lower every year. Nobody listens to old men about water.'],
        [25, 'Saltmere was a fishing camp before it was a town. The fish remember.'],
        [50, 'Mistheim sends for salt and never sends back what it promises.'],
      ]),
      p('sm-liv', 'Liv', 'healer', 'refuge-keepers', { kind: 'item', item: 'waterskin', qty: 1 }, [
        [0, 'Clean water first. Everything else after.'],
        [25, 'Half the fevers on the road come from bad wells.'],
        [50, 'We take in anyone the road spits out. That\'s what a refuge is.'],
      ]),
    ],
  },
  'kestrel-gate': {
    id: 'kestrel-gate', name: 'Kestrel Gate', people: [
      p('kg-veit', 'Veit', 'elder', 'wallborn', { kind: 'job', job: 'carry a message to Mistheim' }, [
        [0, 'Kestrel Gate keeps the road. The road keeps us.'],
        [25, 'The toll pays for the wall. The wall pays for the peace.'],
        [50, 'Mistheim is not what the caravan songs say. Go anyway.'],
        [75, 'The gate was built against something from the Reach. We stopped saying what.'],
      ]),
      p('kg-sabine', 'Sabine', 'smith', 'ironborne-encampment', { kind: 'item', item: 'materials', qty: 5 }, [
        [0, 'Gate hinges, cart axles, arrowheads. A smith here never runs out of work.'],
        [25, 'Good iron sings when you strike it. Bad iron argues.'],
        [50, 'I could teach you the forge, if you stayed. Nobody stays.'],
      ]),
      p('kg-arvid', 'Arvid', 'trader', 'bazaar-folk', { kind: 'item', item: 'firewood', qty: 6 }, [
        [0, 'Everything has a price at the Gate. Some prices are friendship.'],
        [25, 'Mistheim buys Reach-made tools for silly money. Bring something sound.'],
        [50, 'The toll-keeper drinks. Arrive at dusk.'],
      ]),
      p('kg-runa', 'Runa', 'teacher', 'mountainhold', { kind: 'job', job: 'gather mountain herbs' }, [
        [0, 'A mountain teaches slowly and forgives nothing.'],
        [25, 'Stonework is patience with a hammer.'],
        [50, 'The dry-stone walls of the hold have stood three hundred years.'],
        [75, 'I could show you how. It takes a season, not a day.'],
      ], { skill: 'stonework', techniques: ['cleave', 'knapping', 'drystone'], recipes: [], concept: 'joinery' }),
    ],
  },
};

/** Trust a person starts at in the first village (#1246): the caravan master vouches for a thriving Warden. */
export const BASE_TRUST: Readonly<Record<'thrive' | 'ragged', number>> = { thrive: 20, ragged: 10 };
/** Word travels: the next village starts this share of your average trust in the last one higher. */
export const WORD_TRAVELS = 0.1;
/** A talk takes this long. */
export const TALK_HOURS = 2;
/** Trust a talk earns while someone still has something to tell you, and after (diminishing from this). */
export const TALK_TRUST = 5, TALK_TRUST_TOLD = 2;
export const MAX_TRUST = 100;

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
