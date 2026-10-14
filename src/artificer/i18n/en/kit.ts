/**
 * The pack's items in English (#1707): each item's name, what a scout would say it's for, and the
 * scout's note, turned into catalog keys straight from the kit's own list (kit.ts), so the English
 * has one copy and the pack screen, the in-run pack list and the AI player all read the same words.
 * The Swedish is written by hand in ../sv/kit.ts; the catalog test holds it to every key here.
 */

import { KIT, type KitId } from '../../kit';

type KitKey = `kit.${KitId}` | `kit.${KitId}.does` | `kit.${KitId}.note`;

export const kit = Object.fromEntries(
  KIT.flatMap(k => [[`kit.${k.id}`, k.name], [`kit.${k.id}.does`, k.does], [`kit.${k.id}.note`, k.note]]),
) as Record<KitKey, string>;
