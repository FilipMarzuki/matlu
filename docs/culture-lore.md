# What Peoples and cultures value, believe and keep

**Issue:** #1590 (the Wildkin: #1606) · **Status:** content and reader written, not yet read by the game
**Files:** `src/artificer/content/peoples-lore.json`, `src/artificer/content/cultures-lore.json`, read through `src/artificer/culture-lore.ts` (tests: `culture-lore.test.ts`)
**Feeds:** the knowledge model's scope content (#1577 slice C, `docs/knowledge-model-design.md`) and rumours, confidence and lies (#1580)

## What's there

For each of the **16 Mistheim Peoples** (the 15 of `WORLD.md` and the **Wildkin**, made the 16th by
the owner on 2026-10-11, #1606) and each of the **12 cultures the caravan road uses** (every
villager's and traveller's `culture` in `villages.ts`, and every village's `cultures`):

| Part | What it is |
|---|---|
| `values` | what they honour (2–3) |
| `taboos` | what shames them (2–3) |
| `customs` | how they greet, trade, mourn and settle a debt (one each) |
| `views` | what they believe about the others, as claims |
| `peopleViews` | cultures only: what they believe about each of the 16 Peoples |
| `candour` | cultures only: how openly they voice an opinion to an outsider (`blunt`, `plain`, `guarded`) |
| `voice`, `sayings` | how they sound: a line on their manner of speech, and three or four sayings |

**Views cover:** every People holds a view of **every other People** (16 × 15). Every road culture
holds a view of **every other road culture** (12 × 11) and of **every People** (12 × 16).

Every claim has a `truth` (`true`, `rumour` or `false`, as in the knowledge model). A rumour or a
false belief says what is `actually` so, with its own source, so #1580 can correct it, and how
firmly it's held (`strength`: `firm`, `held` or `loose`). A few claims carry a `sensitivity`
(`guarded`, `secret`) where canon says it's kept quiet; the rest are `public`.

**Counts:** 828 claims (396 for the Peoples, 432 for the cultures): 769 true, 31 rumours, 28
false. Views: 250 People-to-People, 132 culture-to-culture, 192 culture-to-People. 113 sayings and
voice lines. Every People met on the road holds at least one wrong or half-true belief; the 59
wrong views are 13 firm, 23 held and 23 loose.

## How openly a view is said

Whether someone says a prejudice or a wrong belief out loud isn't fixed (owner, 2026-10-11). It
depends on how openly their **culture** talks to outsiders, how **strongly** they hold the belief,
and the **trust** between you. The rule, on the knowledge model's trust levels (0 / 25 / 50 / 75,
`SENSITIVITY_TRUST` in `knowledge.ts`):

```
openness = candour (blunt 2, plain 1, guarded 0) + strength (firm 2, held 1, loose 0)    0 to 4
said, hedged, from trust 75 − 25 × openness; said plainly from 25 more (both kept to 0–75)
```

| Openness | Example | Trust 0 | 25 | 50 | 75 |
|---|---|---|---|---|---|
| 4 | blunt, firm | plain | plain | plain | plain |
| 3 | blunt, held · plain, firm | hedged | plain | plain | plain |
| 2 | plain, held · guarded, firm · blunt, loose | — | hedged | plain | plain |
| 1 | guarded, held · plain, loose | — | — | hedged | plain |
| 0 | guarded, loose | — | — | — | close friends only |

A claim's own `sensitivity` is a floor on both levels. The rule covers views that are wrong or half
true; everything else (customs, values, true views) is said plainly once trust reaches its
sensitivity, and a `secret` only to close friends. `voicingGates(claim, candour)` gives the two
levels, `voicedAt(claim, candour, trust)` the outcome: `plain`, `hedged`, `close` or `held-back`.

**Candour**, from each culture's temperament (its `voice` line and the road's people):

| Candour | Cultures | Why |
|---|---|---|
| blunt | ridgefolk, mountainhold, harborfolk, ironborne-encampment | gruff advice for anyone; plain and short; loud; blunt and funny |
| plain | waterstead, caravan-folk, refuge-keepers | tell anyone who asks; practical; brisk |
| guarded | fieldborn, wallborn, grovekin, steppe-camp, bazaar-folk | "count twice, say half"; every word weighed; soft-spoken; take no sides; never name a price first |

So Runa (mountainhold) says goblins steal to a stranger; Veit (wallborn) keeps his wrong view of
goblins back until trust 50, hedges it, and says it plainly at 75; Isa (grovekin) half believes
beastkin change shape, and only a close friend hears it.

### Where they are (#1619)

A culture's candour is how its people speak in ordinary times. Where they are now nudges it, one
step at most either way, so a culture still sounds like itself (`effectiveCandour(candour, place)`):

| Shift | When |
|---|---|
| +1, blunter | a **hard place** (times hard, bread dear, a poor or failed harvest, the place on hard times) or **harsh weather** (winter, a storm, snow) |
| −1, more guarded | a **feared or strict lord** (or whoever holds the place) |
| +1, more open | a **lax or well-liked lord** |
| −1, more guarded | an **uneasy region**: lords dead, seats changed hands lately (#1608 `unsettled`) |

The shifts add up and are kept to one step, then to the scale: a hard place under a feared lord
cancels out, and a blunt people can't get blunter. A region of a told history reads as a place with
`placeOfRegion` (place-candour.ts), turning where its facts do ("Times are hard", "tax heavily", "the
lords are uneasy"); heavy dues read as a strict lord, light ones as a lax one. The road villages
have places written by hand (`VILLAGE_PLACES`, invented to fit villages.ts): **Hollowford** is hard
(its high fields dead to the corruption), **Saltmere** ordinary, **Kestrel Gate** held strictly (nothing
passes uncounted). So at Hollowford Maren (fieldborn, guarded) speaks plainly and tells you at
trust 25 what her people think of the Fae; at Kestrel Gate Runa hedges her view of goblins to a
stranger. Free questions use it behind the `candour-by-place` rule switch (road.ts `questionPlace`).

## Where it came from

Every claim, saying and correction names its **source** as `file § heading › label`, and the tests
check that the file, the heading and the label are really there. Most of it rests on:

- **`WORLD.md` § Nations, peoples, and the world between them**: each People's *What shapes them*,
  *What they make* and *Relations*; the visual identity sections (*Objects* hold most of the canon
  customs: Bergfolk tools buried with their master, Deepwalker seal rings buried with their
  [Keeper], Steinfolk adding a stone to what the dead built); *Who uses Rasa*; *Alliances*; *Safe to
  use freely* (the canon prejudices about goblins, dragons, elves and minotaurs).
- **`AXES.md`**: each People's context score and mode, for their voice.
- **`src/artificer/villages.ts`, `answers.ts` and `asks.ts`**: the road's own people. Culture lore leans on what
  they already say (Maren for fieldborn, Orrin for ridgefolk, Anselm and Gunnar for waterstead,
  Runa for mountainhold, Veit for wallborn, Bodil and cv-runa for caravan-folk, Isa and Ottilia for
  grovekin, Hedda for harborfolk, Yrsa for steppe-camp, Liv for refuge-keepers, Sabine for
  ironborne-encampment, Arvid and Pim for bazaar-folk), so the voice fits them.
- **`src/artificer/world/peoples.ts`**: the Reach cultures' temperament and succession law
  (ridgefolk land is split among all the children; fieldborn goes to the eldest).
- **`macro-world/cultures.json`**: culture names, and traits that suggest customs (ridgefolk are
  fire-centred, so their customs gather at the hearth; refuges are light-sensitive, so their lamps
  are low). The file isn't edited: it stays layout only.
- **`macro-world/setting-corewarden.md`** for the **Wildkin**: the beastkin kingdom between the
  mountains and the sea, the Highfang and the Great Clans, the old roaming packs and the new iron
  hinges, the dwarves walking out of the mountains, the dead that stay dead, and no boats. Where it
  says "see Wildkin race lore", the lines rest on **`macro-world/race-affinities.json`** (the clan
  lines, Greymane, Ironhide, Redtail, Stoneback, the Clan Question, not shapeshifters). Neither
  file is edited.

**No faiths.** Canon says the gods are dead and their names aren't said aloud (`WORLD.md` § The
weight of the past). No custom prays or worships; mourning is about naming the dead and what they
made. A test keeps it so.

## What's invented

`invented: true` marks a line canon doesn't state outright. It still names the source it was built
on, and nothing invented contradicts a canon statement. 563 of the 828 claims are invented:

- **Most customs** (78 of 112): canon gives a few (above); greetings, debts and most mourning
  customs are new.
- **Most People-to-People views** (179 of 250): canon gives the *Relations* pairs (Bergfolk with Markfolk, Lövfolk,
  Steinfolk and Goblins; Lövfolk with Pandor, Bergfolk and Fae; Markfolk with Bergfolk, Steinfolk
  and Viddfolk; Viddfolk with all nations and the Goblins; Steinfolk with Markfolk and Bergfolk;
  Deepwalkers with Merfolk and Pandor; the Pandor's dealings with the Merfolk, Giants, Dragons,
  Everstill, Constructs and Remnants). The rest are new, written to fit each pair's canon.
  Everyone's view of the Wildkin, and theirs of everyone, is new apart from what the setting bible
  says outright (the dwarves walking out, the dead that stay dead).
- **Culture lore** is mostly new (325 of 432), since canon gives cultures only layout. It follows
  the road's people closely. Of the 192 culture-to-People views, 166 are invented: most restate a
  People's canon in the culture's voice, and say so in their source.

### The wrong beliefs

| Who | About | Belief | Truth | Strength | |
|---|---|---|---|---|---|
| Bergfolk | Lövfolk | Our mana-granite does the forest no harm. | false | firm | invented |
| Bergfolk | Lövfolk | Elf healing is feeling, not real magic. | false | held | canon |
| Bergfolk | Viddfolk | A Viddfolk herald still runs a main route in three days. | false | loose | invented |
| Bergfolk | Pandor | Pandor scholars make nothing you can hold in your hands. | false | firm | canon |
| Bergfolk | Goblins | There are no goblins in our holds. | false | firm | canon |
| Bergfolk | Dragons | Iskuldr keeps our tribute tools and never uses them. That means he approves. | rumour | held | canon |
| Bergfolk | Constructs | A construct is a made thing, not a person. | rumour | firm | canon |
| Lövfolk | Markfolk | Farming is humble work. It takes no great skill. | false | firm | canon |
| Lövfolk | Goblins | Goblins are pests, not people. | false | held | invented |
| Lövfolk | Dragons | Grimmvald's patronage takes our young ones and gives back strangers. | rumour | loose | canon |
| Lövfolk | Constructs | A construct cannot change. It stays as it was made. | false | held | invented |
| Markfolk | Lövfolk | The elves think they're better than everyone. | rumour | held | invented |
| Markfolk | Viddfolk | The eastern steppe is empty land going to waste. | false | firm | invented |
| Markfolk | Merfolk | The Merfolk never answer because they look down on us. | false | loose | invented |
| Markfolk | Goblins | No goblins live in the Merkförbund. It's against the law. | false | firm | canon |
| Markfolk | Fae | A fae deal is a trick. Never make one at the field's edge. | rumour | held | invented |
| Markfolk | Dragons | Dragons are wicked, and hoard gold to spite us. | false | held | invented |
| Markfolk | Everstill | The Pale City's dead are the corruption's work. | false | loose | invented |
| Markfolk | Wildkin | Beastkin are wild things. They couldn't keep a field. | false | held | invented |
| Viddfolk | Everstill | Nothing can touch the Everstill. They'll be here forever. | false | loose | invented |
| Steinfolk | Giants | Bergamora's eastern face was built, not grown. | rumour | loose | invented |
| Pandor | Steinfolk | The stronghold at the centre of the continent must guard an old ruin. | rumour | loose | invented |
| Deepwalkers | Bergfolk | The Bergfolk are born with a gift for metal. | false | loose | invented |
| Deepwalkers | Steinfolk | The Steinfolk will always come when the sea-wall breaks. | rumour | held | invented |
| Deepwalkers | Merfolk | The deep channels are ours by right of memory. | rumour | firm | canon |
| Deepwalkers | Remnants | The Remnants are dead gods walking. | rumour | loose | invented |
| Deepwalkers | Wildkin | The beastkin are afraid of the sea. | rumour | loose | invented |
| Merfolk | Steinfolk | The Steinfolk live in stone mazes. | false | held | invented |
| Merfolk | Deepwalkers | The deep places are ours. The Deepwalkers only visit. | rumour | firm | canon |
| Goblins | Pandor | Sell a secret to a Pandor and the whole world has it by spring. | rumour | held | invented |
| Goblins | Giants | Aldriksson must be a very high-level [Sage]. | false | loose | invented |
| Wildkin | Merfolk | Nothing lives out past the shore. The sea is just the edge. | false | firm | invented |
| Wildkin | Fae | Something at the meadow's edge at dawn bargains for names. Grandmothers warn the cubs. | rumour | held | invented |
| Wildkin | Everstill | The walking dead in the high passes come from the Pale City. | rumour | held | invented |
| fieldborn | Merfolk | Merfolk are a story harbour folk tell to sell fish. | false | loose | invented |
| fieldborn | Fae | Don't leave a gate open at the field's edge at dawn. That's how the fae walk in. | rumour | held | invented |
| fieldborn | Wildkin | Beastkin turn into wolves when the moon is full. | false | loose | invented |
| ridgefolk | bazaar-folk | Goblin traders never name a price first, so they always win the bargain. | rumour | held | invented |
| ridgefolk | Steinfolk | Steinfolk never get angry. You could knock their wall down twice. | rumour | held | invented |
| ridgefolk | Everstill | A dead smith can't be any good. Skill needs a living hand. | false | firm | invented |
| ridgefolk | Constructs | A construct is a tool, like a hammer. | rumour | held | invented |
| waterstead | ironborne-encampment | The ironborne doubled the iron price to get rich. | rumour | loose | invented |
| mountainhold | bazaar-folk | There are no goblins in the holds. | false | firm | canon |
| mountainhold | Pandor | The Pandor know why our granite is weakening, and won't say. | rumour | loose | invented |
| mountainhold | Goblins | Goblins steal. Lock the upper levels. | false | firm | invented |
| wallborn | Goblins | Goblins aren't really people, so they don't go on the roll. | false | held | invented |
| wallborn | Remnants | Something passed the Gate once without being counted. The old keepers say it was a Remnant. | rumour | loose | invented |
| caravan-folk | Merfolk | Camp too close to deep water and the Merfolk will pull your cart in. | rumour | loose | invented |
| caravan-folk | Wildkin | Beastkin are wild animals that happen to talk. | false | held | invented |
| grovekin | Markfolk | Farming takes strong arms, not much skill. | false | loose | invented |
| grovekin | Wildkin | Beastkin change shape when they get angry. | rumour | loose | invented |
| harborfolk | Merfolk | Merfolk are slow to answer because they don't care about us. | false | held | invented |
| harborfolk | Remnants | The Remnants are what the dead gods left behind. | rumour | loose | invented |
| refuge-keepers | Fae | A fae will take your memory for a bowl of soup. | rumour | loose | invented |
| refuge-keepers | Remnants | A Remnant walked past the refuge once. You knew by the silence after. | rumour | loose | invented |
| ironborne-encampment | Fae | Never shoe a stranger's horse at dawn. That's how the fae trick you. | rumour | held | invented |
| ironborne-encampment | Constructs | Hold-made constructs will take all the smithing work. | rumour | held | invented |
| bazaar-folk | waterstead | Tell a Saltmere scholar anything and the whole valley knows by spring. | rumour | held | invented |
| bazaar-folk | Constructs | An old construct is a person. A new hold-made one is a very good doorstop. | rumour | loose | invented |

"Canon" here means canon says they hold the belief (and what's really so); "invented" means the
belief is new, and only the correction is canon.

## How it plugs in

`culture-lore.ts` reads the files and gives:

- `peopleLore(id)`, `cultureLore(id)`: the lore as written.
- `scopedClaims(scope)`, `allScopedClaims()`: claims in the shape of the spike's `Fact`: a `people`
  or `culture` scope, a topic (`values`, `taboos`, `greeting`, `trade`, `mourning`, `debt`, `view`),
  `about` keys (`group:Bergfolk` as `topics.ts` already names Peoples; `culture:ridgefolk`, which
  has no topic kind yet), `truth`, `sensitivity` and `depth` (1 unless said).
- `voicingGates`, `voicedAt`, `candourOf`: the rule above; `effectiveCandour`, `placeShift`: where they are.
- `matchLore(question, knower?, trust?, place?)`: names, aliases ("dwarves", "the Dyprike", "harbour folk",
  "beastkin") and a few topic words, in the style of `free-questions.ts`. A member of the group
  named answers from its own lore ("What do the Bergfolk believe?" to Orrin: the Bergfolk's
  values), and never speaks for another group's opinions. The order otherwise:
  - **About themself** ("What do you do when someone dies?"): their culture's custom, then their
    People's. Both come back, the culture's first: in a mixed culture it wins (Orrin's ridgefolk
    hearth before the Bergfolk's buried tools; Veit's wall before the Femhörn's stone).
  - **What they think of a group, or a group they're not in** ("What do you think of goblins?";
    "What do the Bergfolk believe?" to Maren): one view, their **culture's** when it has one, else
    their **People's** (a Bergfolk of a culture with no lore answers with the Bergfolk's view).
    "Your people" turns the order round ("What do your people think of goblins?" to Orrin: the
    Bergfolk's view, canon prejudice and all). Cultures hold views of every People and every road
    culture; Peoples only of Peoples.
  - **Given a trust**, it returns only what they'd say at it, how each is said (`voicing`), and
    whether they're holding something back (`holdingBack`, and `opensAt`, the trust at which they'd
    say more). The candour is the knower's culture's (with nobody in particular, the claim's own
    culture's, else `plain`), nudged by `place` when one is given. Without a trust it returns
    everything that answers, as before.

Free questions read it (#1611, behind `knowledge-questions`), and the place nudge (#1619, behind `candour-by-place`); no save or RNG change comes with either.

## Decided (owner, 2026-10-11)

1. **Prejudice isn't one level.** It's voiced by candour, strength and trust: the rule above.
2. **Invented views are placeholders.** Each stays marked `invented: true` until someone reviews it; the
   canon *Relations* pairs are the only canon views. A view becomes canon only by review.
3. **Mixed cultures:** the culture's custom wins over the People's. Built; a test pins it (Orrin, Veit).
4. **Cultures hold views of Peoples:** all 12 road cultures, of all 16 Peoples. An outsider answers
   from their culture's view, else their People's.
5. **The Wildkin are the 16th People** (#1606): full lore here, sourced to the setting bible. The
   tests take the canon list from `docs/peoples-and-races.md` plus the Wildkin until #1604 adds
   them to that table, and take the table as it is once it does.

## Open questions for the owner

1. **Reviewing the placeholders.** Who reviews the invented views, and when (the lore agents, or the
   owner as they come up in play)?
2. **Regional candour.** Answered (owner, 2026-10-11, #1619): place shifts it, one step at most:
   hardship and harsh weather make people blunter, a strict lord or unease more guarded. See
   *Where they are*. Still open: the road villages' places are hand-written placeholders until the
   road's history runs in the sim (slice F) and `placeOfRegion` can read them.
3. **The off-road Peoples** (Merfolk, Fae, Giants, Dragons, Everstill, Constructs, Remnants, and now
   the Wildkin) have full lore though nobody on the road is one of them. Keep it, or trim to what
   other Peoples say of them?
4. **`macro-world/cultures.json` is stale on Peoples.** Its `racePreferences` still use the ids
   retired in #709 (Humans, Dvergr, Sylphari, Steppevarg, Grynfolk…), not the canon mapping in
   `docs/peoples-and-races.md`. The lore follows the docs and `world/peoples.ts`. Fix the export?
5. **A `culture` topic kind.** Wiring this in (slice C) needs `topics.ts` to name cultures, as it
   already names Peoples (`group:<People>`). `culture:<id>` is the key used here.
6. **Wildkin and the human lands.** The setting bible's eastern human empire has no People of its
   own in Mistheim's list (#709 folded "human" into others). The Wildkin lore here says nothing of
   it, and doesn't name the Markfolk as those neighbours. Should a People hold that role?
7. **Wildkin in `villages.ts`.** The road's `People` type still has 15; the lore adds the Wildkin
   as `LorePeople` beside it. Widen `People` when a Wildkin first walks the road?
