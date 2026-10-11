/**
 * The hike kit (#1400, epic #1397): the Warden is a young scout who packed for a weekend in the
 * woods with the patrol — and the weekend turned into something else. What's in the pack is what
 * they have on day 1.
 *
 * Everything here is something real scouts bring, from Scouterna and scout-group packing lists
 * for a hajk. The pack holds about 9 kg (a quarter of a kid's weight), and the whole list weighs
 * far more, so packing is a choice. A few things every scout brings do little or nothing out
 * here; they're in on purpose.
 *
 * Pure: `startFromPack` turns a pack into day 1's tools, stores and supplies; region1.ts reads
 * `hasKit` and the supplies where each item does its small thing.
 */

import type { Tool } from './crafting';

export type KitId =
  | 'mora-knife' | 'fire-steel' | 'matches' | 'first-aid-kit' | 'water-bottle' | 'kasa' | 'thermos'
  | 'sleeping-bag' | 'sleeping-pad' | 'sit-pad' | 'wool-underlayer' | 'hat-mittens' | 'rain-gear' | 'spare-socks'
  | 'headlamp' | 'map-compass' | 'whistle' | 'cord' | 'tarp' | 'trangia' | 'weekend-food' | 'sweets'
  | 'notebook' | 'toilet-paper' | 'phone' | 'comic' | 'pillow';

export type KitGroup = 'sleep' | 'fire-food' | 'clothes' | 'tools' | 'other';
export const KIT_GROUPS: Readonly<Record<KitGroup, string>> = { sleep: 'Sleep', 'fire-food': 'Fire and food', clothes: 'Clothes', tools: 'Tools', other: 'Other' };

export interface KitItem {
  id: KitId;
  name: string;
  /** Its Swedish scout name, for flavour. */
  sv?: string;
  /** Kilograms. */
  weight: number;
  group: KitGroup;
  /** What it does out here, in plain words. */
  effect: string;
  /** A line in a scout's voice. */
  note: string;
}

export const KIT: readonly KitItem[] = [
  { id: 'sleeping-bag', name: 'Sleeping bag', sv: 'sovsäck', weight: 1.6, group: 'sleep', effect: 'a sound bedroll from the first night (a fine one with the sleeping pad)', note: 'The heaviest thing in the pack, and the one you\'d never leave behind.' },
  { id: 'sleeping-pad', name: 'Sleeping pad', sv: 'liggunderlag', weight: 0.4, group: 'sleep', effect: 'with the sleeping bag, a fine bedroll; on its own, cold nights cost 10% less', note: 'The ground steals more heat than the air does — the leader says it every single hike.' },
  { id: 'pillow', name: 'Pillow', sv: 'kudde', weight: 0.3, group: 'sleep', effect: 'the first night\'s sleep is a little better (+2 Clarity), and that\'s all', note: 'Everyone laughs. Everyone is jealous at bedtime.' },
  { id: 'mora-knife', name: 'Mora knife', sv: 'morakniv', weight: 0.1, group: 'fire-food', effect: 'a fine knife: hunting, preserving and work that needs a blade', note: 'Your knife-licence knife. You\'re allowed to carry it on hikes now.' },
  { id: 'fire-steel', name: 'Fire steel', sv: 'eldstål', weight: 0.05, group: 'fire-food', effect: 'a fire catches and holds in the wind: wind never costs extra firewood for close work', note: 'Scrape it hard against the back of the knife. Birch bark catches every time.' },
  { id: 'matches', name: 'Matches in a zip bag', sv: 'tändstickor', weight: 0.05, group: 'fire-food', effect: '5 easy fires: each spares a firewood when you work by firelight. They run out.', note: 'Kept dry in a freezer bag, because somebody always falls in the stream.' },
  { id: 'kasa', name: 'Kåsa', sv: 'kåsa', weight: 0.1, group: 'fire-food', effect: 'a hot drink on every night the fire is kept in: +1 Clarity', note: 'Carved birch, hanging from your belt on a leather thong. It makes cocoa taste better.' },
  { id: 'thermos', name: 'Thermos', sv: 'termos', weight: 0.6, group: 'fire-food', effect: 'two hot drinks for the first two cold nights: +4 Clarity each. Then it\'s empty.', note: 'Hot blackcurrant drink from home. It stays warm till Saturday lunch.' },
  { id: 'trangia', name: 'Trangia stove and fuel', sv: 'stormkök', weight: 1.1, group: 'fire-food', effect: '4 hot meals on cold nights with no fire kept in: +3 Clarity each. Then the fuel is gone.', note: 'The patrol\'s stove. Somebody had to carry it, and it was your turn.' },
  { id: 'weekend-food', name: 'Weekend food', sv: 'matsäck', weight: 1.5, group: 'fire-food', effect: '+4 food, packed (it keeps like rations)', note: 'Crispbread, cheese, oat porridge, a tin of meatballs. Enough for the weekend.' },
  { id: 'sweets', name: 'Bag of sweets', sv: 'godis', weight: 0.2, group: 'fire-food', effect: 'once, when your mind is nearly gone (under 30 Clarity at night): +6 Clarity', note: 'Saturday sweets, saved. You were going to share them.' },
  { id: 'water-bottle', name: 'Water bottle', sv: 'vattenflaska', weight: 0.3, group: 'fire-food', effect: 'a sound waterskin: +1 water a trip', note: 'Filled at home. Refill it at the stream and drink the stream.' },
  { id: 'wool-underlayer', name: 'Wool underlayer', sv: 'ullunderställ', weight: 0.4, group: 'clothes', effect: 'wool layers: cold nights cost 15% less (stacks with knowing the cold)', note: 'Itchy, warm even when it\'s wet. Wool, never cotton — cotton kills.' },
  { id: 'hat-mittens', name: 'Wool hat and mittens', sv: 'mössa och vantar', weight: 0.2, group: 'clothes', effect: 'blizzard exposure is a step safer', note: 'Knitted by your grandmother. Lose one mitten and you\'re in trouble.' },
  { id: 'rain-gear', name: 'Rain gear', sv: 'regnställ', weight: 0.7, group: 'clothes', effect: 'rain soaks you half as fast', note: 'Jacket and trousers. It always rains on hikes, whatever the forecast said.' },
  { id: 'spare-socks', name: 'Spare wool socks', sv: 'ullsockor', weight: 0.2, group: 'clothes', effect: 'dry socks after a soaking: being wet through costs half the Clarity', note: 'Two pairs. Dry feet are a happy scout.' },
  { id: 'sit-pad', name: 'Sit pad', sv: 'sittunderlag', weight: 0.05, group: 'clothes', effect: 'a rest restores a little more (+2 Vigor)', note: 'A square of foam on a cord. A dry seat on a wet rock.' },
  { id: 'first-aid-kit', name: 'First-aid kit', sv: 'första hjälpen', weight: 0.2, group: 'tools', effect: '3 dressings: "treat" uses one instead of goods, and treats one step better', note: 'Plasters, a bandage, blister tape and a tiny pair of scissors.' },
  { id: 'headlamp', name: 'Headlamp', sv: 'pannlampa', weight: 0.15, group: 'tools', effect: '8 hours of light for close work after dark — no firewood, no dark penalty. The battery runs down.', note: 'For finding the latrine at night, mostly.' },
  { id: 'map-compass', name: 'Map and compass', sv: 'karta och kompass', weight: 0.15, group: 'tools', effect: 'scouting and surveying take 20% less time', note: 'Orienteering badge. Red end north, map to the land, land to the map.' },
  { id: 'whistle', name: 'Whistle', sv: 'visselpipa', weight: 0.02, group: 'tools', effect: 'face a boar or a bear and you can blow it: noise sends most animals off', note: 'Three blasts means help. Every scout has one round their neck.' },
  { id: 'cord', name: 'Cord, 10 m', sv: 'snöre', weight: 0.2, group: 'tools', effect: '+2 materials', note: 'For the tarp, for a clothesline, for anything. You can never have too much cord.' },
  { id: 'tarp', name: 'Tarp', sv: 'vindskydd', weight: 1.0, group: 'tools', effect: 'pitched when you make camp: a crude lean-to roof without felling a tree', note: 'The patrol\'s tarp — you were carrying it when you got separated.' },
  { id: 'notebook', name: 'Notebook and pencil', sv: 'anteckningsbok', weight: 0.1, group: 'other', effect: '+10% insight from study', note: 'For the hike diary the leader wants. A pencil works in the rain; a pen doesn\'t.' },
  { id: 'toilet-paper', name: 'Toilet paper', sv: 'toalettpapper', weight: 0.1, group: 'other', effect: 'nothing, out here', note: 'In a plastic bag. Every scout brings it. Every scout.' },
  { id: 'phone', name: 'Phone', sv: 'mobil', weight: 0.2, group: 'other', effect: 'nothing: no signal, and dead by the third day', note: 'You promised to call home on Saturday evening.' },
  { id: 'comic', name: 'Comic book', sv: 'serietidning', weight: 0.2, group: 'other', effect: 'once, resting on a rainy day: +3 Clarity', note: 'Bamse, read so many times the cover\'s coming off.' },
];

export const KIT_IDS = KIT.map(k => k.id) as KitId[];
export const kitItem = (id: KitId): KitItem => KIT.find(k => k.id === id)!;

/** What the pack holds, in kg: about a quarter of a kid's body weight. */
export const PACK_CAPACITY = 9;

/** The leader's packing list: the screen's default, and what a new Warden takes until they choose. */
export const SUGGESTED_PACK: readonly KitId[] = [
  'mora-knife', 'fire-steel', 'first-aid-kit', 'water-bottle', 'kasa', 'sleeping-bag', 'sleeping-pad', 'sit-pad',
  'wool-underlayer', 'hat-mittens', 'rain-gear', 'headlamp', 'map-compass', 'whistle', 'cord', 'weekend-food', 'toilet-paper',
];

export const packWeight = (ids: readonly KitId[]): number => Math.round(ids.reduce((n, id) => n + kitItem(id).weight, 0) * 100) / 100;

/** Why a pack won't do, or null if it will: unknown or doubled items, or too heavy. */
export function packProblem(ids: readonly string[]): string | null {
  const unknown = ids.find(id => !KIT_IDS.includes(id as KitId));
  if (unknown) return `there's no "${unknown}" on the list`;
  const twice = ids.find((id, i) => ids.indexOf(id) !== i);
  if (twice) return `${kitItem(twice as KitId).name.toLowerCase()} is in there twice`;
  const kg = packWeight(ids as KitId[]);
  return kg > PACK_CAPACITY ? `too heavy: ${kg} kg, and the pack holds ${PACK_CAPACITY}` : null;
}
export const validPack = (ids: readonly string[]): ids is KitId[] => packProblem(ids) === null;

/** The kit's limited supplies (#1400): what runs out, and how much is left. */
export interface KitState {
  /** What was packed. */
  items: KitId[];
  /** Matches left, headlamp battery in hours, thermos drinks, stove meals; one-offs as 1 or 0. */
  matches: number;
  lamp: number;
  thermos: number;
  stove: number;
  sweets: number;
  comic: number;
}

/** What day 1 looks like with this pack. */
export interface PackStart {
  tools: Tool[];
  stores: { rations: number; materials: number };
  dressings: number;
  kit: KitState;
}

/** First-aid kit dressings; matches; headlamp hours; thermos drinks; stove meals. */
export const KIT_DRESSINGS = 3, KIT_MATCHES = 5, KIT_LAMP_HOURS = 8, KIT_THERMOS = 2, KIT_STOVE = 4;

/**
 * Turn a pack into day 1: a sound backpack always (the pack itself), the knife, the bottle and
 * the bag as the tools they stand for, the food and cord into the stores, and the supplies that
 * run out.
 */
export function startFromPack(ids: readonly KitId[]): PackStart {
  const has = (id: KitId) => ids.includes(id);
  const tools: Tool[] = [{ item: 'backpack', grade: 'sound' }];
  if (has('mora-knife')) tools.push({ item: 'stone-knife', grade: 'fine' });
  if (has('water-bottle')) tools.push({ item: 'waterskin', grade: 'sound' });
  if (has('sleeping-bag')) tools.push({ item: 'bedroll', grade: has('sleeping-pad') ? 'fine' : 'sound' });
  return {
    tools,
    stores: { rations: has('weekend-food') ? 4 : 0, materials: has('cord') ? 2 : 0 },
    dressings: has('first-aid-kit') ? KIT_DRESSINGS : 0,
    kit: {
      items: [...ids],
      matches: has('matches') ? KIT_MATCHES : 0,
      lamp: has('headlamp') ? KIT_LAMP_HOURS : 0,
      thermos: has('thermos') ? KIT_THERMOS : 0,
      stove: has('trangia') ? KIT_STOVE : 0,
      sweets: has('sweets') ? 1 : 0,
      comic: has('comic') ? 1 : 0,
    },
  };
}

/** Did they pack it? */
export const hasKit = (s: { kit?: KitState }, id: KitId): boolean => s.kit?.items.includes(id) ?? false;

/** How much cold nights cost with the clothes and pad packed (the bag-and-pad pair is a fine bedroll instead). */
export const WOOL_COLD = 0.85, PAD_COLD = 0.9;
export const kitColdCost = (s: { kit?: KitState }): number =>
  (hasKit(s, 'wool-underlayer') ? WOOL_COLD : 1) * (hasKit(s, 'sleeping-pad') && !hasKit(s, 'sleeping-bag') ? PAD_COLD : 1);

/** Scouting and surveying with a map and compass. */
export const MAP_TIME = 0.8;
export const kitTimeMult = (s: { kit?: KitState }, action: string): number =>
  hasKit(s, 'map-compass') && (action === 'scout' || action === 'survey') ? MAP_TIME : 1;

/** The kit from a save: kept if it's well-formed, else dropped (an old or broken save just has no kit). */
export function readKit(x: unknown): KitState | undefined {
  if (typeof x !== 'object' || x === null) return undefined;
  const o = x as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  if (!Array.isArray(o.items) || !validPack(o.items as string[])) return undefined;
  return { items: [...(o.items as KitId[])], matches: n(o.matches), lamp: n(o.lamp), thermos: n(o.thermos), stove: n(o.stove), sweets: n(o.sweets), comic: n(o.comic) };
}

/** What's left of the things that run out, in words (for the screen and the AI). */
export function kitSupplies(k: KitState, dressings = 0): string[] {
  const out: string[] = [];
  if (k.items.includes('first-aid-kit')) out.push(`${dressings} dressing${dressings === 1 ? '' : 's'}`);
  if (k.items.includes('headlamp')) out.push(`headlamp ${k.lamp}h`);
  if (k.items.includes('matches')) out.push(`${k.matches} match${k.matches === 1 ? '' : 'es'}`);
  if (k.items.includes('thermos')) out.push(`thermos ${k.thermos ? `${k.thermos} drink${k.thermos === 1 ? '' : 's'}` : 'empty'}`);
  if (k.items.includes('trangia')) out.push(`Trangia ${k.stove ? `${k.stove} meal${k.stove === 1 ? '' : 's'}` : 'out of fuel'}`);
  if (k.items.includes('sweets')) out.push(k.sweets ? 'sweets saved' : 'sweets eaten');
  if (k.items.includes('comic')) out.push(k.comic ? 'comic unread' : 'comic read');
  return out;
}
