/**
 * Make camp's picker (#1986, ui switch `camp-picker`): tapping the Make camp card opens a popup of
 * the places to camp you know, each with what you can tell of its surroundings, and the one you tap
 * is where camp is made. Without it the card queues Make camp with no spot, and the sim takes the
 * default (camp-sites.ts `defaultSpot`): the player never chose.
 *
 * Presentation only. The places and their readings are camp-blocks.ts `spotsBlock`, the list the
 * "Make camp" section already draws, and a tap on one is its `data-camp` (main.ts), which queues
 * Make camp at that spot the way the section always has. Pure: state in, HTML out.
 */

import type { T } from '../artificer/i18n';
import { campAsActionOn, knownSpots } from '../artificer/camp-sites';
import type { AppState } from './controller';
import { spotsBlock } from './camp-blocks';
import { esc } from './html';

type Sim = AppState['sim'];

/** The picker's ui switch (#1986): read with `uiFeatureOn`. */
export const CAMP_PICKER_FEATURE = 'camp-picker';

/**
 * Is Make camp's card the picker's? With the switch on, where camp is an action (#1732). Cheap: the
 * card is drawn on every redraw, so whether there's a place to pick is asked only when it's tapped
 * (`pickable`).
 */
export const pickerFor = (s: Sim, on: boolean): boolean => on && campAsActionOn(s);

/**
 * Is there a place to pick? One you know that isn't the camp you're at (as Make camp's own rule asks
 * of a chosen spot, region1.ts `campGate`), in a run that isn't over. Without one, the card queues
 * Make camp as before, and the sim says why it can't.
 */
export const pickable = (s: Sim): boolean => !s.outcome && knownSpots(s).some(p => !p.here);

/**
 * The popup: a dialog on the encounters' backdrop (style.css `.enc-backdrop`), its places and Cancel.
 * Without the section's closing line ("it goes in your plan like any other"), which isn't true
 * before planning is learned, when a tap here makes camp at once.
 */
export function campPicker(s: Sim, t: T): string {
  return `<div class="enc-backdrop campickwrap" data-campickwrap>
    <section class="box campick" role="dialog" aria-modal="true" aria-labelledby="campick-title">
      <h2 id="campick-title">${esc(t('campick.title'))}</h2>
      ${spotsBlock(s, t, { note: false })}
      <div class="cpbtns"><button class="pill" data-cmd="campickclose">${esc(t('campick.cancel'))}</button></div>
    </section>
  </div>`;
}
