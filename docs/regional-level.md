# The regional level (#1598)

The story engine (`storytelling/`) used to work at two levels: the **province** (holders, wars,
famines, plague) and the **realm**. #1598 adds a **region** between them: a few neighbouring
provinces, a few days across, around a market town. A region's people share a harvest, a road, a
market, their lords' quarrels and the news. That's what the knowledge model's regional facts are
made of (owner's answer 3 in `docs/knowledge-model-design.md`: politics, economics and regional
events, not only who holds a province).

## Where it sits, and why there

- **Formed once, at seed time** (`seed.ts` calls `regions.ts` `formRegions`), from the neighbour
  graph and the provinces' populations. The most populous provinces become market towns, never two
  next door to each other, about one per four provinces (`PROVINCES_PER_REGION`). Then the smallest
  region claims a bordering province, again and again, until all are claimed. So every province is
  in exactly one region, every region is in one piece and about the same size. No randomness picks
  them.
- **3 to 6 provinces a region** (owner, 2026-10-11; `MIN_REGION`, `MAX_REGION`). The number of
  market towns is kept between N/6 and N/3 for N provinces, and a region left under 3 (hemmed in
  by its neighbours) takes a bordering province from a neighbour that can spare one (keeps 3 or
  more, stays in one piece, keeps its market town), or else joins a neighbouring region when the
  two together are 6 or fewer. A world too small or broken up for that (under 3 provinces, an
  island of 1–2) keeps smaller regions. The Reach always has 11 provinces, so 2 or 3 regions of
  3–6 (most often 4, 4, 3). No member is more than three borders from its market town (two, mostly).
  Only region membership changed, which nothing in the simulation reads: the golden hashes and the
  Reach's pinned log are the same.
- **Run every year, last in `tick()`** (`runRegions`). It reads the finished year: its events, each
  province's harvest roll and plague, who now holds which title. It keeps each region's running
  state and logs **regional events**.
- **A reading, not a second simulation.** Most regional events are engine events seen from the
  countryside ("a lord seated here died", "famine struck two of its lands", "bandits", "a
  festival"). A few belong to the region itself (a hard winter, banditry, a fair, the venture's
  luck, people arriving from a troubled neighbour). Those draw on the world's **separate regional
  random stream** (`World.regionRng`, seeded from the world seed through a mix).
- **It pushes back (#1608).** As #1598 shipped it, the level only read the engine, and no hash
  moved. Since #1608 it ends each year by writing a few consequences back into the engine's own
  state (below: **Pushing back**). It still never writes `World.events` and never draws from
  `World.rng`, but the provinces and people it changes are what the engine's next year reads, so
  the golden hashes and the Reach's pinned event log were rebaselined.

## Pushing back (#1608)

Owner, 2026-10-11: regions should affect the simulation. `regions.ts` `pushBack` runs for each
region at the end of `runRegions`, after the year is read and the roads updated, and changes the
engine's state. The engine's **next** year reads it: `World.power` (wars, marriages), scarcity
(hunger, expansion, famine), opinions and claims (goals, plots, wars). Running last means this
year's engine rolls are exactly as they were; only what follows feels the region. Every knob is in
`FEEDBACK` (`regions.ts`), in one place to tune.

| Feedback | What it changes | Constants |
|---|---|---|
| **Levy** | each province whose lord fought this year loses `levyToll × levy` of its people (3% at a full levy); every province's wealth target drops `levyWork × levy` (fields untended) | `levyToll` 0.03, `levyWork` 0.15 |
| **Hard winter** | every surface province loses `winterToll × hardship` of its people and `winterStores × hardship` of its wealth; the winter's event records the toll | `winterToll` 0.015, `winterStores` 0.08 |
| **Famine** | on top of the engine's own toll, each famine province loses `famineToll × hardship` of its people and `famineStores × hardship` of its wealth | `famineToll` 0.03, `famineStores` 0.15 |
| **Banditry** | the province bandits worked loses wealth; the engine's trade routes touching the region lose traffic (`TradeRoute.wealth`); the region's roads already lose trade (#1598), which feeds wealth | `banditWealth` 0.08, `banditRoute` 0.1 |
| **Trade and prosperity** | each province's **wealth** (`Province.wealth`, 0–1, 0.5 getting by) eases 12% of the way a year toward the region's prosperity, plus its roads' trade (doubled at the market town), the venture's health (its province), and the busiest engine trade route through it, and is drawn 2% of the way back toward 0.5 (getting by) a year. The slow pull lets a hard winter or bandits be felt for years; the drift keeps prosperous regions from sitting at 0.7–0.8 everywhere. Wealth reaches its holder: `World.power` counts a province's people ×(1 + 0.4 × (wealth − 0.5)), so ±20%; in magic worlds the house treasury's income from the province scales ×(0.5 + wealth) | `wealthPull` 0.12, `wealthDrift` 0.02, `roadWealth` 0.3, `ventureWealth` 0.2, `routeWealth` 0.15, `WEALTH_POWER` 0.4 (`world.ts`) |
| **Unsettled politics** | `Region.unsettled` (0–1) rises with a lord's death (0.1, a great lord 0.2), an empty seat (0.2), a seized seat (0.3) and keeps 60% a year. While it's up its lords of different houses lose `6 × unsettled` opinion of each other a year, bandits get easier (+0.1 × unsettled a year) and prosperity's target drops 0.1 × unsettled | `unsettle*`, `unsettleKeep` 0.6, `unsettledOpinion` 6, `unsettledBandits`, `unsettledProsperity` |
| **A feud grows into war** | a feud is live 25 years after its lords last fought. Each year, if both houses still have a lord seated in the region and they aren't under a truce (often the sons, not the men who fought), it flares with chance `0.6 × unsettled` (from `World.regionRng`): the more vengeful lord gets a weak claim on the other's seat (`FEUD_FLARES`, significance 4), and both lose 15 opinion. The engine's goals turn the claim into a `SEIZE_TITLE` goal, and a war if the lord dares | `feudFlare` 0.6, `feudMemory` 25, `feudFlareOpinion` 15 |

**Hardship** is `0.5 + (1 − prosperity)` with the region's prosperity going into the year: 1 in a
region getting by, 1.5 in a destitute one, 0.5 in a rich one. A poor region has nothing to fall
back on, so the same winter or famine kills more.

Over 16 Reach seeds it's proportionate: about 9% fewer people at the end of 150 years, 10% fewer
wars (poorer lords, thinner levies) and fewer famines (less crowded land) than with no feedback
(measured at #1608's first tuning). `regions-feedback.test.ts` shows each
effect against a control world built from the same seed.

**Tuning (owner, 2026-10-11).** Wealth sat high in prosperous histories, so the pull toward the
target was slowed (`wealthPull` 0.25 → 0.12) and a drift back toward 0.5 added (`wealthDrift`
0.02). Over Reach seeds 1–16, province wealth at the end of the history went from median 0.55
(10th–90th percentile 0.30–0.73, 95th 0.77) to median 0.51 (0.31–0.69, 5th–95th 0.24–0.71); over
48 seeds (1–16, 100–115, 200–215) sampled every 10 years from year 40, from median 0.52 (5th–95th
0.24–0.79) to median 0.49 (0.25–0.73). Feuds were not changed: counted in the regional log, a
history has about 1.4 flares (1.31 before the wealth change and 1.44 after on seeds 1–16; 1.60
and 1.54 over 48 seeds), already the owner's target of 1–1.5. Only about 0.4 of them fall within
living memory (40 years), where a region's lines tell them, which is likely why they looked rarer. About
3 in 4 flares see the claimant at war within ten years. Wars per history barely moved (45.3 →
43.4 on seeds 1–16, 46.8 → 47.0 over 48), and raising `feudFlare` to 0.8 (about 2 flares a
history) didn't change them either.

The new randomness is one roll per live feud per year in an unsettled region, from the regional
stream. Every other effect is arithmetic on values the year already produced.

## Region names

A region is called after what matters most in it, which its history decides (owner, 2026-10-11):
its market town ("the Hollowford country"), a trade it's known for ("the Ironvein", "the
Timberwold"), a hero ("Sigmund's Land"), a hardship ("the Lean Woods", "the Pale Fens") or a
quarrel ("the Marches of Old Feud"). `regions.ts` `nameRegions` names them **once, after the
history is lived** (`simulateReach` calls it after the last tick), not at formation: at seed time
only the land is known, with no heroes, famines or quarrels yet, and naming once keeps it simple
(no renaming mid-history). People call it by today's name, even in old stories.

- **Candidates and scores** (`regionNameCandidates`): the market town 5. A hero 7: someone born to
  no house who seized a seat here and whose house still holds land in the region (or an engine
  `HERO_RISEN` there, in worlds with magic). A quarrel or a hardship (famine counts double, plague
  once) only when it's at least 5 (4 for hardship) and half again the world's mean, scored
  4 + 2 × its share of the mean: over 150 years every region has feuds and lean years, so only the
  one that clearly had the most is known for it. A trade 5.5 when its venture is thriving now, a
  working mine 5.2.
- **Assignment**: strongest claim first; each kind but the market town once in the world; names
  unique; at least half the regions (rounded up) keep the market town's name, so travellers can
  find their way. Typically one region in three has a special name.
- **No randomness** (neither `World.rng` nor the regional stream) and **display only**: the
  region's `label`. Its id (`r_<centre>`, and `hollowford-country` in the told history and facts)
  stays the market town's, so facts and #1592 keep working.

## What a region keeps

| | State | Events |
|---|---|---|
| **Politics** | `houses` (seats each house holds), `leadingHouse`, `feuds`, `levy`, `tax` | lord died, seat vacant, seat seized, house rises / falls, feud (two of its lords at war), border war (an outsider fights for a seat), alliance or union, levy raised, taxes raised / eased |
| **Economy** | `livelihoods` per province, `primary`, `venture` (mine, lumber camp, fishery, mill…), `prosperity`, bread `price`, `harvest`, `roads` to neighbouring regions | bumper / failed harvest, shortage, boom, slump, venture opened / thriving / failing / closed, road thrives / fails |
| **Events** | | famine, plague, banditry, hard winter, fair, festival, migration, unrest |

**Trades.** Each province has a dominant trade (`livelihoods`, below), up to two **secondary**
trades its land also supports well (`secondary`: at least 0.4 and half its best), and a
**founding** one, what the settlement grew up around (`founding`): a market town on a river at its
ford (`crossing`), otherwise its land's best trade before the region's villages spread over
different trades. So the market town and a village that took up a second trade differ from what
they grew around. The told history carries all three per province and `regionalFacts` says it:
"Hollowford grew up around the ford; today it lives on its market, and on timber besides." (A seam
running out and a village changing trade over time is #1599's.)

**Livelihoods.** Each province lives on what its land suits best (farming, lumber, mining,
fishing, herding, peat). The market town lives on its market (`trading`). Where a province's
second-best trade is nearly as good and its best is already taken in the region, it takes the
second, so a region's villages differ where the land allows. This is the hook for #1599 (each
village its own economic engine). Variety comes from the land, not from culture (owner's answer
5: keep culture variety low near the start). The Reach tells the engine which provinces border a
lake and how much of each is bare rock (`reachSpec`: `lake`, `mineralWealth`), so fishing and
mining show up where they should.

Each regional event gets a significance from the sifter (`sifter.ts` `regionalSignificance`: a fair
is 2, a famine 6) and a sentence from the renderer (`render.ts` `renderRegionalEvent`).

## Big regional events in the chronicle

The owner's call (2026-10-11): famine, plague, a house falling belong in the history. So the told
chronicle (`ReachHistory.chronicle`, what the HISTORY tab shows) carries the big regional events
in year order among the province events, each naming its region ("Famine struck Ravenford, in the
Hollowford country.", `renderRegionalEventNamed`).

- **Which.** `history.ts` `regionalChronicleEvents`: significance 5 and up within living memory
  (famine and plague 6–7, a house losing its last seat in a region 5, a seat seized or left empty,
  a feud, a great lord's death 5); older than living memory 6 and up (famine, plague, seizures).
  Not a fair or festival (2), a hard winter, bandits or a poor harvest (3), a failing venture
  (3–4). 5 is the province chronicle's own cutoff (`TELL_THRESHOLD`), so the two agree on what's
  worth telling. An event that only retells a province event the chronicle already tells (a
  seizure, a lord's death) is left out, unless it's a famine or plague across more than one of
  the region's lands, which the province lines don't say. A seed tells about 15–20 of them.
- **Where.** At the telling layer: `runHistory` reads `World.regionalEvents` after the history is
  lived and hands the lines to `renderLayeredChronicle` as `extra` (rendering only). In living
  memory each goes under its year, after that year's province events; in the older chronicle
  among the threads by year, with the year in brackets. Each is marked `◇`, which the HISTORY tab
  shows as a small gold mark (and explains in one line at the top). Nothing goes into
  `World.events` and nothing draws from `World.rng`, so the hashes and the Reach's pinned log
  don't move.
- **`HISTORY_VERSION`** 6 since #1608 (5 was #1586): the regions push back, so the same seed lives a different
  history, and the told regions carry `unsettled` and each province's `wealth`.
- A **hard winter** now says when it cost lives ("…and the old and the weak died of the cold";
  "…and many died of the cold and hunger" when it took 1.8% or more, which is worth a point more,
  4). A **flared feud** is 4. Both stay under the chronicle's 5, so they're told in the region's
  own lines and facts; the war a flare leads to is told like any war.

## From the engine to facts

1. `src/artificer/world/history.ts` `runHistory` writes each region into the told history as
   plain data (`RegionHistory` in `history-format.ts`): its name, its provinces and their trades, venture,
   state, lords, live feuds and alliances, roads, and its told events (`lines`). Told events: the
   notable ones of living memory, with a share for each kind so lords' deaths don't crowd out the
   harvests, plus the few great ones from before. `HISTORY_VERSION` went to 4 so kept histories
   are told again.
2. `src/artificer/world/regional-facts.ts` `regionalFacts(history)` turns that into facts in the
   knowledge model's shape: how things stand now (what it lives on, the venture, the times, bread,
   who leads, dues, levies, feuds, alliances, roads, what each place grew up around and lives on,
   the best- and worst-off places when their wealth is 0.12 or more apart, and an uneasy country
   when it's unsettled 0.25 or more, which is `guarded`)
   and what happened there (each line dated).
   Scope `region:<id>` (`hollowford-country`). Truth and depth by age, as #1592 does for
   provinces: within a generation `true` and depth 1, within living memory (40 years) depth 2,
   older a `rumour` at depth 3. Small news (significance 2 or less) is depth 2 even when recent.
   Lords' quarrels and seized seats are `guarded`; the rest `public`.

Nothing in play reads these yet. Each road village's list joins them with its own remembered
facts (#1618, below); wiring that into play is slice F.

## Local history: there is always recent history (#1613)

Owner, 2026-10-11: "There is always recent history. We need to create some structure where
recent history is filled with local politics and events." The told history keeps a province's
few most significant events, which tend to be old and lordly, so `src/artificer/world/local-history.ts`
gives every road village its own last 20 years (`LOCAL_YEARS`, a generation), read off a told
history and attached as `VillageMemory.local` (`remembered.ts`).

- **Slots.** Politics: `leader` (who speaks for the village and how they came to), `dispute`
  (two families over land, water or a debt), `council` (a decision), `marriage`, `scandal`.
  Events: `trade` (a good or bad year for what it lives on), `mishap` (fire, flood, hard winter,
  sickness), `building`, `comings` (someone left or arrived), `death`. `leader`, `dispute`,
  `trade` and `mishap` are always told, so every village has politics and events in every seed;
  the others by chance.
- **Crafted plus generated.** `CRAFTED_LOCAL` holds hand-written entries per road village, dated
  in years before the present (Maren chosen after old Sune drowned, Bodil's three barrels, the ash
  off the pass, the drunk toll-keeper). A written slot is told as written; only empty slots are
  generated. Each slot draws from its own stream (`seed|local|<village>|<slot>`), so writing one
  never rerolls the others.
- **From the engine's state.** The village's country (its generated region) decides much of it:
  heavy dues send someone to the steward, a levy draws lots, a seized seat puts in the new lord's
  headman, the country's famine, plague or hard winter of the last 20 years is the village's
  hard year (dated the same), its venture or told harvest is its trade news, else its wealth.
  Names come from the village's culture, never a road person's name or a lords' house.
- **Off the engine.** It runs on the told history with its own seeded generator (`rng.ts`), not
  `World.rng` or `World.regionRng`: no engine change, no golden hash or pinned log moves, and
  `HISTORY_VERSION` stays 6 (a kept history tells the same villages).
- **As facts.** `local:<village>:<slot>`, scope the village, `true` (all within living memory).
  Sensitivity by how public it was and the teller's stake (`localSensitivity`): `public` (a fire)
  is public to all; `open` (a quarrel at the moot) public, guarded to those in it; `house` (a
  family's trouble) guarded, private with a stake; `family` (a scandal) private, secret with a
  stake. A road person who's a party gets their own more guarded person-scope telling
  (`local:<village>:<slot>:<person>`), which the knowledge model answers from first; something
  touching the ruling house (pleading with the steward) is one step more guarded for the whole
  village. Depth follows publicity: 1 for public and open, 2 a family's trouble, 3 a scandal.

Nothing in play reads these yet. When #1618's `VillageMemory.known` lands, the local facts
belong in it too.

## Merging with PR #1592

#1592 added `remembered()` and `RememberedFact`, and there's one `GENERATION` (regional-facts.ts).
Since #1618 `remembered()` also gives each road village **one list of what it knows**
(`VillageMemory.known`, built by `remembered.ts` `placeKnowledge`): its own facts (`facts`, as
before: who holds it, for the village and for the north road, and its told events), then its
country's regional facts (`factsOfRegion`). Over seeds 1, 3, 4, 8 and two play seeds that's 5 own
facts and 27–36 of its country's, 30–40 in one list.

- **Which region's facts: the country.** `VillageMemory.country` is the generated region its
  province lies in (`generated(province.id)`, by default the history's own), asked for directly.
  The crafted north road still wins `region` (regions.ts `regionFor`), which stays the road's
  scope, the caravan's; but a village's country is where its harvest, market, lords and news are,
  so its facts attach by the generated region even when the crafted one wins. Regional facts keep
  their scope (`region:<country id>`). Nothing places anyone in a country yet: slice F has to give
  a village's people their country as a region (today every `Knower.region` is `north-road`).
- **One fact for one happening.** Two facts telling the same thing become one, at the village
  fact's place in the list: the village's holder fact and its country's `lord:` fact for that seat;
  and a village event and its country's telling of it (`sameEvent`: the same year, the regional
  kind read from the event's kind by `SAME_EVENT_KINDS`, e.g. `SEAT_SEIZED` from `USURP` or
  `LOWBORN_RISE`, `LORD_DIED` from `SUCCESSION`, `MIGRATION` from the lost companies, and the same
  province, or a famine or plague told region-wide). Told lines carry no engine event id, so
  that's what's matched; adding one would mean telling every kept history again.
- **How they merge** (`mergeFacts`): the village fact's id and scope (the more specific scope,
  which the knowledge model answers from first, and everyone in a village lives in its country),
  the richer (longer) text, the stricter sensitivity, the shallower depth, both facts' topics, and
  `absorbs` naming the regional fact taken in. Truth agrees by construction (the same year against
  the same `LIVING_MEMORY`). The north-road holder fact stays: it's the caravan's, who live in no
  country.
- **Ids.** A regional fact left as itself is exactly `factsOfRegion`'s, so an id means the same
  fact in every village's list (two road villages often share a country). A merged fact has the
  village's id, which only that village's list has.

Not wired into play: that's slice F.

## Cost

The regional pass adds about 6.5% to `runHistory`: about 22 ms of about 345 ms a seed in Node
(`regions.timing.test.ts` prints it; pushing back added about 5 ms, from about 17). `regionalFacts`
takes under a millisecond for about 100 facts.

## Story-engine checklist (CLAUDE.md)

| Layer | Touched? |
|---|---|
| `types.ts` | `Region` (with `label`, `secondary`, `founding`, `unsettled`), `Founding`, `RegionalEvent` and its kinds (`FEUD_FLARES` since #1608); optional `Province.lake`, `lastHarvest`, `plaguedYear`, `wealth` |
| `world-spec.ts` | optional `ProvinceSpec.lake`; nothing for #1608 (wealth starts at 0.5 everywhere, and the knobs are `FEEDBACK`, not per world) |
| `seed.ts` | sets `lake` and `wealth` (0.5); `formRegions` |
| simulation | `tick.ts` runs `runRegions` last, which ends with `pushBack`; `phenomena.ts` records the harvest roll and plague's reach (writes, not draws); `world.ts` `power` reads `wealth`. `geography.ts` and `people.ts` unchanged: population and claims are changed directly, and regrowth reads the population as it finds it |
| `perception.ts` | yes (#1608): a landed lord in an unsettled region gets `unsettled × 0.006` more chance a year of a distortion (`UNSETTLED_ONSET`). Changes the odds of a roll the engine makes anyway, never the number of rolls |
| `culture-drift.ts` | no: it reads the year's engine events, and the regions' consequences reach it through them (fewer famines, different wars). A regional pressure would add culture variety the owner wants kept low near the start (answer 5) |
| `catastrophe.ts` | no: catastrophes are world-scale and already feed the regions (`GREAT_FROST` is a hard winter everywhere); deepening their tolls by region would count the same disaster twice |
| `magic.ts` | yes (#1608): a house's income from a province scales ×(0.5 + wealth) |
| `sifter.ts` | `regionalSignificance`; `FEUD_FLARES` 4, a killing winter +1 |
| `render.ts` | `renderRegionalEvent` (a winter's toll, a flared feud), `renderRegionalEventNamed`; `renderLayeredChronicle` `extra` lines (the big regional events) |
| `testkit.ts` | region invariants in `checkInvariants` (plus `unsettled`, `wealth` in bounds, the population floor, flared feuds name a title and two lords); golden hashes rebaselined for #1608 |
