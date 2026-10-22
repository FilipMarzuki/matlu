/**
 * What a provisioning trip brings, as numbers (#1827): the action card prints them (`yieldText` in
 * camp-blocks.ts) and, with `forecasts`, the rough word is judged from them (forecast-words.ts).
 * In a file of their own so both read the same numbers without importing each other.
 * The numbers mirror region1.ts yields.
 */

import { huntOddsOf, huntTool, trapCatchOf, LOOSE_STONE_SITES, FISH_CATCH, type ActionId } from '../artificer/region1';
import { RICHNESS, tripYield, hasFind, type Domain, type Ring } from '../artificer/exploration';
import { modifiersFor } from '../artificer/crafting';
import type { AppState } from './controller';

type Sim = AppState['sim'];

/** Extra yield your tools give an action (shown in the hint). */
const bonus = (s: Sim, id: ActionId): number => modifiersFor(s.tools, id).yieldAdd;
/** +2 if you've made the find in this ring × domain. */
const fb = (s: Sim, r: Ring, d: Domain): number => (hasFind(s.explore, r, d) ? 2 : 0);
/** Shorthand: this trip's yield from what you know of the ring (mirrors region1.ts). */
const ty = (s: Sim, r: Ring, d: Domain, base: number, per: number): number => tripYield(s.explore, r, d, base, per);

/** The trips that bring something home, the ones a forecast puts a rough word on. */
export const PROVISION_TASKS: readonly ActionId[] = ['gather', 'hunt', 'traps', 'water', 'wood', 'quarry', 'gatherstone', 'fish'];

/**
 * What the trip would bring in this ring: `n` its main store (food, water, fuel, stone) and, for
 * wood, `m` the materials too. Null for an action that isn't a provisioning trip.
 */
export function yieldAmounts(id: ActionId, s: Sim, r: Ring): { n: number; m?: number } | null {
  switch (id) {
    case 'gather': return { n: ty(s, r, 'forage', 3, 2) + bonus(s, 'gather') };
    case 'hunt':
      // With `hunting-gear` (#1821) a sling brings small game only; a bow, or no gear rule, a deer.
      return huntOddsOf(s, 'hunt', r) && huntTool(s) !== 'bow'
        ? { n: ty(s, r, 'game', 3, 1) + bonus(s, 'hunt') + fb(s, r, 'game') }
        : { n: ty(s, r, 'game', 7, 0) + bonus(s, 'hunt') + fb(s, r, 'game') };
    case 'traps': return { n: trapCatchOf(s.explore, r) };
    case 'water': return { n: ty(s, r, 'water', 4, 1) + (s.site === 'river' && r === 1 ? 2 : 0) + bonus(s, 'water') + fb(s, r, 'water') };
    case 'wood': return { n: ty(s, r, 'timber', 4, 1) + (s.site === 'tree' && r === 1 ? 1 : 0) + fb(s, r, 'timber'), m: ty(s, r, 'timber', 2, 1) };
    case 'quarry': return { n: ty(s, r, 'stone', 3, 1) + fb(s, r, 'stone') };
    // Loose stone (#1816): half of quarrying's, +1 camped by the river or on the hill, half a flint seam's find.
    case 'gatherstone': return { n: ty(s, r, 'stone', 1.5, 0.5) + (r === 1 && s.site !== null && LOOSE_STONE_SITES.includes(s.site) ? 1 : 0) + fb(s, r, 'stone') / 2 };
    case 'fish': return { n: FISH_CATCH * RICHNESS[r] };
    default: return null;
  }
}
