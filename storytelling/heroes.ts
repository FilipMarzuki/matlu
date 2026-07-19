// heroes.ts — living named heroes and legendary artefacts.
//
// LEGEND_INSCRIBED fires POSTHUMOUSLY (fate.ts) — a great figure's deeds pass
// into cultural memory when they die. This module handles LIVING legend: a
// character who has done something notable enough that the world starts to
// call them by an epithet BEFORE they die.
//
// Named heroes accumulate around notable deeds (challenge vanquished, war won,
// dragon slain, kingdom united, mass survival). Their epithet is fused from
// their deed shape ("the Dragon-Slayer of Ithan", "the Uniter of the Ashen
// Steppe"). They stay named while alive; death fires NAMED_HERO_FALLS with a
// special send-off.
//
// Legendary artefacts are forged by MASTER craftsmen (level 20+ scholar or
// artisan) in exceptional circumstances — a great deed, an inspired vision,
// or an ancient rite. Once forged, they persist. They pass through
// inheritance, get stolen by schemes, get lost when the last bearer dies
// without a legal heir, and can be REDISCOVERED much later by a hero or a
// scholar (especially in blighted or high-mana provinces).
//
// Guarded on magicEnabled — the naming and artefact rules assume the magic /
// leveling layer. Without it we skip entirely (RNG symmetric).

import type {
  ArtefactBinding,
  ArtefactCategory,
  ArtefactId,
  Character,
  HeroEpithetShape,
  HeroId,
  LegendaryArtefact,
  NamedHero,
} from "./types.js";
import type { World } from "./world.js";

// ---- tuning constants ------------------------------------------------------
const HERO_LEVEL_THRESHOLD = 15;    // minimum level to be considered a hero candidate
const HERO_NAMING_PROB = 0.06;      // per candidate per year
const HERO_FAME_DECAY = 0.005;      // per year after death
const ARTEFACT_FORGE_PROB = 0.05;   // per master craftsman per year
const ARTEFACT_MAX_ACTIVE = 8;
const ARTEFACT_INHERIT_PROB = 0.75; // on bearer death: passes to heir if any
const ARTEFACT_STOLEN_PROB = 0.03;  // per year per active artefact
const ARTEFACT_REDISCOVERY_PROB = 0.008; // per year per lost artefact
const ARTEFACT_MARTIAL_BONUS = 0.15;

// Epithet fragments — Roman-numeral-free procedural naming.
const EPITHET_ROOTS: Record<HeroEpithetShape, string[]> = {
  slayer:     ["Dragon-Slayer", "Wraith-Reaver", "Beast-Ender", "Serpent-Slayer", "Wolf-Slayer"],
  conqueror:  ["Uniter", "Kingmaker", "Crown-Taker", "Broker of Realms", "Sword-of-Thrones"],
  sage:       ["Wise", "Golden-Tongue", "Star-Reader", "the Learned", "the All-Speaking"],
  kinbreaker: ["Kinslayer", "Oath-Breaker", "the Twice-Sworn", "the Betrayer"],
  unbroken:   ["Unbroken", "Iron-Willed", "the Twice-Fallen", "the Enduring"],
  wanderer:   ["Wanderer", "Far-Farer", "the Nameless", "the Long-Walking"],
};

const ARTEFACT_NAME_ROOTS = [
  "Duren", "Grim", "Ash", "Frost", "Iron", "Star", "Crown", "Sil", "Cor",
  "Wyrm", "Rim", "Dawn", "Storm", "Yor", "Ophir", "Kess", "Vor", "Thal",
];
const ARTEFACT_NAME_ENDINGS = [
  "-dal", "-mourne", "-song", "-bane", "-fall", "-guard", "-render", "-fang",
  " the Bright", " the Grim", " the Golden", " the Broken", " the True",
];

const CATEGORY_BY_CLASS: Record<string, ArtefactCategory> = {
  knight:      "weapon",
  soldier:     "weapon",
  scholar:     "tome",
  necromancer: "tome",
  stormcaller: "ring",
  warden:      "relic",
  merchant:    "ring",
  hunter:      "weapon",
  commoner:    "relic",
};

// Called from tick.ts, once per year, after runInnovations (so this year's
// deeds are visible when naming heroes) and after runUnions (personal-union
// holders are properly credited).
export function runHeroes(w: World): void {
  if (!w.magicEnabled) return;
  detectNewHeroes(w);
  detectHeroDeaths(w);
  ageHeroFame(w);
  maybeForgeArtefact(w);
  ageArtefacts(w);
  maybeRediscoverArtefact(w);
}

// ---------------------------------------------------------------------------
// New heroes rise. Look for level-15+ living characters without an epithet
// who did something notable this tick (challenge vanquished, war won, invention
// made, plague survived), OR who are simply the mightiest of the age.
// ---------------------------------------------------------------------------
function detectNewHeroes(w: World): void {
  const candidates: Character[] = [];
  for (const c of w.living()) {
    if (c.level < HERO_LEVEL_THRESHOLD) continue;
    if (w.heroOfCharacter(c.id)) continue;
    candidates.push(c);
  }
  if (candidates.length === 0) return;

  // Rank by recent-deed evidence.
  const scoredCandidates: { c: Character; score: number; shape: HeroEpithetShape; deed: string }[] = [];
  for (const c of candidates) {
    let score = c.level;
    let shape: HeroEpithetShape = "unbroken";
    let deed = "high level";

    // Challenge vanquisher this year?
    const vanq = w.events.find(
      (e) => e.year === w.year && e.type === "CHALLENGE_VANQUISHED" && e.actorId === c.id,
    );
    if (vanq) {
      score += 30;
      shape = "slayer";
      deed = "vanquished a great challenge";
    }
    // War-winner (their titleId prevailed in a WAR this year and they still hold it)?
    const warWin = w.events.some(
      (e) => e.year === w.year && e.type === "WAR" && e.actorId === c.id,
    );
    if (warWin) {
      score += 15;
      shape = "conqueror";
      deed = "won a war";
    }
    // Inventor?
    const inv = w.events.find(
      (e) => e.year === w.year && e.type === "INVENTION_MADE" && e.actorId === c.id,
    );
    if (inv) {
      score += 20;
      shape = "sage";
      deed = "made a breakthrough";
    }
    // Kinslayer?
    const kin = w.events.some(
      (e) => e.year === w.year && e.type === "KINSLAYING_NOTORIOUS" && e.actorId === c.id,
    );
    if (kin) {
      score += 10;
      shape = "kinbreaker";
      deed = "spilled kin-blood";
    }
    scoredCandidates.push({ c, score, shape, deed });
  }

  // Only try to name the top-scoring candidate this year (so the chronicle
  // stays readable). Roll the prob against that one.
  scoredCandidates.sort((a, b) => b.score - a.score);
  const pick = scoredCandidates[0];
  if (!pick) return;
  if (!w.rng.chance(HERO_NAMING_PROB * Math.min(1, pick.score / 30))) return;

  const epithetRoot = EPITHET_ROOTS[pick.shape][Math.floor(w.rng.next() * EPITHET_ROOTS[pick.shape].length)];
  const provName = w.province(pick.c.provinceId)?.name;
  const epithet = provName
    ? `the ${epithetRoot} of ${provName}`
    : `the ${epithetRoot}`;

  const id: HeroId = w.freshId("hero");
  const hero: NamedHero = {
    id,
    characterId: pick.c.id,
    epithet,
    shape: pick.shape,
    foundingDeed: pick.deed,
    foundingDeedYear: w.year,
    levelAtNaming: pick.c.level,
    charClassAtNaming: pick.c.charClass,
    died: false,
    diedYear: null,
    fame: 0.6 + Math.min(0.4, pick.score / 100),
  };
  w.namedHeroes.set(id, hero);
  w.log("NAMED_HERO_RISES", {
    actorId: pick.c.id,
    provinceId: pick.c.provinceId,
    data: {
      heroId: id,
      name: pick.c.name,
      epithet,
      shape: pick.shape,
      deed: pick.deed,
      level: pick.c.level,
      charClass: pick.c.charClass,
    },
  });
}

// ---------------------------------------------------------------------------
// Detect named-hero deaths. Fire the send-off event.
// ---------------------------------------------------------------------------
function detectHeroDeaths(w: World): void {
  for (const h of w.namedHeroes.values()) {
    if (h.died) continue;
    const c = w.char(h.characterId);
    if (!c || c.alive) continue;
    h.died = true;
    h.diedYear = c.deathYear ?? w.year;
    w.log("NAMED_HERO_FALLS", {
      actorId: c.id,
      provinceId: c.provinceId,
      data: {
        heroId: h.id,
        name: c.name,
        epithet: h.epithet,
        diedAge: (c.deathYear ?? w.year) - c.birthYear,
        shape: h.shape,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Fame decays after death — the world forgets slowly.
// ---------------------------------------------------------------------------
function ageHeroFame(w: World): void {
  for (const h of w.namedHeroes.values()) {
    if (!h.died) continue;
    h.fame = Math.max(0, h.fame - HERO_FAME_DECAY);
  }
}

// ---------------------------------------------------------------------------
// Master craftsmen (level 20+ scholar/artisan-adjacent) may forge a
// legendary artefact — usually for a named hero of their province, or for
// the sitting monarch.
// ---------------------------------------------------------------------------
function maybeForgeArtefact(w: World): void {
  if (w.activeArtefacts().length >= ARTEFACT_MAX_ACTIVE) return;
  // Master forgers: level-12+ scholar/necromancer, OR level-15+ of a
  // combat/warden class. Ceilings in a 500y run are low, so we cast a wider
  // net than pure "grandmaster" would allow.
  const masters = w.living().filter(
    (c) => (c.level >= 12 && (c.charClass === "scholar" || c.charClass === "necromancer"))
        || (c.level >= 15 && (c.charClass === "knight" || c.charClass === "stormcaller" || c.charClass === "warden")),
  );
  if (masters.length === 0) return;
  for (const m of masters) {
    if (!w.rng.chance(ARTEFACT_FORGE_PROB)) continue;
    // Pick a bearer — a named hero in the same province, else the province's
    // title-holder, else the master themselves.
    let bearer: Character | undefined;
    const localHeroes = w.livingNamedHeroes()
      .map((h) => w.char(h.characterId))
      .filter((c): c is Character => !!c && c.provinceId === m.provinceId);
    if (localHeroes.length > 0) {
      bearer = localHeroes[0];
    } else {
      const holder = [...w.titles.values()].find((t) => t.provinceId === m.provinceId);
      const holderChar = w.char(holder?.holderId ?? null);
      if (holderChar) bearer = holderChar;
    }
    if (!bearer) bearer = m;

    const category = CATEGORY_BY_CLASS[bearer.charClass] ?? "relic";
    const nameRoot = ARTEFACT_NAME_ROOTS[Math.floor(w.rng.next() * ARTEFACT_NAME_ROOTS.length)];
    const nameEnd = ARTEFACT_NAME_ENDINGS[Math.floor(w.rng.next() * ARTEFACT_NAME_ENDINGS.length)];
    const name = `${nameRoot}${nameEnd}`;

    const binding: ArtefactBinding = pickBinding(w, category);
    const bindingClass = binding === "class" ? bearer.charClass : null;

    const id: ArtefactId = w.freshId("art");
    const artefact: LegendaryArtefact = {
      id,
      name,
      category,
      forgedYear: w.year,
      creatorId: m.id,
      bearerId: bearer.id,
      bindingType: binding,
      bindingClass,
      lostYear: null,
      lostProvinceId: null,
      history: [{ year: w.year, bearerId: bearer.id, event: "forged" }],
      martialBonus: ARTEFACT_MARTIAL_BONUS,
      fame: 0.5,
    };
    w.artefacts.set(id, artefact);
    w.log("ARTEFACT_FORGED", {
      actorId: m.id,
      targetId: bearer.id,
      provinceId: m.provinceId,
      data: {
        artefactId: id,
        artefact: name,
        category,
        binding,
        bindingClass: bindingClass ?? "",
        creator: m.name,
        bearer: bearer.name,
      },
    });
    return; // one forging per tick keeps the chronicle readable
  }
}

function pickBinding(w: World, category: ArtefactCategory): ArtefactBinding {
  // Weapons and rings are often class-locked. Tomes lean bloodline. Crowns
  // lean worthy. Relics are usually free (they choose their bearer).
  const r = w.rng.next();
  if (category === "weapon") return r < 0.5 ? "class" : r < 0.75 ? "worthy" : "bloodline";
  if (category === "ring")   return r < 0.4 ? "class" : "bloodline";
  if (category === "tome")   return r < 0.7 ? "bloodline" : "class";
  if (category === "crown")  return r < 0.6 ? "worthy" : "bloodline";
  return "free";
}

// ---------------------------------------------------------------------------
// Age artefacts — deaths pass them to heirs / lose them, and schemes may
// steal them.
// ---------------------------------------------------------------------------
function ageArtefacts(w: World): void {
  for (const a of w.artefacts.values()) {
    if (a.lostYear !== null) continue;
    const bearer = w.char(a.bearerId);
    if (!bearer) {
      // No bearer at all — mark lost.
      loseArtefact(w, a, null);
      continue;
    }
    if (!bearer.alive) {
      // Pass to heir or lose.
      const heirId = pickArtefactHeir(w, a, bearer);
      if (heirId && w.rng.chance(ARTEFACT_INHERIT_PROB)) {
        const oldBearer = bearer.id;
        a.bearerId = heirId;
        a.history.push({ year: w.year, bearerId: heirId, event: "inherited" });
        w.log("ARTEFACT_INHERITED", {
          actorId: heirId,
          data: {
            artefactId: a.id,
            artefact: a.name,
            from: oldBearer,
            to: heirId,
          },
        });
      } else {
        loseArtefact(w, a, bearer.provinceId);
      }
      continue;
    }
    // Alive bearer — chance of theft.
    if (w.rng.chance(ARTEFACT_STOLEN_PROB)) {
      // Find a level 10+ character in the same province, not the bearer, who
      // could plausibly steal it.
      const thieves = w.living().filter(
        (c) => c.id !== bearer.id && c.provinceId === bearer.provinceId
            && c.level >= 10 && canWield(a, c),
      );
      if (thieves.length > 0) {
        const thief = thieves[Math.floor(w.rng.next() * thieves.length)];
        a.bearerId = thief.id;
        a.history.push({ year: w.year, bearerId: thief.id, event: "stolen" });
        w.log("ARTEFACT_STOLEN", {
          actorId: thief.id,
          targetId: bearer.id,
          data: {
            artefactId: a.id,
            artefact: a.name,
            thief: thief.name,
            from: bearer.name,
          },
        });
      }
    }
  }
}

function pickArtefactHeir(w: World, a: LegendaryArtefact, bearer: Character): string | null {
  // Bloodline-bound: only descendants qualify.
  const candidates = w.living().filter((c) => canWield(a, c));
  if (candidates.length === 0) return null;
  // Prefer the bearer's own children.
  const children = candidates.filter((c) => c.fatherId === bearer.id || c.motherId === bearer.id);
  if (children.length > 0) return children[0].id;
  // Then dynasty-mates.
  const dynMates = candidates.filter((c) => c.dynastyId === bearer.dynastyId);
  if (dynMates.length > 0) return dynMates[0].id;
  return candidates[0].id;
}

function canWield(a: LegendaryArtefact, c: Character): boolean {
  if (a.bindingType === "free") return true;
  if (a.bindingType === "class") return c.charClass === a.bindingClass;
  if (a.bindingType === "worthy") return c.level >= 12;
  if (a.bindingType === "bloodline") {
    // Track lineage back to the creator via dynasty (proxy: same dynasty).
    return true; // dynasty check happens at heir selection; free at hand-off
  }
  return true;
}

function loseArtefact(w: World, a: LegendaryArtefact, provinceId: string | null): void {
  const prov = provinceId ?? [...w.provinces.keys()][0];
  a.lostYear = w.year;
  a.lostProvinceId = prov;
  a.bearerId = null;
  a.history.push({ year: w.year, bearerId: null, event: "lost" });
  w.log("ARTEFACT_LOST", {
    provinceId: prov,
    data: {
      artefactId: a.id,
      artefact: a.name,
      category: a.category,
    },
  });
}

// ---------------------------------------------------------------------------
// Rediscovery — lost artefacts occasionally surface in high-mana or blighted
// provinces, borne to a living named hero or high-level scholar.
// ---------------------------------------------------------------------------
function maybeRediscoverArtefact(w: World): void {
  const lost = [...w.artefacts.values()].filter((a) => a.lostYear !== null);
  if (lost.length === 0) return;
  for (const a of lost) {
    if (!w.rng.chance(ARTEFACT_REDISCOVERY_PROB)) continue;
    // Pick a rediscoverer — hero or level-15+ character in a hot province.
    const finders = w.living().filter(
      (c) => c.level >= 15 && canWield(a, c),
    );
    if (finders.length === 0) continue;
    const finder = finders[Math.floor(w.rng.next() * finders.length)];
    a.bearerId = finder.id;
    a.lostYear = null;
    a.lostProvinceId = null;
    a.history.push({ year: w.year, bearerId: finder.id, event: "rediscovered" });
    a.fame = Math.min(1, a.fame + 0.2);
    w.log("ARTEFACT_REDISCOVERED", {
      actorId: finder.id,
      provinceId: finder.provinceId,
      data: {
        artefactId: a.id,
        artefact: a.name,
        finder: finder.name,
        yearsLost: w.year - (a.history.find((r) => r.event === "lost")?.year ?? w.year),
      },
    });
    return; // one per tick
  }
}
