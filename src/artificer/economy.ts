/**
 * What each place lives on (#1599): its economy.
 *
 * Owner (#1585 Q5): villages a few days apart can share a region, but each should have its own
 * economic engine (a lumber village, a mining one, fishing, trading) so the player feels the
 * difference, and the difference should come from work, not from new cultures. Owner (on #1599):
 * every village has at least one **dominant** trade, several can be present, and a village can be
 * known for the trade or resource that **founded** it, which needn't be what it lives on today
 * (a mining town whose seam ran out and now trades).
 *
 * So an economy is three things: `dominant`, `secondary` and `founding`.
 *
 * ## Crafted first, generated to fill
 *
 * The same rule as the villages' local history (local-history.ts): what we write by hand wins,
 * and generation fills the rest.
 * - The three **road villages** have their economy written here (VILLAGE_ECONOMY), to agree with
 *   what villages.ts already says of them: Hollowford's terraced barley and sheepfolds at the
 *   ford, Saltmere's salt and fish racks (the mere "was sweet water once", Anselm says, so it grew
 *   up around the fishing), and Kestrel Gate's toll, market and "iron off the passes".
 * - **Every other place** gets the economy the story engine gave its province (storytelling/
 *   regions.ts: the land's best trade, or the market for a market town; history-format.ts
 *   `RegionHistory.provinces`), read by `economyOfProvince`.
 *
 * The engine knows nothing of the road villages' writing: it scores the land at their seats like
 * any other, so it can make Saltmere a lumber town or put a fishery at Kestrel Gate. Reading the
 * economy here, after the history is told, keeps the hand-written villages true to their
 * landscape without touching the engine's random stream (no golden hashes, no HISTORY_VERSION).
 * local-history.ts and regional-facts.ts both read it.
 *
 * ## In play (behind the `village-economies` switch)
 *
 * A road village's economy also says what's **plentiful** there (the goods its trades make, cheap
 * to buy and not worth much to sell) and what's **scarce** (what it lacks, dear to buy and worth
 * more to sell), and what the place looks and sounds like (`scene`). road.ts reads those
 * through `localMarket` for prices and stock, quests.ts gates each village's trade job on the
 * switch, and the arrival tells the scene, what the place lives on and what it burns.
 *
 * ## Everyday fuel is local (#1627)
 *
 * Owner (on #1627): a village has to get its everyday fuel close by, "else how could they be
 * sustaining themselves. Firewood is heavy and hard to transport". So no road village lists fuel
 * as scarce: Hollowford cuts wood in the copses above its terraces, Kestrel Gate on the slopes
 * below the pass, and Saltmere, out on the treeless steppe, burns what it cuts and gathers there:
 * reed off the mere's edge, peat, and dried dung (`fuel`). Saltmere still lacks *wood*, so
 * firewood is dear there as timber, not as fuel: it goes to Hedda's smoke-racks, not the hearths.
 *
 * ## The prices (#1627)
 *
 * The multipliers (×0.75 for what a village makes, ×1.25 for what it lacks, ×1.1 for a market
 * town's markup) were checked against a careful player carrying goods down the road
 * (economy-prices.test.ts) and kept. The best carry, hides from Hollowford to Saltmere or salt
 * rations from Saltmere to the Gate, returns a third on what it cost at a stranger's prices
 * (about 1.6× at a friend's), so 20 marks carried the whole road come to about 35: real, and
 * less than the jobs pay along the way. The check found one thing to change: traders bought a
 * good they sell for more than they sold it (a wanted kind pays ×1.5, which beats the ×1.25
 * markup), so a player could buy a heap and sell it straight back for marks every hour, with or
 * without village economies. With the switch, no trader pays more than ×0.8 of their own price
 * for a good they sell (`BUY_BACK`).
 *
 * Pure data plus pure helpers.
 */

import type { Good, Kind } from './trade';
import type { AnchorId } from './world/provinces';

/**
 * A trade a place can live on: the story engine's livelihoods (storytelling/types.ts `Livelihood`),
 * plus two only the road villages have: `salt` (Saltmere's, raked off the mere's crust) and `tolls` (Kestrel Gate's wall).
 */
export type Trade = 'farming' | 'herding' | 'lumber' | 'mining' | 'fishing' | 'peat' | 'trading' | 'salt' | 'tolls';

/** What a place grew up around: a trade, a ford (`crossing`, the engine's), or a pass it guards (`pass`). */
export type Founding = Exclude<Trade, 'trading' | 'tolls'> | 'crossing' | 'pass';

export interface Economy {
  /** What it lives on most. Every place has one. */
  dominant: Trade;
  /** What else it lives on (none, one or two), besides the dominant. */
  secondary: readonly Trade[];
  /** What it grew up around, which may not be what it lives on now. */
  founding: Founding;
  /** Written by hand (a road village), not read off the engine. */
  crafted: boolean;
  /** The hand-written telling of it, in place of the generated one (`economyLine`). */
  story?: string;
}

/** A road village's economy: what it lives on, and what that means at its market and on arrival. */
export interface VillageEconomy extends Economy {
  crafted: true;
  story: string;
  /** Goods its trades make: plentiful, so cheap to buy and worth less to sell. */
  plentiful: readonly Good[];
  /** What it lacks: scarce, so dear to buy and worth more to sell. Never `fuel` (#1627). */
  scarce: readonly Scarcity[];
  /** Its everyday fuel, got close by (#1627): no village can live on firewood carted in. */
  fuel: LocalFuel;
  /** What it looks and sounds like when the caravan rolls in, from what it lives on. */
  scene: string;
  /**
   * Whether its traders sell at a market town's keener prices (`MARKET_MARKUP`). Unset, it does
   * when it lives on trading. Hollowford trades at its ford (#1631), but with one trader and no
   * choice of stalls, so it says `false`.
   */
  market?: boolean;
}

/**
 * What a village can lack: a kind of goods (trade.ts `KIND_OF`), or one good when the village
 * lacks the thing rather than the kind. Saltmere lacks wood, not fuel: it lists `firewood` (the
 * road's only wood good), so a fuel it could burn, were there one besides firewood, wouldn't be
 * dear there.
 */
export type Scarcity = Kind | Good;

/**
 * What a village burns day to day (#1627). `wood`: firewood cut close by. `peat`: what a treeless
 * place cuts and gathers instead, reed, peat and dried dung. world/settlements.ts reads it too:
 * a village that burns wood has its woodlot.
 */
export interface LocalFuel {
  burns: 'wood' | 'peat';
  /** Said on arrival, after what the place lives on. */
  line: string;
}

/**
 * The road villages' economies, written to agree with villages.ts and with their people:
 * - **Hollowford** lives on its terraced barley, and its sheepfolds and the trade at its ford
 *   besides: Tobin buys "what travels well" from everyone who has to cross there (#1631). The ford
 *   was there before the village (Maren). It has no iron ("that's Gate work", Orrin). Its wood comes down
 *   from the copses above the terraces (its scope facts), so it isn't short of fuel: Orrin's
 *   forge "eats wood faster than I can cut it" because he's busy, not because the hill is bare.
 * - **Saltmere** lives on salt ("salt fish, salt pork, salt everything", Hedda), and on the fish
 *   it salts; it grew up around the fishing, when the mere was sweet (Anselm). It's at the edge of
 *   the treeless steppe, so wood is dear (Hedda's smoke-racks) and the hearths burn reed, peat and
 *   dung; and its waterskins "leak at every seam" (Liv).
 * - **Kestrel Gate** lives on its toll ("the toll pays for the wall", Veit), its market and the
 *   iron off the passes; it grew up around the wall across the pass. A pass has no fields. The
 *   Gate burns a lot of wood (Arvid buys it), and cuts it on its own slopes.
 */
export const VILLAGE_ECONOMY: Readonly<Record<AnchorId, VillageEconomy>> = {
  hollowford: {
    dominant: 'farming', secondary: ['herding', 'trading'], founding: 'crossing', crafted: true,
    story: 'Hollowford grew up around the ford, where the river let it; today it lives on the barley on its terraces, and on its sheep and the trade at the ford besides.',
    // One trader at the ford (Tobin), not a market of stalls: his prices stay a village trader's.
    market: false,
    plentiful: ['rawFood', 'hides'],
    scarce: ['tools'],
    fuel: { burns: 'wood', line: 'Its hearths burn wood from the copses above the terraces.' },
    scene: 'Barley stands gold on every terrace, sheep call from the stone folds, and fresh hides hang drying on the walls by the ford.',
  },
  saltmere: {
    dominant: 'salt', secondary: ['fishing'], founding: 'fishing', crafted: true,
    story: 'Saltmere grew up around the fishing, when the mere was still sweet water; today it lives on salt, and on the fish it salts besides.',
    plentiful: ['rations', 'rawFood'],
    scarce: ['firewood', 'leather'],
    fuel: { burns: 'peat', line: 'There isn\'t a tree on the steppe: the hearths burn reed cut at the mere\'s edge, peat and dried dung, and what wood the carts bring goes to the smoke-racks.' },
    scene: 'Rakers work the white crust along the shore, the racks are hung with fish drying over slow smoke, and everything smells of brine.',
  },
  'kestrel-gate': {
    dominant: 'tolls', secondary: ['trading', 'mining'], founding: 'pass', crafted: true,
    story: 'Kestrel Gate grew up around the wall across the pass; today it lives on the toll, and on its market and the iron off the passes besides.',
    plentiful: ['stone'],
    scarce: ['food'],
    fuel: { burns: 'wood', line: 'Its fires and its forge burn wood cut on the slopes below the pass.' },
    scene: 'Wagons wait at the gate to be counted and tolled, ore-carts rattle down from the passes, and the market inside the wall rings with lowland coin and hammered iron.',
  },
};

/** The road villages whose economy is written by hand, by anchor id. */
export type CraftedEconomies = Readonly<Partial<Record<AnchorId, VillageEconomy>>>;

/** A province as a told history lists it in its region (history-format.ts `RegionHistory.provinces`). */
export interface ProvinceTrade { name: string; livelihood: string; secondary: readonly string[]; founding: string }

/** The road village a province is seated at, by name (provinces.ts names each anchor's province after its village). */
const ANCHOR_BY_NAME: Readonly<Record<string, AnchorId>> = { Hollowford: 'hollowford', Saltmere: 'saltmere', 'Kestrel Gate': 'kestrel-gate' };

/** The road village a province is, if it's one: its name is the village's. */
export const anchorNamed = (name: string): AnchorId | undefined => ANCHOR_BY_NAME[name];

/**
 * A province's economy: a road village's as written, else what the engine gave it. The engine's
 * livelihoods are all `Trade`s, so its values pass through as they are.
 */
export function economyOfProvince(p: ProvinceTrade, crafted: CraftedEconomies = VILLAGE_ECONOMY): Economy {
  const anchor = anchorNamed(p.name);
  const written = anchor ? crafted[anchor] : undefined;
  if (written) return written;
  return { dominant: p.livelihood as Trade, secondary: p.secondary as Trade[], founding: p.founding as Founding, crafted: false };
}

/** Every trade a place lives on, dominant first. */
export const tradesOf = (e: Economy): readonly Trade[] => [e.dominant, ...e.secondary];

/** Whether a place lives on `trade` at all (dominant or secondary). */
export const livesOn = (e: Economy, trade: string): boolean => tradesOf(e).includes(trade as Trade);

/** How people name a trade when they say what a place lives on. */
export const TRADE_WORDS: Readonly<Record<string, string>> = {
  farming: 'its fields', lumber: 'timber', mining: 'ore', fishing: 'fish', herding: 'its flocks', peat: 'peat and reed',
  trading: 'its market', salt: 'salt', tolls: 'the toll',
};

/** ...and what it grew up around. */
export const FOUNDING_WORDS: Readonly<Record<string, string>> = {
  crossing: 'the ford', farming: 'its fields', lumber: 'the woods', mining: 'a seam of ore', fishing: 'the fishing',
  herding: 'its pastures', peat: 'the peat cuttings', salt: 'the salt', pass: 'the wall across the pass',
};

/**
 * What a place lives on, in a sentence: the hand-written telling where there is one, else made
 * from its economy ("Ravenford grew up around the ford; today it lives on its market, and on
 * timber besides").
 */
export function economyLine(name: string, e: Economy): string {
  if (e.story) return e.story;
  const founded = FOUNDING_WORDS[e.founding] ?? e.founding;
  const today = TRADE_WORDS[e.dominant] ?? e.dominant;
  const also = e.secondary.map(t => TRADE_WORDS[t] ?? t);
  const besides = also.length ? `, and on ${also.join(' and ')} besides` : '';
  return e.founding === e.dominant
    ? `${name} grew up around ${founded}, and still lives on ${today}${besides}.`
    : `${name} grew up around ${founded}; today it lives on ${today}${besides}.`;
}

/**
 * The trade each of the engine's ventures belongs to (storytelling/regions.ts `VENTURE_OF`): a
 * region's venture sits in one of its provinces, and at a road village it may be one the village
 * doesn't live on (a lumber camp at Saltmere). Readers tell that one as out beyond the village.
 */
export const VENTURE_TRADE: Readonly<Record<string, Trade>> = {
  mill: 'farming', 'lumber camp': 'lumber', mine: 'mining', fishery: 'fishing', 'wool trade': 'herding', 'peat cuttings': 'peat',
};

/** Whether a venture fits the economy of the place it's at: the place lives on its trade. */
export const ventureFits = (e: Economy, ventureKind: string): boolean => {
  const t = VENTURE_TRADE[ventureKind];
  return !t || livesOn(e, t);
};

// --- in play: the village's market (the `village-economies` switch) ---

/**
 * A plentiful good costs and fetches this share of its price; a scarce one this much more.
 * Checked against a careful player's trade down the road (#1627, economy-prices.test.ts).
 */
export const PLENTIFUL = 0.75, SCARCE = 1.25;
/** A market town's traders sell at this markup in place of trade.ts `MARKUP`: buyers have a choice of stalls. */
export const MARKET_MARKUP = 1.1;
/**
 * The most a trader pays for a good they sell themselves, as a share of what they'd charge for it
 * (#1627, trade.ts `sellPrice`): no buying a heap and selling it straight back at a profit.
 */
export const BUY_BACK = 0.8;

/** What a village's market makes of a trade: what's plentiful, what's scarce, whether it's a market town. */
export interface LocalMarket {
  plentiful: readonly Good[];
  scarce: readonly Scarcity[];
  /** A market or toll town: keener prices on what its traders sell. */
  market: boolean;
}

/** A road village's market, or null for a place with no hand-written economy (and on the wagon). */
export function localMarket(village: string | null, crafted: CraftedEconomies = VILLAGE_ECONOMY): LocalMarket | null {
  const e = village ? crafted[village as AnchorId] : undefined;
  if (!e) return null;
  return { plentiful: e.plentiful, scarce: e.scarce, market: e.market ?? livesOn(e, 'trading') };
}

/** How a kind of goods and a good are named in the line about the market. */
const KIND_WORDS: Readonly<Record<Kind, string>> = {
  food: 'food', water: 'water', fuel: 'firewood', raw: 'raw materials', leather: 'leather goods', cloth: 'cloth goods', tools: 'tools',
};
const GOOD_WORDS: Readonly<Record<Good, string>> = {
  rawFood: 'fresh food', water: 'water', firewood: 'firewood', materials: 'materials', rations: 'salted rations', stone: 'stone', hides: 'hides',
};

/** How a scarce thing is named: a kind by its kind's words, a good by its own. */
const scarceWord = (x: Scarcity): string => (x in KIND_WORDS ? KIND_WORDS[x as Kind] : GOOD_WORDS[x as Good]);

/** "Fresh food and hides are cheap here; tools are dear, and sell well." */
export function marketLine(m: Pick<LocalMarket, 'plentiful' | 'scarce'>): string {
  const list = (xs: readonly string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  // Two things are plural, and so is one whose name is ("tools", "leather goods"); "food" isn't.
  const plural = (xs: readonly string[]) => (xs.length > 1 || /s$/.test(xs[0]) ? 'are' : 'is');
  const cheapWords = m.plentiful.map(g => GOOD_WORDS[g]), dearWords = m.scarce.map(scarceWord);
  const cheap = cheapWords.length ? `${list(cheapWords)} ${plural(cheapWords)} cheap here` : '';
  const dear = dearWords.length ? `${list(dearWords)} ${plural(dearWords)} dear, and sell well` : '';
  return `${cap([cheap, dear].filter(Boolean).join('; '))}.`;
}

/**
 * What arriving tells of a village's economy: what it looks and sounds like, what it lives on,
 * what it burns (#1627), and what that means at its market. Null for a place with none written.
 */
export function arrivalLines(village: string, crafted: CraftedEconomies = VILLAGE_ECONOMY): string[] | null {
  const e = crafted[village as AnchorId];
  if (!e) return null;
  return [e.scene, e.story, e.fuel.line, marketLine(e)];
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
