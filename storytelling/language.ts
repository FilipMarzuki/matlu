// language.ts — persistent languages, drift, and translation.
//
// Every culture starts with a proto-language. Isolation drifts it; sustained
// trade contact pulls it back toward its neighbours. When drift crosses a
// threshold the language SPLITS — a distinct daughter tongue is born and the
// culture switches to it. Flourishing trade routes anoint a LINGUA FRANCA:
// the hub culture's tongue becomes the shared merchant language of the whole
// route. When the last culture speaking a language goes extinct the tongue
// DIES, and can later be REVIVED by scholars working from surviving treatises.
//
// This composes with the other layers: academies check for a shared language
// with foreign scholars (translation gates diffusion); the printing press +
// treatises increase a language's written corpus (giving it revival potential
// after death); climate/trade collapses (e.g. plague on a trade route) let
// isolation drift accelerate.
//
// Not guarded on magic — languages are a mundane social phenomenon.

import type { Character, Language, LanguageId } from "./types.js";
import type { World } from "./world.js";

// ---- tuning constants ------------------------------------------------------
const DRIFT_PER_YEAR = 0.002;             // baseline isolation drift
const DRIFT_SPLIT_THRESHOLD = 0.6;        // splits into a daughter language
const CONTACT_CONVERGE_FACTOR = 0.008;    // reduction from active trade contact
const LINGUA_FRANCA_ROUTE_WEALTH = 0.5;   // wealth threshold on route to mint one
const REVIVAL_MIN_CORPUS = 0.4;           // written corpus needed to revive
const REVIVAL_PROB = 0.02;                // per eligible scholar per year
const TRANSLATOR_PROB = 0.03;             // per multilingual scholar per year
const TREATISE_TRANSLATION_PROB = 0.08;   // per year per untranslated treatise

const LANG_SYLLABLES = [
  "koro", "nari", "sil", "ash", "veth", "iri", "quen", "morn", "dor", "kal",
  "athra", "vor", "zin", "ulu", "syn", "brack", "tessa", "yol", "oren", "meru",
];

const LANG_PREFIXES = ["Old", "High", "Middle", "New", "Coastal", "Deep", "Upper", "Lower"];

// Called from tick.ts once per year, after runCulture (so culture-drift's
// aesthetic linguisticShift is visible to us) and after runTradeRoutes (so
// this year's flourishing routes are already scored).
export function runLanguages(w: World): void {
  ensureInitialised(w);
  driftAndConverge(w);
  splitOnThreshold(w);
  mintLinguaeFrancae(w);
  ageWrittenCorpus(w);
  killOrphanedLanguages(w);
  maybeRevive(w);
  maybeHonourTranslators(w);
  maybeTranslateTreatises(w);
}

// ---------------------------------------------------------------------------
// Initialise a proto-language for every culture that doesn't have one yet.
// Done lazily so lost-peoples arriving mid-sim also get one on the tick after
// they show up.
// ---------------------------------------------------------------------------
function ensureInitialised(w: World): void {
  for (const cs of w.cultures.values()) {
    if (w.languageOfCulture(cs.id)) continue;
    const id: LanguageId = w.freshId("lg");
    const rootA = LANG_SYLLABLES[Math.floor(w.rng.next() * LANG_SYLLABLES.length)];
    const rootB = LANG_SYLLABLES[Math.floor(w.rng.next() * LANG_SYLLABLES.length)];
    const language: Language = {
      id,
      name: `Old ${capitalise(rootA)}${rootB}`,
      cultureId: cs.id,
      parentId: null,
      bornYear: w.year,
      diedYear: null,
      revivedYear: null,
      driftScore: 0,
      speakerCultures: [cs.id],
      linguaFrancaRoutes: [],
      writtenCorpus: 0,
    };
    w.languages.set(id, language);
  }
}

// ---------------------------------------------------------------------------
// Drift accumulates per year. Contact via an ACTIVE trade route between
// culture pairs reduces drift on both sides — merchants exchange loanwords,
// terms of art bleed through, orthographies stabilise around a shared code.
// ---------------------------------------------------------------------------
function driftAndConverge(w: World): void {
  // Build contact map from active trade routes: cultureA → set of cultureB it's linked to.
  const contact = new Map<string, Set<string>>();
  for (const r of w.activeTradeRoutes()) {
    if (r.wealth < 0.3) continue;
    const holderA = holderCulture(w, r.fromProvinceId);
    const holderB = holderCulture(w, r.toProvinceId);
    if (!holderA || !holderB || holderA === holderB) continue;
    if (!contact.has(holderA)) contact.set(holderA, new Set());
    if (!contact.has(holderB)) contact.set(holderB, new Set());
    contact.get(holderA)!.add(holderB);
    contact.get(holderB)!.add(holderA);
  }

  for (const lg of w.languages.values()) {
    if (lg.diedYear !== null) continue;
    if (!lg.cultureId) continue;

    // Baseline drift.
    let delta = DRIFT_PER_YEAR;

    // Contact convergence — every actively-trading partner reduces drift.
    const partners = contact.get(lg.cultureId);
    if (partners) delta -= CONTACT_CONVERGE_FACTOR * partners.size;

    lg.driftScore = Math.max(0, Math.min(1, lg.driftScore + delta));
  }
}

// ---------------------------------------------------------------------------
// When drift crosses the split threshold, spawn a daughter language and move
// the culture's speech to it. The old language stays in the map as a parent
// reference (family tree); if no other culture speaks it, it dies below.
// ---------------------------------------------------------------------------
function splitOnThreshold(w: World): void {
  for (const parent of [...w.languages.values()]) {
    if (parent.diedYear !== null) continue;
    if (parent.driftScore < DRIFT_SPLIT_THRESHOLD) continue;
    // Only split for the primary-culture speaker (lingua francae don't split).
    if (!parent.cultureId) continue;

    const cultureId = parent.cultureId;
    const id: LanguageId = w.freshId("lg");
    const prefix = LANG_PREFIXES[Math.floor(w.rng.next() * LANG_PREFIXES.length)];
    const baseName = parent.name.replace(/^(Old|High|Middle|New|Coastal|Deep|Upper|Lower)\s+/, "");
    const daughter: Language = {
      id,
      name: `${prefix} ${baseName}`,
      cultureId,
      parentId: parent.id,
      bornYear: w.year,
      diedYear: null,
      revivedYear: null,
      driftScore: 0,
      speakerCultures: [cultureId],
      linguaFrancaRoutes: [],
      writtenCorpus: 0,
    };
    w.languages.set(id, daughter);

    // Move the culture off the parent language.
    parent.speakerCultures = parent.speakerCultures.filter((c) => c !== cultureId);
    parent.cultureId = null;  // parent becomes archaic

    w.log("LANGUAGE_SPLITS", {
      data: {
        parentLanguageId: parent.id,
        parentLanguage: parent.name,
        childLanguageId: id,
        childLanguage: daughter.name,
        cultureId,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Trade routes at high wealth become carriers for their hub language. The
// endpoint whose language has the LARGEST speaker base wins — that tongue
// becomes the working language of the route.
// ---------------------------------------------------------------------------
function mintLinguaeFrancae(w: World): void {
  for (const r of w.activeTradeRoutes()) {
    if (r.wealth < LINGUA_FRANCA_ROUTE_WEALTH) continue;
    const cA = holderCulture(w, r.fromProvinceId);
    const cB = holderCulture(w, r.toProvinceId);
    if (!cA || !cB) continue;
    const lA = w.languageOfCulture(cA);
    const lB = w.languageOfCulture(cB);
    if (!lA || !lB) continue;
    if (lA.linguaFrancaRoutes.includes(r.id) || lB.linguaFrancaRoutes.includes(r.id)) continue;

    // Winner = larger speaker culture pool (proxy: population of the hub).
    const provA = w.province(r.fromProvinceId);
    const provB = w.province(r.toProvinceId);
    const scoreA = (provA?.population ?? 0) + lA.speakerCultures.length * 200;
    const scoreB = (provB?.population ?? 0) + lB.speakerCultures.length * 200;
    const winner = scoreA >= scoreB ? lA : lB;
    winner.linguaFrancaRoutes.push(r.id);

    w.log("LINGUA_FRANCA_ESTABLISHED", {
      provinceId: r.fromProvinceId,
      data: {
        routeId: r.id,
        languageId: winner.id,
        language: winner.name,
        hubCultureId: winner.cultureId ?? "",
        wealth: Math.round(r.wealth * 100) / 100,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Written corpus grows slowly per living scholar-class member speaking the
// language. This determines revival potential after death.
// ---------------------------------------------------------------------------
function ageWrittenCorpus(w: World): void {
  for (const lg of w.languages.values()) {
    if (lg.diedYear !== null) continue;
    let scholars = 0;
    for (const cultureId of lg.speakerCultures) {
      for (const c of w.living()) {
        if (c.charClass !== "scholar") continue;
        const dyn = w.dynasty(c.dynastyId);
        if (dyn?.cultureId === cultureId) scholars++;
      }
    }
    // Each active scholar adds a tiny amount to the corpus.
    lg.writtenCorpus = Math.min(1, lg.writtenCorpus + scholars * 0.001);
  }
}

// ---------------------------------------------------------------------------
// A language dies when no living culture speaks it. That's when a culture
// migrated off it (via split) AND no lingua franca role remains. Parent
// languages stay in the map with diedYear set — they're now historical
// tongues, still readable if the written corpus exists.
// ---------------------------------------------------------------------------
function killOrphanedLanguages(w: World): void {
  for (const lg of w.languages.values()) {
    if (lg.diedYear !== null) continue;
    // Update speakerCultures — drop cultures that are now on a different tongue.
    lg.speakerCultures = lg.speakerCultures.filter((cid) => w.languageOfCulture(cid)?.id === lg.id);
    if (lg.speakerCultures.length > 0) continue;
    if (lg.linguaFrancaRoutes.some((rid) => {
      const r = w.tradeRoutes.get(rid);
      return r && r.closedYear === null;
    })) continue;

    lg.diedYear = w.year;
    w.log("LANGUAGE_DIES", {
      data: {
        languageId: lg.id,
        language: lg.name,
        agedYears: w.year - lg.bornYear,
        writtenCorpus: Math.round(lg.writtenCorpus * 100) / 100,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Revival — a level-12+ scholar in a literacy_valued culture can reconstruct
// a dead language IF it has enough written corpus. Historical: Sanskrit,
// Latin (as scholarly language), Hebrew (Ben-Yehuda).
// ---------------------------------------------------------------------------
function maybeRevive(w: World): void {
  const deadReadable = [...w.languages.values()].filter(
    (lg) => lg.diedYear !== null && lg.revivedYear === null && lg.writtenCorpus >= REVIVAL_MIN_CORPUS,
  );
  if (deadReadable.length === 0) return;

  for (const scholar of w.living()) {
    if (scholar.charClass !== "scholar" || scholar.level < 12) continue;
    const dyn = w.dynasty(scholar.dynastyId);
    if (!dyn?.cultureId) continue;
    const state = w.cultureState(dyn.cultureId);
    const starting = w.cultures.get(dyn.cultureId)?.startingTraits ?? [];
    const literate = state.eliteTraits.has("literacy_valued") || starting.includes("literacy_valued");
    if (!literate) continue;
    if (!w.rng.chance(REVIVAL_PROB)) continue;
    // Pick a random revivable target.
    const target = deadReadable[Math.floor(w.rng.next() * deadReadable.length)];
    target.revivedYear = w.year;
    // Revived languages don't get new native speakers — they're liturgical /
    // scholarly. We DO mark writtenCorpus as expanding by revival efforts.
    target.writtenCorpus = Math.min(1, target.writtenCorpus + 0.1);
    w.log("LANGUAGE_REVIVED_BY_SCHOLARS", {
      actorId: scholar.id,
      data: {
        languageId: target.id,
        language: target.name,
        agedYears: (target.diedYear ?? w.year) - target.bornYear,
        deadYears: w.year - (target.diedYear ?? w.year),
      },
    });
    return;
  }
}

// ---------------------------------------------------------------------------
// A polyglot scholar — a scholar living in a province where a lingua franca
// route also passes through — occasionally gets recognised as a translator,
// bridging two literate cultures.
// ---------------------------------------------------------------------------
function maybeHonourTranslators(w: World): void {
  const franca = [...w.languages.values()].filter((lg) => lg.linguaFrancaRoutes.length > 0);
  if (franca.length === 0) return;
  for (const scholar of w.living()) {
    if (scholar.charClass !== "scholar" || scholar.level < 8) continue;
    const dyn = w.dynasty(scholar.dynastyId);
    if (!dyn?.cultureId) continue;
    const native = w.languageOfCulture(dyn.cultureId);
    if (!native) continue;
    // Is the scholar's home province on any lingua-franca route the scholar
    // doesn't natively speak?
    const nearby = franca.filter((lf) => lf.id !== native.id && lf.linguaFrancaRoutes.some((rid) => {
      const r = w.tradeRoutes.get(rid);
      return r && (r.fromProvinceId === scholar.provinceId || r.toProvinceId === scholar.provinceId);
    }));
    if (nearby.length === 0) continue;
    if (!w.rng.chance(TRANSLATOR_PROB)) continue;
    const bridge = nearby[Math.floor(w.rng.next() * nearby.length)];
    w.log("TRANSLATOR_HONOURED", {
      actorId: scholar.id,
      provinceId: scholar.provinceId,
      data: {
        nativeLanguageId: native.id,
        nativeLanguage: native.name,
        bridgeLanguageId: bridge.id,
        bridgeLanguage: bridge.name,
      },
    });
    return;
  }
}

// ---------------------------------------------------------------------------
// A TREATISE_PUBLISHED event carries a treatise implicitly. If the author's
// culture has any active lingua-franca contact, the treatise gets translated
// and jumps the language barrier — knowledge diffuses.
// ---------------------------------------------------------------------------
function maybeTranslateTreatises(w: World): void {
  // Recent treatises this year.
  const treatises = w.events.filter(
    (e) => e.type === "TREATISE_PUBLISHED" && e.year === w.year,
  );
  if (treatises.length === 0) return;
  for (const ev of treatises) {
    if (!w.rng.chance(TREATISE_TRANSLATION_PROB)) continue;
    const author: Character | undefined = w.char(ev.actorId ?? null);
    if (!author) continue;
    const dyn = w.dynasty(author.dynastyId);
    if (!dyn?.cultureId) continue;
    const native = w.languageOfCulture(dyn.cultureId);
    if (!native) continue;
    // Find a lingua franca the author's home province is on.
    const franca = [...w.languages.values()].find(
      (lg) => lg.id !== native.id && lg.linguaFrancaRoutes.some((rid) => {
        const r = w.tradeRoutes.get(rid);
        return r && (r.fromProvinceId === author.provinceId || r.toProvinceId === author.provinceId);
      }),
    );
    if (!franca) continue;
    // Boost written corpus of both — the translated version now exists in both languages.
    native.writtenCorpus = Math.min(1, native.writtenCorpus + 0.02);
    franca.writtenCorpus = Math.min(1, franca.writtenCorpus + 0.02);
    w.log("TREATISE_TRANSLATED", {
      actorId: author.id,
      provinceId: author.provinceId,
      data: {
        fromLanguageId: native.id,
        fromLanguage: native.name,
        toLanguageId: franca.id,
        toLanguage: franca.name,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------
function holderCulture(w: World, provinceId: string): string | null {
  const holder = [...w.titles.values()].find((t) => t.provinceId === provinceId);
  const holderChar = w.char(holder?.holderId ?? null);
  if (!holderChar) return null;
  return w.dynasty(holderChar.dynastyId)?.cultureId ?? null;
}

function capitalise(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}
