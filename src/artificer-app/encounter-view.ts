/**
 * The encounter screen (#1347): when the day pauses for an encounter, a modal over the plan
 * shows the scene and the choices — each with what it costs, what it needs, and its odds in
 * words. After a choice, the outcome, then "Continue the day".
 *
 * Presentation only: the rules live in `src/artificer/encounters.ts` and `chooseOption`.
 * Buttons carry `data-choose="<optionId>"` and `data-cmd="carryon"`.
 */

import { encounterById, optionsFor, type EncounterKind, type EncounterOption, type OddsWord } from '../artificer/encounters';
import { RING_NAME } from '../artificer/exploration';
import type { Region1State } from '../artificer/region1';

const esc = (t: string | number): string => String(t).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

const KIND_ICON: Readonly<Record<EncounterKind, string>> = { animal: '🐾', find: '✦', person: '👤' };
const KIND_WORD: Readonly<Record<EncounterKind, string>> = { animal: 'AN ANIMAL', find: 'A FIND', person: 'SOMEONE' };
const ODDS_NOTE: Readonly<Record<OddsWord, string>> = {
  safe: 'nothing can go wrong', likely: 'it should go well', risky: 'it could go either way', desperate: 'it will probably go badly',
};

/** What an option asks of you, in a few words: its cost, and what you need for it. */
function asks(o: EncounterOption): string {
  const parts: string[] = [];
  for (const [k, n] of Object.entries(o.cost?.stores ?? {})) parts.push(`${n} ${k === 'rawFood' ? 'food' : k}`);
  if (o.cost?.hours) parts.push(`${o.cost.hours}h`);
  return parts.join(' · ');
}

/** A clock hour as "13:00". */
const clock = (h: number): string => `${String(Math.floor(h) % 24).padStart(2, '0')}:00`;

/** The encounter you just answered, shown until you carry on: the scene, your choice, what came of it. */
export interface EncounterAfter { kind: EncounterKind; scene: string; choice: string; text: string[]; died: boolean }

/** The modal, or nothing when no encounter is waiting and none has just been answered. */
export function encounterModal(s: Region1State, after: EncounterAfter | null, waiting: number): string {
  const p = s.pending;
  if (!p && !after) return '';
  const t = p ? encounterById(p.id) : null;
  const head = p && t
    ? `<p class="enc-kind">${KIND_ICON[t.kind]} ${KIND_WORD[t.kind]} · D${p.day} · ${esc(RING_NAME[p.ring].toUpperCase())} RING · ${clock(p.hour)}</p><p class="enc-text">${esc(t.text)}</p>`
    : '';
  const body = p && t
    ? `<div class="enc-options">${optionsFor(s, t).map(({ option, unmet, odds }) => `<button class="enc-opt" data-choose="${esc(option.id)}" ${unmet ? `disabled title="${esc(unmet)}"` : ''}>
        <span class="eo-label">${esc(option.label)}</span>
        <span class="eo-meta">${asks(option) ? `<span class="eo-cost">${esc(asks(option))}</span>` : ''}${unmet ? `<span class="eo-need">${esc(unmet)}</span>` : `<span class="odds o-${odds}" title="${ODDS_NOTE[odds]}">${odds}</span>`}</span>
      </button>`).join('')}</div>
      ${waiting ? `<p class="enc-wait">The rest of the day waits: ${waiting} action${waiting === 1 ? '' : 's'} queued.</p>` : ''}`
    : `<p class="enc-kind">${KIND_ICON[after!.kind]} ${KIND_WORD[after!.kind]}</p><p class="enc-text">${esc(after!.scene)}</p>
      <p class="enc-chose">You chose: <b>${esc(after!.choice)}</b></p>
      ${after!.text.map(l => `<p class="enc-result ${after!.died ? 'dead' : ''}">${esc(l)}</p>`).join('')}
      <div class="runbar">${after!.died ? '<button class="btn" data-cmd="carryon">SEE HOW IT ENDED</button>'
        : `<button class="btn go" data-cmd="carryon">${waiting && s.canPlan ? '▶ CONTINUE THE DAY' : '✓ CARRY ON'}</button>`}</div>`;
  return `<div class="enc-backdrop"><section class="enc box" role="dialog" aria-modal="true" aria-label="Encounter">${head}${body}</section></div>`;
}
