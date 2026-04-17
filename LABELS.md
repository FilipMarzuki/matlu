# Label Convention & Tagging Guidelines

Standard labeling system for Fills Pills / Matlu. All issues — whether created manually or by the nightly Claude agent — should follow this convention.

---

## Label Set

### Type — what kind of work is this?

| Label | When to use |
| -- | -- |
| `feature` | New functionality being added |
| `bug` | Something is broken and needs fixing |
| `chore` | Routine maintenance, dependency updates, cleanup |
| `exploration` | Design spike or open-ended research, not yet committed to implementation |
| `refactor` | Code restructuring without changing functionality |

### Domain — what area of the game does this touch?

| Label | When to use |
| -- | -- |
| `art` | Visual assets, animation, pixel art, art direction |
| `audio` | Music, ambient sound, audio systems |
| `systems` | Game mechanics, systems architecture, core logic |
| `lore` | World-building, narrative, design philosophy |
| `infrastructure` | Tooling, CI/CD, deployment, error tracking, dev environment |

### Effort / Status — how does this issue relate to flow?

| Label | When to use |
| -- | -- |
| `quick-win` | Small, self-contained task that can be done quickly |
| `blocked` | Cannot proceed — waiting on a decision, asset, or dependency |

---

## Rules

1. **Every issue gets at least one Type label** — feature, bug, chore, exploration, or refactor
2. **Add a Domain label when relevant** — not every issue needs one, but most do
3. **Don't duplicate Linear's built-in fields** — use priority field for urgency, state for workflow, due date for deadlines. Don't create labels for these.
4. **Max ~3 labels per issue** — if you need more, the issue is probably too broad
5. `exploration` issues become `feature` issues — once a design spike concludes and implementation is decided, create a new feature issue and link it
6. `blocked` is transient — remove it once the blocker is resolved
7. **Don't create new labels without documenting them here** — keep the set stable and small

---

## For the Claude Agent

When creating issues autonomously, apply labels as follows:

- Implementation tasks → `feature` + relevant domain
- Bug reports from Better Stack → `bug` + relevant domain
- Dependency/config updates → `chore` + `infrastructure`
- Design questions without clear implementation → `exploration`
- Code cleanup without new behavior → `refactor`
- Anything waiting on art or design decisions → `blocked`

---

## Agent workflow labels (separate system)

These are managed by the triage and implementation agents — do not apply them manually:

| Label | Applied by | Meaning |
| ----- | ---------- | ------- |
| `ready` | Triage agent | Agent can pick this up in the nightly run |
| `needs-refinement` | Triage agent | Close but missing specifics; description has been edited |
| `too-large` | Triage agent | Needs to be split into 2+ smaller issues |
| `rework` | Triage agent | Fixes/reverts/polishes something recently shipped |
| `agent:success` | Implementation agent | PR is ready for review |
| `agent:partial` | Implementation agent | Partial progress; blocked or incomplete |
| `agent:failed` | Implementation agent | Unable to make progress |
| `agent:wrong-interpretation` | Implementation agent | Issue was ambiguous or misread |
