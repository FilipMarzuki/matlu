# Lens: determinism

The Artificer sim (`src/artificer/`), the story engine (`storytelling/`) and
the map generator (`mapgen/`) are **pure and seeded**: the same seed and the
same actions must give the same result, byte for byte, on every machine and
every run. Golden hashes in tests pin that down. Look for anything that breaks it:

- `Math.random()`, `Date.now()`, `new Date()`, `performance.now()` or any other
  unseeded source inside sim code (outside the UI).
- **RNG stream shifts**: a new `rng()` / `streamFor()` draw inserted before
  existing draws, a draw moved into or out of a branch, or a loop whose count
  changed. Each one silently changes every later draw. If a stream changed on
  purpose, the golden hashes must be rebaselined in the same PR — check that.
- Iteration order that isn't fixed: `for...in` over objects whose keys were added
  in data-dependent order, `Set`/`Map` built from unordered input, `Array.sort`
  with a comparator that can return 0 for distinct items, `Object.keys` on
  records filled from JSON.
- Floating-point results used as keys or compared with `===`; accumulated sums
  whose order depends on input order.
- State mutated in place where the code elsewhere treats it as immutable (a pure
  function that changes its argument breaks replays and counterfactual runs).
- Shared module-level state (caches, counters) that leaks between runs.
