# Region 1 — Greywind Reach — Design Document

**Issue:** #1201
**Date:** 2026-10-05
**Status:** Draft for review
**Builds on:** [`region-exploration-design.md`](region-exploration-design.md), [`vitality-system-design.md`](vitality-system-design.md)
**Prototype:** *Warden's Field Survey* (Claude Artifact) — the explore/site/vitality loop Region 1 is built from

---

## Summary

Region 1 is the game's opening region **and** its hidden tutorial. The Warden
arrives alone and with nothing in a fully fogged **Greywind Reach**, and
**winter is coming.** The goal is to **survive it**: thirty days of autumn to
build a winterized shelter, a stocked larder, fuel for warmth and a sound body
and mind — then thirty days of winter, played day by day, living on what you
laid by, until the thaw. A caravan comes up the valley in spring and takes the
survivors on (#1307).

> **Revised by epic #1310 (#1301, #1302).** The first draft ended Region 1 at an
> autumn exit — a caravan before the snow, a solo crossing, or wintering over
> resolved in one step. Now winter is played, the goal is to be alive at the
> thaw, and there are no autumn exits. §3–§7 below describe the current design.

The region teaches every core system in order (fog → exploration → site rating →
shelter → the Vigor/Clarity loop → Condition → first crafting → a light brush
with permanent injury) under one legible human goal, and ends on the choice that
defines the whole game: **wander or root.**

Design only — no gameplay code here. Combat is deferred (animals first); the
caravan encounter is non-combat.

---

## 1. Setup & fiction

The Warden arrives in the Reach alone, with nothing — washed up / exiled /
waking after the corruption (exact hook TBD). The region is all `???`. A quiet
pressure hangs over it: **the season is turning** — winds rising, a cold snap
coming — and there is one chance to move on before the Reach closes in. The
player learns the weather is turning *by exploring* (Lookout, survey), not from a
popup.

---

## 2. Goal: be ready for winter

A bare "survive N days" is passive — you would just wait. The organizing
pressure is concrete and diegetic: **winter is coming, and you must be prepared
before it lands.** Readiness is a set of stockpiles and a state, not a timer —
which forces the player to actually build the loop and, crucially, to *stockpile
ahead* rather than live hand-to-mouth:

| Pillar | What it requires | Systems it exercises |
|---|---|---|
| **A winter larder** | *Stored, preserved* food + water laid in for the cold months — not just today's meal | gathering, preservation crafting (smoke/dry/salt, waterskins) |
| **A winterized shelter** | A built shelter at a site that breaks the weather, warm enough to hold through the cold | fog, exploration, site/shelter rating, first build |
| **Warmth & fuel** | Firewood / a hearth / cold-weather gear to keep Clarity recovering through the freeze | gathering, crafting, the warmth gate on recovery |
| **A sound body & mind** | Vigor & Clarity capacity at/above baseline, Condition **Sound**, to *enter* winter on | the vitality loop, recovery, capacity growth |

**Winter-ready** — larder stocked to a threshold, shelter winterized, fuel in,
body & mind sound — is a milestone and a rough guide, not the win. It sequences
the loop: explore → choose a site → build → secure *and store* food/water → lay
in fuel → settle the recover rhythm. The **winter outlook** (#1302) turns it into
plain numbers: nights of food, water and firewood at the rates the nights use,
and how the shelter stands against a midwinter night. **The win is the winter
itself**: being alive at the thaw.

By the end a well-played Warden enters winter **at or above baseline** — the
reward for good preparation is that you meet the cold stronger than you arrived
(capacity model, vitality §1).

### Milestones — a first-win ladder

Because Region 1 is the tutorial, the winter-ready goal is scaffolded by a
**ladder of milestones** — discrete first-time wins that light up as the player
hits them, breaking the abstract goal into legible steps and quietly teaching
the order of operations:

*get your bearings* (scout) → *stake a claim* (choose a site) → *water secured*
→ *first forage* → *fire & timber* → *a roof overhead* (raise a shelter) →
*read the tracks* → *first catch* (hunt) → *the larder begins* (preserve) →
*winterized* → *larder stocked* / *fuel laid in* → **winter-ready**.

Early rungs are "first time you do X" (guidance); the later ones are the
readiness thresholds themselves (shelter winter-warm, larder/fuel full). The
ladder is a teaching aid and a progress readout, not a hard gate — the player
can tackle steps in any order, and the milestones simply celebrate and signpost.
(Prototyped in the *Greywind Reach* slice.)

---

## 3. The year: 30 days of autumn, 30 of winter (#1301)

| Days | Season | Daylight | Mean temperature |
|---|---|---|---|
| 1–30 | Autumn — prepare | 11½ h → 8 h | 10 °C → −2 °C |
| 31–60 | Winter — survive | 8 h → 6 h (midwinter, day 45) → 7½ h | −2 °C → −12 °C → −4 °C |
| 61 | The thaw — the run ends | | |

Weather follows the season: early autumn is mild; late autumn (from day 16)
brings wind and storms, with early snow from day 20; in winter snow is the
commonest weather and a storm is a blizzard. Streams ice over once the mean
drops below freezing. The last three days of autumn press the mind toward
survival if you're not ready.

---

## 4. Winter is played (#1302)

There are **no exits** in autumn. The snow falls on day 31 and the days go on —
the same daily queue, darker and colder. You live on the larder (raw food
first, then preserved rations, one a night), your water, your fuel and your
shelter. Winter's own rules come in parts: nights against the deep cold and
melting snow for water (#1303), snow cover, scarce game, ice fishing and
blizzard days (#1304), rationing and cabin fever (#1305).

---

## 5. The ending: alive at the thaw

The run ends on the morning of **day 61**, graded by how the Warden came
through:

| Grade | Condition at the thaw |
|---|---|
| **Hale** | 70+ and no lasting injury |
| **Worn** | 40–69 |
| **Broken** | below 40, or a lasting injury |

Surviving ranks above every old exit in the run history. A survivor goes on:
the **spring caravan** comes up the thawing valley and takes them onto the road
to Mistheim (Region 1.5, #1307) — arriving thriving if hale, ragged otherwise.

---

## 6. Nomad survival — later

The draft's solo crossing (the vitality loop on the move: portable shelter,
preserved rations, cold gear, route knowledge) is gone from Region 1. The idea
stays for later long-distance travel and expedition modes; the pass glimpsed
from the distant hills (`routeKnown`) is kept as a find for that.

---

## 7. Failure

- **The body gives out before the thaw** — Condition reaches 0: dead of thirst
  or hunger, or found collapsed. Death ends the character; a collapse ends the
  run (vitality §3, #1234).
- **Coming through badly** — a thin larder, a cold shelter or no fuel grinds
  Condition down through the winter; you may still reach the thaw, but *worn* or
  *broken*.

---

## 8. Tutorial beat mapping (one lesson at a time)

| Beat | System introduced |
|---|---|
| Arrive fogged | the region knowledge/fog model |
| First Scout | the five explore actions, confidence |
| Read the Reach | region feel + resources |
| Pick a site | site/shelter rating (Shelter/Safety/Water/Resources) |
| Build shelter | first craft/build; sleep quality → recovery |
| A day's work | the Vigor/Clarity per-time loop, the day rhythm |
| Overdo it | Condition reserve, soft-fail |
| Lay in stores | stockpiling vs. hand-to-mouth; preservation crafting; capacity growth |
| Cold snap / winter | exposure, warmth gate, and a light brush with permanent injury |
| Trade / prep | the crafting economy; nomad gear |
| The exit choice | wander-or-root (flee / brave / hunker); persistence |

---

## 9. Open questions

1. **Winter-readiness threshold** — what exactly counts as "ready"? A larder of
   N rations (how many?), a shelter at/above some warmth tier, X units of fuel,
   capacity ≥ baseline on both pools, Condition ≥ Sound — and is it a hard
   checklist or a soft score?
2. ~~**Window & winter length**~~ — settled by epic #1310: 30 days of autumn,
   30 of winter with a midwinter low, the thaw on day 61 (§3–§5).
3. **Arrival hook** — washed up / exiled / waking? This sets tone and whether the
   Warden has *any* starting kit.
4. **Caravan generosity** — how much of a leg-up (tool? companion? Region-2
   intel?) without trivialising Region 2.
5. **Solo-crossing difficulty curve** — how steep is the prep gate, and what's
   the exact turn-back/injury rule so "hard but not impossible" lands fairly?
6. **Does the Reach persist** if you leave — a returnable node, or narratively
   closed behind you?

---

## 10. Relationship to other systems

- **Region / exploration** — Region 1 *is* the exploration loop with a goal and a
  deadline wrapped around it; Greywind Reach is the prototype's example region.
- **Vitality** — stability is defined in Vigor/Clarity/Condition terms; the cold
  snap introduces permanent injury; the solo exit is the travel variant of the
  loop; the player leaves with grown capacity.
- **Crafting** — first builds (shelter, snare, waterskin), preservation and
  cold-weather gear for the crossing, and trade goods for the caravan.
- **Settlements / Mistheim** — the caravan is bound for civilisation, grounding
  Region 2 as the step from solo survival toward people and trade (and,
  eventually, people-combat).
