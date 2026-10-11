# What Peoples and cultures value, believe and keep

**Issue:** #1590 · **Status:** content and reader written, not yet read by the game
**Files:** `src/artificer/content/peoples-lore.json`, `src/artificer/content/cultures-lore.json`, read through `src/artificer/culture-lore.ts` (tests: `culture-lore.test.ts`)
**Feeds:** the knowledge model's scope content (#1577 slice C, `docs/knowledge-model-design.md`) and rumours, confidence and lies (#1580)

## What's there

For each of the **15 Mistheim Peoples** and each of the **12 cultures the caravan road uses** (every
villager's and traveller's `culture` in `villages.ts`, and every village's `cultures`):

| Part | What it is |
|---|---|
| `values` | what they honour (2–3) |
| `taboos` | what shames them (2–3) |
| `customs` | how they greet, trade, mourn and settle a debt (one each) |
| `views` | what they believe about the others, as claims |
| `voice`, `sayings` | how they sound: a line on their manner of speech, and three sayings |

**Views cover:** every People holds a view of **every other People** (15 × 14). Every road culture
holds a view of **every other road culture** (12 × 11). Cultures don't hold views of Peoples: a
ridgefolk asked about goblins answers from their People's view (Orrin: the Bergfolk's).

Every claim has a `truth` (`true`, `rumour` or `false`, as in the knowledge model). A rumour or a
false belief says what is `actually` so, with its own source, so #1580 can correct it. A few carry
a `sensitivity` (`guarded`, `secret`) where canon says it's kept quiet; the rest are `public`.

**Counts:** 595 claims (355 for the Peoples, 240 for the cultures): 562 true, 15 rumours, 18
false. 108 sayings and voice lines. Every People met on the road holds at least one wrong or
half-true belief.

## Where it came from

Every claim, saying and correction names its **source** as `file § heading › label`, and the tests
check that the file, the heading and the label are really there. Most of it rests on:

- **`WORLD.md` § Nations, peoples, and the world between them**: each People's *What shapes them*,
  *What they make* and *Relations*; the visual identity sections (*Objects* hold most of the canon
  customs: Bergfolk tools buried with their master, Deepwalker seal rings buried with their
  [Keeper], Steinfolk adding a stone to what the dead built); *Who uses Rasa*; *Alliances*; *Safe to
  use freely* (the canon prejudices about goblins, dragons, elves and minotaurs).
- **`AXES.md`**: each People's context score and mode, for their voice.
- **`src/artificer/villages.ts` and `asks.ts`**: the road's own people. Culture lore leans on what
  they already say (Maren for fieldborn, Orrin for ridgefolk, Anselm and Gunnar for waterstead,
  Runa for mountainhold, Veit for wallborn, Bodil and cv-runa for caravan-folk, Isa and Ottilia for
  grovekin, Hedda for harborfolk, Yrsa for steppe-camp, Liv for refuge-keepers, Sabine for
  ironborne-encampment, Arvid and Pim for bazaar-folk), so the voice fits them.
- **`src/artificer/world/peoples.ts`**: the Reach cultures' temperament and succession law
  (ridgefolk land is split among all the children; fieldborn goes to the eldest).
- **`macro-world/cultures.json`**: culture names, and traits that suggest customs (ridgefolk are
  fire-centred, so their customs gather at the hearth; refuges are light-sensitive, so their lamps
  are low). The file isn't edited: it stays layout only.

**No faiths.** Canon says the gods are dead and their names aren't said aloud (`WORLD.md` § The
weight of the past). No custom prays or worships; mourning is about naming the dead and what they
made. A test keeps it so.

## What's invented

`invented: true` marks a line canon doesn't state outright. It still names the source it was built
on, and nothing invented contradicts a canon statement. 362 of the 595 claims are invented:

- **Most customs** (74 of 108): canon gives a few (above); greetings, debts and most mourning
  customs are new.
- **Most views** (250 of 351): canon gives the *Relations* pairs (Bergfolk with Markfolk, Lövfolk,
  Steinfolk and Goblins; Lövfolk with Pandor, Bergfolk and Fae; Markfolk with Bergfolk, Steinfolk
  and Viddfolk; Viddfolk with all nations and the Goblins; Steinfolk with Markfolk and Bergfolk;
  Deepwalkers with Merfolk and Pandor; the Pandor's dealings with the Merfolk, Giants, Dragons,
  Everstill, Constructs and Remnants). The rest are new, written to fit each pair's canon.
- **Culture lore** is mostly new (159 of 240), since canon gives cultures only layout. It follows
  the road's people closely.

### The wrong beliefs

| Who | About | Belief | Truth | |
|---|---|---|---|---|
| Bergfolk | Lövfolk | Our mana-granite does the forest no harm. | false | invented |
| Bergfolk | Lövfolk | Elf healing is feeling, not real magic. | false | canon |
| Bergfolk | Viddfolk | A Viddfolk herald still runs a main route in three days. | false | invented |
| Bergfolk | Pandor | Pandor scholars make nothing you can hold in your hands. | false | canon |
| Bergfolk | Goblins | There are no goblins in our holds. | false | canon |
| Bergfolk | Dragons | Iskuldr keeps our tribute tools and never uses them. That means he approves. | rumour | canon |
| Bergfolk | Constructs | A construct is a made thing, not a person. | rumour | canon |
| Lövfolk | Markfolk | Farming is humble work. It takes no great skill. | false | canon |
| Lövfolk | Goblins | Goblins are pests, not people. | false | invented |
| Lövfolk | Dragons | Grimmvald's patronage takes our young ones and gives back strangers. | rumour | canon |
| Lövfolk | Constructs | A construct cannot change. It stays as it was made. | false | invented |
| Markfolk | Lövfolk | The elves think they're better than everyone. | rumour | invented |
| Markfolk | Viddfolk | The eastern steppe is empty land going to waste. | false | invented |
| Markfolk | Merfolk | The Merfolk never answer because they look down on us. | false | invented |
| Markfolk | Goblins | No goblins live in the Merkförbund. It's against the law. | false | canon |
| Markfolk | Fae | A fae deal is a trick. Never make one at the field's edge. | rumour | invented |
| Markfolk | Dragons | Dragons are wicked, and hoard gold to spite us. | false | invented |
| Markfolk | Everstill | The Pale City's dead are the corruption's work. | false | invented |
| Viddfolk | Everstill | Nothing can touch the Everstill. They'll be here forever. | false | invented |
| Steinfolk | Giants | Bergamora's eastern face was built, not grown. | rumour | invented |
| Pandor | Steinfolk | The stronghold at the centre of the continent must guard an old ruin. | rumour | invented |
| Deepwalkers | Bergfolk | The Bergfolk are born with a gift for metal. | false | invented |
| Deepwalkers | Steinfolk | The Steinfolk will always come when the sea-wall breaks. | rumour | invented |
| Deepwalkers | Merfolk | The deep channels are ours by right of memory. | rumour | canon |
| Deepwalkers | Remnants | The Remnants are dead gods walking. | rumour | invented |
| Merfolk | Steinfolk | The Steinfolk live in stone mazes. | false | invented |
| Merfolk | Deepwalkers | The deep places are ours. The Deepwalkers only visit. | rumour | canon |
| Goblins | Pandor | Sell a secret to a Pandor and the whole world has it by spring. | rumour | invented |
| Goblins | Giants | Aldriksson must be a very high-level [Sage]. | false | invented |
| ridgefolk | bazaar-folk | Goblin traders never name a price first, so they always win the bargain. | rumour | invented |
| waterstead | ironborne-encampment | The ironborne doubled the iron price to get rich. | rumour | invented |
| mountainhold | bazaar-folk | There are no goblins in the holds. | false | canon |
| bazaar-folk | waterstead | Tell a Saltmere scholar anything and the whole valley knows by spring. | rumour | invented |

"Canon" here means canon says they hold the belief (and what's really so); "invented" means the
belief is new, and only the correction is canon.

## How it plugs in

`culture-lore.ts` reads the files and gives:

- `peopleLore(id)`, `cultureLore(id)`: the lore as written.
- `scopedClaims(scope)`, `allScopedClaims()`: claims in the shape of the spike's `Fact`: a `people`
  or `culture` scope, a topic (`values`, `taboos`, `greeting`, `trade`, `mourning`, `debt`, `view`),
  `about` keys (`group:Bergfolk` as `topics.ts` already names Peoples; `culture:ridgefolk`, which
  has no topic kind yet), `truth`, `sensitivity` and `depth` (1 unless said).
- `matchLore(question, knower?)`: names, aliases ("dwarves", "the Dyprike", "harbour folk") and a
  few topic words, in the style of `free-questions.ts`. A member of the group named answers from its
  own lore ("What do the Bergfolk believe?" to Orrin: the Bergfolk's values); anyone else answers
  with their own People's or culture's view of it (to Maren: the Markfolk's view of the Bergfolk),
  and never speaks for another group's opinions. "What do you do when someone dies?" answers from
  the person's culture, then their People.

Nothing on the road reads it yet: no play, save or RNG change.

## Open questions for the owner

1. **How strongly should prejudice show?** Every People met on the road has at least one wrong or
   half-true belief; the off-road Peoples and most cultures hold true views only. Prejudice is
   `public` (said at trust 0). Should it be `guarded`, so strangers hear politeness first?
2. **Which invented views stand?** The *Relations* pairs above are canon; the other views are mine.
   Any that should be vetoed or made canon?
3. **Mixed cultures.** Ridgefolk, wallborn, harborfolk and caravan-folk mix Peoples, and some road
   people live in a culture their People doesn't usually follow (Veit, a Steinfolk, is wallborn;
   Liv, a Markfolk, keeps the refuge). When a culture's custom and a People's differ (Orrin's
   ridgefolk hearth vs the Bergfolk burying a master's tools), the culture answers first, as the
   design's specificity order says. Right?
4. **Views of Peoples by culture.** Should cultures also hold views of Peoples? Fieldborn are kinder
   to goblins (Maren's "neighbours") than the Markfolk law is, and only the culture-to-culture view
   says so today.
5. **The off-road Peoples** (Merfolk, Fae, Giants, Dragons, Everstill, Constructs, Remnants) have full
   lore though nobody on the road is one of them. Keep it, or trim to what other Peoples say of them?
6. **`macro-world/cultures.json` is stale on Peoples.** Its `racePreferences` still use the ids
   retired in #709 (Humans, Dvergr, Sylphari, Steppevarg, Grynfolk…), not the canon mapping in
   `docs/peoples-and-races.md`. The lore follows the docs and `world/peoples.ts`. Fix the export?
7. **A `culture` topic kind.** Wiring this in (slice C) needs `topics.ts` to name cultures, as it
   already names Peoples (`group:<People>`). `culture:<id>` is the key used here.
