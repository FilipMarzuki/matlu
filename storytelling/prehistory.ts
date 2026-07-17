// prehistory.ts — cheaply manufacture a deep-past saga BEFORE the full sim.
//
// The full simulation is expensive per year, and it starts from a blank seed.
// A world with no past feels shallow. So instead of full-simulating millennia,
// we AUTHOR a compact procedural skeleton of the deep past — a founding, a
// golden age, lost arts, a cataclysm, the fall of the old realms, and the
// migrations that brought the present peoples — as a handful of LEGEND events
// stamped across the ancient years. O(1), deterministic (seeded).
//
// Its real output, though, is RESIDUE in the starting world: ancestral grudges
// along the ancient fault lines, so the opening generation is already freighted
// with old enmity. The temporal-LOD renderer shows the LEGEND events as "Ages
// of Legend"; the residue makes the present feel like it has a past.

import type { World } from "./world.js";

const REALMS = [
  "the Verdant Court",
  "the First Khaganate",
  "the Sunlit Dominion",
  "the Drowned Kingdom",
  "the Elderspire",
  "the Ashen Throne",
];
const FIGURES = [
  "Ozkar the Uniter",
  "Saelith the Radiant",
  "the Widow-Queen Maerith",
  "Vharun the Undying",
  "Coranth Sky-Sundered",
  "Ildis of the Thousand Halls",
];
const ARTS = [
  "star-reading",
  "stone-singing",
  "the greater healing",
  "dragon-binding",
  "the deep sorceries",
  "god-speech",
];
const CATACLYSMS = [
  "the Sundering",
  "the Long Night",
  "the Drowning of the West",
  "the Ashfall",
  "the Breaking of the Sky",
];

// Generate the deep past on `w`, which is at its start year with no events yet.
// `span` is how many years of prehistory to reach back over.
export function generatePrehistory(w: World, span = 800): void {
  const startYear = w.year;
  const rng = w.rng;

  const realm = rng.pick(REALMS);
  const foe = rng.pick(REALMS.filter((r) => r !== realm));
  const figure = rng.pick(FIGURES);
  const art = rng.pick(ARTS);
  const cataclysm = rng.pick(CATACLYSMS);

  // Fraction of the span → absolute ancient year.
  const at = (frac: number) => Math.round(startYear - span + frac * span);
  // Stamp a LEGEND event at an ancient year (log() uses w.year, so we move it).
  const legend = (frac: number, kind: string, data: Record<string, string> = {}) => {
    w.year = at(frac);
    w.log("LEGEND", { data: { legend: kind, ...data } });
  };

  // The Great Vanishing — the oldest event a chronicler can name. Fires
  // BEFORE the legend sequence so the event log stays monotonic in year.
  // Logical yearsAgo is [500, 2000] per the design; the actual logged year
  // is pushed back to at least `span + 1` years so this event precedes every
  // legend() call (whose years live within [startYear-span, startYear]).
  if (w.magicEnabled) {
    const targetYearsAgo = Math.round(500 + rng.next() * 1500);
    const yearsAgo = Math.max(targetYearsAgo, span + 1);
    const vanishingYear = startYear - yearsAgo;
    w.year = vanishingYear;
    w.godsVanishedYear = vanishingYear;
    w.log("GREAT_VANISHING", { data: { yearsAgo, realm, cataclysm } });
  }

  legend(0.02, "found", { figure, realm });
  legend(0.18, "golden", { realm, art });
  legend(0.34, "height", { realm });
  legend(0.5, "war", { realm, foe });
  const cataclysmYear = at(0.62);
  legend(0.62, "cataclysm", { cataclysm, realm, art });
  legend(0.7, "fall", { realm });

  // Migrations — tie the present peoples to the deep past (only if the world
  // defines cultures; the default tableau has none and simply skips these).
  let frac = 0.78;
  for (const c of [...w.cultures.values()].slice(0, 5)) {
    legend(frac, "migration", { people: c.name });
    frac += 0.035;
  }

  legend(0.97, "dawn", {});

  // Restore the clock to the present, ready for the full simulation.
  w.year = startYear;

  seedAncestralGrudges(w, cataclysm, cataclysmYear);
}

// Residue: the great houses of hostile peoples begin already at odds, "since the
// cataclysm". Uses the peoples layer's own hostility (race affinity + faith),
// so nothing fires for a world without races/faiths (e.g. the default tableau).
function seedAncestralGrudges(w: World, cataclysm: string, since: number): void {
  const lords = [...w.characters.values()].filter(
    (c) => c.alive && w.titlesHeldBy(c.id).some((t) => t.tier === "kingdom" || t.tier === "duchy"),
  );
  for (let i = 0; i < lords.length; i++) {
    for (let j = i + 1; j < lords.length; j++) {
      const a = lords[i];
      const b = lords[j];
      // Only genuinely hostile peoples (a strong negative standing modifier).
      if (w.peoplesModifier(a, b) > -20) continue;
      const reason = `ancestral enmity since ${cataclysm}`;
      a.grudges.push({ targetId: b.id, reason, year: since });
      b.grudges.push({ targetId: a.id, reason, year: since });
      w.adjustOpinion(a, b.id, -30);
      w.adjustOpinion(b, a.id, -30);
    }
  }
}
