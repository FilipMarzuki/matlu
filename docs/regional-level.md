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
  next door to each other, about one per three provinces. Then the smallest region claims a
  bordering province, again and again, until all are claimed. So every province is in exactly one
  region, every region is in one piece and about the same size, and no member is more than two
  borders from its market town. No randomness picks them.
- **Run every year, last in `tick()`** (`runRegions`). It reads the finished year: its events, each
  province's harvest roll and plague, who now holds which title. It keeps each region's running
  state and logs **regional events**.
- **A reading, not a second simulation.** Most regional events are engine events seen from the
  countryside ("a lord seated here died", "famine struck two of its lands", "bandits", "a
  festival"). A few belong to the region itself (a hard winter, banditry, a fair, the venture's
  luck, people arriving from a troubled neighbour). Those draw on the world's **separate regional
  random stream** (`World.regionRng`, seeded from the world seed through a mix).
- **No feedback, no hash moves.** The level writes only `World.regions`, `World.regionOf` and its
  own log, `World.regionalEvents`. It never writes `World.events` and never draws from `World.rng`.
  The two engine changes it needed are writes of values the engine already computed (each
  province's harvest roll, `lastHarvest`, and which provinces a plague reached, `plaguedYear`).
  So **every golden hash in `testkit.ts` and the Reach's pinned event log
  (`src/artificer/world/history.test.ts`) are unchanged**. Letting the region push back into the
  simulation (a levy thinning a province, a hard winter killing) would move them; that's a later
  choice.

## What a region keeps

| | State | Events |
|---|---|---|
| **Politics** | `houses` (seats each house holds), `leadingHouse`, `feuds`, `levy`, `tax` | lord died, seat vacant, seat seized, house rises / falls, feud (two of its lords at war), border war (an outsider fights for a seat), alliance or union, levy raised, taxes raised / eased |
| **Economy** | `livelihoods` per province, `primary`, `venture` (mine, lumber camp, fishery, mill…), `prosperity`, bread `price`, `harvest`, `roads` to neighbouring regions | bumper / failed harvest, shortage, boom, slump, venture opened / thriving / failing / closed, road thrives / fails |
| **Events** | | famine, plague, banditry, hard winter, fair, festival, migration, unrest |

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
- **`HISTORY_VERSION`** stays 4: the chronicle's shape (one text) didn't change, and version 4
  hasn't shipped (main is on 3), so no kept history of 4 lacks these lines.

## From the engine to facts

1. `src/artificer/world/history.ts` `runHistory` writes each region into the told history as
   plain data (`RegionHistory` in `history-format.ts`): its provinces and livelihoods, venture,
   state, lords, live feuds and alliances, roads, and its told events (`lines`). Told events: the
   notable ones of living memory, with a share for each kind so lords' deaths don't crowd out the
   harvests, plus the few great ones from before. `HISTORY_VERSION` went to 4 so kept histories
   are told again.
2. `src/artificer/world/regional-facts.ts` `regionalFacts(history)` turns that into facts in the
   knowledge model's shape: how things stand now (what it lives on, the venture, the times, bread,
   who leads, dues, levies, feuds, alliances, roads) and what happened there (each line dated).
   Scope `region:<id>` (`hollowford-country`). Truth and depth by age, as #1592 does for
   provinces: within a generation `true` and depth 1, within living memory (40 years) depth 2,
   older a `rumour` at depth 3. Small news (significance 2 or less) is depth 2 even when recent.
   Lords' quarrels and seized seats are `guarded`; the rest `public`.

Nothing in play reads these yet, and the road's villages aren't given their region yet. Wiring
them in place of #1592's hand-made "north road" is later work.

## Merging with PR #1592

#1592 (not merged when this was written) adds `remembered()` and `RememberedFact`. `RegionalFact`
has the same fields, with `guarded` sensitivity added and `year` and `kind` extra, so #1592's facts
are assignable to it. Both branches move `LIVING_MEMORY` into `history-format.ts` the same way.
When both land, keep one `GENERATION` and have `remembered()` include the regional facts.

## Cost

The regional pass adds about 5% to `runHistory`: about 20 ms of about 380 ms a seed in Node
(`regions.timing.test.ts` prints it). `regionalFacts` takes under a millisecond for about 110
facts.

## Story-engine checklist (CLAUDE.md)

| Layer | Touched? |
|---|---|
| `types.ts` | `Region`, `RegionalEvent` and its kinds; optional `Province.lake`, `lastHarvest`, `plaguedYear` |
| `world-spec.ts` | optional `ProvinceSpec.lake` |
| `seed.ts` | sets `lake`; `formRegions` |
| simulation | `tick.ts` runs `runRegions` last; `phenomena.ts` records the harvest roll and plague's reach (writes, not draws) |
| `perception.ts`, `culture-drift.ts`, `catastrophe.ts`, `magic.ts` | no: the level doesn't feed back into the simulation yet |
| `sifter.ts` | `regionalSignificance` |
| `render.ts` | `renderRegionalEvent` |
| `testkit.ts` | region invariants in `checkInvariants`; golden hashes unchanged, no rebaseline |
