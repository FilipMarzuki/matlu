/**
 * What you can ask road people about their past (#1656, knowledge slice F): the topic keys the
 * history facts answer (history-in-play.ts), how a question names each, and how each reads.
 *
 * Every key starts `past:`, and only the history facts carry them, so they exist only in a run
 * with `history-in-play` on: a run without the switch has no fact about any of them, so nothing
 * here can match, open or change anything in it. They're not topics.ts topics on purpose: those
 * are what you can focus on and what lore lines mark as heard, and adding a kind there would
 * change both in every run, and the places and houses here are a seed's own (a history names its
 * own lords), not a fixed list.
 *
 * - `past:here`: what happened in the village ("What happened here?", "Any old stories?");
 * - `past:around`: what happened in its country ("What's happened in these parts?");
 * - `past:plague`, `past:famine`, `past:war`, `past:lord`, `past:murder`: an event by its kind
 *   (the engine's event kinds, `KIND_TOPICS`), and `past:lord` for who holds a place, too;
 * - `past:house:<slug>`: a house the history names ("What happened to the Crowhelms?");
 * - `past:place:<slug>`: a place in the country that isn't a road village (those have their own
 *   topics, `place:hollowford`).
 * A slug keeps every letter (`åkerman`), so a name with an Å is still asked for by its name.
 *
 * Pure: patterns and words, nothing read but the key.
 */

/** The prefix every history topic key starts with. */
export const PAST = 'past:';

/** Whether a topic key is one of these. */
export const isPastKey = (key: string): boolean => key.startsWith(PAST);

/** A name as a key's last part: lower case, every run of anything but letters and digits a dash. */
export const pastSlug = (name: string): string => name.toLowerCase().replace(/[^\p{L}\d]+/gu, '-').replace(/^-|-$/g, '');

/**
 * The engine's event kinds (the story engine's province and regional events) read as one of the
 * kinds a player asks about. A kind not listed is still asked for by place, house, or "what
 * happened here": these are only the ones people name.
 */
export const KIND_TOPICS: Readonly<Record<string, string>> = {
  PLAGUE: 'plague',
  FAMINE: 'famine',
  WAR: 'war', FEUD: 'war', BORDER_WAR: 'war', BARBARIAN_INVASION: 'war',
  SUCCESSION: 'lord', SUCCESSION_CRISIS: 'lord', USURP: 'lord', LOWBORN_RISE: 'lord', LORD_DIED: 'lord', SEAT_VACANT: 'lord', SEAT_SEIZED: 'lord',
  MURDER: 'murder', KINSLAYING_NOTORIOUS: 'murder',
};

/**
 * How the journal names an event of each of the engine's kinds (#1658: "The plague in the Wrenwood
 * country, year 68"), where the engine's own name for it doesn't read well. Any other kind is
 * named from the engine's (`SOLAR_ECLIPSE`: "the solar eclipse"), which reads well enough.
 */
const EVENT_NOUNS: Readonly<Record<string, string>> = {
  PLAGUE: 'the plague', FAMINE: 'the famine', WAR: 'the war', FEUD: 'the feud', BORDER_WAR: 'the border war', BARBARIAN_INVASION: 'the invasion',
  SUCCESSION: 'the new lord', SUCCESSION_CRISIS: 'the empty seat', USURP: 'the usurping', LOWBORN_RISE: 'the lowborn lord', LORD_DIED: 'the lord\'s death',
  SEAT_VACANT: 'the empty seats', SEAT_SEIZED: 'the seized seat', DEATH: 'the lord\'s death', MURDER: 'the murder', KINSLAYING_NOTORIOUS: 'the kinslaying',
  HARD_WINTER: 'the hard winter', HARVEST_POOR: 'the failed harvest', SHORTAGE: 'the dear bread', BANDITRY: 'the bandits', MIGRATION: 'the newcomers',
  UNREST: 'the unrest', FAIR: 'the fair', FESTIVAL: 'the festival', VENTURE_FAILING: 'the failing venture', ROAD_FAILS: 'the dwindling trade',
  SLUMP: 'the hard times', HOUSE_FALLS: 'a house\'s fall', HOUSE_RISES: 'a house\'s rise',
};

/** How the journal names an event of the engine's kind `kind` ("the plague"). */
export const eventNoun = (kind: string): string => EVENT_NOUNS[kind] ?? `the ${kind.toLowerCase().replace(/_/g, ' ')}`;

/**
 * How each fixed key is named in a question, and how it reads mid-sentence. Kept to what a player
 * would type: "plague" and "pestilence" but not "sick", which is how you ask after the healer
 * (free-questions.ts SCOPE_HINTS); "what happened" and "long ago", but not a bare "here", which
 * half of all questions have in them ("Where does the iron here come from?").
 */
const FIXED: Readonly<Record<string, { named: RegExp; about: string }>> = {
  'past:here': { named: /\b(?:what happened|happened here|history|long ago|years ago|old days|olden days|the past|old stor(?:y|ies)|legends?|remember)\b/i, about: 'what happened here' },
  'past:around': { named: /\b(?:around here|these parts|hereabouts|this country|the country|the region|this land)\b/i, about: 'what happened in these parts' },
  'past:plague': { named: /\b(?:plagues?|pestilences?|epidemics?|the sickness)\b/i, about: 'the plague' },
  'past:famine': { named: /\b(?:famines?|starv\w*|hunger|hungry years?)\b/i, about: 'the famine' },
  'past:war': { named: /\b(?:wars?|battles?|fighting|fought|feuds?|sieges?)\b/i, about: 'the wars' },
  'past:lord': { named: /\b(?:lords?|lordship|ruler|throne|heirs?|succession|usurp\w*|who holds)\b/i, about: 'who holds the place' },
  'past:murder': { named: /\b(?:murder\w*|kinslay\w*|assassinat\w*|killings?)\b/i, about: 'the killings' },
};

/**
 * What naming a history topic adds to a match, over naming any topic (free-questions.ts `NAMED`):
 * one for the particular ones, none for "what happened here" and "in these parts". A question that
 * names both ("What happened in the plague?") is asking about the plague, and without this the two
 * would tie, and the first event a person knows of would answer, whatever it was.
 */
export const pastBonus = (key: string): number => (isPastKey(key) && key !== 'past:here' && key !== 'past:around' ? 1 : 0);

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A slug as a name in a question: its parts in order, a space or a dash between, not inside a longer word. */
const nameOf = (slug: string): RegExp => new RegExp(`(?<![\\p{L}\\d])${slug.split('-').map(escape).join('[\\s-]+')}(?![\\p{L}\\d])`, 'iu');

/** Every way a history key is named in a question; none for a key that isn't one. */
export function pastPatterns(key: string): RegExp[] {
  const fixed = FIXED[key];
  if (fixed) return [fixed.named];
  const named = key.match(/^past:(?:house|place):(.+)$/u);
  return named ? [nameOf(named[1])] : [];
}

const titled = (slug: string): string => slug.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

/** How a history key reads mid-sentence ("the plague", "the house of Crowhelm"), or null for a key that isn't one. */
export function pastAbout(key: string): string | null {
  if (FIXED[key]) return FIXED[key].about;
  const house = key.match(/^past:house:(.+)$/u);
  if (house) return `the house of ${titled(house[1])}`;
  const place = key.match(/^past:place:(.+)$/u);
  return place ? titled(place[1]) : null;
}
