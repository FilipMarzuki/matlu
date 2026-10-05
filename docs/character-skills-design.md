# Character & skills — design

Status: in progress. Inspired by *Drakar och Demoner* and D&D: a named
character with a few defining **traits**, and a list of practical **skills**
that improve **by use** and make that kind of work richer, easier and better.

Builds on the sim core (`src/artificer/`): vitality (Vigor / Clarity /
Condition), crafting (grades, concepts, tools) and Region 1's actions. Feeds
Region 1.5 (the caravan road, #1235), where villagers, trade and quests check
skills.

## 1. Skills

Seven skills, each tied to the actions that use it:

| Skill | Used by |
| --- | --- |
| **Woodcraft** | gather wood; lean-to, brush hut, timber walls; crude shovel |
| **Foraging** | gather food (and fiber) |
| **Hunting** | hunt, track, snare |
| **Stonework** | quarry; stone knife; stone-banked walls |
| **Fieldcraft** | fetch water, preserve food |
| **Scouting** | scout, survey, look out |
| **Handcraft** | cold gear, hide parka, waterskin, bedroll, tinker |

Rest and study use no skill. Study grows concepts instead: skills are *doing*
and concepts are *understanding*.

**Levels.** Untrained (0) → Novice → Apprentice → Journeyman → Expert →
Master (5).

**Improvement by use.** Every hour of work in a skill is practice. Thresholds
are cumulative hours: 6, 18, 36, 60 and 90. A level-up is announced in the
journal. (Like DoD's *färdighetsförbättring*, but deterministic: the sim has
no dice.)

**What a level does in its field:**

| Effect | Per level |
| --- | --- |
| Energy | Vigor and Clarity drain × (1 − 0.06 × level); a Master spends 30% less |
| Yield | +0 / 0 / 1 / 1 / 2 / 3 on gathering trips |
| Tool use | the field's tool bonuses × (1 + 0.2 × level) |
| Craft quality | +0 / 0 / 1 / 1 / 2 / 3 to the craft-grade score (the same score as bench, tools and concepts) |

**Across runs.** Skills carry into a new run at the level reached, with the
practice beyond that level dropped. The body is new; the hands remember.

## 2. Traits

Pick two at character creation. Each trait has an upside and a cost, and works
through the existing levers: capacity caps, drains, deprivation costs and the
salvage bonus. That's in line with the vitality design's plan for traits that
shape baselines and resilience. Examples: Hardy, Sharp-minded, Light Eater,
Careful Hands, Quick Learner, Cold-blooded. *(Separate issue.)*

## 3. Focus

One standing focus: a **concept** (extra insight from actions that use it), a
**goal** (Shelter / Larder / Explore: a small bonus on matching actions) or a
**skill** (practice counts double). Focus costs a little Clarity a day, and
low Clarity makes it unreliable.

**Survival lock.** Focus snaps to *Survival* and stays there while any of
these hold:
- a night without water, or 2+ without food;
- Condition under 40;
- winter 3 days away and not ready.

While locked, survival actions get the focus bonus and learning pauses.
*(Separate issue.)*

## 4. Character creation

A name and a portrait, chosen after the arrival intro's class designation.
The voice uses the name. A Character tab shows the portrait, name, rank,
traits, skills, concepts and focus. *(Separate issue.)*
