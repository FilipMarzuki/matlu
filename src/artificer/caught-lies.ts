/**
 * What a caught lie costs (#1660, a follow-up to rumours and lies, #1580). The journal
 * (journal.ts) already catches a lie: two accounts clash, or the Warden goes and looks. Here is
 * what happens when the Warden shows the liar they know, by asking them again with the clash in
 * hand. It depends on why they lied (claims.ts `LieReason`, the owner's answers of 2026-10-12):
 * - **protective** or **loyal** (covering for a friend, keeping a group's business): they come
 *   clean, tell the truth, and say why. Catching it is rewarded with the truth.
 * - **greedy** (lying for gain): their trust drops (CAUGHT_TRUST), they guard their other secrets
 *   more (GUARDED: every gate of theirs reads that much higher), and their friends hear of it
 *   (CAUGHT_WORD, scaled by how much each thinks of the liar, as ties.ts `tieWord` scales help).
 *
 * **What's kept.** A confrontation is written into `asked`, in order, as `caught:<topic>`, after
 * the `claimed:<topic>` of the lie, and (coming clean) before the topic itself: the truth told.
 * So a person's list reads as their history with the Warden, deed by deed: lied, caught, told.
 * A later reader (#1663's predictability and trust over a deed history) reads it in that order,
 * and the reason off the lie (`lieById`). Everything else is read off it: the guard, and the word
 * to friends not yet met. Nothing else is saved.
 *
 * Behind the `caught-lies` rule switch: off (and in every run from before it), a liar asked again
 * sticks to their story, as they always did. The friends' word goes along ties, so it needs the
 * `ties` switch too.
 *
 * Pure and deterministic.
 */

import { featureOn, type FeatureSwitches } from './features';
import { lieById, liesFor, PROPOSITIONS, type LieEntry } from './claims';
import { tieEntries } from './ties';
import type { HeardClaim } from './journal';

/** The prefix in `asked` that marks a lie the Warden has shown they know about: `caught:<topic>`. */
export const CAUGHT = 'caught:';

/** How much a greedy liar's trust in the Warden drops, caught out. */
export const CAUGHT_TRUST = 15;
/** How much higher every gate of a caught greedy liar reads: they guard their other secrets more. */
export const GUARDED = 10;
/** The most a friend of a caught greedy liar cools, from someone who loves them (opinion 100); less as they like them less. */
export const CAUGHT_WORD = 10;

/** The lie `pid` told about `topic` in this run, as written, if they told one. */
export function lieAbout(features: FeatureSwitches | undefined, pid: string, topic: string): LieEntry | undefined {
  const lie = liesFor(features)[pid]?.find(l => l.about === topic);
  return lie?.id ? lieById(lie.id) : undefined;
}

/**
 * Whether the Warden holds evidence against a lie: a claim heard from someone else about the same
 * thing that says otherwise (journal.ts: two accounts that clash), or having been where it can be
 * checked (`visited`). Hearing the lie alone, or hearing it again, is no evidence.
 */
export function caughtOut(lie: LieEntry, heard: readonly HeardClaim[], visited: readonly string[]): boolean {
  const check = PROPOSITIONS[lie.proposition]?.check;
  if (check && visited.includes(check.visit)) return true;
  return heard.some(c => c.proposition === lie.proposition && c.person !== lie.person && c.version !== `lie:${lie.id}`);
}

/** The lies `pid` has been caught in, in the order they were caught: what `asked` keeps. */
export function caughtIn(asked: Readonly<Record<string, readonly string[]>> | undefined, features: FeatureSwitches | undefined, pid: string): LieEntry[] {
  return (asked?.[pid] ?? []).flatMap(k => {
    const lie = k.startsWith(CAUGHT) ? lieAbout(features, pid, k.slice(CAUGHT.length)) : undefined;
    return lie ? [lie] : [];
  });
}

/**
 * How much higher `pid`'s gates read for the Warden: GUARDED once caught in a greedy lie, else 0.
 * Only with the `caught-lies` switch on; off, and in a run from before it, nobody guards more.
 */
export function guardOf(asked: Readonly<Record<string, readonly string[]>> | undefined, features: FeatureSwitches | undefined, pid: string): number {
  if (!featureOn(features, 'caught-lies')) return 0;
  return caughtIn(asked, features, pid).some(l => l.reason === 'greedy') ? GUARDED : 0;
}

/**
 * Who hears that `liar` was caught in a greedy lie, and how much each cools: everyone who thinks
 * well of them (a tie where their view of the liar is above 0), CAUGHT_WORD scaled by that view.
 * Someone who dislikes the liar isn't moved (turning it to the Warden's credit is left for later).
 * In the order the ties are written.
 */
export function friendsWhoHear(liar: string): { person: string; cools: number }[] {
  return tieEntries().flatMap(t => {
    if (!t.between.includes(liar)) return [];
    const other = t.between[0] === liar ? t.between[1] : t.between[0];
    const view = t.views[other];
    return view && view.opinion > 0 ? [{ person: other, cools: Math.round(CAUGHT_WORD * view.opinion / 100) }] : [];
  });
}

/**
 * The word against the Warden that reaches `pid` before they've met: from each friend of theirs
 * the Warden caught in a greedy lie, the most any one friend's catching cools them (the coldest
 * counts, not the sum, as `tieWord` takes the warmest). Read off `asked`. Only with both
 * `caught-lies` and `ties` on.
 */
export function caughtWord(asked: Readonly<Record<string, readonly string[]>> | undefined, features: FeatureSwitches | undefined, pid: string): number {
  if (!featureOn(features, 'caught-lies') || !featureOn(features, 'ties')) return 0;
  let most = 0;
  for (const liar of Object.keys(asked ?? {})) {
    if (!caughtIn(asked, features, liar).some(l => l.reason === 'greedy')) continue;
    for (const f of friendsWhoHear(liar)) if (f.person === pid) most = Math.max(most, f.cools);
  }
  return most;
}
