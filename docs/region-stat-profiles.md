# Region stat profiles — design

Status: draft for #1441 (spike). Part of the stats epic (#1255). Builds on the
point-buy (#1256), growth by use and wear (#1257), the recovery cap (#1414),
the AI harness's stats (#1259) and the physical taper (#1440).

**The question.** Later regions will be harder, and different. Right now stats
are balanced only against Region 1 (the Reach). If each region only checks the
stats it trains, a creation spread is either an obvious choice or a trap. This
doc maps what each region **trains** and **tests**, proposes profiles for the
regions to come, and sets out what the AI bench must measure before we tune
further.

## 1. Where we are

From the code (`statEffects`, `encounters.ts`, `panic.ts`, `pins.ts`,
`road.ts`, and the `exerciseStats` call sites):

| Stat | The Reach trains it by… | The Reach tests it in… | The road trains it by… | The road tests it in… |
|---|---|---|---|---|
| **STR** | woodcraft and stonework; heavy work (Vigor −4/h or more) | Vigor on heavy work (−3%/pt); carry load; animal and brigand fights | — | brigand fights (encounters) |
| **CON** | fieldcraft and foraging; heavy work; long days; hungry and thirsty nights | Condition lost to hunger, thirst and cold (−3%/pt); healing (+3%/pt); crossing ice | — | brigand fights |
| **AGI** | hunting, scouting, handcraft | drain on agile work (−3%/pt); travel; climbing, chasing, dodging in encounters | — | travel drain (−3%/pt); chasing a thief |
| **INT** | memory and first aid; study; demanding mind work | insight (+5%/pt); craft grade (±1 per 3 pts); pins (+1 per 2 pts); searching and studying finds; learning from a stranger | — | craft grade and study insight (road crafts and study run through the Reach's rules with the Warden's own stats) |
| **WIL** | demanding mind work; working with a tired mind | Clarity drain (−2%/pt); deprivation; reliability threshold; panic nerve (+1 per 4 pts); touching the stone; remembering a place | — | — |
| **CHA** | — | persuading strangers (several person encounters); haggling needs CHA 13 | talking (2 h) and trading (1 h) | starting trust (±1/pt); prices (−2%/pt); talking down trouble, asking favours |

**What a year actually does** (scripted player, full Reach year plus the road,
the three presets, measured with #1259):

| | STR | CON | AGI | INT | WIL | CHA |
|---|---|---|---|---|---|---|
| Exercise banked in the Reach (h/year) | ~210 | ~230 | ~140 | ~45 | ~45 | 0 |
| Points gained in a year | +1 | +1–2 before the taper (#1440); +1 with it | +1 | 0 | 0 | 0 |
| CHA on the road | | | | | | 110 h talked, ≤ 72 h banked |

The road can't raise CHA on its own. A road trip is about 18 nights, and the
recovery cap banks at most 4 h a night, so 72 h at most. CHA's first point
needs 120 h.

**The spread barely matters to a scripted player.**
- In the Reach: balanced, strong and clever all survived and were winter-ready
  on day 16.
- On the road: all three arrived with 37 marks and 6 quests. One CHA point
  changed starting trust by about 2%.

The scripted plan is stat-blind and comfortably strong, so it can't show
whether stats matter. Only players who choose (models, people) can.

## 2. Findings

1. **The Reach is a body region.** It trains STR, CON and AGI, and tests them
   most. INT and WIL grow about +1 every three years. CHA is untrained, and
   tested only by a few encounters. That's the intended design ("CHA in Region
   1 is a dump stat"), but it means a spread is only a real choice if later
   regions pay the mind and CHA back.
2. **Effects are small per point.** Most effects are 2–5% per point, and
   encounter modifiers are +0.02–0.05 per point. One point is invisible; a
   lean of 3 or more (13+ against 10) is felt. That's fine for realism, but
   regions have to put the stats into situations where they matter, not just
   into percentages.
3. **The body is bounded by recovery; the mind and CHA by opportunity.** With
   the 4 h/night cap, a stat can bank at most about 240 h a Reach year (60
   nights) and ~72 h on an 18-night road. STR and CON come close to that; INT
   and WIL get about 45 h and CHA none, because the Reach offers little mind or
   social work. So the fix for slow mind growth is regions with more mind work,
   not a looser cap. With the taper (#1440), physical stats go +1, +1, then
   plateau. **A Warden enters each new region about one point
   stronger in what the last region trained.** Checks should assume that, and
   no more.
4. **CHA has no way to grow anywhere yet.** The road exercises it but is too
   short to bank a point. Mistheim (a settled stay, many nights) is where it
   should. Until Mistheim exists, CHA is trained in practice nowhere.

## 3. Proposal: a profile for each region

Each region **trains** two or three stats (its everyday work). It **tests**
the trained ones plus at least one it doesn't train, so a spread pays off in
more than one place. Every stat should be tested by at least two regions, and
trained by at least one. "Tests" below means a stat that matters there, today
or as proposed; most regions also touch other stats lightly.

| Region | Trains | Tests | Notes |
|---|---|---|---|
| **The Reach** (Region 1) | STR, CON, AGI | STR, CON, AGI, **INT** (crafts, insight, pins), **WIL** (dark nights, the stone, panic), CHA (a few strangers) | as built; INT and WIL are the off-stat tests |
| **The caravan road** (1.5) | CHA (exercised, but no point banks) | CHA, AGI, STR and CON (brigands), **INT** (crafts and study; lessons and appraising to add) | short: it introduces CHA, it doesn't build it |
| **Mistheim** (the city) | CHA, INT | CHA, INT, **WIL** (pressure, bargaining under stress) | many nights in one place: CHA and INT finally bank points |
| **A cold or high region** (later) | CON, WIL | CON, WIL, **STR** (climbing, hauling) | the hardship region: nights cost more, recovery is scarcer |
| **A corrupted region** (later) | WIL, INT | WIL, INT, **AGI** (avoiding, fleeing) | the mind region: Clarity is the resource |

So, across the game (counting the road as training CHA only in name):

| Stat | Trained in | Tested in |
|---|---|---|
| **STR** | 1 (Reach) | 3 (Reach, road, cold) |
| **CON** | 2 (Reach, cold) | 3 (Reach, road, cold) |
| **AGI** | 1 (Reach) | 3 (Reach, road, corrupted) |
| **INT** | 2 (Mistheim, corrupted) | 4 (Reach, road, Mistheim, corrupted) |
| **WIL** | 2 (cold, corrupted) | 4 (Reach, Mistheim, cold, corrupted) |
| **CHA** | **1** (Mistheim) | 3 (Reach, road, Mistheim) |

No stat is a dump stat across the whole game, though every region has one.
**CHA is the thinnest:** it's trained only in Mistheim, which isn't built yet.
Until it is, a CHA lean pays off only through trust and prices on the road.

## 4. Difficulty curve

- **Expected Warden entering region N:** the creation spread, plus age growth,
  plus about +1 in each stat region N−1 trained. Region checks (encounter base
  odds, drains, gates like CHA 13) are set against that, not against a
  max-grind Warden.
- **No reward for grinding:** the recovery cap and the taper already make
  extra days in a region worth less and less. A region shouldn't be passable
  only by staying longer.
- **Gates** (a minimum stat needed for an option) are rare, always have
  another way through, and sit about 2–3 above 10, reachable by a lean at
  creation or by training in the region before.

## 5. What the bench must measure

The scripted baseline is stat-blind, so the dump-stat question needs players
who choose:

- **Runs:** cheap OpenRouter models × the three presets × Reach + road
  (`ai:play --player openrouter --stats <preset> --road --budget <per preset>`).
  The first run below was 2 models × 3 presets × 1–2 runs (planned 9 games;
  5 finished). The rerun is 5 Llama and 2 Haiku games per preset (21 games),
  capped at $0.80 and $0.50 per preset batch, about $3.90 at most.
- **Cost:** before #1448 bounded the history, one surviving game cost $2.52.
  With it, $0.29. Since #1449 the budget is checked after every model call,
  so a batch stops within one call of its cap.
- **Compare by preset:**
  - survival and winter-ready day;
  - encounter outcomes where the preset's stats apply;
  - road trust, marks and prices.
- **Pass:** each preset wins on some measure. A preset that loses on every
  measure means its stats aren't being tested anywhere it plays.

Later, when Mistheim and further regions exist, the same table grows a column
per region.

### Results (first run, 8 October)

Llama 4 Maverick, three presets, the Reach plus the road, `--budget 0.5` per preset batch. 5 games, about $2.84. The budget was then checked only between runs (#1449), so one surviving game ran to $2.52 on its own.
The Haiku 4.5 runs all crashed before finishing (see the harness bugs below).

| Preset (adult spread) | Runs | Outcome | Cause of death | Stats at the end (age 12; the same in each run of a preset) |
|---|---|---|---|---|
| **strong** (STR 13, CON 13) | 1 | **survived**, winter-ready day 32; the road: arrived, 52 marks | — | STR 10 · CON 11 · AGI 10 · INT 8 · WIL 8 · CHA 9 |
| **balanced** (all 11) | 2 | died day 26, day 26 | an encounter (a bear); collapse in the cold | STR 7 · CON 8 · AGI 10 · INT 9 · WIL 9 · CHA 10 |
| **clever** (INT 13, WIL 13) | 2 | died day 15, day 26 | collapse: hunger and cold, twice | STR 6 · CON 7 · AGI 9 · INT 11 · WIL 11 · CHA 9 |

**What it suggests.** This is a tiny sample (5 games, one model), so read it as a direction, not a verdict.

- **For a player who chooses, the Reach rewards the body heavily.** The only survivor leaned STR and CON. Both mind-leaning runs collapsed from deprivation, which costs Condition at −3% per point of CON.
- **The young-Warden gap makes it sharper.** At 12, CON lags the adult value by about 3, so a clever Warden starts at CON 7.
- **The clever build is a trap in Region 1, not just a dump-stat question.** It doesn't merely do worse; it dies. That backs the proposal in §3 (later regions must pay INT and WIL back). It also raises a Region 1 question: should INT give a mind-leaning Warden a way through? For example, better planning, preserving or shelter craft that makes up for a frail body.

**Harness bugs this run exposed** (#1448, #1449):
1. **Context overflow.** A whole-year game plus the road overflows a 200k-token context: Haiku crashed at about 203k on every run. The runner sends the whole conversation each turn, so long games need history trimming or summarising.
2. **The budget is checked between runs, not during them.** One surviving Llama game cost $2.52 against a $0.50 cap. The context grows each turn, and a game that lives to the end is roughly 25× the cost of one that dies early.

**Next:** fix the two harness bugs, then rerun with more games (5 per preset, two models), so each preset has enough runs to compare.

## 6. Follow-ups (to file once this is agreed)

1. Fix the two harness bugs above, then rerun the bench in §5 with 5 games per preset.
2. Mistheim's stat hooks: CHA and INT exercise for a settled stay, and CHA, INT
   and WIL checks.
3. A WIL off-stat test in the Reach that's visible in play: the stone and panic
   exist, but they're rare.
4. Encounter gates on the road at CHA 12–13 and INT 12–13, each with another
   way through.
5. Each region's profile as data, so the AI rules text and the bench report can
   show it.
6. Region 1: decide whether INT should give a mind-leaning Warden a way through the Reach, or whether body-first is the intended lesson.
