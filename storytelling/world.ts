// world.ts — the live state container plus the query helpers every system uses.
//
// The World holds all canonical state in plain maps/arrays. Systems (goals,
// schemes, inheritance, phenomena) mutate it through these helpers so the
// bookkeeping (event ids, child links, opinion defaults) stays in one place.

import { RNG } from "./rng.js";
import type {
  CatastropheQueueItem,
  Challenge,
  Character,
  CharId,
  CultureState,
  Dynasty,
  DynastyId,
  EventType,
  Goal,
  Invention,
  InventionId,
  Province,
  ProvinceId,
  Scheme,
  Title,
  TitleId,
  Treaty,
  WorldEvent,
} from "./types.js";
import type { CultureSpec, FaithSpec, RaceSpec } from "./world-spec.js";

export class World {
  year = 0;
  rng: RNG;

  // When true, the magic/leveling layer (magic.ts) runs each tick and personal
  // combat prowess feeds into power(). Off by default so the base sim is
  // unchanged and the two chronicles can be diffed.
  magicEnabled = false;

  // When true, the world catastrophe layer (catastrophe.ts) draws from the
  // event deck each year and fires chain events that mutate province state.
  // Off by default so base golden-master hashes are unaffected.
  catastrophesEnabled = false;

  // Pending chain steps from in-progress catastrophe events.
  catastropheQueue: CatastropheQueueItem[] = [];

  // Discrete challenges (dragons, wraith hosts, abyssal gates) that named
  // characters can attempt for XP + class/skill unlocks. Only populated when
  // magicEnabled (challenges.ts is a no-op otherwise).
  challenges = new Map<string, Challenge>();

  // Codified craft-secrets — procedurally created by INVENTION_MADE, protected
  // by guilds, leaked over time, potentially lost. Only populated when
  // magicEnabled (innovation.ts guards on that flag for RNG symmetry).
  inventions = new Map<InventionId, Invention>();

  characters = new Map<CharId, Character>();
  dynasties = new Map<DynastyId, Dynasty>();
  provinces = new Map<ProvinceId, Province>();
  titles = new Map<TitleId, Title>();

  // Peoples layer (populated from the WorldSpec; empty in the default world).
  cultures = new Map<string, CultureSpec>();
  races = new Map<string, RaceSpec>();
  faiths = new Map<string, FaithSpec>();

  // Live mutable overlay for each culture — traits, pressure, aesthetic drift.
  // Lazily initialised by cultureState(); only populated when cultures exist.
  liveCultures = new Map<string, CultureState>();

  goals: Goal[] = [];
  schemes: Scheme[] = [];
  treaties: Treaty[] = [];
  events: WorldEvent[] = [];

  private nextEventId = 1;
  private nextEntityId = 1;

  constructor(seed: number) {
    this.rng = new RNG(seed);
  }

  // A monotonic id source for generated characters, goals, schemes, etc.
  freshId(prefix: string): string {
    return `${prefix}${this.nextEntityId++}`;
  }

  // ---- logging -----------------------------------------------------------
  // Every system funnels through here so the event log is the single trace of
  // history. Significance is set later by the sifter, hence the 0 default.
  log(
    type: EventType,
    fields: Partial<Omit<WorldEvent, "id" | "year" | "type" | "significance">> = {},
  ): WorldEvent {
    const ev: WorldEvent = {
      id: this.nextEventId++,
      year: this.year,
      type,
      actorId: fields.actorId ?? null,
      targetId: fields.targetId ?? null,
      titleId: fields.titleId ?? null,
      provinceId: fields.provinceId ?? null,
      data: fields.data ?? {},
      significance: 0,
    };
    this.events.push(ev);
    return ev;
  }

  // ---- basic getters -----------------------------------------------------
  char(id: CharId | null): Character | undefined {
    return id ? this.characters.get(id) : undefined;
  }
  dynasty(id: DynastyId): Dynasty | undefined {
    return this.dynasties.get(id);
  }
  province(id: ProvinceId): Province | undefined {
    return this.provinces.get(id);
  }
  title(id: TitleId | null): Title | undefined {
    return id ? this.titles.get(id) : undefined;
  }

  // ---- collections -------------------------------------------------------
  living(): Character[] {
    const out: Character[] = [];
    for (const c of this.characters.values()) if (c.alive) out.push(c);
    return out;
  }

  // Adults are eligible for goals, marriage, and scheming.
  adults(): Character[] {
    return this.living().filter((c) => this.age(c) >= 16);
  }

  age(c: Character): number {
    return this.year - c.birthYear;
  }

  // Living members of a dynasty, eldest first — used by seniority succession
  // and for detecting dynasty extinction.
  dynastyMembers(id: DynastyId): Character[] {
    return this.living()
      .filter((c) => c.dynastyId === id)
      .sort((a, b) => a.birthYear - b.birthYear);
  }

  // Direct legitimate children, eldest first. Bastardy isn't modelled in v1,
  // so "legitimate" just means a recorded child.
  children(c: Character): Character[] {
    return c.childrenIds
      .map((id) => this.characters.get(id))
      .filter((k): k is Character => !!k)
      .sort((a, b) => a.birthYear - b.birthYear);
  }

  livingChildren(c: Character): Character[] {
    return this.children(c).filter((k) => k.alive);
  }

  titlesHeldBy(id: CharId): Title[] {
    const out: Title[] = [];
    for (const t of this.titles.values()) if (t.holderId === id) out.push(t);
    return out;
  }

  // ---- inventions --------------------------------------------------------
  // Every dynasty knows every invention in its spreadTo set. Query cheap; the
  // set is at most a few dozen dynasties in a fully-diffused breakthrough.
  dynastyKnows(dynId: DynastyId, inv: Invention): boolean {
    return inv.inventorDynastyId === dynId || inv.spreadTo.includes(dynId);
  }

  activeInventions(): Invention[] {
    const out: Invention[] = [];
    for (const inv of this.inventions.values()) if (!inv.lost) out.push(inv);
    return out;
  }

  // Living characters whose dynasty knows this invention. Used by innovation.ts
  // to decide when an invention becomes LOST (empty carrier chain).
  livingBearersOf(inv: Invention): Character[] {
    const carriers = new Set<DynastyId>([inv.inventorDynastyId, ...inv.spreadTo]);
    const out: Character[] = [];
    for (const c of this.characters.values()) if (c.alive && carriers.has(c.dynastyId)) out.push(c);
    return out;
  }

  // All active inventions currently known to a dynasty. Used by the benefits
  // pass in innovation.ts to sum up bonuses when accruing wealth / resolving
  // wars / handling plague.
  inventionsKnownBy(dynId: DynastyId): Invention[] {
    const out: Invention[] = [];
    for (const inv of this.inventions.values()) {
      if (!inv.lost && this.dynastyKnows(dynId, inv)) out.push(inv);
    }
    return out;
  }

  // ---- peoples -----------------------------------------------------------
  cultureOf(c: Character): CultureSpec | undefined {
    const id = this.dynasty(c.dynastyId)?.cultureId;
    return id ? this.cultures.get(id) : undefined;
  }
  raceIdOf(c: Character): string {
    return this.dynasty(c.dynastyId)?.raceId ?? "";
  }
  faithIdOf(c: Character): string {
    return this.dynasty(c.dynastyId)?.faithId ?? "";
  }

  // Lazily creates the live culture state for a cultureId. Callers can mutate
  // the returned object; the map holds the reference.
  cultureState(id: string): CultureState {
    let s = this.liveCultures.get(id);
    if (!s) {
      s = {
        cultureId: id,
        elitePressure: {},
        folkPressure: {},
        eliteTraits: new Set(),
        folkTraits: new Set(),
        contested: {},
        stratification: 0.3,
        legacySeeds: {},
        contactYears: {},
        activeRifts: new Set(),
        aesthetic: { linguisticShift: null, fashionStyle: null },
        establishedFigureId: null,
        establishedSince: 0,
        figureQuirks: {},
      };
      this.liveCultures.set(id, s);
    }
    return s;
  }

  // The standing opinion modifier between two peoples: race affinity + faith
  // hostility. Zero when the world defines no races/faiths, so the default
  // world is unaffected. This is what makes orc/human and cross-faith tension
  // mechanical rather than merely flavour.
  peoplesModifier(a: Character, b: Character): number {
    let m = 0;
    const ra = this.raceIdOf(a), rb = this.raceIdOf(b);
    if (ra && rb && ra !== rb) {
      m += this.races.get(ra)?.affinities?.[rb] ?? 0;
    }
    const fa = this.faithIdOf(a), fb = this.faithIdOf(b);
    if (fa && fb && fa !== fb) {
      const hostile =
        this.faiths.get(fa)?.hostileTo?.includes(fb) ||
        this.faiths.get(fb)?.hostileTo?.includes(fa);
      if (hostile) m -= 25;
    }
    return m;
  }

  // ---- opinion -----------------------------------------------------------
  // Opinion is lazily defaulted. Dynasty kin start a little warmer; members of
  // hostile races/faiths start colder. A query, so callers never special-case
  // missing keys.
  opinionOf(a: Character, bId: CharId): number {
    if (a.opinion[bId] !== undefined) return a.opinion[bId];
    const b = this.char(bId);
    let base = b && b.dynastyId === a.dynastyId ? 15 : 0;
    if (b) base += this.peoplesModifier(a, b);
    base = Math.max(-100, Math.min(100, base));
    a.opinion[bId] = base;
    return base;
  }

  adjustOpinion(a: Character, bId: CharId, delta: number): void {
    const cur = this.opinionOf(a, bId);
    a.opinion[bId] = Math.max(-100, Math.min(100, cur + delta));
  }

  // ---- power -------------------------------------------------------------
  // A character's "power" is the levy + wealth their lands can raise, derived
  // straight from geography. Carrying capacity caps population caps levy, so
  // scarcity and conquest both flow into political strength here.
  power(c: Character): number {
    let p = 0;
    for (const t of this.titlesHeldBy(c.id)) {
      const prov = this.province(t.provinceId);
      if (prov) p += prov.population;
      // Higher tiers project authority beyond their own seat.
      p += t.tier === "kingdom" ? 600 : t.tier === "duchy" ? 250 : 60;
    }
    // Magic layer: a high-level martial figure is worth an army. This is the
    // "overmighty subject" coupling — a level-20 warden on the frontier can
    // out-fight a soft king with three counties. Kept inline (no import of
    // magic.ts) so world.ts stays dependency-free.
    if (this.magicEnabled) p += personalCombat(c);
    return p;
  }
}

// How much a person's own prowess weighs in a war, in the same units as levies.
// Grows super-linearly with level so the very top tier is genuinely decisive,
// scaled by how martial the class is.
const MARTIAL: Record<string, number> = {
  warden: 1.0,
  stormcaller: 1.1,
  knight: 0.85,
  necromancer: 0.8,
  soldier: 0.55,
  hunter: 0.45,
  commoner: 0.2,
  scholar: 0.15,
  merchant: 0.1,
};

// Named skills earned by challenge trials add a flat combat bonus in the same
// units personalCombat produces. A skill is a small army in the hands of a
// hero — the tenth dragon-slayer isn't as fearsome as the first, but they
// still tilt a war. Amounts scale with the challenge tier that granted them
// (see challenges.ts KINDS table): void_walker (tier 5) > dragon_slayer /
// wyrm_slayer (tier 4-5) > corruption_purger (tier 4) > grove_cleanser /
// beast_master (tier 2).
const SKILL_COMBAT: Record<string, number> = {
  void_walker:       100,
  dragon_slayer:      80,
  wyrm_slayer:        60,
  corruption_purger:  60,
  grove_cleanser:     25,
  beast_master:       20,
};

export function personalCombat(c: Character): number {
  if (!c.alive || c.level <= 1) return 0;
  const martial = MARTIAL[c.charClass] ?? 0.3;
  let p = Math.round(Math.pow(c.level, 1.4) * martial * 6);
  if (c.skills) {
    for (const s of c.skills) p += SKILL_COMBAT[s] ?? 0;
  }
  return p;
}
