/**
 * Portrait choices for character creation (#1239): the front-facing idle frame
 * (`idle_south_0`, top-left of each atlas) of existing character sprites, shown
 * scaled up with crisp pixels. Sizes come from each sprite's atlas JSON.
 */

export interface Portrait { id: string; label: string; url: string; frame: number; sheet: { w: number; h: number } }

export const PORTRAITS: readonly Portrait[] = [
  { id: 'skald', label: 'Skald', url: '/assets/sprites/characters/earth/heroes/skald/skald.png', frame: 48, sheet: { w: 864, h: 192 } },
  { id: 'tinkerer', label: 'Tinkerer', url: '/assets/sprites/characters/earth/heroes/tinkerer/tinkerer.png', frame: 48, sheet: { w: 2304, h: 288 } },
  { id: 'wanderer', label: 'Wanderer', url: '/assets/sprites/characters/earth/npcs/npc-wanderer/npc-wanderer.png', frame: 48, sheet: { w: 384, h: 288 } },
  { id: 'loke', label: 'Loke', url: '/assets/sprites/characters/mistheim/heroes/loke/loke.png', frame: 76, sheet: { w: 6460, h: 456 } },
];

export const portraitById = (id: string | null): Portrait | undefined => PORTRAITS.find(p => p.id === id);

/** Inline style that shows a portrait's first frame at `size` px square. */
export function portraitStyle(p: Portrait, size: number): string {
  const k = size / p.frame;
  return `width:${size}px;height:${size}px;background-image:url('${p.url}');background-size:${p.sheet.w * k}px ${p.sheet.h * k}px;background-position:0 0`;
}
