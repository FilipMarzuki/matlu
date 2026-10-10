/**
 * Asking people about what you're focused on (#1495, epic #1493 — docs/focus-and-dialogue-design.md §2).
 *
 * Talking to someone on the road is a short conversation: Chat (the lore line, `talk` in
 * villages.ts) and **Ask about <your focus>**. Focus is attention: what you're turning over is
 * what you think to ask about. The person:
 * - **knows**: an answer, told once their trust reaches its gate;
 * - **won't say yet**: they know, and you're still a stranger;
 * - **doesn't know**: which is worth knowing too.
 *
 * What they name in an answer you've come across (`mentionsIn`), so an answer can point you on:
 * "Sabine at Kestrel Gate works it" opens Sabine, and Kestrel Gate, as a focus.
 *
 * Pure: the answers, and `ask`. The road (`ask:<person>`) applies the result.
 */

import { VILLAGES, TRAVELLERS, type Person } from './villages';
import { SKILLS, type SkillId } from './skills';

/** An ask is an hour's talk. */
export const ASK_HOURS = 1;
/** The trust an answer earns: people like being asked about what they know. */
export const ASK_TRUST = 2;
/** A lead is worth one trust gate with the person it points to, on its topic: someone sent you (#1497). */
export const LEAD_TRUST = 25;

export interface Answer {
  /** The trust it takes before they'll say it. */
  at: number;
  text: string;
  /** Insight in a concept, for an answer that teaches something. */
  insight?: { concept: string; amount: number };
  /** Someone elsewhere the answer sends you to (#1497): a person id, and what about (the topic asked, unless said). */
  lead?: { who: string; about?: string };
}

/**
 * A lead (#1497): someone an answer pointed you to. Who (a person id), where (their village, if
 * they have one), about what (a focus key), and who told you (a person id).
 */
export interface Lead { who: string; where?: string; about: string; from: string }

/**
 * What people know, by person id and focus key (`material:iron`, `group:compact`, `skill:…`,
 * `concept:…`). The first content (#1498): iron, the Compact (the goblins' — the Pandor's Compact
 * of Knowing only comes up through Anselm), smiths, foraging, Kestrel Gate, and Tobin's hides for
 * Hedda, across the three villages and the caravan. Iron is one lead chain: Orrin at Hollowford
 * (or Yrsa at Saltmere) → Sabine at Kestrel Gate.
 */
export const ANSWERS: Readonly<Record<string, Readonly<Record<string, Answer>>>> = {
  // Hollowford's smith: a woodwright with an anvil. He sends you on to the Gate for iron and for smithing.
  'hf-orrin': {
    'material:iron': { at: 25, text: 'Iron? Not from these hills. They give stone and grudges. Sabine at Kestrel Gate works it; the ironborne bring ore down off the passes, and she buys the best of it.', lead: { who: 'kg-sabine' } },
    'role:smith': { at: 0, text: 'A smith? I\'m a woodwright who owns an anvil. Real smithing wants iron and a reason to use it, and the Gate has both. Sabine there would laugh at my forge, and then show you something worth knowing.', lead: { who: 'kg-sabine' } },
    'place:kestrel-gate': { at: 0, text: 'Steinfolk on the wall, Bergfolk in the hold above it, and a market crammed in between. Everything costs more inside. Except iron.' },
  },
  // A goblin of the Compact (his sign: the seal token). Free with prices, close with the Compact.
  'hf-tobin': {
    'material:iron': { at: 0, text: 'Iron travels badly and sells well. I\'ve never had enough to sell. Everything that goes through Kestrel Gate pays a toll in something, and the smiths there take theirs in ore.' },
    'group:compact': { at: 50, text: 'The Compact is what big folk call goblins helping goblins. Fine: we help each other. A well that\'s turned, a road that\'s closed, a ruin that\'s opened — we hear it first, and it\'s never written down. That\'s all you get, friend, and it\'s more than most.' },
    'quest:hf-hides-saltmere': { at: 0, text: 'Two hides, to Hedda, in Saltmere. If you\'ve none of your own, I sell them, and once we\'re friends I sell them cheaper. I\'d rather the debt was paid than argue about whose hides paid it.' },
    'place:kestrel-gate': { at: 0, text: 'Sell before the wall if you can. Inside, every price has the toll folded into it, and Arvid will smile at you until you name yours first.' },
  },
  // Not of the Compact, so she says what she's seen of it.
  'hf-maren': {
    'group:compact': { at: 25, text: 'There\'s a goblin band in the old quarry above the ford. When the mill wheel cracked, no wright would come up from the lowlands; they had it turning in a day, and took barley for it. Tobin calls them the Compact. I call them neighbours, and I don\'t ask where the tools came from.' },
    'quest:hf-hides-saltmere': { at: 0, text: 'Tobin buys every skin off our folds, then asks a stranger to carry two of them away. If you\'ve none, buy them back from him. He\'ll name a price. Pay it; Hedda\'s waited long enough.' },
    'place:kestrel-gate': { at: 25, text: 'My brother went through the Gate once and came home with a stamped paper saying so. He kept it on the wall until it went yellow. That\'s the Gate: they count you, and you remember being counted.' },
  },
  // She teaches foraging, and points you up the mountain to Runa for the high slopes.
  'hf-isa': {
    'skill:foraging': { at: 0, text: 'Foraging? That\'s what I teach: greens, roots, fungi, the low country\'s larder. Never eat a white-gilled cap you can\'t name. The high slopes are another book; Runa at Kestrel Gate sends people up for feverfew. Ask her what grows above the ash.', insight: { concept: 'toxicology', amount: 0.5 }, lead: { who: 'kg-runa' } },
  },
  // The other end of Tobin's hides; a Deepwalker who remembers who paid in what.
  'sm-hedda': {
    'quest:hf-hides-saltmere': { at: 0, text: 'Tobin\'s hides! Two springs he\'s owed me those. If you\'ve brought them, I\'ll pay you what he should have; if you haven\'t, tell him I asked after him. Sweetly.' },
    'group:compact': { at: 25, text: 'Goblins pay in news, and the news is usually good. A Deepwalker remembers who paid in what: the Compact has never once paid me in a lie. I can\'t say as much for the caravan master.' },
    'place:kestrel-gate': { at: 0, text: 'Salt goes up to the Gate by the cartload and comes back as coin, less the toll. Always less the toll.' },
  },
  // A Pandor: the Compact of Knowing obliges him to tell anyone who asks, even about the goblins' Compact.
  'sm-anselm': {
    'group:compact': { at: 0, text: 'The goblins\' Compact? They sell us what their [Delvers] find in the ruins, and we write it down, because we write everything down. Then the Compact of Knowing obliges us to tell anyone who asks. They have never forgiven us for that. They have never stopped selling, either.' },
    'material:iron': { at: 25, text: 'The book has Kestrel Gate\'s iron price for every year since the wall was built. The ore comes down off the passes on ironborne backs, and the price has doubled in forty winters. The book does not say why. I have my suspicions.' },
  },
  // Her arrowheads are Gate iron (her sign); she sends you to Sabine too.
  'sm-yrsa': {
    'material:iron': { at: 25, text: 'My arrowheads are iron, from the Gate. Flint is free and iron is dear, but an iron point comes back out of the deer. Sabine makes them. She\'ll tell you more than I can, if you can get her off the subject of hinges.', lead: { who: 'kg-sabine' } },
    'skill:foraging': { at: 0, text: 'I hunt; I don\'t graze. But I know what the deer eat, and where they browse, you can. Isa at Hollowford taught me the rest.' },
  },
  // The end of the iron chain. She doesn't teach strangers, but one Orrin (or Yrsa) sent is no stranger: a lead opens her answers at trust 0.
  'kg-sabine': {
    'material:iron': { at: 25, text: 'Heat it to the colour of a fire going out, never white. White burns the heart out of it. Then let it tell you when it\'s ready; good iron sings.', insight: { concept: 'heat-treatment', amount: 0.5 } },
    'role:smith': { at: 25, text: 'Smithing is listening: strike, hear what it says, strike again. Orrin at Hollowford knows it too, whatever he tells you about being a woodwright. He\'s hold-trained. You can hear it in how he sets an edge.', insight: { concept: 'sharpening', amount: 0.5 } },
    'place:kestrel-gate': { at: 0, text: 'Every hinge on that gate is mine. When the toll-keeper complains about the squeak, I tell him it\'s the gate counting.' },
  },
  // A goblin of the Compact (his sign: the map case). He talks freely about everything but that.
  'kg-arvid': {
    'group:compact': { at: 50, text: 'The Compact pays in maps. Not money. Maps of places that aren\'t on anyone else\'s, and they never sell the same one twice.' },
    'material:iron': { at: 0, text: 'Iron is the one thing that\'s cheaper inside the wall than out. Sabine buys the best ore; whatever she doesn\'t want, I sell on to people who can\'t tell the difference.' },
    'place:kestrel-gate': { at: 0, text: 'The Gate is a market with a wall round it. Everything here has a price, and the toll is only the first one.' },
  },
  // The Gate's elder.
  'kg-veit': {
    'group:compact': { at: 25, text: 'The Compact\'s people come through with stamped tokens instead of papers. We let them. The gate has needed a goblin to mend its winch more often than the wall likes to remember.' },
    'place:kestrel-gate': { at: 0, text: 'You will be counted: wagons, heads and goods. Do not take it personally. We count the kestrels too.' },
  },
  // She teaches stonework, knows the high slopes' herbs, and sends you back to Isa for the low country.
  'kg-runa': {
    'skill:foraging': { at: 25, text: 'Above the ash line the herbs grow bitter and true: feverfew, stonebreak, mountain sorrel. Below it, Isa\'s book serves you better than mine. Pick nothing that grows in the ash itself, however green.', insight: { concept: 'toxicology', amount: 0.5 } },
    'role:smith': { at: 25, text: 'In the holds the forge is the second hearth, and the smith keeps it. Sabine was hold-trained before she went down to the encampment. Ask her why she left; she likes being asked.' },
  },
  // The caravan's own, asked on the travel days between villages.
  'cv-bodil': {
    'place:kestrel-gate': { at: 0, text: 'The Gate counts the wagons, then the people, then the wagons again in case one walked off. Pay the toll, nod to the kestrels, and we\'re through by noon.' },
    'quest:hf-hides-saltmere': { at: 0, text: 'Hedda\'s owed hides by half the valley. Keep them under the wagon cover; wet hide stinks by Saltmere, and she\'ll complain about the smell for a week.' },
  },
  'cv-pim': {
    'material:iron': { at: 0, text: 'Iron\'s what every axle wants and nobody up here has. Every pin I mend with is Gate iron, bought dear and saved twice.' },
    'group:compact': { at: 50, text: 'Every band keeps its own counsel, and the Compact is only bands talking to each other. I mostly talk to axles. They keep secrets better.' },
    'place:kestrel-gate': { at: 0, text: 'The gate winch is goblin work under Steinfolk paint. Don\'t tell Veit I said so.' },
  },
  'cv-ottilia': {
    'skill:foraging': { at: 0, text: 'Most of the road\'s medicine grows at its edges, where the carts don\'t crush it. Isa at Hollowford knows the low country better than I do, and she\'s younger than my walking stick.' },
  },
  'cv-runa': {
    'place:kestrel-gate': { at: 0, text: 'The Gate\'s verse is the shortest in the song: wall, toll, count, through. The prices are in the chorus, and the chorus climbs every year.' },
  },
};

/** Everyone on the road, by id: the villages' people and the caravan's own. */
const PEOPLE: Readonly<Record<string, Person>> = Object.fromEntries([...Object.values(VILLAGES).flatMap(v => v.people), ...TRAVELLERS].map(p => [p.id, p]));

/** Where `who` lives: a village id, or undefined for someone on the road (the caravan's own). */
const homeOf = (who: string): string | undefined => Object.values(VILLAGES).find(v => v.people.some(p => p.id === who))?.id;

/** The lead an answer gives, told by `from` when asked about `key`. */
export function leadOf(a: Answer, key: string, from: string): Lead | undefined {
  if (!a.lead || !PEOPLE[a.lead.who]) return undefined;
  const where = homeOf(a.lead.who);
  return { who: a.lead.who, ...(where ? { where } : {}), about: a.lead.about ?? key, from };
}

/**
 * A saved lead, checked against what people say: kept only if `from` has an answer that sends you
 * to `who` about `about`, and rebuilt from that answer (so `where` comes from the data, not the save).
 * A lead no answer gives is dropped, as a saved focus you can no longer hold is (`readFocus`).
 */
export function leadOnLoad(who: string, about: string, from: string): Lead | undefined {
  for (const [key, a] of Object.entries(ANSWERS[from] ?? {})) {
    const l = leadOf(a, key, from);
    if (l && l.who === who && l.about === about) return l;
  }
  return undefined;
}

/** Whether a lead sends you to `who` about `key`: they'll answer it one trust gate early. */
export const sentTo = (leads: readonly Lead[] | undefined, who: string, key: string): boolean => (leads ?? []).some(l => l.who === who && l.about === key);

/** A teacher always knows their own skill: they'll tell anyone, and point them to a lesson. */
function teacherAnswer(p: Person, key: string): Answer | undefined {
  if (!p.teaches || key !== `skill:${p.teaches.skill}`) return undefined;
  const name = SKILLS[p.teaches.skill as SkillId]?.name ?? p.teaches.skill;
  const shows = p.teaches.techniques.length ? ` I can show you ${p.teaches.techniques.length === 1 ? 'one way' : `${p.teaches.techniques.length} ways`} to do it better.` : '';
  return { at: 0, text: `${name}? That's what I teach.${shows} Come and learn when you have the time.` };
}

/** What `personId` would say about the focus `key`, if they know anything (and at what trust). */
export function answerFor(personId: string, key: string): Answer | undefined {
  const p = PEOPLE[personId];
  return ANSWERS[personId]?.[key] ?? (p ? teacherAnswer(p, key) : undefined);
}

export type AskResult =
  | { kind: 'told'; line: string; answer: Answer }
  | { kind: 'not-yet'; line: string }
  | { kind: 'unknown'; line: string }
  /** Asked and answered before: nothing new, and no time spent. */
  | { kind: 'again'; line: string };

/**
 * Ask `p` about the focus `key` (`about` is how it reads mid-sentence: "iron", "the Compact"),
 * given their trust in you and the topics they've already answered.
 */
export function ask(p: Person, key: string, about: string, trust: number, answered: readonly string[]): AskResult {
  if (answered.includes(key)) return { kind: 'again', line: `${p.name} has already told you what they know about ${about}.` };
  const a = answerFor(p.id, key);
  if (!a) return { kind: 'unknown', line: `${p.name} thinks, and shakes their head. "I don't know much about ${about}."` };
  if (trust < a.at) return { kind: 'not-yet', line: `${p.name} looks at you a long moment. "Maybe. Ask me again when I know you better."` };
  return { kind: 'told', line: `${p.name}: "${a.text}"`, answer: a };
}
