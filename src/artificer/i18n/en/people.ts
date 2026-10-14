/**
 * The road's people in English (#1709, phase 3 of #1685): what each person is like and says, their
 * quests, what they answer when asked, what they tell back of your deeds, the signs a sharp eye
 * notices, the techniques teachers teach, and what each village lives on. Turned into catalog keys
 * straight from the sim's own data (villages.ts, quests.ts, answers.ts, asks.ts, notice.ts,
 * techniques.ts, economy.ts...), so the English has one copy: the AI player and the API read the
 * same words from the data. The Swedish is written by hand in ../sv/people.ts, keyed by the same
 * ids; the catalog test holds it to every key here.
 *
 * The keys are by id (`person.hf-maren.lore.2`), never by the English, so a reworded line keeps its
 * Swedish key (and the catalog test flags that the Swedish wants a look only through review, not a
 * crash). The page finds a line's key from its English when the sim hands it over as finished text
 * (a quote in the journal): see the app's sim-words.ts `phrase`.
 */

import { VILLAGES, TRAVELLERS, MISTHEIM_ARRIVAL, type Person } from '../../villages';
import { QUESTS } from '../../quests';
import { ANSWERS } from '../../answers';
import { TELLS } from '../../asks';
import { SIGNS } from '../../notice';
import { TECHNIQUES } from '../../techniques';
import { VILLAGE_ECONOMY } from '../../economy';
import { HARM_LORE } from '../../injuries';
import { DEFLECTIONS } from '../../free-questions';

const EVERYONE: readonly Person[] = [...Object.values(VILLAGES).flatMap(v => v.people), ...TRAVELLERS];

type PeopleKey =
  | `person.${string}.personality` | `person.${string}.lore.${number}`
  | `quest.${string}.${'title' | 'offer' | 'thanks'}`
  | `ans.${string}.${string}` | `tell.${string}.${string}.${'label' | 'answer'}` | `sign.${string}.${string}`
  | `tech.${string}` | `tech.${string}.how`
  | `econ.${string}.${'scene' | 'story' | 'fuel'}`
  | `harmlore.${string}` | `deflect.${number}` | 'phr.mistheimArrival';

export const people = Object.fromEntries([
  ...EVERYONE.flatMap(p => [[`person.${p.id}.personality`, p.personality], ...p.lore.map((l, i) => [`person.${p.id}.lore.${i}`, l.text])]),
  ...QUESTS.flatMap(q => [[`quest.${q.id}.title`, q.title], [`quest.${q.id}.offer`, q.offer], [`quest.${q.id}.thanks`, q.thanks]]),
  ...Object.entries(ANSWERS).flatMap(([pid, byKey]) => Object.entries(byKey).map(([key, a]) => [`ans.${pid}.${key}`, a.text])),
  ...Object.entries(TELLS).flatMap(([pid, byDeed]) => Object.entries(byDeed).flatMap(([deed, t]) => [[`tell.${pid}.${deed}.label`, t.label], [`tell.${pid}.${deed}.answer`, t.answer.text]])),
  ...Object.entries(SIGNS).flatMap(([pid, byTopic]) => Object.entries(byTopic).map(([topic, sign]) => [`sign.${pid}.${topic}`, sign])),
  ...TECHNIQUES.flatMap(t => [[`tech.${t.id}`, t.name], [`tech.${t.id}.how`, t.how]]),
  ...Object.entries(VILLAGE_ECONOMY).flatMap(([v, e]) => [[`econ.${v}.scene`, e.scene], [`econ.${v}.story`, e.story], [`econ.${v}.fuel`, e.fuel.line]]),
  ...Object.entries(HARM_LORE).map(([h, text]) => [`harmlore.${h}`, text]),
  ...DEFLECTIONS.map((d, i) => [`deflect.${i}`, d]),
  ['phr.mistheimArrival', MISTHEIM_ARRIVAL],
]) as Record<PeopleKey, string>;
