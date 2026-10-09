# Concepts & mastery — design

**Epic:** #1454 · **Date:** 2026-10-08 · **Status:** decided; built in the order below
**Builds on:** [`crafting-tools-design.md`](crafting-tools-design.md) (#1202), the stats epic (#1255), guild ranks (#1195)

## The idea

An artificer is powered by **mastery of concepts**. Mastery has two sides:

- **volume** — how many concepts you understand (joinery, tension, sealing… the web in
  `public/macro-world/concepts.json`);
- **depth** — how well you understand each (its rank, 1–3).

It works in two places. In your own hands at the bench: a deeper, broader mind makes
better things. And **foremost through your items**: what you make carries what you
understood when you made it, and it outlasts you.

## Decisions

### 1. One run per Warden; the items carry over (#1455)

A Warden's story is one year in the Reach, and perhaps the road. When it ends — thaw,
arrival or death — that character is done. The next Warden is someone new.

What passes on is **the tools the last Warden had at the end**: their heirlooms. One of
each item, the best grade, at the grade it was tended to. The next Warden finds them
where they start ("Someone was here before you. Left for you: a fine stone-knife."). Any
outcome leaves them, death included: what you made outlasts you.

What does *not* pass on: recipes, concept ranks, skills, stats, talents, quirks, marks,
the road's contacts. None of it belongs to a stranger.

This retires the app's "continue as the same Warden, keeping what you learned" flow
(#1242). The sim keeps the knowledge-carrying `Legacy` and `legacyOf` for the history
and the AI harness's experiments; the game's own next run uses `heirloomsOf`.

**Why.** A saved character that keeps everything turns the game into a grind across
runs, and makes the first run matter least. A line of Wardens who leave each other
their work keeps each run whole, and makes the *items* the thing you build up.

### 2. Items carry the maker's understanding (#1456)

A crafted tool records the concept ranks of the hand that made it: `made: { sharpening:
2 }`. The first time a run *uses* an heirloom, its concepts teach the new Warden — insight
scaled by the maker's rank and the item's grade. Once per item per run. So knowledge comes
back, but through the items, and faster from better work. A line of Wardens climbs through
what they leave each other.

### 3. One ladder, by volume and depth (#1457)

**Apprentice → Journeyman → Master → Artificer**, the same four names as the crafter's
guild ranks (#1195). Earned by total concept ranks, with a depth requirement at the top:

| Rank | Total concept ranks | Depth |
|---|---|---|
| Apprentice | 0 | — |
| Journeyman | 3 | — |
| Master | 8 | at least one concept at its full rank |
| Artificer | 15 | at least two at full rank |

Volume alone makes a Journeyman; the top two rungs need something understood all the way
down. The numbers are a first guess (direction, not precision). The old Apprentice /
Journeyman / Adept / Master in `rank.ts` goes.

### 4. All of a recipe's concepts count (#1458)

Today the grade uses only your *best* rank among a recipe's concepts, so there's no reason
to learn the second one. Grade and salvage from the **mean** rank; the tier gate keeps the
best rank (lenient to attempt, rewarding to master). Every concept still drips insight.

### 5. The concept web (#1459)

Load `concepts.json` into the sim: 34 concepts with prerequisites (`bearings` needs
`friction:1` and `rotation:1`) and their own rank caps. Study offers what is *open* for
this Warden: Region 1's six, plus whatever prerequisites have unlocked. Volume has
somewhere to go. Focus follows the same list (#1478): a Warden can turn over any concept
open to them while they work.

## What this adds up to

- **In one run:** learn broadly to open the web and climb the ladder; learn deeply to make
  fine and masterwork things.
- **Across runs:** what you leave is what the next Warden has. A masterwork knife made by a
  Master teaches sharpening to whoever picks it up.
- **The bench stays the bottleneck.** Region 1's shelter caps grades at fine
  (`BENCH_GRADE_CAP`); masterwork needs a real station in a later region.

## Open questions

1. Should an heirloom wear with use, so a line can't coast on one masterwork tool forever?
   (Crafting design §9 Q4; tools wear only through accidents today.)
2. Where are the heirlooms found: at the start, or at the last Warden's site? At the start
   for now; a cache at the old site is a nicer story once sites persist.
3. Deliberate study of an heirloom (the crafting design's "reverse-engineer") versus
   learning by use only — use only, until it's missed.
