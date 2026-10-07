/**
 * Sim invariants: things that must hold in any state, whatever was played.
 * The random players check these every turn, so hundreds of random runs act
 * as a fuzz test of the sim core.
 */

import { SITES, type Region1State } from '../artificer/region1';
import { maxLoad } from '../artificer/load';
import type { RoadState } from '../artificer/road';
import { QUESTS } from '../artificer/quests';
import { pinCapacity } from '../artificer/pins';

/** Every broken invariant in `s`, as readable messages (empty when all is well). */
export function invariantViolations(s: Region1State): string[] {
  const out: string[] = [];
  const num = (label: string, x: number, lo = 0, hi = Infinity): void => {
    if (!Number.isFinite(x)) out.push(`${label} is ${x}`);
    else if (x < lo || x > hi) out.push(`${label} = ${x} outside [${lo}, ${hi}]`);
  };
  for (const [k, v] of Object.entries(s.stores)) num(`stores.${k}`, v);
  const v = s.vitals;
  num('vigor', v.vigor.current, 0, v.vigor.cap);
  num('clarity', v.clarity.current, 0, v.clarity.cap);
  num('vigor cap', v.vigor.cap, 50, 150);
  num('clarity cap', v.clarity.cap, 50, 150);
  num('condition', v.condition, 0, 100);
  num('tier', s.tier, 0, 2);
  for (const [k, c] of Object.entries(s.concepts)) { num(`concept ${k} rank`, c.rank); num(`concept ${k} insight`, c.insight); }
  if (new Set(s.known).size !== s.known.length) out.push('known recipes has duplicates');
  if (s.tier > 0 && !s.site) out.push('a shelter with no site');
  // Carrying (#1297): never more carried than can be lifted, strain never negative, a cold pit only at a real site.
  if (s.tally) {
    num('tally heaviest carried', s.tally.heaviest, 0, maxLoad(s.character.stats));
    num('tally stones left behind', s.tally.leftStones);
    num('tally overloaded hours', s.tally.overloadedHours);
    num('tally spoiled', s.tally.spoiled);
  }
  num('strain', s.strain ?? 0);
  if (s.coldPitAt && !(s.coldPitAt in SITES)) out.push(`cold pit at unknown site ${s.coldPitAt}`);
  // Encounters (#1348): a turn never ends with one still waiting for a choice.
  if (s.pending) out.push(`encounter ${s.pending.id} still waiting at the end of the turn`);
  // Pins (#1381): never more than memory holds, never the same place twice.
  const pins = s.pins ?? [];
  if (pins.length > pinCapacity(s)) out.push(`${pins.length} pins held, but memory holds ${pinCapacity(s)}`);
  if (new Set(pins.map(p => p.id)).size !== pins.length) out.push('the same place pinned twice');
  return out;
}

/** Road invariants (#1251): marks never negative, trust within 0–100, no quest done twice — and the body's numbers in range. */
export function roadInvariantViolations(r: RoadState): string[] {
  const out: string[] = [];
  const num = (label: string, x: number, lo = 0, hi = Infinity): void => {
    if (!Number.isFinite(x)) out.push(`${label} is ${x}`);
    else if (x < lo || x > hi) out.push(`${label} = ${x} outside [${lo}, ${hi}]`);
  };
  num('marks', r.marks);
  for (const [id, t] of Object.entries(r.trust)) num(`trust ${id}`, t, 0, 100);
  for (const [k, v] of Object.entries(r.stores)) num(`stores.${k}`, v);
  const v = r.vitals;
  num('vigor', v.vigor.current, 0, v.vigor.cap);
  num('clarity', v.clarity.current, 0, v.clarity.cap);
  num('condition', v.condition, 0, 100);
  for (const [id, st] of Object.entries(r.quests)) if (!['active', 'done', 'failed', 'expired'].includes(st)) out.push(`quest ${id} has status ${st}`);
  // A quest pays out once: its "<title> done —" line appears at most once in the journal.
  for (const q of QUESTS) {
    const n = r.log.filter(l => l.text.includes(`${q.title} done —`)).length;
    if (n > 1) out.push(`quest ${q.id} completed ${n} times`);
  }
  if (new Set(r.known).size !== r.known.length) out.push('known recipes has duplicates');
  if (new Set(r.techniques).size !== r.techniques.length) out.push('techniques has duplicates');
  return out;
}
