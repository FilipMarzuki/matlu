/**
 * What the recipe-discovery toast says (#1529). Phaser-free, so the wording can be unit-tested;
 * `src/ui/DiscoveryToast.ts` draws it.
 */

import type { DiscoveryMethod } from './Discovery';

/** How each method reads under the recipe name. Innate recipes never get a toast. */
const METHOD_LINES: Record<Exclude<DiscoveryMethod, 'innate'>, string> = {
  memory: 'Worked out from practice',
  experiment: 'Found by experimenting',
  observation: 'Learned by watching',
  taught: 'Taught',
  'reverse-engineer': 'Worked out by taking it apart',
};

export interface ToastText {
  /** The recipe's name, e.g. "Healing Salve". */
  title: string;
  /** How it was found, e.g. "Worked out from practice". */
  detail: string;
}

/**
 * The toast for a discovered recipe, or null for one that shouldn't get a toast (innate recipes
 * are known from the start). A recipe missing from the list is named from its id
 * ("healing-salve" → "Healing Salve"), so a toast never shows a raw id.
 */
export function discoveryToastText(
  recipeId: string,
  method: DiscoveryMethod,
  recipes: readonly { id?: string; name?: string }[],
): ToastText | null {
  if (method === 'innate') return null;
  const name = recipes.find(r => r.id === recipeId)?.name
    ?? recipeId.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return { title: name, detail: METHOD_LINES[method] };
}
