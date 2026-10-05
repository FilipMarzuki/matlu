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

**Levels (#1241).** There are 13 levels on an exponential curve. Early levels come fast, Professional sits at the famous 10,000 hours, there are levels above it, and the top three go past human:

| # | Level | Hours | # | Level | Hours |
| --- | --- | --- | --- | --- | --- |
| 1 | Novice | 5 | 8 | Professional | 10,000 |
| 2 | Apprentice | 20 | 9 | Master | 25,000 |
| 3 | Adept | 60 | 10 | Grandmaster | 60,000 (human peak) |
| 4 | Journeyman | 150 | 11 | ✦ Paragon | 150,000 |
| 5 | Skilled | 400 | 12 | ✦ Mythic | 400,000 |
| 6 | Expert | 1,000 | 13 | ✦ Transcendent | 1,000,000 |
| 7 | Veteran | 3,000 | | | |

**Improvement by use, multiplied by intent.** Every hour of work is practice. A *focused* skill practises ×3, because deliberate practice matters a lot. (This is like DoD's *färdighetsförbättring*, but deterministic: the sim has no dice.)

**What a level does in its field.** The effects follow smooth curves, so the long range can't break the maths:

| Effect | Formula |
| --- | --- |
| Energy | drain × 1/(1 + 0.07 × level): 0.74 at Skilled, 0.52 at Transcendent |
| Yield | +⌊level/2⌋ on gathering trips |
| Tool use | the field's tool bonuses × (1 + 0.15 × level) |
| Craft quality | +⌊level/2⌋ to the craft-grade score |

**Self-assessment (Dunning–Kruger).** You never see your true level, only how good you *think* you are:

| Stage | Practice | True level | Feels like |
| --- | --- | --- | --- |
| Mount Stupid | 10–25h | Novice | Adept |
| The valley | 60–100h | Adept | Apprentice |
| Experts | high | e.g. Professional | one level lower (Veteran) |
| Supernatural | 150,000h | Paragon | Grandmaster |

The true level drives every effect, so improvement is **felt**. A true level-up writes a line like "The axe finds the grain more easily now — woodcraft comes easier." When your own estimate drops, you get "The more you learn of woodcraft, the more you see how little you know." The AI is shown only the self-assessment too, and snapshots record both values. (Later, a Region 1.5 teacher could reveal your true level.)

**Across runs.** All practice carries over. The climb to mastery spans many runs.

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
