/**
 * How well the Warden feels they know each area of the land (#1835, ui feature `land-self-assessment`):
 * a word beside each ring's heading on LAND, "A rough idea", "Well explored"…, with a tooltip of what
 * would raise it.
 *
 * It's read from what the run already knows of the ring (exploration.ts): how many of its domains
 * you've seen at all (suspected or better), how many you've seen clearly (observed), how many you
 * know as well as they can be known (detailed; routes are never worked, so for them observed is as
 * far as it goes), and how many trips you've worked there. Text only: it changes no rule and draws
 * no random number, so a run plays the same with it on or off.
 *
 * The thresholds were picked against a scripted run (land-assessment.test.ts): a first look makes a
 * hunch, a few explores and some gathering a rough idea and then "well explored", and only a long
 * stay with every domain worked to the detail earns "could work it blindfolded".
 */

import type { Key, T } from '../artificer/i18n';
import { domainsOf, level, type Domain, type Exploration, type Ring } from '../artificer/exploration';
import { esc } from './html';

export const LAND_ASSESS_FEATURE = 'land-self-assessment';

/** 0 Unknown · 1 A hunch · 2 A rough idea · 3 Well explored · 4 Know it closely · 5 Could work it blindfolded. */
export type Assessment = 0 | 1 | 2 | 3 | 4 | 5;

/** Trips worked in a ring before it's "well explored" (with every domain observed). */
export const WELL_WORK = 8;
/** Domains known in detail, and trips worked, before you "know it closely". */
export const CLOSE_DETAILED = 2;
export const CLOSE_WORK = 20;
/** Trips worked before you "could work it blindfolded" (with every domain known in detail). */
export const BLIND_WORK = 50;
/** Domains observed before you have "a rough idea" (with every domain seen). */
export const ROUGH_OBSERVED = 2;

/** As well as a domain can be known: detailed, or observed for routes (nothing works them further). */
const top = (d: Domain): number => (d === 'routes' ? 2 : 3);

/** What the assessment is read from: the ring's domains by how well they're known, and the work done there. */
export interface RingKnowledge {
  domains: readonly Domain[];
  unseen: Domain[];
  unclear: Domain[];
  undetailed: Domain[];
  worked: number;
}

export function ringKnowledge(e: Exploration, r: Ring): RingKnowledge {
  const domains = domainsOf(r);
  return {
    domains,
    unseen: domains.filter(d => level(e, r, d) < 1),
    unclear: domains.filter(d => level(e, r, d) < 2),
    undetailed: domains.filter(d => level(e, r, d) < top(d)),
    worked: domains.reduce((n, d) => n + e.worked[r][d], 0),
  };
}

/** How well you know a ring, 0–5 (pure). */
export function selfAssessment(e: Exploration, r: Ring): Assessment {
  const k = ringKnowledge(e, r);
  const n = k.domains.length;
  if (k.unseen.length === n) return 0;
  if (k.unseen.length || n - k.unclear.length < ROUGH_OBSERVED) return 1;
  if (k.unclear.length || k.worked < WELL_WORK) return 2;
  if (n - k.undetailed.length < CLOSE_DETAILED || k.worked < CLOSE_WORK) return 3;
  if (k.undetailed.length || k.worked < BLIND_WORK) return 4;
  return 5;
}

/** A domain's name in running text ("water", "vatten"). */
const dname = (d: Domain, t: T): string => t(`land.domain.${d}` as Key).toLowerCase();

/**
 * What would raise the assessment, in a sentence: the first domain that holds it back, by name, or
 * "work there more". Empty at the top.
 */
export function nextStep(e: Exploration, r: Ring, t: T): string {
  const k = ringKnowledge(e, r);
  const n = k.domains.length;
  switch (selfAssessment(e, r)) {
    case 0: return t('land.assess.next.look');
    case 1: return k.unseen.length ? t('land.assess.next.find', { what: dname(k.unseen[0], t) }) : t('land.assess.next.closer');
    case 2: return k.unclear.length ? t('land.assess.next.clear', { what: dname(k.unclear[0], t) }) : t('land.assess.next.work');
    case 3: return n - k.undetailed.length < CLOSE_DETAILED ? t('land.assess.next.detail') : t('land.assess.next.work');
    case 4: return k.undetailed.length ? t('land.assess.next.detailOf', { what: dname(k.undetailed[0], t) }) : t('land.assess.next.work');
    default: return '';
  }
}

/** The word, with its tooltip, for beside a ring's heading. */
export function assessmentTag(e: Exploration, r: Ring, t: T): string {
  const a = selfAssessment(e, r);
  const next = nextStep(e, r, t);
  const word = t(`land.assess.${a}` as Key);
  const tip = next ? t('land.assess.tip', { word, next }) : t('land.assess.tipTop', { word });
  return `<span class="assess a${a}" title="${esc(tip)}">${esc(word)}</span>`;
}
