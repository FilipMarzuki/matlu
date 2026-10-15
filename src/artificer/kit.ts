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
import type { WeatherId } from './world';
import { featureOn, type FeatureSwitches } from './features';

export type KitId =
  | 'mora-knife' | 'fire-steel' | 'matches' | 'first-aid-kit' | 'water-bottle' | 'kasa' | 'thermos'
  | 'sleeping-bag' | 'sleeping-pad' | 'sit-pad' | 'wool-underlayer' | 'hat-mittens' | 'rain-gear' | 'spare-socks'
  | 'headlamp' | 'map-compass' | 'whistle' | 'cord' | 'tarp' | 'trangia' | 'weekend-food' | 'sweets'
  | 'notebook' | 'toilet-paper' | 'phone' | 'comic' | 'pillow'
  // The odd things (#1727): funny, maybe useful, and weird.
  | 'family-tent' | 'salsa' | 'hairdryer' | 'home-pillow' | 'dumbbells' | 'hammer' | 'big-bag-sweets' | 'rubber-boots' | 'flamingo' | 'rice'
  | 'harmonica' | 'board-game' | 'binoculars' | 'duct-tape' | 'sewing-kit' | 'magnifying-glass' | 'notebook-pencils' | 'bird-book' | 'throat-sweets' | 'lots-of-socks'
  | 'toy-duck' | 'garden-gnome' | 'snow-globe' | 'roller-skate' | 'alarm-clock' | 'dala-horse' | 'sock-puppet' | 'pickled-herring' | 'smooth-stones' | 'accordion';

/**
 * The pack screen's sections, in the order they show. `personal` (#1727) is for the things from
 * home that fit no other section: toys, keepsakes, a whole accordion. The English labels here are
 * for the AI's packing turn; the screen reads `kitgroup.<id>` from the catalog.
 */
export type KitGroup = 'sleep' | 'fire-food' | 'clothes' | 'tools' | 'other' | 'personal';
export const KIT_GROUPS: Readonly<Record<KitGroup, string>> = { sleep: 'Sleep', 'fire-food': 'Fire and food', clothes: 'Clothes', tools: 'Tools', other: 'Other', personal: 'Personal' };

export interface KitItem {
  id: KitId;
  name: string;
  /** Its Swedish scout name, for flavour. */
  sv?: string;
  /** Kilograms. */
  weight: number;
  group: KitGroup;
  /**
   * What a scout would say it's for (#1684): plain words, no numbers, no game terms. This is what
   * the pack screen, the in-run pack list and the AI player see; the player finds out what's
   * actually useful by playing.
   */
  does: string;
  /** The rule it plays out here: documentation for the code, shown only with `?dev=truths` (#1684). */
  effect: string;
  /** A line in a scout's voice. */
  note: string;
}

export const KIT: readonly KitItem[] = [
  { id: 'sleeping-bag', name: 'Sleeping bag', sv: 'sovsäck', weight: 1.6, group: 'sleep', does: 'To sleep in.', effect: 'a sound bedroll from the first night (a fine one with the sleeping pad)', note: 'The heaviest thing in the pack, and the one you\'d never leave behind.' },
  { id: 'sleeping-pad', name: 'Sleeping pad', sv: 'liggunderlag', weight: 0.4, group: 'sleep', does: 'Goes under the sleeping bag, between you and the ground.', effect: 'with the sleeping bag, a fine bedroll; on its own, cold nights cost 10% less', note: 'The ground steals more heat than the air does — the leader says it every single hike.' },
  { id: 'pillow', name: 'Pillow', sv: 'kudde', weight: 0.3, group: 'sleep', does: 'For your head at night.', effect: 'the first night\'s sleep is a little better (+2 Clarity), and that\'s all', note: 'Everyone laughs. Everyone is jealous at bedtime.' },
  { id: 'mora-knife', name: 'Mora knife', sv: 'morakniv', weight: 0.1, group: 'fire-food', does: 'For cutting, carving and whittling.', effect: 'a fine knife: hunting, preserving and work that needs a blade', note: 'Your knife-licence knife. You\'re allowed to carry it on hikes now.' },
  { id: 'fire-steel', name: 'Fire steel', sv: 'eldstål', weight: 0.05, group: 'fire-food', does: 'Strikes sparks to light a fire.', effect: 'a fire catches and holds in the wind: wind never costs extra firewood for close work', note: 'Scrape it hard against the back of the knife. Birch bark catches every time.' },
  { id: 'matches', name: 'Matches in a zip bag', sv: 'tändstickor', weight: 0.05, group: 'fire-food', does: 'To light a fire.', effect: '5 easy fires: each spares a firewood when you work by firelight. They run out.', note: 'Kept dry in a freezer bag, because somebody always falls in the stream.' },
  { id: 'kasa', name: 'Kåsa', sv: 'kåsa', weight: 0.1, group: 'fire-food', does: 'A cup to drink from.', effect: 'a hot drink on every night the fire is kept in: +1 Clarity', note: 'Carved birch, hanging from your belt on a leather thong. It makes cocoa taste better.' },
  { id: 'thermos', name: 'Thermos', sv: 'termos', weight: 0.6, group: 'fire-food', does: 'Keeps a drink hot.', effect: 'two hot drinks for the first two cold nights: +4 Clarity each. Then it\'s empty.', note: 'Hot blackcurrant drink from home. It stays warm till Saturday lunch.' },
  { id: 'trangia', name: 'Trangia stove and fuel', sv: 'stormkök', weight: 1.1, group: 'fire-food', does: 'To cook on.', effect: '4 hot meals on cold nights with no fire kept in: +3 Clarity each. Then the fuel is gone.', note: 'The patrol\'s stove. Somebody had to carry it, and it was your turn.' },
  { id: 'weekend-food', name: 'Weekend food', sv: 'matsäck', weight: 1.5, group: 'fire-food', does: 'Food for the weekend.', effect: '+4 food, packed (it keeps like rations)', note: 'Crispbread, cheese, oat porridge, a tin of meatballs. Enough for the weekend.' },
  { id: 'sweets', name: 'Bag of sweets', sv: 'godis', weight: 0.2, group: 'fire-food', does: 'Something sweet for later.', effect: 'once, when your mind is nearly gone (under 30 Clarity at night): +6 Clarity', note: 'Saturday sweets, saved. You were going to share them.' },
  { id: 'water-bottle', name: 'Water bottle', sv: 'vattenflaska', weight: 0.3, group: 'fire-food', does: 'To carry water in.', effect: 'a sound waterskin: +1 water a trip', note: 'Filled at home. Refill it at the stream and drink the stream.' },
  { id: 'wool-underlayer', name: 'Wool underlayer', sv: 'ullunderställ', weight: 0.4, group: 'clothes', does: 'Worn under your clothes to keep you warm.', effect: 'wool layers: cold nights cost 15% less (stacks with knowing the cold)', note: 'Itchy, warm even when it\'s wet. Wool, never cotton — cotton kills.' },
  { id: 'hat-mittens', name: 'Wool hat and mittens', sv: 'mössa och vantar', weight: 0.2, group: 'clothes', does: 'For your head and hands in the cold.', effect: 'blizzard exposure is a step safer', note: 'Knitted by your grandmother. Lose one mitten and you\'re in trouble.' },
  { id: 'rain-gear', name: 'Rain gear', sv: 'regnställ', weight: 0.7, group: 'clothes', does: 'To keep the rain off.', effect: 'rain soaks you half as fast', note: 'Jacket and trousers. It always rains on hikes, whatever the forecast said.' },
  { id: 'spare-socks', name: 'Spare wool socks', sv: 'ullsockor', weight: 0.2, group: 'clothes', does: 'Dry socks for wet feet.', effect: 'dry socks after a soaking: being wet through costs half the Clarity', note: 'Two pairs. Dry feet are a happy scout.' },
  { id: 'sit-pad', name: 'Sit pad', sv: 'sittunderlag', weight: 0.05, group: 'clothes', does: 'Something dry to sit on.', effect: 'a rest restores a little more (+2 Vigor)', note: 'A square of foam on a cord. A dry seat on a wet rock.' },
  { id: 'first-aid-kit', name: 'First-aid kit', sv: 'första hjälpen', weight: 0.2, group: 'tools', does: 'For cuts, scrapes and blisters.', effect: '3 dressings: "treat" uses one instead of goods, and treats one step better', note: 'Plasters, a bandage, blister tape and a tiny pair of scissors.' },
  { id: 'headlamp', name: 'Headlamp', sv: 'pannlampa', weight: 0.15, group: 'tools', does: 'A light to see by in the dark.', effect: '8 hours of light for close work after dark — no firewood, no dark penalty. The battery runs down.', note: 'For finding the latrine at night, mostly.' },
  { id: 'map-compass', name: 'Map and compass', sv: 'karta och kompass', weight: 0.15, group: 'tools', does: 'To find your way.', effect: 'scouting and surveying take 20% less time', note: 'Orienteering badge. Red end north, map to the land, land to the map.' },
  { id: 'whistle', name: 'Whistle', sv: 'visselpipa', weight: 0.02, group: 'tools', does: 'For making a loud noise.', effect: 'face a boar or a bear and you can blow it: noise sends most animals off', note: 'Three blasts means help. Every scout has one round their neck.' },
  { id: 'cord', name: 'Cord, 10 m', sv: 'snöre', weight: 0.2, group: 'tools', does: 'For tying things.', effect: '+2 materials', note: 'For the tarp, for a clothesline, for anything. You can never have too much cord.' },
  { id: 'tarp', name: 'Tarp', sv: 'vindskydd', weight: 1.0, group: 'tools', does: 'A roof to sleep under.', effect: 'pitched when you make camp: a crude lean-to roof without felling a tree', note: 'The patrol\'s tarp — you were carrying it when you got separated.' },
  { id: 'notebook', name: 'Notebook and pencil', sv: 'anteckningsbok', weight: 0.1, group: 'other', does: 'To write things down.', effect: '+10% insight from study', note: 'For the hike diary the leader wants. A pencil works in the rain; a pen doesn\'t.' },
  { id: 'toilet-paper', name: 'Toilet paper', sv: 'toalettpapper', weight: 0.1, group: 'other', does: 'You know what for.', effect: 'nothing, out here', note: 'In a plastic bag. Every scout brings it. Every scout.' },
  { id: 'phone', name: 'Phone', sv: 'mobil', weight: 0.2, group: 'other', does: 'To call home.', effect: 'nothing: no signal, and dead by the third day', note: 'You promised to call home on Saturday evening.' },
  { id: 'comic', name: 'Comic book', sv: 'serietidning', weight: 0.2, group: 'other', does: 'Something to read.', effect: 'once, resting on a rainy day: +3 Clarity', note: 'Bamse, read so many times the cover\'s coming off.' },
  // The odd things (#1727): real stories of what scouts, kids and hikers have packed. Their `effect`
  // is what they do with the `pack-extras` switch on; with it off, every one of them only weighs.
  // "For later" marks an effect that needs a system the game doesn't have yet.
  // Funny
  { id: 'family-tent', name: 'Family-size tent', sv: 'familjetält', weight: 4.5, group: 'sleep', does: 'Room for six. You are one.', effect: 'cold nights cost 10% less (stacks with the wool)', note: 'Dad\'s camping tent, still in its bag from last summer. It\'s the size of a small house.' },
  { id: 'home-pillow', name: 'Bed pillow from home', sv: 'huvudkudde', weight: 0.8, group: 'sleep', does: 'The real one, from your bed.', effect: '+1 Clarity every night', note: 'Not a camp pillow. The big soft one. It takes up half the pack.' },
  { id: 'salsa', name: 'Big jar of salsa', sv: 'burk salsa', weight: 0.7, group: 'fire-food', does: 'For tacos. You have no tacos.', effect: 'once, the first night you eat: +2 Clarity', note: 'It was on the kitchen counter, and it seemed important.' },
  { id: 'big-bag-sweets', name: 'Family pack of sweets', sv: 'jättepåse godis', weight: 1.0, group: 'fire-food', does: 'Only the green ones are left.', effect: 'nothing yet (a treat to trade with kids on the road is for later)', note: 'It was full when the bus left. Somebody sat next to you.' },
  { id: 'rice', name: 'Bag of rice, no pot', sv: 'påse ris', weight: 1.0, group: 'fire-food', does: 'Dinner, eventually.', effect: 'nothing yet (food once you can cook it is for later)', note: 'A whole kilo. The pot is in somebody else\'s pack.' },
  { id: 'rubber-boots', name: 'Rubber boots', sv: 'gummistövlar', weight: 1.8, group: 'clothes', does: 'Mum insisted.', effect: 'rain soaks you a quarter slower (stacks with rain gear)', note: 'Green, heavy, and they squeak with every step.' },
  { id: 'hammer', name: 'Full-size hammer', sv: 'snickarhammare', weight: 0.7, group: 'tools', does: 'Instead of tent pegs.', effect: 'nothing yet (counting as a crude tool is for later: there are no hammers to count as)', note: 'From the toolbox in the garage. Pegs go in with a stone, but this felt more serious.' },
  { id: 'hairdryer', name: 'Hairdryer', sv: 'hårtork', weight: 0.6, group: 'personal', does: 'Needs a socket.', effect: 'nothing, until there is power', note: 'Your sister\'s. She doesn\'t know yet.' },
  { id: 'dumbbells', name: 'Two dumbbells', sv: 'två hantlar', weight: 4.0, group: 'personal', does: 'For staying in shape.', effect: 'half an hour of Strength exercise every night', note: 'Two kilos each. The leader looked at them for a long time and said nothing.' },
  { id: 'flamingo', name: 'Inflatable flamingo', sv: 'uppblåsbar flamingo', weight: 0.4, group: 'personal', does: 'For the lake.', effect: 'nothing (it floats)', note: 'Pink, flat, and already named. There might be a lake.' },
  // Maybe useful
  { id: 'binoculars', name: 'Binoculars', sv: 'kikare', weight: 0.5, group: 'tools', does: 'For birds.', effect: 'scouting and looking out take 10% less time (stacks with the compass)', note: 'Grandpa\'s, in a leather case that smells of his car.' },
  { id: 'duct-tape', name: 'Duct tape', sv: 'silvertejp', weight: 0.15, group: 'tools', does: 'Fixes things.', effect: 'once, a tool knocked in an accident is taped up instead of losing a grade or breaking', note: 'If it moves and it shouldn\'t, tape it. Half a roll, wound round a pencil stub.' },
  { id: 'sewing-kit', name: 'Sewing kit', sv: 'sykit', weight: 0.1, group: 'tools', does: 'Grandma packed it.', effect: 'nothing yet (clothes and bedroll wearing slower is for later: nothing wears yet)', note: 'Needles, thread in five colours, and a button that isn\'t from anything.' },
  { id: 'magnifying-glass', name: 'Magnifying glass', sv: 'förstoringsglas', weight: 0.1, group: 'tools', does: 'For looking at ants.', effect: 'on a clear day, the night\'s fire is lit in the sun: one firewood less for a fire that needs two or more', note: 'From the nature badge. Everything looks bigger and more interesting.' },
  { id: 'bird-book', name: 'Bird book', sv: 'fågelbok', weight: 0.4, group: 'tools', does: 'Which bird is that?', effect: 'tracking and hunting take 10% less time', note: 'Every bird in the north, with pictures. You\'ve ticked off the magpie.' },
  { id: 'throat-sweets', name: 'Hard sweets', sv: 'halstabletter', weight: 0.05, group: 'fire-food', does: 'For your throat.', effect: 'cold nights cost 5% less', note: 'Strong ones, in a tin that rattles. They make your eyes water.' },
  { id: 'lots-of-socks', name: 'Lots of spare socks', sv: 'extra sockor', weight: 0.8, group: 'clothes', does: 'You can never have too many.', effect: 'dry socks after a soaking, as the spare wool socks (fewer blisters is for later)', note: 'Seven pairs, one for every day, and a spare pair for the spares.' },
  { id: 'notebook-pencils', name: 'Squared notebook and pencils', sv: 'rutat block', weight: 0.3, group: 'other', does: 'For writing things down.', effect: 'something to draw your own map on, as the notebook is (#1686)', note: 'Squared pages, and a box of pencils in every colour.' },
  { id: 'harmonica', name: 'Harmonica', sv: 'munspel', weight: 0.1, group: 'personal', does: 'Everyone will love it.', effect: 'nothing yet (better first impressions with villagers is for later)', note: 'You know one song. Most of one song.' },
  { id: 'board-game', name: 'Board game', sv: 'sällskapsspel', weight: 0.9, group: 'personal', does: 'For when it rains.', effect: 'on a storm day: +2 Clarity at night', note: 'Half the pieces are missing, so you make up the rules.' },
  // Weird
  { id: 'pickled-herring', name: 'Jar of pickled herring', sv: 'burk sill', weight: 0.6, group: 'fire-food', does: 'For midsummer.', effect: '+1 food, packed (animals smelling it is for later)', note: 'Midsummer was in June. The lid is very, very tight.' },
  { id: 'toy-duck', name: 'Toy duck', sv: 'leksaksanka', weight: 0.1, group: 'personal', does: 'Comes everywhere.', effect: 'nothing (journal lines about it are for later)', note: 'Yellow rubber, a bit chewed. He\'s been on every trip since you were three.' },
  { id: 'garden-gnome', name: 'Garden gnome', sv: 'trädgårdstomte', weight: 1.5, group: 'personal', does: 'He wanted to come.', effect: 'nothing (villagers asking about him is for later)', note: 'From the flowerbed by the front door. Red hat, painted smile, heavier than he looks.' },
  { id: 'snow-globe', name: 'Snow globe', sv: 'snöglob', weight: 0.5, group: 'personal', does: 'It\'s always winter inside.', effect: 'nothing', note: 'Shake it and a tiny red cottage gets snowed in.' },
  { id: 'roller-skate', name: 'A single roller skate', sv: 'en rullskridsko', weight: 1.2, group: 'personal', does: 'The other one is at home.', effect: 'nothing', note: 'You meant to pack the pair. You found one under the bed, in a hurry.' },
  { id: 'alarm-clock', name: 'Alarm clock', sv: 'väckarklocka', weight: 0.3, group: 'personal', does: 'So you don\'t oversleep.', effect: 'rings at dawn on the first morning; nothing else', note: 'The loud kind, with two bells on top. It ticks all night.' },
  { id: 'dala-horse', name: 'Wooden dala horse', sv: 'dalahäst', weight: 0.2, group: 'personal', does: 'From Grandpa.', effect: 'nothing (becoming an heirloom on a later run is for later)', note: 'Red, with flowers painted on. He carved one for every grandchild.' },
  { id: 'sock-puppet', name: 'Sock puppet', sv: 'strumpdocka', weight: 0.05, group: 'personal', does: 'His name is Sigge.', effect: 'nothing (making kids on the road laugh is for later)', note: 'Two button eyes and a great many opinions.' },
  { id: 'smooth-stones', name: 'Ten smooth stones', sv: 'tio släta stenar', weight: 1.0, group: 'personal', does: 'They\'re good stones.', effect: 'nothing (throwing them is for later)', note: 'From the beach last summer. You couldn\'t leave them behind.' },
  { id: 'accordion', name: 'Accordion', sv: 'dragspel', weight: 6.0, group: 'personal', does: 'You\'ve practised a little.', effect: 'nothing (what villagers think of it is for later)', note: 'Grandma\'s, in its case. It wheezes when you pick it up.' },
];

/** The 30 odd things (#1727), in the order they were added: none is on the leader's list. */
export const EXTRA_ITEMS: readonly KitId[] = KIT.slice(KIT.findIndex(k => k.id === 'family-tent')).map(k => k.id);

/**
 * The switch the odd things' hidden effects sit behind (#1727, features.ts). A rules switch: a run
 * keeps it as it started, and a run from before it reads it as off, so its replay plays the same.
 */
export const PACK_EXTRAS = 'pack-extras';

/** What the kit's rules read from a run: its pack, and (for the odd things) its world's switches. */
export interface KitRun { kit?: KitState; config?: { world: { features?: FeatureSwitches } } }

/** Are the odd things' effects on in this run? */
export const extrasOn = (s: KitRun): boolean => featureOn(s.config?.world.features, PACK_EXTRAS);

/** Did they pack this odd thing, and does it do anything in this run? With the switch off it's only weight. */
export const hasExtra = (s: KitRun, id: KitId): boolean => extrasOn(s) && hasKit(s, id);

/** Has a one-off odd thing (the salsa, the duct tape) been used up? */
export const usedKit = (s: KitRun, id: KitId): boolean => s.kit?.used?.includes(id) ?? false;

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
  /**
   * The odd things' one-offs that are used up (#1727): the salsa eaten, the duct tape spent.
   * Optional, so a save from before it reads the same, and only ever holds items that were packed.
   */
  used?: KitId[];
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
/** The pickled herring's food, with the odd things' switch on (#1727). */
export const HERRING_FOOD = 1;

/**
 * Turn a pack into day 1: a sound backpack always (the pack itself), the knife, the bottle and
 * the bag as the tools they stand for, the food and cord into the stores, and the supplies that
 * run out. With the odd things' switch on (`extras`, #1727), the pickled herring is food too.
 */
export function startFromPack(ids: readonly KitId[], extras = false): PackStart {
  const has = (id: KitId) => ids.includes(id);
  const food = (has('weekend-food') ? 4 : 0) + (extras && has('pickled-herring') ? HERRING_FOOD : 0);
  const tools: Tool[] = [{ item: 'backpack', grade: 'sound' }];
  if (has('mora-knife')) tools.push({ item: 'stone-knife', grade: 'fine' });
  if (has('water-bottle')) tools.push({ item: 'waterskin', grade: 'sound' });
  if (has('sleeping-bag')) tools.push({ item: 'bedroll', grade: has('sleeping-pad') ? 'fine' : 'sound' });
  return {
    tools,
    stores: { rations: food, materials: has('cord') ? 2 : 0 },
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
export const hasKit = (s: KitRun, id: KitId): boolean => s.kit?.items.includes(id) ?? false;

/** How much cold nights cost with the clothes and pad packed (the bag-and-pad pair is a fine bedroll instead). */
export const WOOL_COLD = 0.85, PAD_COLD = 0.9;
/** …and with the odd things on (#1727): a family tent's spare room is a little warmer, and hard sweets soothe a cold throat. */
export const TENT_COLD = 0.9, THROAT_SWEETS_COLD = 0.95;
// Multipliers, so each thing takes its share off what's left and they stack without ever reaching zero.
// With `thermal-model` (#1770) the wool and the pad are insulation in the night's heat balance
// (thermal.ts insulationHeld), so they don't also take a share off here.
export const kitColdCost = (s: KitRun): number => {
  const inClo = featureOn(s.config?.world.features, 'thermal-model');
  return (hasKit(s, 'wool-underlayer') && !inClo ? WOOL_COLD : 1) * (hasKit(s, 'sleeping-pad') && !hasKit(s, 'sleeping-bag') && !inClo ? PAD_COLD : 1)
    * (hasExtra(s, 'family-tent') ? TENT_COLD : 1) * (hasExtra(s, 'throat-sweets') ? THROAT_SWEETS_COLD : 1);
};

/** Scouting and surveying with a map and compass. */
export const MAP_TIME = 0.8;
/** With the odd things on (#1727): binoculars for scouting and looking out, the bird book for tracking and hunting. */
export const BINOCULARS_TIME = 0.9, BIRD_BOOK_TIME = 0.9;
export const kitTimeMult = (s: KitRun, action: string): number =>
  (hasKit(s, 'map-compass') && (action === 'scout' || action === 'survey') ? MAP_TIME : 1)
  * (hasExtra(s, 'binoculars') && (action === 'scout' || action === 'lookout') ? BINOCULARS_TIME : 1)
  * (hasExtra(s, 'bird-book') && (action === 'track' || action === 'hunt') ? BIRD_BOOK_TIME : 1);

/**
 * The firewood a night's fire needs, after the magnifying glass (#1727): on a clear day you light it
 * in the last of the sun, so the kindling log is spared. A fire that needs only one still needs it.
 */
export const kitFireNeed = (s: KitRun & { weatherToday: WeatherId }, need: number): number =>
  hasExtra(s, 'magnifying-glass') && s.weatherToday === 'clear' && need >= 2 ? need - 1 : need;

/** The kit from a save: kept if it's well-formed, else dropped (an old or broken save just has no kit). */
export function readKit(x: unknown): KitState | undefined {
  if (typeof x !== 'object' || x === null) return undefined;
  const o = x as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  if (!Array.isArray(o.items) || !validPack(o.items as string[])) return undefined;
  const items = [...(o.items as KitId[])];
  // What's used up (#1727): kept only if every entry is something that was packed; otherwise
  // dropped, which reads as nothing used yet.
  const used = Array.isArray(o.used) && o.used.every(id => items.includes(id as KitId)) && o.used.length > 0 ? [...(o.used as KitId[])] : undefined;
  return { items, matches: n(o.matches), lamp: n(o.lamp), thermos: n(o.thermos), stove: n(o.stove), sweets: n(o.sweets), comic: n(o.comic), ...(used ? { used } : {}) };
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
