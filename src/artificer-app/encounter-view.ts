/**
 * The encounter screen (#1347): when the day pauses for an encounter, a modal over the plan
 * shows the scene and the choices — each with what it costs, what it needs, and its odds in
 * words. After a choice, the outcome, then "Continue the day".
 *
 * Presentation only: the rules live in `src/artificer/encounters.ts` and `chooseOption`.
 * Buttons carry `data-choose="<optionId>"` and `data-cmd="carryon"`.
 *
 * In the viewer's language (#1709): the scene, each option and its outcome come from the catalog
 * (encounters are keyed by id there), and what the sim hands over as English (an unmet need, the
 * outcome's journal lines) is read back through sim-words.ts `simLine`.
 */

import { encounterById, optionsFor, stepOf, type EncounterKind, type EncounterOption, type OddsWord } from '../artificer/encounters';
import type { Region1State } from '../artificer/region1';
import { makeT, type Key, type T } from '../artificer/i18n';
import { memoryLine } from './pins-view';
import { esc } from './html';
import { isKey, simLine } from './sim-words';

const EN: T = makeT('en');

const KIND_ICON: Readonly<Record<EncounterKind, string>> = { animal: '🐾', find: '✦', person: '👤', place: '📍' };

/** What an option asks of you, in a few words: its cost, and what you need for it. */
function asks(o: EncounterOption, t: T): string {
  const parts: string[] = [];
  for (const [k, n] of Object.entries(o.cost?.stores ?? {})) parts.push(`${n} ${t(`storeword.${k}` as Key)}`);
  if (o.cost?.marks) parts.push(t('encui.marks', { n: o.cost.marks }));
  if (o.cost?.hours) parts.push(`${o.cost.hours}h`);
  return parts.join(' · ');
}

/** An encounter's step, as its catalog keys start: `enc.<id>` at the opening, `enc.<id>.step.<step>` later on. */
const stepKey = (id: string, step?: string | null): string => (step ? `enc.${id}.step.${step}` : `enc.${id}`);
/** Words the catalog has by id (an option's label means one thing in one encounter); else read back from the English. */
const byId = (key: string, english: string, t: T): string => (isKey(key) ? t(key as Key) : simLine(english, t));

/** A clock hour as "13:00". */
const clock = (h: number): string => `${String(Math.floor(h) % 24).padStart(2, '0')}:00`;

/** An option's odds, in a word and with what that means. */
const oddsTag = (odds: OddsWord, t: T): string => `<span class="odds o-${odds}" title="${esc(t(`encui.${odds}Tip` as Key))}">${esc(t(`encui.${odds}` as Key))}</span>`;

/**
 * The encounter you just answered, shown until you carry on: the scene, your choice, what came of
 * it — and, when your read of it was badly wrong, the truth (#1364).
 */
export interface EncounterAfter { kind: EncounterKind; scene: string; choice: string; text: string[]; died: boolean; truth?: string | null }

/** The modal, or nothing when no encounter is waiting and none has just been answered. */
export function encounterModal(s: Region1State, after: EncounterAfter | null, waiting: number, t: T = EN): string {
  const p = s.pending;
  if (!p && !after) return '';
  const e = p ? encounterById(p.id) : null;
  // Your read of it, and how you stand (#1364): how dangerous it looks to you — not what it is.
  const state = p?.state ?? 'calm';
  const read = p && e ? `<p class="enc-read s-${state}">${t('encui.looksHtml', { threat: esc(t(`threat.${p.perceived ?? e.threat}` as Key)) })} ${esc(t(`say.state.${state}` as Key))}</p>` : '';
  const kindWord = (k: EncounterKind): string => esc(t(`encui.${k}` as Key));
  const head = p && e
    ? `<p class="enc-kind">${KIND_ICON[e.kind]} ${kindWord(e.kind)} · ${esc(p.action === 'road' ? t('encui.roadDay', { n: p.day }) : t('encui.where', { n: p.day, ring: t(`ring.${p.ring}`).toUpperCase(), clock: clock(p.hour) }))}</p>${p.step && s.log.length > 1 ? `<p class="enc-result">${esc(simLine(s.log[s.log.length - 2].text, t))}</p>` : ''}<p class="enc-text">${esc(byId(`${stepKey(e.id, p.step)}.text`, stepOf(e, p.step).text, t))}</p>${read}${e.kind === 'place' ? memoryLine(s, t) : ''}`
    : '';
  const body = p && e
    ? `<div class="enc-options">${optionsFor(s, e).map(({ option, unmet, odds }) => {
        const need = unmet ? simLine(unmet, t) : null;
        return `<button class="enc-opt" data-choose="${esc(option.id)}" ${need ? `disabled title="${esc(need)}"` : ''}>
        <span class="eo-label">${esc(byId(`${stepKey(e.id, p.step)}.opt.${option.id}`, option.label, t))}${option.careful && state === 'shaken' && !need ? ` <span class="eo-shaken" title="${esc(t('encui.shakenTip'))}">${esc(t('encui.shaken'))}</span>` : ''}</span>
        <span class="eo-meta">${asks(option, t) ? `<span class="eo-cost">${esc(asks(option, t))}</span>` : ''}${need ? `<span class="eo-need">${esc(need)}</span>` : oddsTag(odds, t)}</span>
      </button>`;
      }).join('')}</div>
      ${waiting ? `<p class="enc-wait">${esc(t(waiting === 1 ? 'encui.waits.one' : 'encui.waits.other', { n: waiting }))}</p>` : ''}`
    : `<p class="enc-kind">${KIND_ICON[after!.kind]} ${kindWord(after!.kind)}</p><p class="enc-text">${esc(simLine(after!.scene, t))}</p>
      <p class="enc-chose">${esc(t('encui.chose'))} <b>${esc(simLine(after!.choice, t))}</b></p>
      ${after!.text.map(l => `<p class="enc-result ${after!.died ? 'dead' : l.startsWith('You meant to') ? 'override' : ''}">${esc(simLine(l, t))}</p>`).join('')}
      ${after!.truth ? `<p class="enc-truth">${esc(simLine(after!.truth, t))}</p>` : ''}
      <div class="runbar">${after!.died ? `<button class="btn" data-cmd="carryon">${esc(t('encui.seeEnd'))}</button>`
        : `<button class="btn go" data-cmd="carryon">${esc(t(waiting && s.canPlan ? 'encui.continue' : 'encui.carryOn'))}</button>`}</div>`;
  return `<div class="enc-backdrop"><section class="enc box" role="dialog" aria-modal="true" aria-label="${esc(t('encui.label'))}">${head}${body}</section></div>`;
}
