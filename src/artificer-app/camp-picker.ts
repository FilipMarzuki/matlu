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
 * Does Make camp open the picker? With the switch on, where camp is an action (#1732) and there's a
 * place to pick. Otherwise the card queues Make camp itself, as before.
 */
export const pickerFor = (s: Sim, on: boolean): boolean => on && campAsActionOn(s) && knownSpots(s).length > 0;

/** The popup: a dialog on the encounters' backdrop (style.css `.enc-backdrop`), its places and Cancel. */
export function campPicker(s: Sim, t: T): string {
  return `<div class="enc-backdrop campickwrap" data-campickwrap>
    <section class="box campick" role="dialog" aria-modal="true" aria-labelledby="campick-title">
      <h2 id="campick-title">${esc(t('campick.title'))}</h2>
      ${spotsBlock(s, t)}
      <div class="cpbtns"><button class="pill" data-cmd="campickclose">${esc(t('campick.cancel'))}</button></div>
    </section>
  </div>`;
}
