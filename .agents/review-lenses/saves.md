# Lens: saves

Players keep their game in `localStorage` (the Artificer controller,
`src/artificer-app/controller.ts`) and carry a legacy between runs
(`src/artificer/legacy.ts`). A save written by **last week's build** must load
in this one. Look for anything that breaks that:

- A field added to saved state with no default when an older save lacks it
  (`undefined` reaching arithmetic gives `NaN`; reaching `.length` throws).
- A field renamed, removed or retyped without a migration for old saves; an enum
  or id renamed while old saves still hold the old value.
- A version number that should have been bumped, or a migration that runs twice
  or not at all.
- Writes that can leave a half-written save (a crash between two `setItem`
  calls), or a save written before the state it describes is complete.
- `JSON.parse` on stored data without a try/catch, or data from storage trusted
  as if the types guaranteed it.
- Something cleared from storage too early (a draft, a save) so a reload loses it.
