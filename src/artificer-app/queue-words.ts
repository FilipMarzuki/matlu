/**
 * The queue's warnings and the status chips' tooltips in the viewer's language (#1709, the part of
 * a day at camp phase 2 left over): a session's plan, a blizzard's danger, an injury the work could
 * worsen, how uneasy a trip will be, what a remembered place does for it, and the pain, night and
 * injury chips. Each is built from the sim's numbers and ids (or, for a plan or a danger the sim
 * hands over as English, read back through its template), so the sim's own English, which the AI
 * and the API read, is untouched.
 */

import type { Key, T } from '../artificer/i18n';
import type { Ring } from '../artificer/exploration';
import { pinYield, placeName, type Pin } from '../artificer/pins';
import { injuryView, INJURY_COST, AGGRAVATE_CHANCE, KNOWS, type Injury } from '../artificer/injuries';
import { PAIN_DRAIN, PAIN_HOURS, PAIN_NIGHT } from '../artificer/pain';
import type { Threat } from '../artificer/panic';
import { wordText } from './sim-words';

/** One or other of a plural pair (`.one`/`.other`), chosen by `n`. */
const plural = (t: T, key: string, n: number, vars: Record<string, string | number> = {}): string => t(`${key}.${n === 1 ? 'one' : 'other'}` as Key, { n, ...vars });

/** A small word the sim uses (an unease's reason, an injury's name), in the viewer's language; as it came if the catalog lacks it. */
const word = (v: string, t: T): string => wordText(v, t) ?? v;
/** A place you remember, by name ("the deep pool"). */
const placeText = (p: Pin, t: T): string => word(placeName(p), t);

/** What a remembered place does for this trip (pins.ts tripPinNote): "📌 the deep pool: +1 water". Null if none touches it. */
export function pinNoteText(pins: readonly Pin[] | undefined, action: string, ring: Ring, t: T): string | null {
  const notes: string[] = [];
  for (const p of (pins ?? []).filter(x => x.ring === ring)) {
    const extra = pinYield([p], action, ring);
    const what = action === 'quarry' || action === 'gatherstone' ? t('storeword.stone') : action === 'gather' ? t('storeword.rawFood') : action === 'fish' ? t('queue.pin.fish') : t('storeword.water');
    if (extra) notes.push(t('queue.pin.yield', { place: placeText(p, t), n: extra, what }));
    else if (p.feeling === 'peaceful' || p.feeling === 'eerie') notes.push(t(p.feeling === 'peaceful' ? 'queue.pin.calmer' : 'queue.pin.uneasy', { place: placeText(p, t) }));
  }
  return notes.length ? `📌 ${notes.join(' · ')}` : null;
}

/** How a trip will feel (#1364): its reasons, and what that will do to you. */
export function uneaseText(u: { state: 'shaken' | 'panicked'; reasons: readonly string[] }, t: T): { text: string; tip: string } {
  const reasons = u.reasons.filter(r => r !== 'ground you know').map(r => word(r, t));
  return {
    text: `🌑 ${reasons.join(' · ')} — ${t(u.state === 'shaken' ? 'queue.uneasy' : 'queue.mayPanic')}`,
    tip: t(u.state === 'panicked' ? 'queue.uneaseTipPanic' : 'queue.uneaseTip'),
  };
}

/** The pain chip's tooltip (#1409): what pain at this level costs. */
export function painTip(p: number, t: T): string {
  if (p < 2) return t('chip.painAche');
  return PAIN_HOURS[p] > 1
    ? t('chip.painSharpSlow', { x: PAIN_DRAIN[p], h: PAIN_HOURS[p], n: PAIN_NIGHT[p] })
    : t('chip.painSharp', { x: PAIN_DRAIN[p], n: PAIN_NIGHT[p] });
}

/** The night chip's tooltip (#1364): how tonight looks, why, and what that will cost. */
export function nightTip(f: { state: 'shaken' | 'panicked'; perceived: Threat; reasons: readonly string[] }, t: T): string {
  const why = f.reasons.filter(r => r !== 'home' && !r.startsWith('a warm')).map(r => word(r, t)).join(', ');
  return t('chip.nightTip', { threat: t(`threat.${f.perceived}` as Key), why, what: t(f.state === 'shaken' ? 'chip.nightUneasy' : 'chip.nightSleepless') });
}

/** An injury's name as you understand it (injuries.ts injuryView), in the viewer's language. */
export const injuryName = (i: Injury, fa: number, t: T): string => word(injuryView(i, fa).name, t);

/** An injury chip: its name, how bad, the nights left — and the tooltip saying all of it (injuries.ts injuryWords). */
export function injuryChip(i: Injury, fa: number, t: T): { parts: string[]; tip: string } {
  const v = injuryView(i, fa);
  const name = word(v.name, t);
  const sev = v.severity ? t(`inj.sev.${v.severity}` as Key) : v.badness ? t(`inj.bad.${v.badness}` as Key) : '';
  const parts = [name.toUpperCase(), sev.toUpperCase() || null, v.nights !== undefined ? plural(t, 'chip.injNights', v.nights) : null].filter((x): x is string => !!x);
  const cost = v.severity
    ? (i.kind === 'cut' ? t('inj.cost.cut') : t(i.kind === 'sprain' ? 'inj.cost.sprain' : 'inj.cost.hand', { x: INJURY_COST[i.severity] }))
    : t(`inj.felt.${i.kind}` as Key);
  const words = [
    v.severity ? t('inj.name', { sev, name }) : name,
    cost,
    v.nights !== undefined ? plural(t, 'inj.nights', v.nights) : null,
    v.treated ? t('inj.treated', { how: t(`inj.treated.${v.treated}` as Key) }) : t('inj.untreated'),
    v.risk && i.kind !== 'cut' ? (v.worsenChance ? t('inj.riskChance', { n: Math.round(AGGRAVATE_CHANCE * 100) }) : t('inj.risk')) : null,
    v.festers ? t('inj.festers') : null,
    v.willMark ? t('inj.mark') : null,
  ].filter(Boolean).join(', ');
  return { parts, tip: `${words}.${fa < KNOWS.severity ? t('chip.injUnsure') : ''}` };
}
