# Focus opens conversations — design

**Date:** 2026-10-10 · **Status:** decided (choices below are the owner's); built in the slices at the end
**Builds on:** focus (#1238, #1478, #1479), [focus makes work better, not faster](https://github.com/FilipMarzuki/matlu/issues/1490), the caravan road's villages (#1246), the "active perception" spec in `macro-world/tinker-tray.json`

## The idea

Focus is **attention**. What a Warden is turning over shapes what they notice and what they
think to ask. Focus on iron and you start asking people about it, and some know something,
or know someone who might. Focus on a place and lore questions come up when you meet people
who've been there. Focus on the Compact and you start to notice who seems to belong to it.

Baldur's Gate 3 does contextual dialogue well, but its options lean on **what has happened**:
your deeds, your companions, your race and class. We want that, and we also want **what you are
focused on** to bring out options and sharpen what you notice. The past and your present
attention both open doors.

This also follows the focus rule from #1490: focus never makes work faster. It makes you learn
more, make better things, succeed more often, and now **notice and ask** more.

## Decisions (owner, 2026-10-10)

| Question | Decision |
|---|---|
| What can be focused on | Today's goals, skills and concepts, plus **topics**: materials, places, groups, people, quests, and jobs/classes. Skills also count as topics in conversation |
| How noticing works | **Passive.** In a village, while focused, you may notice who's tied to the topic. No hours are spent; the chance rises with Clarity and INT |
| One focus or a separate topic slot | **One focus.** Chasing iron means not studying a concept or practising a skill |
| Where it lands first | **The road's villages:** "Talk" becomes a short conversation |

## What exists today (and what's missing)

- **Talk is one action** (`villages.ts` `talk`, `road.ts` `talk:` branch): 2 hours, and the next
  lore line once trust passes its gate. No choices; the result is a log line. The UI has one
  `💬 TALK` button (`road-view.ts` `personSheet`).
- **Branching dialogue already exists** in encounters and the caravan meeting. Options are gated
  by `Requirement` (skill, talent, stat, tool, kit, marks, stores) through `unmet()`, and the UI
  shows a locked option greyed with its reason. **Nothing gates on focus, knowledge or deeds.**
- **People** have `role`, `people` (one of the 15 Peoples), `culture`, `personality`, `need` and
  trust-gated `lore`. There's **no affiliation and no "knows about"**. Groups (the Compact, the
  Vidde Accords, the Dyprike) exist only in lore text.
- **Iron isn't in the sim.** It's in the data: an `ore` node yielding `iron-ore`/`copper-ore`
  (`public/macro-world/resource-nodes.json`) and the item registry.
- **There are no referrals or rumours.** Deeds are recorded (`region1.ts` `deeds`) but never read.
- **Seeded rolls are per-salt streams** (`rng.ts` `streamFor`), so a new kind of roll (a new salt)
  leaves every existing stream, and every determinism test, unchanged.

## Design

### 1. Topics

`Focus` gains a fourth kind, `topic`, with a topic key `kind:id`:

| Topic kind | Examples | Comes from |
|---|---|---|
| `material` | `material:iron`, `material:copper`, `material:hides` | the item registry / resource nodes; materials the Warden has handled |
| `place` | `place:kestrel-gate`, `place:hollowford`, Reach sites, discoveries | `ROUTE`, `VILLAGES`, `SITES`, `DISCOVERIES` |
| `group` | `group:compact`, `group:vidde-accords`, the 15 Peoples, cultures | a new small registry; Peoples and cultures from their data |
| `person` | `person:kg-sabine` | leads (§5) |
| `quest` | `quest:hf-hides-saltmere` | quests the Warden has taken |
| `role` | `role:smith`, `role:healer`, classes such as artificer | `Role` in `villages.ts`; classes from the guild ranks |

A skill focus (`skill:hunting`) counts as a topic in conversation too.

**Only topics you've come across can be focused on**, the same rule concepts follow (#1478). You
come across a topic by hearing it named in a lore line or an answer, by visiting a place, by
taking a quest, or by meeting someone of that role. That makes listening worth something: a
smith's passing remark about iron opens iron as a focus.

Costs are unchanged: one focus, its Clarity each night, halved below `UNRELIABLE_BELOW`.

### 2. Conversations

Talking to someone opens a short **conversation**:

- **Chat**: today's talk. 2 hours; the next lore line once trust allows; trust grows.
- **Ask about <your focus>**: appears whenever your focus is a topic or a skill. 1 hour. The person:
  - **knows**: an answer (below);
  - **knows someone**: a lead (§5): *"Not me. Orrin at Hollowford works iron."*;
  - **won't say yet**: trust-gated: *"I might. Ask me when you're not a stranger."*;
  - **doesn't know**: *"Never had much to do with iron."* That's still worth knowing.
- Later (slice F), **asks from what happened**: deeds and earlier answers open their own options
  (*"I found the herald's satchel."*). This is the Baldur's Gate side.

An answer can give:
- a lore line, kept in the Warden's knowledge;
- a new topic come across;
- a lead;
- a map pin;
- concept insight;
- a quest offered;
- a pointer to a teacher.

People get optional data: `knows: Record<TopicKey, Answer>` (an answer, its trust gate, its effect)
and `signs: Record<TopicKey, string>` (§3). Nothing changes for a person without them.

Locked asks show greyed with a reason, as encounter options do, so the player sees what trust
or focus would open.

### 3. Noticing (passive)

When you arrive in a village, and each morning you're there, a Warden with a topic focus rolls
once for each person who has a **sign** for that topic:

```
chance = base × reliability(Clarity) + INT bonus      (seeded: salt `notice:<village>:<person>:<topic>`, per day)
```

On a success:
- the journal gets the sign: *"Tobin's ledger has a Compact seal pressed into the cover."*;
- the person's card shows the topic mark;
- your ask to them about it opens one trust gate early (you've shown you know).

**Knowledge sharpens it too.** A topic you've learned about (you've heard an answer about the
Compact) can be noticed at a lower chance even when it isn't your focus: *"a person seems tied
to something you know about"*. Focus makes it likely; knowledge makes it possible.

### 4. Where the gate lives

Extend `Requirement` (encounters.ts) with:
- `focus?: TopicKey` (your current focus is this topic, or covers it);
- `knows?: TopicKey` (you've come across this topic);
- `deed?: string` (slice F).

Village asks use the same `unmet()`. Encounters and the caravan meeting then get focus-, knowledge-
and deed-gated options for free, which is the second place this lands.

### 5. Leads

An answer can point to someone elsewhere. A **lead** is recorded as:
- *who* (a person topic);
- *where* (a village, if known);
- *about what* (the topic);
- *who told you*.

Leads show in the quest log. A lead opens its person as a focus topic: focus on them and you ask
after them in each village. When you meet them, their card says *"the one Orrin mentioned"*, and
their answer on the lead's topic opens without the first trust gate.

### 6. AI players

The AI observation lists the asks open to each person, and the AI can choose them. The bench can
then measure whether focus-driven asking pays (leads followed, quests found, insight gained).

## Rules the build must keep

- **Determinism:** only new salts (`notice:…`). No existing stream changes, and no golden hash moves.
- **Saves:** every new field is optional, with a default. A save from before loads with no
  knowledge, no leads and no noticed marks. A stored topic focus is re-checked on load
  (`readFocus`, #1488).
- **One focus:** a topic focus replaces a work focus. The UI says so.
- **No speed:** nothing here shortens hours (#1490).

## Slices

| Slice | What | Notes |
|---|---|---|
| A | **Topics as a focus**: the `topic` kind, registry, come-across rule, setters and load check, topic chips in the Warden tab | sim + UI; no dialogue yet |
| B | **Village conversations**: talk sheet (Chat + Ask), `Person.knows`, answer effects, trust gates, `Requirement.focus/knows`, AI observation | sim + UI |
| C | **Passive noticing**: `Person.signs`, the seeded roll, card marks, journal lines, knowledge-based noticing | sim + UI |
| D | **Leads**: lead records, person topics, "the one X mentioned", quest-log section | sim + UI |
| E | **First content**: iron, the Compact, smithing, Kestrel Gate, one quest, foraging; answers and signs across the three villages and the travellers, with one lead chain (iron → Orrin at Hollowford → Sabine, the smith at Kestrel Gate) | data + lore |
| F | **The weight of what happened**: deeds and earlier answers open asks; encounters use the same gate | later |

A → B → C/D (either order) → E. E's content can be drafted alongside B, so B ships with
something to say.
