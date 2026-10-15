# Local culture: styles that drift with isolation

**Issue:** #1739 (design spike) · **Epic:** #1738 · **Written:** 2026-10-15 · **Status:** design, nothing built yet

The owner (2026-10-15): "let's make sure the region, province and even village level gets some distinct culture elements, like fashion, crafting style, architecture, music etc. If places are very connected — small differences. If places are a bit more isolated — larger difference. But still strong similarities across cultures, nations, regions etc unless there is a reason for it. Create some kind of framework for this. I want to use this info for creating speech patterns, how people interact, clothing, artifacts, and maybe even in-game music and soundscape."

This page is that framework. In one paragraph: every culture has a **base style**, about 30 small picks (what cloth, what roof, what tune, how you greet). Each level below it (realm, region, province, village) adds a few **twists**. How many twists a place gets depends on how **cut off** it is from its parent, and for how long. Every twist carries a **reason** taken from the history engine, so lore can always say why Kettleridge sounds different. It's computed after the history is lived, on its own random stream, so no golden hash moves.

## 1. What exists

| Piece | What it gives us | Reuse for local culture? |
|---|---|---|
| `storytelling/culture-drift.ts` | Each culture's elite and folk pressure pools, its seven traits (mercantile, meritocracy…), and an **aesthetic layer**: a ruler's quirk (sibilant speech, elaborate dress…) that spreads to the whole culture (`CultureState.aesthetic`, `figureQuirks`). Runs only when a world has cultures (the Reach does). | **Yes, as culture-level drift.** A spread quirk moves the culture's base (§3). Traits feed reasons (§5). It's per culture, never per place. |
| `storytelling/language.ts` | Languages drift with isolation (0.002 a year), converge with trade contact, split at 0.6, and a busy trade route makes a lingua franca. | **Yes, as the model.** Its idea (isolation drifts, contact pulls back) is exactly ours. A split is a reason for speech twists. It works per culture, not per place. |
| `storytelling/regions.ts` | Regions of 3–6 provinces around a market town; each province's livelihood and founding; road trade between regions (`Region.roads`); prosperity; regional events (fairs, hard winters, migration, booms) in their own log. | **Yes, heavily.** The region is our middle level. Livelihoods force crafts, food and idiom (§5). Roads and fairs are connectivity and reasons. |
| `storytelling/geography.ts`, `Province` (`types.ts`) | Terrain, fertility, river, lake, neighbour graph, population, wealth, blight. | **Yes:** terrain forces building materials; rivers, lakes and the neighbour graph are connectivity. |
| `storytelling/names.ts` | Generic name pools. Culture names come from each `CultureSpec`. | No change needed. |
| `storytelling/specs/culture-events.ts` | 15 events fired by culture traits. | Reasons only. |
| `migration.ts`, `odd-patches.ts`, `specs/lost-peoples-events.ts` | Migration waves, odd patches of humans, strangers arriving from nowhere. | **Yes:** "Peoples present" and "strangers settled" reasons. |
| `religion.ts`, `diplomacy.ts` | Churches and deities (the Reach has none: the gods are dead, `world/peoples.ts`); treaties and alliances. | Religion as a reason where a world has faiths; alliances count as shared rule. |
| `macro-world/cultures.json` | The 22 cultures' settlement layout: `roofStyle`, `streetPattern`, `traits`, `racePreferences`. Read by `mapgen/` and the Reach's settlements. | **Yes:** the base for architecture, and the Peoples mix a culture expects. |
| `macro-world/culture-traits.json` | 25 settlement traits (fire-centred, fortified-perimeter…). | **Yes:** what a settlement gathers around. |
| `macro-world/fashion.json` | For all 22 cultures: base materials, palette, motifs, and role variants (common, elder, warrior, ceremonial) with silhouette and headwear. | **Yes:** the base for fashion and craft motifs. Not named in the issue, but it's most of the clothing half. |
| `public/macro-world/architecture.json` | 21 building styles (material, method, ornament). Which culture uses which lives only in Supabase (`docs/canon.md` gap G9). | Phrasing only, until G9 is fixed. |
| `src/artificer/content/cultures-lore.json`, `culture-lore.ts` | For the 12 road cultures: values, taboos, customs (greeting, trade, mourning, debt), **candour** (blunt, plain, guarded), voice and sayings. `effectiveCandour` nudges candour by place (#1619). | **Yes:** the base for speech and interaction. #1619 is the precedent: a place nudges a culture one step, and the culture still sounds like itself. |
| `docs/race-and-culture.md`, `docs/culture-lore.md`, `AXES.md` | The model: cultures are race-agnostic; People-level axes (tight/loose, high/low context). AXES says the interesting signal for a sub-group is its divergence from the parent. | The axes seed directness and formality. |
| `WORLD.md` § Visual identity | Each People's clothing, architecture and objects. Rule: **resources determine aesthetics**. | **Yes:** the "People touch" a person adds (§3), and the rule behind the land reasons. |
| Artificer world (`src/artificer/world/`) | The Reach: grid with walking hours (`reach.ts`), provinces with a culture each (`provinces.ts`), realms and houses lived for 150 years (`history.ts`), a settlement per province (`settlements.ts`), crafted-first local history with a stream per slot (`local-history.ts`), crafted regions (`regions.ts`). | **Yes:** the places, the hours between them, and the pattern "crafted first, generated to fill, one stream per slot". |
| `src/artificer/villages.ts` | The three road villages and their people, each with a People and a culture. A village can hold several cultures (Saltmere: waterstead, harborfolk, steppe-camp). | Crafted pins for those villages (§3). |
| `macro-world/npc-presentation.json` | An empty schema for per-culture NPC overlays (palette, accessory, voice set). | A later consumer. |

**What's missing.** Nothing models style per *place*. Food, music and interaction norms exist nowhere as data. Culture drift and language drift are per culture. `fashion.json` and `cultures-lore.json` have no local variants. Nothing turns "how connected is this place" into "how different is it".

## 2. The data model

A **style** is a map from attribute to value: 32 attributes in 7 categories. Each attribute is one pick from a small value set. Each value has a short phrase for prose. Values are grouped so the generator knows a *near* change from a *far* one:

- **ordinal** attributes are a scale; a near change is one step, a far change two or more;
- **nominal** attributes with families: a near change stays in the family, a far change leaves it. A nominal attribute with no families listed has only far changes.

| Category | Attribute | Kind | Values (families in brackets) | Base comes from |
|---|---|---|---|---|
| Fashion | `cloth` | nominal | [wool] heavy wool, felted wool, knitted wool · [skin] sheepskin, leather, oilskin · [plant] linen, hemp, reed fibre, cotton · [fine] brocade, silk | `fashion.json` materials[0] |
| | `colour` | nominal | [dark] charcoal, iron-grey, soot-black · [earth] russet, ochre, clay-brown · [green] moss, grass · [bright] weld yellow, woad blue, deep red · [pale] cream, undyed, cloud-white | `fashion.json` palette[0] (the accent stays palette[1]) |
| | `cut` | ordinal | fitted · wrapped · layered-loose · draped · flowing | `fashion.json` common silhouette |
| | `ornament` | ordinal | bare · plain · bordered · patterned · ornate | new (motif count is a hint) |
| | `signature` | nominal | per culture, plus a shared pool (a cap, a hat, a token on a cord, braided hair, a clasp, a sash…) | `fashion.json` common headwear or accessory |
| Crafts | `material` | nominal | wood, stone, iron, clay, bone and horn, wicker and reed, textile | new |
| | `motif` | nominal | [lines] chevrons, zigzags, ripple lines, plough lines · [knots] knotwork, interlace · [marks] runes as record, tally marks · [forms] mountains, sheaves, lily pads, beasts · plain | `fashion.json` motifs[0] |
| | `finish` | ordinal | raw · smoothed · oiled · carved · inlaid | new |
| Architecture | `walls` | nominal | log, timber frame, wattle and daub, dry stone, cut stone, timber on piles, turf | new |
| | `roof` | nominal | `cultures.json` `roofStyle` values (thatch, slate, stone, reed, tile, hide…) | `cultures.json` |
| | `layout` | nominal | `cultures.json` `streetPattern` values (linear, grid, organic, radial, branching) | `cultures.json` |
| | `heart` | nominal | hearth, hall, market square, well or water, gate, forge, grove | `cultures.json` traits (fire-centred → hearth) |
| Food | `staple` | nominal | oat porridge, barley bread, rye flatbread, fish, mutton, curds and cheese, roots, game | new |
| | `keeping` | nominal | smoked, salted, dried, soured, cheese-making, root-cellared | new |
| | `taste` | nominal | plain, smoky, sour, herby, honey-sweet, sharp | new |
| Music | `lead` | nominal | [bowed] fiddle, keyed fiddle · [plucked] lyre, zither · [wind] willow pipe, bone flute, birch horn · [beat] frame drum, hammer and anvil, bells · [voice] herding call, chant | new |
| | `mode` | ordinal | major · mixolydian · dorian · minor · phrygian (bright to dark) | new |
| | `meter` | nominal | march (2) · polska (uneven 3) · lilt (6/8) · limp (7) · free | new |
| | `tempo` | ordinal | slow · walking · lively · quick | new |
| | `texture` | nominal | solo, unison, drone and tune, call and answer, harmony | new |
| | `singing` | ordinal | rarely · at gatherings · at work too · always | new |
| Speech | `greeting` | nominal | per culture (from its greeting custom), plus a shared pool | `cultures-lore.json` customs.greeting |
| | `directness` | ordinal | blunt · plain · guarded · oblique | `cultures-lore.json` candour |
| | `formality` | ordinal | familiar · plain · polite · ceremonious | AXES tight/loose as a hint |
| | `pace` | ordinal | quick · steady · slow · drawn out | voice line |
| | `sound` | nominal | plain, sibilant, clipped consonants, nasal, drawling vowels, sing-song | culture-drift `linguisticShift` when set |
| | `idiom` | nominal | hills and weather, stone and forge, timber and axe, water and nets, field and harvest, the book, the road, the hearth | sayings |
| | `oath` | nominal | by stone, by hearth and ash, by the book, by the road, by my hands, the cold take it | new; **never a god's name** (the gods are dead and their names aren't said, WORLD.md) |
| Interaction | `hospitality` | ordinal | fed before asked · fed when asked · bring something · the inn, not the house | customs |
| | `haggling` | ordinal | fixed price · a little · expected · a sport | customs.trade |
| | `space` | ordinal | close · arm's length · wide | new |
| | `gift` | nominal | returned in kind, refused twice then taken, a gift is a debt, shared with the household | customs.debt |

**Phrasing.** Each value has one phrase, written once and shared by every culture: `roof: reed` → "reed roofs", `meter: polska` → "polska tunes with a long middle beat". Each attribute has a sentence frame: "They roof with {roof}." So authoring a culture is picking about 30 ids, and only `signature` and `greeting` need words of their own.

**Where the data lives** (proposed): `macro-world/culture-styles.json`, beside `fashion.json` and `cultures.json`, as repo-JSON master (`docs/canon.md`). It holds the value sets and, per culture, only the picks no other file has (food, music, speech, interaction, finish, walls, signature). Fashion, roof, layout and heart are read from their own files, so nothing is copied twice; a test checks every pick has a `source`, like `cultures-lore.json`. First the Reach's five cultures and the seven other road cultures; the rest of the 22 later.

### The base for ridgefolk (used in the sample)

| Attribute | Pick | Source |
|---|---|---|
| fashion | heavy wool · charcoal (moss trim) · fitted · bordered · tall sheepskin cap | `fashion.json` › ridgefolk |
| crafts | wood · chevrons · carved | "stone and timber by the cartload", "make it sound the first time" (`cultures-lore.json`) |
| architecture | dry stone · slate · organic · hearth | `cultures.json` (roof, layout, fire-centred) |
| food | oat porridge · smoked · smoky | new |
| music | fiddle · dorian · polska · walking · drone and tune · at gatherings | new |
| speech | "Come to the hearth first" · blunt · familiar · slow · plain · hills and weather · by hearth and ash | `cultures-lore.json` › ridgefolk (greeting, candour, "impossible to rush", "these hills give stone and grudges") |
| interaction | fed before asked · a little · arm's length · shared with the household | customs: hearth first, handshake by the fire, debts shared like land |

## 3. Inheritance

```
culture base ─┬─ realm overlay (lords, officials and their halls only)
              └─ region twist ─ province twist ─ village twist ─ (person: People touch, role)
```

| Level | What it may change | Who it applies to |
|---|---|---|
| **Culture** | Its base. Also moves when the engine moves the culture: a quirk that spread (culture-drift's aesthetic layer) changes `sound`, `ornament`, `signature` or `formality` for the whole culture. | Everyone of that culture, everywhere. |
| **Realm** (a nation; in the Reach a duchy and its vassals) | `formality`, `signature`, `ornament`, `heart` (the hall). Only reason-driven: the ruling house's culture, a ruler's decree or quirk. | **Lords, officials and their halls only.** Common folk dress and talk as their region does. Realms and regions don't nest (in the sample, Ravenhurst is in the Lean Woods but owes its lord in Hollowford), so the realm is an overlay, not a step in the chain. |
| **Region** (a market town's country) | Any attribute: what spreads from the market. | Everyone in the region (see "several cultures" below). |
| **Province** | Any attribute. | Everyone in the province. |
| **Village** | Any attribute, small budget: what the settlement does (fishing, garrison, trading post) and its size. In the Reach a province has one settlement, at its seat. | Everyone in the village. |
| **Person** (not drift) | Their People's touch (WORLD.md: a Bergfolk's belt clasp is over-engineered metal, a Riksfolk free farmer wears a charter token) and their role's variant (`fashion.json` elder, warrior, ceremonial). | That person. |

**How a village's style is resolved**, for a person of culture C:

1. Start from C's base, as C stands at the end of the history (with any quirk that spread).
2. Apply the region's, the province's and the village's twists, in that order. A later twist on the same attribute wins.
3. If the person is a lord or an official, apply the realm overlay.
4. Apply crafted pins: a hand-written village (Hollowford, Saltmere, Kestrel Gate) can fix any attribute, and a pin always wins, like `CRAFTED_REGIONS` and `CRAFTED_LOCAL` do today.
5. Check the guarantees below.

**Several cultures in one place.** A twist is either a **step** (ordinal: "one step darker") or a **set** (nominal: "barley bread"). Steps apply to every culture in the place. Sets apply to the place's majority culture, and to minorities only in the **public** categories: food, crafts, architecture and haggling, the things you buy at the same market. **Private** attributes (greeting, sound, oath, gift, signature) stay each culture's own. So a mountainhold hall in a ridgefolk country eats the country's bread and haggles at its fair, but still names its craft before its family.

**Guarantees (testable).**
- **Baseline:** any place keeps at least 60% of its culture's base values (19 of 32). Only a change of People or culture goes further, and that's a different culture, not a twist.
- **Invariants no level can break:** no oath names a god; an inn is a sanctuary; nothing contradicts a crafted pin.
- **Archaisms:** when the culture itself changes (a quirk spreads), a place adopts the change after a lag of `60 × i` years, where `i` is its isolation (§4). So a cut-off valley can still keep the old way: "they still say it the old way up there."

## 4. Divergence

### Connectivity

How connected a place is to its parent (a province to its region's market town, a region to the nearest other market town), from 0 to 1:

```
c = 0.40·near + 0.20·trade + 0.15·rule + 0.15·water + 0.10·ties
```

| Term | What it is | Engine state |
|---|---|---|
| `near` | `exp(−hours / T)`: walking hours, seat to the parent's seat. T = 12 h for a province, 24 h for a region. Half a day away gives 0.6; a long day gives 0.37. | The Reach grid's walking cost (`reach.ts` `COST`). A world without a grid uses 8 h per border crossed. |
| `trade` | Market access. Province: 1 if it borders the market town or the caravan road reaches it, 0.5 if two borders away. Region: its best road to another region. | `Province.neighbors`, `Region.roads`, `TradeRoute.wealth`, the crafted road (`road.ts`). |
| `rule` | Same lord. 1 if under the same realm as the parent, 0.5 if allied or joined by a union, 0 if not. A region: the share of its provinces under the market town's realm. | Title liege chain, `hasAlliance`, `unions`. |
| `water` | 0.5 if both are on a river, plus 0.5 if both are on a lake. | `riverConnected`, `lake`. |
| `ties` | How many places it talks to at all: `min(1, neighbours / 5)`. A dead-end valley has one. | `Province.neighbors`. |

Isolation is `i = 1 − c`.

### Time and Peoples

- **Time apart:** `τ = 1 − exp(−Y / 100)`, where Y is the years since the place was settled apart from its parent. In the Reach every province starts in year 1, so Y = 150 and τ = 0.78. A colony founded late (`ISLAND_COLONY_FOUNDED`, `SETTLED_NEW_HOMELAND`) has a smaller τ.
- **Peoples present:** `p` is how far the place's Peoples are from the mix its culture expects (`racePreferences`), from 0 to 1 (total variation distance). The place's mix is the culture's own, shifted by the houses seated there over the history (`Dynasty.raceId`) and by arrivals (odd patches, strangers, migration). `p ≥ 0.15` gives one reason pick, `p ≥ 0.35` two.
- **Cut years** (later, optional): years the link was broken (a road failing until it thrives again, the two lords at war) add `0.3 × share of Y` to `i`. The sample leaves this out.

### How many twists, and how far

```
quiet twists  k = 1 + round(N · B · τ · i²)        N = 32 attributes
reason twists: one per reason over its threshold (two if it happened twice), at most 3 (2 for a region)
far chance:   i²  (otherwise near)
```

| Level | B (share a fully isolated place drifts over a long time) |
|---|---|
| Realm | 0 (reasons only) |
| Region | 0.25 |
| Province | 0.50 |
| Village | 0.15 |

- The **1** is the floor: even the best-connected place has one local touch (owner: "small differences").
- **i²** makes the curve steep: a place half as isolated drifts a quarter as much. Connected neighbours stay close; a valley cut off for generations moves a lot.
- The quiet twists are filled in this order: first the **land and livelihood** fixes (always true: there's no slate in a marsh), then **borrowings** (when a neighbour of another culture has `c ≥ 0.5` to this place, take one of its values), then **drift** (a random near or far step).
- The constants are first guesses, to tune in sub-issue 2 against the guarantees and a few seeds.

### Worked examples (seed `seedOf('w-test-0')`, the first seed of `history.test.ts`)

**A well-connected market town: Cranewood.** The market town of the Lean Woods and seat of the High Hold of Cranewood. It borders six provinces, the most in the Reach, and holds nine fairs between years 58 and 147. It *is* its region's parent, so `c = 1`, `i = 0`, and it gets the floor: 1 quiet twist (a borrowing from the mountainhold hall at Mossbrook), plus its reasons (the fairs, a sacred grove in year 22). Its people share **75%** of the ridgefolk base (24 of 32), and half of the rest is the Lean Woods' own twist, which every neighbour in the country shares.

**An isolated valley: Kettleridge.** Hill country with two neighbours, 11.3 hours over the hill from its market town Yewford, which it doesn't border. It owes its lord in Cranewood while Yewford keeps its own realm, it lives on a mine while its country lives on timber, and twice strangers from nowhere settled there (the engine's lost peoples: a legion in year 81, hoplites in year 101).

| Term | Value |
|---|---|
| near | exp(−11.3 / 12) = 0.39 |
| trade | 0.5 (two borders from Yewford, through Blackbrook) |
| rule | 0 (another realm) |
| water | 0.5 (both on rivers; no shared lake) |
| ties | 2 / 5 = 0.4 |
| **c** | 0.40·0.39 + 0.20·0.5 + 0 + 0.15·0.5 + 0.10·0.4 = **0.37**, so **i = 0.63** |
| quiet twists | 1 + round(32 · 0.5 · 0.78 · 0.40) = **6**, far chance 0.40 |
| reason twists | strangers settled twice: **2** |

So Kettleridge changes 8 attributes against its country, on top of the Yewford country's 4 (one of them, the idiom, it changes again). Its people share **63%** of the ridgefolk base (20 of 32), just above the 60% floor. Against Cranewood, the market town next door over the hill, it shares 13 values exactly and 19 counting near steps.

## 5. Reasons

Every changed attribute carries a reason: a kind, the engine state or events behind it (event ids, years, state keys) and a sentence. That's what lets lore say *why*.

| Reason | Engine state or events | Threshold | Typically touches | Says, for example |
|---|---|---|---|---|
| **Land** | `Province.terrain`, `lake`, `river`; the grid's biomes | always | walls, roof, staple, keeping | "There's no slate in a marsh: they roof with reed." |
| **Livelihood** | `Region.livelihoods`, `founding`, `venture`; settlement purpose | always | staple, material, idiom, texture | "They live on the mine, and talk like it." |
| **Isolation** (drift) | connectivity `c` and its terms | the quiet budget | any | "A long day over the hill from Yewford; its ways have wandered." |
| **Contact** (borrowing) | a neighbour of another culture with `c ≥ 0.5`; `Region.roads`; `TradeRoute`; a lingua franca | the quiet budget | public categories, signature | "They wear the Hollowford straw hat here." |
| **Trade boom** | `FAIR`, `BOOM`, `ROAD_THRIVES`, `VENTURE_THRIVES`, `TRADE_ROUTE_FLOURISHES`; `Province.wealth` | 3 in a generation | haggling, ornament, colour, taste | "Nine fairs taught them to haggle." |
| **Hardship** | `FAMINE`, `PLAGUE`, `HARD_WINTER`, `SLUMP`, `EARTHQUAKE_TREMORS`, `BLIGHT_*` | 3 in a generation | mode, keeping, hospitality, oath | "Hard winters put their songs in a minor key." |
| **A different People** | `Dynasty.raceId` against `racePreferences`; `ODD_PATCH`, `STRANGE_GROWTH`; `LOST_*`; `MIGRATION`, `SETTLED_NEW_HOMELAND`, migration waves | `p ≥ 0.15`, or any arrival | sound, greeting, signature, taste, motif | "Strangers came out of nowhere twice; they ask which road you came by before they ask your name." |
| **Foreign rulers** | the holder's `Dynasty.cultureId` differs from the place's for 25+ years; `USURP`, `SEAT_SEIZED`, conquest | 25 years | realm overlay: formality, signature, heart | "The lords are mountainhold now, and their hall names your craft first." |
| **War and feuds** | `WAR`, `FEUD`, `BORDER_WAR`, `LEVY_RAISED`, sieges | 5 feuds or 10 levies | meter, layout, heart, colour | "Fourteen feuds: they dance to marching tunes." |
| **Decree or quirk** | culture-drift's spread quirk (`CULTURAL_SHIFT` with trait `aesthetic`), `REFORM`, `TAXES_RAISED`, `CIVIC_CHARTER_GRANTED` | the event | ornament, formality, sound | "Holger's farmer's humility spread through a generation." |
| **The sacred** | `SACRED_GROVE_RECOGNIZED`, omens (`COMET_APPEARS`, `BLOOD_MOON`); churches where a world has faiths (`religion.ts`) | the event | heart, singing, gift, oath | "Since the grove was named, the village meets under it." |
| **Festivals** | `FESTIVAL`, `FESTIVAL_HELD` | 3 | singing, tempo | "Three festivals in a generation: they sing at work too." |
| **Climate** | `climate.ts` phase, hard winter counts | a phase | keeping, cloth | "Since the cold years they salt everything." |
| **Language split** | `Language.parentId`, `driftScore` | a split | sound, pace | "Their tongue split from the old one." |
| **Lowborn rulers, social change** | `LOWBORN_RISE`; culture traits (meritocracy, caste_rigid…) | the event | formality, directness | "A lowborn house rose; nobody bows much now." |
| **Crafted** | a hand-written village or person | always wins | any | whatever we wrote |

A reason that touches nothing new (the attribute is already where the reason would send it) is skipped, so it doesn't burn a twist.

## 6. Determinism

- **A pass after the history, not part of it.** `resolveStyles` runs after the last `tick`, like `nameRegions` does. It reads the world (provinces, regions, holders, events, culture state) and writes nothing back: no event, no province field, no draw from `World.rng`, `regionRng` or `oddPatchRng`.
- **Its own string-keyed stream.** Each draw has a key: `<seed>|style|<level>|<place>|<attribute>` for a value, `<seed>|style|<level>|<place>|rank|<attribute>` for which attributes change (each attribute's rank comes from its own key, and the lowest `k` change, so adding an attribute only inserts itself). This is the pattern of `local-history.ts` (a stream per slot) and `src/artificer/rng.ts` (`seedOf`, FNV-1a). The engine gets a small `stringSeed` beside its `RNG` class; adding a function doesn't change any stream. The Reach passes `seedOf("<seed>|world|style")`, beside its `|world|houses` and `|world|provinces` streams.
- **The golden hashes don't move.** Nothing the simulation reads changes, so `npm run unit:story` and the Reach's pinned event log (`history.test.ts`) stay as they are. A test proves it: resolve the styles, then check `World.rng` gives the same next number it would have.
- **`HISTORY_VERSION`.** If the styles join the told history (`history-format.ts`) the version goes up so cached histories are rebuilt. That's a format change, not a pin change.

**Fit with the story engine checklist (CLAUDE.md):**

| Layer | Touched? |
|---|---|
| Data model (`types.ts`) | No. The style types live in the new `storytelling/local-style.ts`. |
| Spec (`world-spec.ts`) | No. Bases are passed to `resolveStyles` as an argument, so the default and frontier worlds are untouched. |
| Seed (`seed.ts`) | No. |
| Simulation (`tick.ts`, `phenomena.ts`, `geography.ts`, `people.ts`) | No: read only, after the run. |
| Psyche (`perception.ts`) | No. |
| Culture (`culture-drift.ts`) | Read only: the aesthetic layer and traits. |
| Catastrophe (`catastrophe.ts`) | Read only: blight and its events are reasons. |
| Magic (`magic.ts`) | No (mana could become a reason later). |
| Sifter (`sifter.ts`) | No: styles are not events. |
| Renderer (`render.ts`) | No. Phrasing lives with the style data. |
| Tests (`testkit.ts`) | Hashes unchanged; add the "untouched stream" test. |

## 7. Consumers and their queries

One query, then small readers on top of it:

```ts
styleOf(styles, place, { culture?, role? }) → {
  values: Record<Attribute, Value>,
  diffs: { attribute, from, to, level, step: 'near' | 'far', reason: { kind, refs, text } }[],
}
phrase(style, attribute) → string     // "They roof with reed."
```

| Consumer | Query | Reads | What it does |
|---|---|---|---|
| **Artificer dialogue: speech** | `speechOf(place, culture)` | greeting, directness, formality, pace, sound, idiom, oath | The greeting line on first meeting; `directness` becomes the culture's candour before `effectiveCandour` nudges it (#1619); formality picks how you're addressed; idiom picks similes; oath picks the swear. Pace and sound are said in narration ("she says, clipping her consonants"), never spelled as dialect, so the text stays readable. |
| **Artificer: interaction** | `normsOf(place, culture)` | hospitality, haggling, space, gift | Whether you're fed before you ask; how far a price moves when you haggle (`trade.ts`); how a gift lands with rapport. Anything that changes play goes behind a switch in `features.ts`. |
| **Descriptions and art briefs** | `lookOf(place, culture, role)` | fashion, crafts, the person's People touch and role variant | A line in the art-brief shape (`art-briefs.json`: silhouette, material, colour, one detail): "A Kettleridge miner: layered-loose heavy wool, russet with a moss trim, a tall sheepskin cap." Item and artifact descriptions get motif and finish: "zigzag-carved". |
| **Settlements** | `buildOf(place, culture)` | walls, roof, layout, heart | Overrides for the `CultureDef` mapgen reads (`roofStyle`, `streetPattern`, traits), so Kettlehithe's houses really are reed-roofed on piles. Changes the drawn settlement, so behind a switch. |
| **Music and soundscape** | `audioOf(place, culture)` | music, plus crafts, livelihood, roof, heart, haggling | The parameter mapping below. |
| **Codex** | `codexOf(place)` | everything, with reasons | A culture's base on its page, and a sample Reach's places with what's different and why. |

**Audio parameter mapping** (for later music and ambience; no playback is designed here):

| Attribute | Parameter | Mapping |
|---|---|---|
| `lead` | instrument set | fiddle → bowed strings; keyed fiddle → bowed, bright; lyre or zither → plucked; willow pipe, bone flute → flute; birch horn → low horn, few notes; frame drum, hammer and anvil, bells → percussion lead; herding call, chant → voice lead |
| `mode` | scale | major, mixolydian, dorian, minor (aeolian), phrygian |
| `meter` | time signature and feel | march 2/4; polska 3/4 with a long second beat; lilt 6/8; limp 7/8 (3+2+2); free (no bar lines) |
| `tempo` | BPM | slow 60–72, walking 80–96, lively 104–120, quick 126–144 |
| `texture` | voices | solo: 1; unison: several on one line; drone and tune: a held note under a melody; call and answer: alternating phrases; harmony: parallel thirds |
| `singing` | vocal share | rarely 0.1, at gatherings 0.3, at work too 0.6, always 0.9 |
| soundscape | ambient layers | material (axe and adze for wood, chisel for stone, anvil for iron), livelihood (nets, saws, mine bells), roof (rain on slate or reed), heart (fire crackle, wind in the grove), haggling (market chatter density) |

Two places that share most of their style share most of their parameters, so neighbouring villages sound related, and an isolated valley's birch horn stands out.

## 8. A sample: seed `seedOf('w-test-0')` = 1624404132

Built from a scratch run of `simulateReach` on `origin/main` at `396b8dfd`: the provinces, hours, holders, realms, regions and events are the engine's. The connectivity, `i` and `k` numbers come from the formula in §4. **Which** attributes change, and to what, is hand-picked here by the §4 order (land, then borrowings, then drift) to illustrate; the generator will draw those from its stream.

The Reach in this seed: 11 provinces, three regions, three realms (the Lordship of Hollowford, the High Hold of Cranewood, the High Hold of Yewford). Ridgefolk everywhere except Hollowford (fieldborn), Saltmere (waterstead), Kestrel Gate (wallborn) and Mossbrook (mountainhold).

The ridgefolk base here is the culture as it stands in year 150, so it carries one change the engine made: in year 36 Holger's "farmer's humility" spread through the culture (culture-drift's aesthetic layer), read as `formality` familiar → plain for every ridgefolk place. Every comparison below is against that base.

### Region: the Lean Woods (market town Cranewood)

The region is 13.6 hours from the nearest other market town (Yewford), its best road carries trade 0.60, three of its four provinces are under Cranewood's realm, and it has two neighbouring regions: `c = 0.53`, `i = 0.47`, 2 quiet twists. Its reasons: hardship (11 hard winters and 3 famines; "the Lean" is the engine's famine name), and Cranewood held 9 fairs.

| Attribute | Base → twist | Kind | Reason |
|---|---|---|---|
| idiom | hills and weather → timber and axe | set (private) | livelihood: the country lives on lumber |
| staple | oat porridge → barley bread | set (public) | contact: borrowed from the fieldborn Hollowford country, whose road thrived in years 117 and 135 |
| mode | dorian → minor | step | hardship: 11 hard winters and 3 famines; the country is called the Lean Woods |
| haggling | a little → expected | step | trade boom: 9 fairs at Cranewood, years 58–147 |

### Its provinces and villages

| Place | Culture · land | Hours to Cranewood · c · i | Twists (quiet + reason) | What changes, and why | Village (the seat) |
|---|---|---|---|---|---|
| **Cranewood** (market town) | ridgefolk · forest | 0 · 1.00 · 0.00 | 1 + 2 | finish carved → inlaid (contact: the mountainhold hall at Mossbrook inlays its work, `c = 0.58` to it); ornament bordered → patterned (trade boom: fair-goers' finery, 9 fairs); heart hearth → grove (the sacred: a grove named in year 22) | village, farming: keeping smoked → root-cellared (what the village does) |
| **Ravenhurst** | ridgefolk · forest, river, lake | 5.1 · 0.56 · 0.44 | 3 + 1 | signature sheepskin cap → wide straw hat (contact: Hollowford, fieldborn, `c = 0.78` to it, same lord); pace slow → steady (drift); finish carved → oiled (drift); singing at gatherings → at work too (festivals in years 3, 22, 24). Owes its lord in Hollowford, not Cranewood, so `rule = 0`. | hamlet, logging: texture → call and answer (sawyers' calls) |
| **Kettlehithe** | ridgefolk · swamp, lake | 11.8 · 0.56 · 0.44 | 3 + 0 | staple barley bread → fish (livelihood: fishing); walls dry stone → timber on piles (land: swamp); roof slate → reed (land: no slate in a marsh). Next in line, had the budget allowed: borrowing the Saltmere watersteads' book at market (`c = 0.60`). | hamlet, fishing: singing → at work too (net songs) |
| **Mossbrook** | mountainhold · mountain, river | 13.8 · 0.54 · 0.46 | 4 + 1 | Inherits the country's barley bread (its own base already), mode one step darker (minor → phrygian) and haggling one step (fixed price → a little); not the idiom (private, and it mines). Own: greeting "name your craft" → "come to the hearth first" (contact: ridgefolk neighbours, `c = 0.50`); tempo slow → walking (drift); keeping root-cellared → dried (drift); taste plain → sharp (drift); formality polite → plain (lowborn rulers: house Brewer rose in 96 and 150). | outpost, trading post: haggling → expected (a trading post) |

**The isolated valley, for contrast: Kettleridge** (the Yewford country). The Yewford country itself: `c = 0.43`, `i = 0.57`, 3 quiet twists plus 14 feuds between its lords, the most in the Reach. Its twist: idiom → timber and axe (livelihood), colour charcoal → russet (drift, far), motif chevrons → zigzags (drift), meter polska → march (war and feuds).

| Place | Culture · land | Hours to Yewford · c · i | Twists | What changes, and why | Village |
|---|---|---|---|---|---|
| **Kettleridge** | ridgefolk · hills, river | 11.3 · 0.37 · 0.63 | 6 + 2 | material wood → stone and idiom → stone and forge (livelihood: it lives on a mine); lead fiddle → birch horn (drift, far); cut fitted → layered-loose (drift, far); space arm's length → wide (drift); taste smoky → sour (drift); sound plain → clipped consonants and greeting → "Which road did you come by?" (a different People: strangers settled in years 81 and 101) | outpost, logging: texture → solo (a few households) |

**Resolved, in a sentence each** (what `phrase` would give):

- **Cranewood:** heavy charcoal wool with patterned borders and the tall sheepskin cap; inlaid woodwork; barley bread and roots from the cellar; fiddles in a minor key to polska tunes; they meet at the grove; a blunt "come to the hearth first", talk of timber and axes, and haggling is expected at the fair.
- **Kettleridge:** loose layered russet wool and the sheepskin cap; stone carved with zigzags; sour, smoky food; a birch horn alone over a marching beat; clipped speech, "which road did you come by?", talk of stone and forge, and people keep their distance.

**How alike they are:**

| Pair | Hours apart | Same value | Same or a near step |
|---|---|---|---|
| Cranewood and the ridgefolk base | — | 24 of 32 (75%) | 28 of 32 (88%) |
| Ravenhurst and Cranewood (neighbours, one country) | 5.1 | 24 of 32 (75%) | 27 of 32 (84%) |
| Kettleridge and its country's style (the Yewford country) | 11.3 | 23 of 32 (72%) | 24 of 32 (75%) |
| Kettleridge and the ridgefolk base | — | 20 of 32 (63%) | 22 of 32 (69%) |
| Kettleridge and Cranewood (next door, over the hill, different country and lord) | 12.2 | 13 of 32 (41%) | 19 of 32 (59%) |

Neighbours in one country stay close; a valley across a country line, under another lord, with a mine and two waves of strangers, has drifted, and each difference says why.

## 9. Implementation plan: proposed follow-up issues

Proposed here; the owner agrees before they're filed (#1738). Systems issues follow the ATDD template: each scenario is a failing Vitest test first.

### Local culture 2: style data and generation in the story engine
*Labels: `systems`, `type:feature`. Risk: medium (sim code), no hash change.*

`macro-world/culture-styles.json` (value sets, phrases, the five Reach cultures and the seven other road cultures, every pick sourced), `storytelling/local-style.ts` (`resolveStyles`, `styleOf`, `phrase`), a `stringSeed` beside the engine's `RNG`, and the Reach wiring (`stylesOf(seed)` in `src/artificer/world/`). A row in `docs/canon.md`.

- **Given** a seed, **when** styles are resolved twice, **then** both results are identical.
- **Given** any golden-hash config, **when** styles are resolved after the run, **then** `npm run unit:story` hashes and the Reach's pinned event log are unchanged, and `World.rng`'s next number is what it was before.
- **Given** a place with `c = 1`, no reasons and the floor off, **when** it's resolved, **then** its style equals its culture's base.
- **Given** a region twist that sets an attribute, **when** its provinces are resolved, **then** each shows that value unless its own level changes it, and its diff names the region as the level.
- **Given** two provinces alike except their hours to the market town (5 and 20), **when** resolved, **then** the far one has at least as many quiet twists; **and** across 12 seeds the number of changes rises with isolation.
- **Given** any place in 12 seeds, **when** resolved, **then** at least 60% of its values equal its culture's base.
- **Given** any changed attribute, **then** it has a reason with a kind, at least one engine reference, and a kind allowed for its category.
- **Given** a new value added to one attribute's value set, **when** styles are resolved, **then** every other attribute's values are unchanged.
- **Given** any resolved oath, **then** it names no god.
- **Given** a crafted pin on Hollowford, **when** any seed is resolved, **then** Hollowford has the pinned value with reason `crafted`.

### Local culture 3: speech and interaction in the Artificer
*Labels: `systems`, `type:feature`. Behind a new switch, `local-speech`.*

Greetings, address, idioms and oaths from `speechOf`; the base candour from `directness`; haggling, hospitality and gifts from `normsOf`.

- **Given** the switch off, **when** any dialogue runs, **then** it's exactly as today.
- **Given** the switch on and a villager whose place greets with "Which road did you come by?", **when** the Warden first meets them, **then** the greeting line is that phrase.
- **Given** a culture whose `directness` is guarded but its place's twist made it plain, **when** `effectiveCandour` runs, **then** it starts from plain and the #1619 nudge still applies on top.
- **Given** haggling `fixed price`, **when** the Warden haggles, **then** the price doesn't move and the reply says so; **given** `a sport`, **then** the price can move further than today's default.
- **Given** the same run, **when** replayed, **then** the same lines are chosen (no new draws on any sim stream).

### Local culture 4: clothing, artifacts and buildings
*Labels: `art`, `systems`, `type:feature`. Exempt for the look (screenshots and a checklist); ATDD for the readers.*

`lookOf` lines for villagers and items, art briefs drawn from them, and `buildOf` overrides for the settlements (behind a switch, since it changes the drawn map).

- **Given** a place and a role, **when** `lookOf` runs, **then** it returns a brief in the `art-briefs.json` shape (silhouette, material, colour, one detail), built only from the resolved values and the person's People touch.
- **Given** Kettlehithe's style (reed roofs, timber on piles), **when** its settlement is generated with the switch on, **then** mapgen gets `roofStyle: reed`; with the switch off, the settlement is exactly as today.
- Checklist: three villagers and three buildings from two different places, side by side, read as related but distinct.

### Local culture 5: the audio parameter mapping
*Labels: `audio`, `systems`, `type:feature`.*

`audioOf(place)` and the mapping table as data. No playback.

- **Given** every value of every music attribute, **then** the mapping has an entry for it.
- **Given** two places that share all their music values, **then** `audioOf` returns identical parameters.
- **Given** a place's style, **when** `audioOf` runs, **then** tempo is inside its value's BPM range and the scale is the mode's.

### Local culture 6: a place's culture in the Codex
*Labels: `lore`, `ui-menus`, `type:feature`. Exempt (screenshot and checklist).*

Each culture's base on a Codex page; a pinned sample Reach (this seed) showing region, provinces and villages with their differences and reasons, from JSON exported by a script, like the chronicles (`wiki/src/lib/chronicles.ts`).

- Checklist: the export script is deterministic (run twice, same file); every difference shown has its reason; the page reads well on a phone.

## 10. Open questions for the owner

1. **Where the base lives:** `macro-world/culture-styles.json` beside `fashion.json` (proposed: shared by the Artificer, the Codex and the game), or `src/artificer/content/` beside `cultures-lore.json`? And should it sync to Supabase like the other macro-world files?
2. **The attribute set:** 32 attributes in 7 categories. Too many to author, or is something missing (mourning customs, hair, tattoos, dances)?
3. **The amount of difference:** in the sample, neighbours in one country share 75% exactly (84% counting near steps); an isolated valley keeps 63% of its culture; two neighbours across a country line share 41% exactly, 59% counting near steps. Does that feel right, or should even isolated places stay closer?
4. **Realms as an overlay for lords and officials only** (proposed), or should a nation change everyone's style?
5. **Speech sound in text:** said in narration ("clipping her consonants"), never spelled as dialect (proposed). Agreed?
6. **Lost peoples:** the engine's strangers from nowhere (`LOST_*`) bring their own sound and greeting in the sample. Should their traces show in a place's style, or stay as unexplained as the odd patches?
7. **Does style ever change play?** Haggling moving prices and hospitality giving shelter would, behind switches. And should the history engine ever read styles back (proposed: never, so the hashes stay put)?
8. **The sacred, with dead gods:** a named grove or an omen as the "religion" reason. Is that the right reading for Mistheim?
9. **Music:** is the audio mapping for the Artificer, the Phaser game, or both, and are we thinking procedural sound or recorded samples?
10. **Villages below the province:** the Reach has one settlement per province. Do we want more, smaller hamlets per province later, each with its own small twist?
