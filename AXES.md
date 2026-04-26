# Cultural Axes

Shared scoring framework for Peoples, Cultures/Movements, and Factions in the
Matlu world. The same axes apply across entity types so a character's effective
values can be derived from their memberships rather than improvised per-entry.

> **Status:** Draft. Scores below are first-pass estimates from `WORLD.md`,
> intended to be reviewed and revised. `Lore Status` for any future Notion
> mirror starts at `draft`.

## Why

Most lore frameworks lean on one of two things: invented personality types
(MBTI/Hogwarts-house style — fun, but pseudo-science and prone to
essentialism), or freeform adjectives that don't compose. Neither lets the
lore agent generate characters whose internal tensions are *structurally*
visible.

Cross-cultural psychology already solved this. Hofstede, Inglehart-Welzel
(World Values Survey), Hall, and Gelfand each contribute axes that are
empirically grounded and — crucially — that reveal interesting drama when
two layers (people vs. faction, faction vs. character) disagree. We use a
small, fiction-tuned subset.

## The four axes

Each scored on an integer scale **-2 to +2**, where 0 = balanced / mixed.

### 1. Tradition ↔ Reason

| -2 | 0 | +2 |
| --- | --- | --- |
| Empirical, methods change with evidence | Both, in tension | Inherited methods are sacred |

Asks: *Does this entity defer to ancestors or to evidence?* The Pandor
update their records constantly but treat record-loss as a moral failure —
that's a 0 with explanation, not a +2.

### 2. Survival ↔ Expression

| -2 | 0 | +2 |
| --- | --- | --- |
| Scarcity-driven, work-focused | Secure but pragmatic | Material security, identity-focused |

Asks: *Are basic needs taken for granted?* Inglehart-Welzel's second axis.
For peoples, this maps to economic position; for factions and guilds, it
weakens — see [Where the framework strains](#where-the-framework-strains).

### 3. Tight ↔ Loose

| -2 | 0 | +2 |
| --- | --- | --- |
| Norms loosely enforced, deviance tolerated | Mixed | Norms tightly enforced, deviance punished |

Asks: *What can a non-conformist get away with?* Gelfand's single-axis
framework, the most fiction-ready dimension on this list. Note that "tight"
at species scope means whole-society conformity; at guild scope it means
expulsion-on-rule-break.

### 4. High ↔ Low context

| -2 | 0 | +2 |
| --- | --- | --- |
| Plain speech, meaning explicit | Mixed | Implicit, status-coded, layered |

Asks: *How much is said vs. understood?* Edward T. Hall's axis. Affects
how dialogue, politics, and silence read on the page.

## Categorical: Honor / Dignity / Face

A three-way mode (Leung & Cohen) — not an axis, a category. Pick one
(or two with notes if the entity is genuinely split).

- **Honor** — status is earned and lost through visible deeds; insults
  must be answered. Shame is public.
- **Dignity** — every person has inherent worth; status is internal.
  Shame is felt regardless of audience.
- **Face** — status is collective and managed; preserve the surface,
  settle privately. Shame is a public exposure.

## Top values vocabulary

A free-form list of 3–5 values per entity, drawn from this shared
vocabulary so cross-entity comparison stays meaningful. Add terms as
the world grows.

`Mastery`, `Continuity`, `Memory`, `Beauty`, `Survival`, `Mutual-aid`,
`Knowledge`, `Sovereignty`, `Hospitality`, `Concealment`, `Vengeance`,
`Craft-lineage`, `Oath`, `Restraint`, `Adaptation`, `Mobility`,
`Neutrality`, `Patience`, `Depth`, `Possibility`, `Witnessing`,
`Territory`, `Hoard`, `Recognition`, `Stillness`, `Long-knowing`,
`Exchange`, `Bargain`, `Solidity`, `Work`, `Honesty`, `Trust`,
`Preservation`, `Purpose`, `Persistence`, `Inscrutability`.

## Layering: how a character's values are computed

```
character_values  ≈  species_baseline
                   + faction_modifier (per faction membership)
                   + personal_deviation (Big Five)
```

A character is interesting when these layers *disagree*. A Bergfolk
[Runesmith] (people: low Tradition-Reason, +2 Tight) who joined the
Compact of Knowing (faction: -2 Tradition-Reason, +1 Tight) reads as
restless — without anyone writing the word.

For **individuals**, switch from cultural axes to **Big Five** —
the empirically grounded personality framework. MBTI is its
less-rigorous cousin; we don't use it.

- **Openness** (-2 to +2) — curiosity, willingness to revise
- **Conscientiousness** — discipline, planning, follow-through
- **Extraversion** — social energy, assertiveness
- **Agreeableness** — warmth, cooperation, deference
- **Neuroticism** — emotional reactivity, stress sensitivity

Score Big Five on Notion Character pages, leave the cultural axes
to Peoples, Factions, and Cultures.

## Where the framework strains

- **Survival ↔ Expression** weakens for small groups. Most guilds
  aren't economically marginal — the axis just isn't doing work.
  Score it 0 and don't worry about it. For Factions, an alternative
  5th axis is **Open ↔ Secret** (does the faction operate publicly
  or in shadow?) — included optionally for Factions only.
- **Tight ↔ Loose** changes meaning across scopes. At species scope:
  whole-society conformity. At guild scope: expulsion enforcement.
  At cultural-movement scope: how strongly the diaspora keeps each
  other in line. Note this in the entry; don't try to formally
  separate the meanings.
- **For Cultures/Movements** (e.g. the Wandering People, the Called),
  the *interesting* signal is divergence from the parent species
  more than the absolute score. Store both: the absolute axis values
  AND a one-line note describing the departure ("Lövfolk official
  +2 Tradition; Wandering People who left = -1, the defection
  is the point").
- **Some entities don't fit cleanly.** The Giants and Remnants exist
  on geological/inhuman timescales where Honor/Dignity/Face arguably
  doesn't apply. Score where it makes sense, leave others null with
  a comment.

## Backfill: Mistheim peoples

> **Source of truth:** The live axis values now live on Culture DB entries in Notion
> (one `default-of-race` Culture per People). The table below is kept for documentation
> but may drift — prefer the Notion Culture DB for current values.

First-pass scores from WORLD.md. Verify and revise.

| People | Tradition | Survival | Tight | Context | Mode | Top values |
| --- | :-: | :-: | :-: | :-: | --- | --- |
| **Bergfolk** | -1 | -1 | +2 | -1 | Honor | Mastery, Craft-lineage, Continuity, Solidity |
| **Lövfolk** | +2 | +1 | +1 | +2 | Face | Continuity, Knowledge, Beauty, Long-knowing |
| **Markfolk** | 0 | -1 | -1 | 0 | Dignity | Work, Mutual-aid, Hospitality, Patience |
| **Viddfolk** | +1 | 0 | +1 | +1 | Honor | Memory, Trust, Neutrality, Mobility |
| **Steinfolk** | -1 | -1 | 0 | -1 | Dignity | Work, Solidity, Patience, Continuity |
| **Pandor** | 0 | +1 | +2 | +1 | Dignity | Knowledge, Memory, Neutrality, Honesty |
| **Deepwalkers** | +1 | -1 | +1 | +1 | Honor | Memory, Adaptation, Witnessing, Oath |
| **Merfolk (Djupvolk)** | +1 | +2 | 0 | +2 | Face | Patience, Depth, Sovereignty, Concealment |
| **Goblins** | 0 | -2 | -1 | +1 | Face | Survival, Memory, Mutual-aid, Adaptation |
| **Fae (Hollow Courts)** | +2 | +1 | +2 | +2 | Face | Exchange, Bargain, Memory, Possibility |
| **Giants (the Seven)** | +2 | +2 | 0 | +2 | Dignity | Stillness, Long-knowing, Sovereignty, Continuity |
| **Dragons** | +1 | +2 | +1 | +1 | Honor | Territory, Sovereignty, Hoard, Patience |
| **Everstill** | 0 | +2 | +1 | +1 | Dignity | Knowledge, Preservation, Continuity, Patience |
| **Constructs** | 0 | +1 | 0 | 0 | Dignity | Purpose, Persistence, Recognition, Craft-lineage |
| **Remnants** | +2 | +2 | 0 | +2 | (n/a) | Inscrutability, Stillness, Long-knowing |

### Notes on individual scores

- **Bergfolk** Tradition is -1 not -2: empirical craft methods evolve,
  but lineage and tool-taboo pull it back from full Reason.
- **Lövfolk** Tight is +1 not +2 because young Lövfolk routinely defect
  to the Wandering People — the official culture is tight, the diaspora
  signal escapes it.
- **Markfolk** Mode is Dignity, not Honor: status comes from yields and
  competence regardless of who notices, and the dry-comedy tradition
  *resists* public face-management.
- **Viddfolk** Tight is +1 internally (memorisation standards), but
  externally they are scrupulously neutral — the harshness is internal.
- **Goblins** are split: low Survival score reflects material
  precariousness, but in-band the culture is high-trust and tight.
- **Fae** score +2 on three axes because everything about them is
  layered, ancient, and binding — they may be the framework's purest
  example.
- **Giants & Remnants** Mode is awkward; left as Dignity / n/a because
  they don't compete for status in any scene-relevant sense.
- **Constructs** scores are tentative because the population is
  heterogeneous (older vs. Bergfolk-made), and individual constructs
  may need their own Character entries that override.

## Earth and Spinolandet

Earth and Spinolandet have factions and creature ecologies but few "peoples"
in the Mistheim sense. Score Earth factions when their Notion entries are
written; score Spinolandet's Precursors and any sapient organisms similarly
when canon firms up.

## How agents use this

- **Lore agents** (`.agents/lore-autofill.md`, `.agents/lore-features.md`):
  before generating a Character, Faction, or Location, read the relevant
  People's row in this table and use the values + mode as scaffolding.
  When generating dialogue, skew toward the entity's Context score.
  When generating internal conflict, look for divergence between the
  character's People baseline and any Faction modifier.
- **Triage / submission agents**: not directly relevant.
- **When in doubt, write the prose first and the score second.** This
  framework is a lens for generation, not a constraint.

## See also

- `WORLD.md` — primary creative source
- `LORE.md` — Notion database IDs, agent conventions
- `.agents/lore-autofill.md` — current lore agent prompt
