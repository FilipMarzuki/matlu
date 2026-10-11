# The Class registry

Mistheim's Classes are listed in **`src/artificer/content/classes.json`** (#1637). It's master canon. WORLD.md says what a Class means to the people who hold it. The registry is the list that says which Classes exist, who holds them and where each one comes from. `src/artificer/classes.ts` types the list, and `src/artificer/classes.test.ts` checks it against WORLD.md.

## Adding a Class (lore agents)

Add the Class to the registry **first**, then write it into WORLD.md or anywhere else.

1. Look it up. Search `classes.json` for the name, its plural and anything close to it (`classByName` in `classes.ts` does it in code). If an entry already covers it, use that entry. If a different People holds it, add that People to the entry's `peoples`.
2. Add an entry. Copy one from `classes.json` and fill in:
   - `id`: kebab-case, made from the name.
   - `name`: the singular, exactly as you'll bracket it.
   - `kind`: one of `craft`, `field`, `trade`, `office`, `martial`, `lore`, `mystic` or `art` (see `CLASS_KINDS`).
   - `peoples`: ids from `content/peoples-lore.json`. Add `widespread: true` when anyone can hold it.
   - `source`: `WORLD.md § <heading>`, the heading it's written under.
   - `invented` and `canonised`: the dates it was made up and made canon (`YYYY-MM-DD`). Add `issue` too.
   - Optional: `forms`, `variantOf`, `levels`, `notes`.
3. If the Class isn't in WORLD.md yet, cite where it was invented (`file › label`). The entry then needs an `invented` date.
4. Run `npx vitest run src/artificer/classes.test.ts`.

The owner is "fine to invent classes". Inventing one is allowed. Writing it into canon without an entry is not.

## What counts as a Class

A Class is a capitalised `[bracketed]` word in WORLD.md prose. The test reads Classes by that rule (`worldClassNames`):

- Brackets inside code blocks don't count. Those are Runescript's syntax placeholders (`[VERB-RUNE]`, `[condition]`).
- `[Classes]`, the name of the system, doesn't count.
- A bracket split across two lines is joined back into one word.
- WORLD.md writes Skills without brackets ("the Sanctuary Skill"), so every other capitalised bracket is a Class. The system talks about levels and Skills *in* a Class. The "Representative Classes:" line in each People's section is the main place Classes are named, but not the only one.

Some names are spellings of a Class that already has an entry. These don't get entries of their own:

- the plural (`name + s`, e.g. `[Keepers]`);
- an irregular plural or a gendered spelling, listed in `forms` (`[Liches]`, `[Craftspeople]`, `[Fisherwoman]`);
- a People's name in front, also listed in `forms`. WORLD.md says "a [Goblin Chef] and a [Human Chef] learn from the same system", so `[Golem Guardian]` is a [Guardian].

A narrower Class built on another one *does* get its own entry, linked with `variantOf`. Examples are [Steppe Scout] and [Canopy Scout] (on [Scout]) and [Herald-of-Holding] (on [Herald]). Entries in different Peoples' lists count as one Class when the name is the same. For example, [Keeper] is one entry held by six Peoples. A different name means a different Class: [Structural Keeper] keeps buildings and has nothing to do with [Keeper].

The test fails in four cases:

- WORLD.md brackets a Class that the registry doesn't have.
- An entry cites a heading or file that doesn't exist.
- Two entries answer to the same name.
- An entry that isn't in WORLD.md has no `invented` date.

## The story engine's classes

`storytelling/` has its own nine classes (`CharClass` in `storytelling/types.ts`; `magic.ts` gates and levels them). **They stay separate.** They're simulation archetypes for a generic chronicle generator, and they're tied to its RNG stream and golden hashes. Renaming them, or making the engine read the registry, would change its output.

The registry records how the two lists line up in `storyEngine`:

- `soldier`, `hunter`, `knight`, `scholar` and `merchant` map to the registry's entries with the same names.
- `commoner` maps to `null`. It means the engine hasn't given that character a Class yet.
- `warden`, `stormcaller` and `necromancer` map to `null`. These are the engine's rare rite-classes, and canon has no matching Class. [Grove-Warden], [Hedge-Warden] and [Lich] are different Classes.

The engine doesn't read this mapping. The test only makes sure that every `CharClass` appears in it, so a new engine class has to be mapped or marked engine-only.
