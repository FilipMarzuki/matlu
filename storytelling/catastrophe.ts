// catastrophe.ts — exogenous world shocks: blights, portal disasters, mana ruptures.
//
// These are things that happen TO the world, not because of any character's
// choices. Each is a multi-step chain stored in World.catastropheQueue so the
// consequences play out over years, not in a single tick.
//
// All code is gated behind World.catastrophesEnabled so the base sim's golden
// hashes remain untouched when the flag is off.

import { killResidentsByChance, markDead } from "./phenomena.js";
import type { CatastropheQueueItem, ProvinceId } from "./types.js";
import type { World } from "./world.js";

// ---------------------------------------------------------------------------
// Template definitions
// ---------------------------------------------------------------------------

interface CatastropheStep {
  // delay in years from the previous step (step 0 delay is from ignition)
  delay: number;
  fire: (w: World, item: CatastropheQueueItem) => void;
}

interface CatastropheTemplate {
  id: string;
  // Probability per eligible province per year
  drawProb: number;
  // Is this province eligible to start this catastrophe?
  eligible: (w: World, provinceId: ProvinceId) => boolean;
  steps: CatastropheStep[];
}

// --- 1. The Withering — steppes and deserts slowly die ----------------------
const WITHERING: CatastropheTemplate = {
  id: "withering",
  drawProb: 0.008,
  eligible: (w, pid) => {
    const p = w.province(pid);
    if (!p) return false;
    return (
      !p.subsurface &&
      (p.terrain === "steppe" || p.terrain === "desert") &&
      p.blightLevel < 0.2 &&
      !p.zoneFlags.includes("blighted")
    );
  },
  steps: [
    {
      delay: 0,
      fire: (w, item) => {
        const p = w.province(item.provinceId);
        if (!p) return;
        p.blightLevel = Math.min(1, p.blightLevel + 0.3);
        p.corruptionType = "necrotic";
        const loss = Math.round(p.population * 0.15);
        p.population = Math.max(50, p.population - loss);
        w.log("BLIGHT_SPREADS", {
          provinceId: p.id,
          data: { deaths: loss, blightLevel: p.blightLevel },
        });
      },
    },
    {
      delay: 12,
      fire: (w, item) => {
        const p = w.province(item.provinceId);
        if (!p) return;
        p.blightLevel = Math.min(1, p.blightLevel + 0.4);
        const loss = Math.round(p.population * 0.25);
        p.population = Math.max(50, p.population - loss);
        // Steppe becomes desert as the land desiccates beyond recovery.
        if (p.terrain === "steppe") p.terrain = "desert";
        w.log("BLIGHT_DEEPENS", {
          provinceId: p.id,
          data: { deaths: loss, blightLevel: p.blightLevel },
        });
      },
    },
    {
      delay: 25,
      fire: (w, item) => {
        const p = w.province(item.provinceId);
        if (!p) return;
        p.blightLevel = Math.min(1, p.blightLevel + 0.2);
        if (!p.zoneFlags.includes("blighted")) p.zoneFlags.push("blighted");
        // Mana seeps into the dying land.
        p.manaDensity = Math.min(1, p.manaDensity + 0.25);
        const dead = killResidentsByChance(w, p.id, "blight", 0.25);
        w.log("BLIGHT_LOCKED", {
          provinceId: p.id,
          data: { named_dead: dead, blightLevel: p.blightLevel },
        });
      },
    },
  ],
};

// --- 2. Portal Catastrophe — people from another world arrive and die --------
const PORTAL_CATASTROPHE: CatastropheTemplate = {
  id: "portal",
  drawProb: 0.004,
  eligible: (w, pid) => {
    const p = w.province(pid);
    if (!p) return false;
    // Fires at most once per world — one permanent dead zone is the story.
    if (w.events.some((e) => e.type === "PORTAL_OPENS")) return false;
    return (
      !p.subsurface &&
      (p.terrain === "mountain" || p.terrain === "jungle") &&
      !p.coastal &&
      !p.riverConnected &&
      p.zoneFlags.length === 0 &&
      w.year > 40
    );
  },
  steps: [
    {
      delay: 0,
      fire: (w, item) => {
        const p = w.province(item.provinceId);
        if (!p) return;
        const stranded = w.rng.int(8000, 12000);
        p.population += stranded;
        // Store count for the follow-up step.
        item.data.strandedCount = stranded;
        w.log("PORTAL_OPENS", {
          provinceId: p.id,
          data: { stranded },
        });
      },
    },
    {
      delay: 1,
      fire: (w, item) => {
        const p = w.province(item.provinceId);
        if (!p) return;
        const stranded = (item.data.strandedCount as number) ?? 0;
        // 85% of the displaced die in the wrong season, wrong world.
        const popLoss = Math.round(stranded * 0.85);
        p.population = Math.max(50, p.population - popLoss);
        const namedDead = killResidentsByChance(w, p.id, "displacement", 0.7);
        w.log("MASS_DEATH", {
          provinceId: p.id,
          data: { stranded, died: popLoss, named_dead: namedDead },
        });
      },
    },
    {
      delay: 1,
      fire: (w, item) => {
        const p = w.province(item.provinceId);
        if (!p) return;
        if (!p.zoneFlags.includes("dead_zone")) p.zoneFlags.push("dead_zone");
        if (!p.zoneFlags.includes("undead_heavy")) p.zoneFlags.push("undead_heavy");
        p.blightLevel = 1;
        p.corruptionType = "necrotic";
        p.manaDensity = Math.min(1, p.manaDensity + 0.4);
        // Kill every living character still in this province — no one survives.
        for (const c of w.living()) {
          if (c.provinceId === p.id) markDead(w, c, "dead_zone");
        }
        p.population = 50; // only the undead remain; we represent as minimum pop
        w.log("DEAD_ZONE_FORMS", {
          provinceId: p.id,
          data: { blightLevel: p.blightLevel, manaDensity: p.manaDensity },
        });
      },
    },
  ],
};

// --- 3. Mana Rupture — a ritual spirals out of control ----------------------
const MANA_RUPTURE: CatastropheTemplate = {
  id: "mana_rupture",
  drawProb: 0.006,
  eligible: (w, pid) => {
    const p = w.province(pid);
    if (!p) return false;
    return (
      p.manaDensity > 0.55 &&
      p.blightLevel < 0.3 &&
      !p.zoneFlags.includes("mana_corrupted") &&
      !p.zoneFlags.includes("dead_zone") &&
      p.population > 150 &&
      w.year > 20
    );
  },
  steps: [
    {
      delay: 0,
      fire: (w, item) => {
        const p = w.province(item.provinceId);
        if (!p) return;
        // The ritual master — whoever holds the title in this province — dies.
        const title = w.title(p.titleId);
        const holder = title ? w.char(title.holderId) : undefined;
        if (holder && holder.alive) {
          markDead(w, holder, "ritual_gone_wrong");
          item.data.actorId = holder.id;
        }
        w.log("RITUAL_GONE_WRONG", {
          provinceId: p.id,
          actorId: holder?.id ?? null,
          data: { manaDensity: p.manaDensity },
        });
      },
    },
    {
      delay: 1,
      fire: (w, item) => {
        const p = w.province(item.provinceId);
        if (!p) return;
        const loss = Math.round(p.population * 0.55);
        p.population = Math.max(50, p.population - loss);
        if (!p.zoneFlags.includes("mana_corrupted")) p.zoneFlags.push("mana_corrupted");
        p.corruptionType = "void";
        p.manaDensity = Math.min(1, p.manaDensity + 0.3);
        const namedDead = killResidentsByChance(w, p.id, "mana_rupture", 0.45);
        w.log("MANA_RUPTURE", {
          provinceId: p.id,
          data: { deaths: loss, named_dead: namedDead, manaDensity: p.manaDensity },
        });
      },
    },
    {
      delay: 2,
      fire: (w, item) => {
        const p = w.province(item.provinceId);
        if (!p) return;
        // Corruption bleeds into every neighbour, inheriting the source type.
        for (const nId of p.neighbors) {
          const n = w.province(nId);
          if (!n) continue;
          n.blightLevel = Math.min(1, n.blightLevel + 0.15);
          n.corruptionType = n.corruptionType ?? p.corruptionType ?? "void";
          n.manaDensity = Math.min(1, n.manaDensity + 0.1);
          const nLoss = Math.round(n.population * 0.08);
          n.population = Math.max(50, n.population - nLoss);
          w.log("CORRUPTION_SPREADS", {
            provinceId: n.id,
            data: { sourceProvinceId: p.id, deaths: nLoss },
          });
        }
      },
    },
  ],
};

// --- 4. Delved Too Deep — an underground hold breaches something ancient -------
// The Moria scenario: the hold's mana-saturated deep is disturbed, the lord is
// slain, and two years later the dead rise and seal the hall forever. Undead
// then raid surface provinces through the tunnel exits the dwarfs dug.
const DELVED_TOO_DEEP: CatastropheTemplate = {
  id: "delved_too_deep",
  drawProb: 0.004,
  eligible: (w, pid) => {
    const p = w.province(pid);
    if (!p) return false;
    return (
      p.subsurface &&
      p.manaDensity > 0.55 &&
      p.population > 100 &&
      !p.zoneFlags.includes("dead_zone") &&
      w.year > 30
    );
  },
  steps: [
    {
      delay: 0,
      fire: (w, item) => {
        const p = w.province(item.provinceId);
        if (!p) return;
        // Something stirs in the deep — the hold-lord is the first to fall.
        const title = w.title(p.titleId);
        const holder = title ? w.char(title.holderId) : undefined;
        if (holder && holder.alive) {
          markDead(w, holder, "delved_too_deep");
          item.data.actorId = holder.id;
        }
        const loss = Math.round(p.population * 0.3);
        p.population = Math.max(50, p.population - loss);
        w.log("DELVED_TOO_DEEP", {
          provinceId: p.id,
          actorId: holder?.id ?? null,
          data: { manaDensity: p.manaDensity, deaths: loss },
        });
      },
    },
    {
      delay: 2,
      fire: (w, item) => {
        const p = w.province(item.provinceId);
        if (!p) return;
        // The dead rise — the hold falls completely.
        if (!p.zoneFlags.includes("dead_zone")) p.zoneFlags.push("dead_zone");
        if (!p.zoneFlags.includes("undead_heavy")) p.zoneFlags.push("undead_heavy");
        p.blightLevel = 1;
        p.corruptionType = "necrotic";
        p.manaDensity = Math.min(1, p.manaDensity + 0.3);
        for (const c of w.living()) {
          if (c.provinceId === p.id) markDead(w, c, "delved_too_deep");
        }
        p.population = 50;
        w.log("DEAD_ZONE_FORMS", {
          provinceId: p.id,
          data: { blightLevel: p.blightLevel, manaDensity: p.manaDensity, source: "delved_too_deep" },
        });
      },
    },
  ],
};

// --- 5. Feral Surge — the mire awakens, wild corruption spreads from jungle/swamp --
// The living corruption of deep jungle or ancient swamp stirs and overflows into the
// world. Unlike necrotic dead zones, feral provinces remain alive but twisted —
// beasts run mad, plants strangle paths, and the people turn to warrior-zeal.
const FERAL_SURGE: CatastropheTemplate = {
  id: "feral_surge",
  drawProb: 0.005,
  eligible: (w, pid) => {
    const p = w.province(pid);
    if (!p) return false;
    return (
      !p.subsurface &&
      (p.terrain === "jungle" || p.terrain === "swamp") &&
      p.blightLevel < 0.2 &&
      !p.zoneFlags.includes("blighted") &&
      !p.zoneFlags.includes("dead_zone") &&
      w.year > 15
    );
  },
  steps: [
    {
      delay: 0,
      fire: (w, item) => {
        const p = w.province(item.provinceId);
        if (!p) return;
        p.blightLevel = Math.min(1, p.blightLevel + 0.25);
        p.corruptionType = "feral";
        const loss = Math.round(p.population * 0.1);
        p.population = Math.max(50, p.population - loss);
        w.log("BLIGHT_SPREADS", {
          provinceId: p.id,
          data: { deaths: loss, blightLevel: p.blightLevel, source: "feral_surge" },
        });
      },
    },
    {
      delay: 10,
      fire: (w, item) => {
        const p = w.province(item.provinceId);
        if (!p) return;
        p.blightLevel = Math.min(1, p.blightLevel + 0.35);
        const loss = Math.round(p.population * 0.2);
        p.population = Math.max(50, p.population - loss);
        // Feral energy bleeds into neighbours — wildlife and plants run wild.
        for (const nId of p.neighbors) {
          const n = w.province(nId);
          if (!n || n.zoneFlags.includes("dead_zone")) continue;
          n.blightLevel = Math.min(1, n.blightLevel + 0.06);
          n.corruptionType = n.corruptionType ?? "feral";
          const nLoss = Math.round(n.population * 0.04);
          n.population = Math.max(50, n.population - nLoss);
          w.log("CORRUPTION_SPREADS", {
            provinceId: n.id,
            data: { sourceProvinceId: p.id, deaths: nLoss },
          });
        }
        w.log("BLIGHT_DEEPENS", {
          provinceId: p.id,
          data: { deaths: loss, blightLevel: p.blightLevel, source: "feral_surge" },
        });
      },
    },
    {
      delay: 20,
      fire: (w, item) => {
        const p = w.province(item.provinceId);
        if (!p) return;
        p.blightLevel = Math.min(1, p.blightLevel + 0.15);
        if (!p.zoneFlags.includes("blighted")) p.zoneFlags.push("blighted");
        p.manaDensity = Math.min(1, p.manaDensity + 0.2);
        const dead = killResidentsByChance(w, p.id, "feral_surge", 0.2);
        w.log("BLIGHT_LOCKED", {
          provinceId: p.id,
          data: { named_dead: dead, blightLevel: p.blightLevel, source: "feral_surge" },
        });
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Helper: ash sweep — all surface provinces take population loss
// ---------------------------------------------------------------------------

function ashSweep(w: World, originId: string, wave: number, loss: number): void {
  for (const p of w.provinces.values()) {
    if (p.subsurface || p.zoneFlags.includes("dead_zone")) continue;
    const deaths = Math.round(p.population * loss);
    p.population = Math.max(50, p.population - deaths);
    w.log("ASH_SUMMER", { provinceId: p.id, data: { deaths, wave, sourceProvinceId: originId } });
  }
}

// Helper: drought BFS — flood-fill through dry terrain provinces
function droughtBFS(w: World, originId: string): string[] {
  const DRY = new Set(["steppe", "plains", "desert", "hills"]);
  const out: string[] = [];
  const queue = [originId];
  const seen = new Set([originId]);
  while (queue.length) {
    const pid = queue.shift()!;
    out.push(pid);
    const p = w.province(pid)!;
    for (const nId of p.neighbors) {
      if (seen.has(nId)) continue;
      seen.add(nId);
      const n = w.province(nId);
      if (!n || n.subsurface || n.zoneFlags.includes("dead_zone")) continue;
      if (DRY.has(n.terrain) && w.rng.next() < 0.65) queue.push(nId);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// VOLCANIC_ERUPTION — global reach (3-wave ash summer)
// ---------------------------------------------------------------------------

const VOLCANIC_ERUPTION: CatastropheTemplate = {
  id: "volcanic_eruption",
  drawProb: 0.002,
  eligible: (w, pid) => {
    const p = w.province(pid);
    if (!p) return false;
    return (
      !p.subsurface &&
      p.terrain === "mountain" &&
      !p.zoneFlags.includes("dead_zone") &&
      w.year > 30 &&
      !w.events.some((e) => e.type === "ERUPTION")
    );
  },
  steps: [
    {
      delay: 0,
      fire: (w, item) => {
        const p = w.province(item.provinceId);
        if (!p) return;
        const loss = Math.round(p.population * 0.3);
        p.population = Math.max(50, p.population - loss);
        if (!p.zoneFlags.includes("ash_shrouded")) p.zoneFlags.push("ash_shrouded");
        const dead = killResidentsByChance(w, p.id, "eruption", 0.35);
        w.log("ERUPTION", { provinceId: p.id, data: { deaths: loss, named_dead: dead } });
      },
    },
    { delay: 4,  fire: (w, item) => ashSweep(w, item.provinceId, 1, 0.08) },
    { delay: 9,  fire: (w, item) => ashSweep(w, item.provinceId, 2, 0.06) },
    { delay: 15, fire: (w, item) => ashSweep(w, item.provinceId, 3, 0.04) },
  ],
};

// ---------------------------------------------------------------------------
// DROUGHT_CYCLE — regional (dry terrain BFS, 3-year chain)
// ---------------------------------------------------------------------------

const DROUGHT_CYCLE: CatastropheTemplate = {
  id: "drought_cycle",
  drawProb: 0.010,
  eligible: (w, pid) => {
    const p = w.province(pid);
    if (!p) return false;
    return (
      !p.subsurface &&
      (p.terrain === "steppe" || p.terrain === "plains" || p.terrain === "desert" || p.terrain === "hills") &&
      p.population > 80 &&
      w.year > 5
    );
  },
  steps: [
    {
      delay: 0,
      fire: (w, item) => {
        for (const pid of droughtBFS(w, item.provinceId)) {
          const p = w.province(pid);
          if (!p) continue;
          const loss = Math.round(p.population * 0.12);
          p.population = Math.max(50, p.population - loss);
          const dead = killResidentsByChance(w, pid, "drought", 0.04);
          w.log("DROUGHT", { provinceId: pid, data: { deaths: loss, named_dead: dead, wave: 1, sourceProvinceId: item.provinceId } });
        }
      },
    },
    {
      delay: 1,
      fire: (w, item) => {
        for (const pid of droughtBFS(w, item.provinceId)) {
          const p = w.province(pid);
          if (!p) continue;
          const loss = Math.round(p.population * 0.09);
          p.population = Math.max(50, p.population - loss);
          const dead = killResidentsByChance(w, pid, "drought", 0.03);
          w.log("DROUGHT", { provinceId: pid, data: { deaths: loss, named_dead: dead, wave: 2, sourceProvinceId: item.provinceId } });
        }
      },
    },
    {
      delay: 2,
      fire: (w, item) => {
        for (const pid of droughtBFS(w, item.provinceId)) {
          const p = w.province(pid);
          if (!p) continue;
          const loss = Math.round(p.population * 0.06);
          p.population = Math.max(50, p.population - loss);
          const dead = killResidentsByChance(w, pid, "drought", 0.02);
          w.log("DROUGHT", { provinceId: pid, data: { deaths: loss, named_dead: dead, wave: 3, sourceProvinceId: item.provinceId } });
        }
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// LOCUST_SWARM — regional (fertile terrain BFS, single wave)
// ---------------------------------------------------------------------------

const LOCUST_SWARM_TEMPLATE: CatastropheTemplate = {
  id: "locust_swarm",
  drawProb: 0.008,
  eligible: (w, pid) => {
    const p = w.province(pid);
    if (!p) return false;
    return (
      !p.subsurface &&
      (p.terrain === "meadow" || p.terrain === "plains" || p.terrain === "forest" || p.terrain === "jungle") &&
      p.fertility > 0.4 &&
      w.year > 5
    );
  },
  steps: [
    {
      delay: 0,
      fire: (w, item) => {
        const FERTILE = new Set(["meadow", "plains", "forest", "jungle", "swamp"]);
        const BLOCK   = new Set(["desert", "mountain", "steppe"]);
        const affected: string[] = [];
        const queue = [item.provinceId];
        const seen  = new Set([item.provinceId]);
        while (queue.length) {
          const pid = queue.shift()!;
          affected.push(pid);
          const p = w.province(pid)!;
          for (const nId of p.neighbors) {
            if (seen.has(nId)) continue;
            seen.add(nId);
            const n = w.province(nId);
            if (!n || n.subsurface || n.zoneFlags.includes("dead_zone")) continue;
            if (BLOCK.has(n.terrain)) continue;
            if (FERTILE.has(n.terrain) && w.rng.next() < 0.60) queue.push(nId);
          }
        }
        for (const pid of affected) {
          const p = w.province(pid);
          if (!p) continue;
          const loss = Math.round(p.population * 0.08);
          p.population = Math.max(50, p.population - loss);
          p.fertility = Math.max(0.1, p.fertility - 0.06);
          w.log("LOCUST_SWARM", { provinceId: pid, data: { deaths: loss, sourceProvinceId: item.provinceId } });
        }
      },
    },
  ],
};

const TEMPLATES: CatastropheTemplate[] = [WITHERING, PORTAL_CATASTROPHE, MANA_RUPTURE, DELVED_TOO_DEEP, FERAL_SURGE, VOLCANIC_ERUPTION, DROUGHT_CYCLE, LOCUST_SWARM_TEMPLATE];

// ---------------------------------------------------------------------------
// Chain engine
// ---------------------------------------------------------------------------

export function runCatastrophes(w: World): void {
  if (!w.catastrophesEnabled) return;

  // 1. Fire any chain steps that are due this year.
  const remaining: CatastropheQueueItem[] = [];
  for (const item of w.catastropheQueue) {
    if (item.fireYear <= w.year) {
      const tmpl = TEMPLATES.find((t) => t.id === item.templateId);
      if (tmpl) {
        const step = tmpl.steps[item.stepIndex];
        if (step) step.fire(w, item);
        // Queue the next step if there is one.
        const next = tmpl.steps[item.stepIndex + 1];
        if (next) {
          w.catastropheQueue.push({
            provinceId: item.provinceId,
            templateId: item.templateId,
            stepIndex: item.stepIndex + 1,
            fireYear: w.year + next.delay,
            data: item.data,
          });
        }
      }
    } else {
      remaining.push(item);
    }
  }
  w.catastropheQueue = remaining;

  // 2. Draw new catastrophe events.
  const provinces = [...w.provinces.values()];
  for (const tmpl of TEMPLATES) {
    // Collect eligible provinces and draw.
    const candidates = provinces.filter((p) => tmpl.eligible(w, p.id));
    for (const p of candidates) {
      if (!w.rng.chance(tmpl.drawProb)) continue;
      // Start the chain at step 0.
      const first = tmpl.steps[0];
      if (!first) continue;
      const item: CatastropheQueueItem = {
        provinceId: p.id,
        templateId: tmpl.id,
        stepIndex: 0,
        fireYear: w.year + first.delay,
        data: {},
      };
      if (first.delay === 0) {
        // Fire immediately this tick; queue next step if any.
        first.fire(w, item);
        const next = tmpl.steps[1];
        if (next) {
          w.catastropheQueue.push({
            ...item,
            stepIndex: 1,
            fireYear: w.year + next.delay,
          });
        }
      } else {
        w.catastropheQueue.push(item);
      }
    }
  }

  // 3. Undead raids from dead zones into neighbours.
  for (const p of provinces) {
    if (!p.zoneFlags.includes("undead_heavy")) continue;
    if (!w.rng.chance(0.12)) continue;
    const neighbors = p.neighbors.map((id) => w.province(id)).filter((n): n is NonNullable<typeof n> => !!n);
    if (neighbors.length === 0) continue;
    const target = w.rng.pick(neighbors);
    const raidMortality = w.rng.float(0.05, 0.15);
    const raidLoss = Math.round(target.population * raidMortality);
    target.population = Math.max(50, target.population - raidLoss);
    const namedDead = killResidentsByChance(w, target.id, "undead_raid", 0.08);
    w.log("UNDEAD_RAID", {
      provinceId: target.id,
      data: { sourceProvinceId: p.id, deaths: raidLoss, named_dead: namedDead },
    });
  }

  // 4. Natural blight decay — slow passive cleansing (~0.5%/yr).
  // Dead zones are permanent and do not decay; everything else gradually heals.
  for (const p of provinces) {
    if (p.blightLevel <= 0 || p.zoneFlags.includes("dead_zone")) continue;
    p.blightLevel = Math.max(0, p.blightLevel - 0.005);
    if (p.blightLevel <= 0) p.corruptionType = undefined;
  }
}
