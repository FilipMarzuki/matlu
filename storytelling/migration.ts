// migration.ts — mass movements of populations between provinces.
//
// A MigrationWave rises when a province hits a pressure threshold — cold
// climate + severe, heavy blight, a devastating war (sacked home), or a
// schism-driven expulsion — and reaches for one or more neighbours. Each
// year en route it rolls: resolved-by-settle, resolved-by-repel, dispersed,
// or still traveling. When it settles it drops population + a diaspora
// marker at the destination; when it's a barbarian invasion, it also
// increases the target's blightLevel a touch as a fingerprint of sacking.
//
// Composes with:
//   • climate.ts — cold+severe phases seed climate_refugee waves
//   • wars/sieges — recent WAR_TERMINATED events at heavy pop-loss provinces
//     spawn war_displaced waves
//   • religion.ts — an EXCOMMUNICATION_ISSUED or SCHISM event fires expulsion
//   • disease.ts — active outbreak in origin propagates to destination
//
// Guarded on catastrophesEnabled so RNG-symmetric no-op golden hashes stay
// byte-identical.

import type {
  MigrationKind,
  MigrationWave,
  MigrationWaveId,
  ProvinceId,
} from "./types.js";
import type { World } from "./world.js";

// ---- tuning constants ------------------------------------------------------
const CLIMATE_WAVE_PROB = 0.04;         // per cold+severe province per year
const BLIGHT_WAVE_PROB = 0.06;          // per heavily-blighted province per year
const WAR_DISPLACED_PROB = 0.4;         // triggered by WAR events
const EXPULSION_PROB = 0.5;             // triggered by SCHISM / EXCOMMUNICATION_ISSUED
const RESOLVE_PROB_PER_YEAR = 0.4;      // per traveling wave per year
const REPELLED_PROB = 0.3;              // conditional on resolving — resisted
const DISPERSE_PROB_PER_YEAR = 0.06;    // wave breaks up on the road
const DIASPORA_ON_SETTLE = 0.55;        // chance a settled wave forms a diaspora
const MAX_ACTIVE = 8;                   // cap for chronicle brevity

// Population thresholds.
const MIN_ORIGIN_POP = 150;             // don't strip below this
const CLIMATE_SEVERITY_MIN = 0.4;       // "severe" climate threshold
const BLIGHT_MIN = 0.35;                // "heavy blight" threshold

// Wave-size fractions of origin pop.
const WAVE_SIZE_MIN_FRAC = 0.03;
const WAVE_SIZE_MAX_FRAC = 0.12;

const REASON_TEMPLATES: Record<MigrationKind, string[]> = {
  climate_refugees: [
    "the winters had grown too long to farm",
    "cold years followed by cold years, and the wells froze deep",
    "hearths could no longer be kept alight through the ice-months",
  ],
  barbarian_invasion: [
    "the war-band burned its own hall behind it and marched",
    "a captain had raised sword-fee for every masterless man in the hills",
    "the ancestral pastures had been taken by a stronger tribe",
  ],
  religious_expulsion: [
    "the new orthodoxy had no room for them",
    "the excommunicated deity's followers were driven from the court city",
    "a schism ended their protected status overnight",
  ],
  famine_flight: [
    "the harvest failed three years running",
    "grain-carts came late and light, and then not at all",
    "the great markets closed their gates to hungry mouths",
  ],
  war_displaced: [
    "the sack of their homeland left nothing to return to",
    "the burnt fields were still cooling when the last of them fled",
    "the victors' new law fell hardest on the survivors",
  ],
};

// ---------------------------------------------------------------------------
// Public entry — called from tick.ts once per year, after runDiseases (so
// this year's outbreaks are visible to origins).
// ---------------------------------------------------------------------------
export function runMigration(w: World): void {
  if (!w.catastrophesEnabled) return;

  ageActiveWaves(w);
  maybeTriggerNew(w);
}

// ---------------------------------------------------------------------------
// Age each traveling wave.
// ---------------------------------------------------------------------------
function ageActiveWaves(w: World): void {
  for (const wv of [...w.migrations.values()]) {
    if (wv.resolvedYear !== null) continue;

    // First check outright dispersal — road hardships broke the wave.
    if (w.rng.chance(DISPERSE_PROB_PER_YEAR)) {
      wv.status = "dispersed";
      wv.resolvedYear = w.year;
      w.log("WAVE_DISPERSED", {
        provinceId: wv.destinationProvinceId ?? wv.fromProvinceId,
        data: {
          waveId: wv.id,
          kind: wv.kind,
          size: wv.sizeInSouls,
        },
      });
      continue;
    }

    // Then a resolve roll — settle or repelled, depending on kind.
    if (!w.rng.chance(RESOLVE_PROB_PER_YEAR)) continue;
    resolveWave(w, wv);
  }
}

function resolveWave(w: World, wv: MigrationWave): void {
  // If no destination chosen yet, pick now (fallback for waves without one).
  if (!wv.destinationProvinceId) {
    const dest = pickDestination(w, wv.fromProvinceId);
    if (!dest) {
      // Nowhere to go — waves dispersing under their own weight.
      wv.status = "dispersed";
      wv.resolvedYear = w.year;
      w.log("WAVE_DISPERSED", {
        provinceId: wv.fromProvinceId,
        data: { waveId: wv.id, kind: wv.kind, size: wv.sizeInSouls },
      });
      return;
    }
    wv.destinationProvinceId = dest;
  }

  const destPid = wv.destinationProvinceId;
  const dest = w.province(destPid);
  if (!dest) {
    wv.status = "dispersed";
    wv.resolvedYear = w.year;
    return;
  }

  // Repelled path — the destination fights back.
  const isArmed = wv.kind === "barbarian_invasion";
  const repelProb = isArmed ? REPELLED_PROB * 0.6 : REPELLED_PROB;
  if (w.rng.chance(repelProb)) {
    wv.status = "repelled";
    wv.resolvedYear = w.year;
    w.log("WAVE_DISPERSED", {
      provinceId: destPid,
      data: {
        waveId: wv.id,
        kind: wv.kind,
        size: wv.sizeInSouls,
        repelled: true,
      },
    });
    return;
  }

  // Settle path.
  wv.status = "settled";
  wv.resolvedYear = w.year;

  // Add population at destination (cap at a soft ceiling).
  const cap = Math.max(dest.population * 3, 10000);
  dest.population = Math.min(cap, dest.population + Math.round(wv.sizeInSouls * 0.85));

  // Armed migrations leave a fingerprint — a small blight tick from sacking.
  if (isArmed) {
    dest.blightLevel = Math.min(1, dest.blightLevel + 0.1);
    w.log("BARBARIAN_INVASION", {
      provinceId: destPid,
      data: {
        waveId: wv.id,
        size: wv.sizeInSouls,
        from: wv.fromProvinceId,
      },
    });
  } else {
    w.log("REFUGEES_ARRIVE", {
      provinceId: destPid,
      data: {
        waveId: wv.id,
        kind: wv.kind,
        size: wv.sizeInSouls,
        from: wv.fromProvinceId,
      },
    });
  }

  w.log("SETTLED_NEW_HOMELAND", {
    provinceId: destPid,
    data: {
      waveId: wv.id,
      size: wv.sizeInSouls,
      kind: wv.kind,
    },
  });

  // Some settlements form a distinct diaspora community that persists.
  if (w.rng.chance(DIASPORA_ON_SETTLE)) {
    wv.formedDiaspora = true;
    w.log("DIASPORA_FORMED", {
      provinceId: destPid,
      data: {
        waveId: wv.id,
        size: wv.sizeInSouls,
        cultureId: wv.cultureId ?? "",
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Trigger new waves from pressure sources.
// ---------------------------------------------------------------------------
function maybeTriggerNew(w: World): void {
  if (w.activeMigrations().length >= MAX_ACTIVE) return;

  // Climate-refugee pressure — every cold+severe year gives every marginal
  // province a chance; may launch multiple in the same year.
  if (w.climate.phase === "cold" && w.climate.severity > CLIMATE_SEVERITY_MIN) {
    for (const p of w.provinces.values()) {
      if (p.subsurface) continue;
      if (p.population < MIN_ORIGIN_POP) continue;
      if (!w.rng.chance(CLIMATE_WAVE_PROB)) continue;
      launchWave(w, p.id, "climate_refugees");
      if (w.activeMigrations().length >= MAX_ACTIVE) return;
    }
  }

  // Blight pressure — heavily blighted provinces shed population.
  for (const p of w.provinces.values()) {
    if (p.subsurface) continue;
    if (p.population < MIN_ORIGIN_POP) continue;
    if (p.blightLevel < BLIGHT_MIN) continue;
    if (!w.rng.chance(BLIGHT_WAVE_PROB)) continue;
    launchWave(w, p.id, "famine_flight");
    if (w.activeMigrations().length >= MAX_ACTIVE) return;
  }

  // War-displaced — each WAR event this year gets its own chance.
  const warEvents = w.events.filter(
    (e) => e.year === w.year && e.type === "WAR" && e.provinceId,
  );
  for (const ev of warEvents) {
    if (!w.rng.chance(WAR_DISPLACED_PROB)) continue;
    if (ev.provinceId) launchWave(w, ev.provinceId, "war_displaced");
    if (w.activeMigrations().length >= MAX_ACTIVE) return;
  }

  // Famine flight — each FAMINE event this year gets a chance. FAMINE is
  // the most common pressure trigger, so keep the rate modest.
  const famineEvents = w.events.filter(
    (e) => e.year === w.year && e.type === "FAMINE" && e.provinceId,
  );
  for (const ev of famineEvents) {
    if (!w.rng.chance(0.08)) continue;
    const p = w.province(ev.provinceId ?? "");
    if (!p || p.population < MIN_ORIGIN_POP) continue;
    if (ev.provinceId) launchWave(w, ev.provinceId, "famine_flight");
    if (w.activeMigrations().length >= MAX_ACTIVE) return;
  }

  // Religious expulsion — each SCHISM / EXCOMMUNICATION_ISSUED gets a chance.
  const schismEvents = w.events.filter(
    (e) => e.year === w.year &&
      (e.type === "CHURCH_SCHISM" || e.type === "EXCOMMUNICATION_ISSUED") &&
      e.provinceId,
  );
  for (const ev of schismEvents) {
    if (!w.rng.chance(EXPULSION_PROB)) continue;
    if (ev.provinceId) launchWave(w, ev.provinceId, "religious_expulsion");
    if (w.activeMigrations().length >= MAX_ACTIVE) return;
  }
}

function launchWave(w: World, fromPid: ProvinceId, kind: MigrationKind): void {
  const from = w.province(fromPid);
  if (!from) return;

  const frac = WAVE_SIZE_MIN_FRAC + w.rng.next() * (WAVE_SIZE_MAX_FRAC - WAVE_SIZE_MIN_FRAC);
  const size = Math.max(200, Math.round(from.population * frac));
  const takenPop = Math.min(size, from.population - MIN_ORIGIN_POP);
  if (takenPop <= 0) return;
  from.population -= takenPop;

  const dest = pickDestination(w, fromPid);
  const reasonPool = REASON_TEMPLATES[kind];
  const reason = reasonPool[Math.floor(w.rng.next() * reasonPool.length)];

  const id: MigrationWaveId = w.freshId("mw");
  const cultureId = deriveCulture(w, fromPid);
  const wv: MigrationWave = {
    id,
    kind,
    fromProvinceId: fromPid,
    cultureId,
    sizeInSouls: takenPop,
    triggeredYear: w.year,
    status: "traveling",
    destinationProvinceId: dest,
    resolvedYear: null,
    formedDiaspora: false,
    reason,
  };
  w.migrations.set(id, wv);

  w.log("MIGRATION_WAVE_RISES", {
    provinceId: fromPid,
    data: {
      waveId: id,
      kind,
      size: takenPop,
      reason,
      destination: dest ?? "",
    },
  });

  // Expulsion logs its own distinct event too.
  if (kind === "religious_expulsion") {
    w.log("RELIGIOUS_EXPULSION", {
      provinceId: fromPid,
      data: {
        waveId: id,
        size: takenPop,
        cultureId: cultureId ?? "",
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------
function pickDestination(w: World, fromPid: ProvinceId): ProvinceId | null {
  const from = w.province(fromPid);
  if (!from) return null;
  const candidates = from.neighbors
    .map((pid) => w.province(pid))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .filter((p) => !p.subsurface && p.blightLevel < 0.5);
  if (candidates.length === 0) {
    // Fall back to any healthy province.
    const all = [...w.provinces.values()].filter(
      (p) => !p.subsurface && p.id !== fromPid && p.blightLevel < 0.5,
    );
    if (all.length === 0) return null;
    return all[Math.floor(w.rng.next() * all.length)].id;
  }
  return candidates[Math.floor(w.rng.next() * candidates.length)].id;
}

function deriveCulture(w: World, pid: ProvinceId): string | null {
  // The ruling title-holder's dynasty carries the culture in worlds that
  // define them; default worlds have no cultures so this returns null.
  for (const t of w.titles.values()) {
    if (t.provinceId !== pid) continue;
    if (t.holderId === null) continue;
    const h = w.char(t.holderId);
    if (!h) continue;
    const dyn = w.dynasty(h.dynastyId);
    if (!dyn) continue;
    return dyn.cultureId || null;
  }
  return null;
}

