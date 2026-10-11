# Label Convention & Tagging Guidelines

Standard labelling system for Matlu / Core Warden. All issues — whether created
by hand, from an issue template, or by an agent — follow this convention.

The canonical list lives in `.github/scripts/create-labels.js`; run it to
create every label idempotently. If a label isn't in that script and in this
file, it doesn't exist.

---

## Label set

### Type — what kind of work is this? (exactly one per issue)

| Label | When to use |
| -- | -- |
| `type:feature` | New functionality being added |
| `type:bug` | Something is broken and needs fixing |
| `type:refactor` | Code restructuring without changing behaviour |
| `type:perf` | Performance work |
| `type:infra` | Tooling, CI/CD, workflows, agent prompts, dev environment |
| `type:docs` | Documentation, templates, issue/PR text |
| `type:spike` | Open-ended research or a design spike, not yet committed to implementation |

### Category — what area does this touch? (at least one per issue)

| Label | When to use |
| -- | -- |
| `systems` | Game mechanics, simulation, core logic (inventory, crafting, settlement generation…) |
| `art` | Visual assets, animation, pixel art, art direction |
| `lore` | World-building, narrative, design philosophy |
| `infrastructure` | Tooling, CI/CD, deployment, error tracking, agents |
| `world` | Terrain, biomes, map generation, settlements as placed in the world |
| `hero` | The player character: movement, stats, abilities |
| `tech` | Engine-level or cross-cutting technical work |
| `ui-hud` | In-game HUD elements |
| `ui-menus` | Menus, overlays, forge/editor screens |
| `audio` | Music, ambient sound, audio systems |
| `weapons` | Weapons and attacks |
| `enemies` | Enemy types and behaviour |
| `waves` | Wave / encounter pacing |
| `upgrades` | Upgrade and progression systems |
| `parts` | Modular parts and loadouts |
| `mobile` | Touch controls, tablet layout, PWA/Capacitor |

### Readiness — can an agent pick this up? (applied by triage)

| Label | Meaning |
| -- | -- |
| `ready` | The nightly implementation agent can take it: clear criteria, known files, no open design decisions |
| `needs-refinement` | Close, but missing specifics; triage has edited the description or asked a question |
| `blocked` | Hard dependency on another issue, a decision, an asset, or missing infrastructure |
| `too-large` | Needs splitting into 2+ smaller issues |

### State

| Label | Meaning |
| -- | -- |
| `in-progress` | Actively being implemented (an agent run has claimed it) |

### Outcome — applied by the implementation agent after a run

| Label | Meaning |
| -- | -- |
| `agent:success` | PR opened and ready for review |
| `agent:partial` | Partial progress; blocked or incomplete, explained in a comment |
| `agent:failed` | Unable to make progress; explained in a comment |
| `agent:wrong-interpretation` | The issue was ambiguous or misread; explained in a comment |
| `agent:already-shipped` | The feature was already on `main`; issue closed without a PR |

`agent-silence-alert` is used by the heartbeat workflow to flag that the
nightly agent hasn't run; it's not a work label.

### Triage extras

The triage agent (`.agents/triage.md`) also applies two label families that
carry information rather than drive the queue:

| Label | Meaning |
| -- | -- |
| `rework` | Fixes, reverts or polishes something shipped recently; tracked as a weekly metric |
| `size:XS` … `size:XL` | Effort estimate (XS = 1, S = 2, M = 3, L = 5, XL = 8) |

---

## Rules

1. **Exactly one `type:*` label per issue.** The issue templates set it; the triage agent adds one if it's missing.
2. **At least one category label per issue.**
3. **Readiness, state and outcome labels are the agents'.** Set `ready` by hand only when you've checked the issue meets the readiness criteria in `.agents/triage.md`; never set `agent:*` by hand.
4. **`blocked` is transient** — remove it once the blocker is resolved.
5. **`type:spike` issues become `type:feature` issues** — once a spike concludes and implementation is decided, open a new feature issue and link it.
6. **Keep it to ~3–4 labels per issue** (type + category + readiness + maybe size). If you need more, the issue is probably too broad.
7. **Don't create new labels without adding them to `create-labels.js` and this file.** Keep the set stable and small.

### Acceptance criteria and the test-first split

Which labels an issue carries decides how its acceptance criteria are written
and checked (see `CLAUDE.md` → Task management):

- `systems` **without** `art`, `ui-hud`, `ui-menus` or `world` → **test-first.** Criteria are Given/When/Then scenarios, each checkable by a unit test; the dev agent writes failing tests before implementing. Use the **Systems (ATDD)** issue template.
- Anything with `art`, `ui-hud`, `ui-menus` or `world` → **exempt.** Acceptance is a screenshot or checklist. Use the **Visual / exploration** template.

---

## For agents creating issues

- Implementation tasks → `type:feature` + the relevant category
- Bug reports (e.g. from the Better Stack monitor) → `type:bug` + the relevant category
- Dependency / config / workflow updates → `type:infra` + `infrastructure`
- Docs, templates, prompt text → `type:docs` (+ `infrastructure` when it's agent tooling)
- Design questions without a clear implementation → `type:spike`
- Cleanup without behaviour change → `type:refactor`
- Anything waiting on art or a design decision → add `blocked`
