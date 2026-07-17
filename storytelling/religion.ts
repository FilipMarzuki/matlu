// religion.ts — organised religion under tangible gods.
//
// The premise reshapes everything from the Earth analogue. Because gods are
// real and their power is observable, doctrine is contract (pact terms), not
// interpretation. Schisms are patron-switching, not creedal argument. Miracles
// are auditable. Excommunication is a supply-cut of divine boons, not a
// spiritual threat. A god CAN die when its power runs out — its churches
// carry on as habit for a while, then dissolve or find a new patron.
//
// Guarded on magicEnabled: the world's supernatural machinery has to be on
// for gods to exist at all. RNG symmetry: with magic off, this module is a
// full no-op (zero rolls) so non-magic golden hashes are unaffected.

import type { Character, Church, ChurchId, Deity, DeityDomain, DeityId, ProvinceId } from "./types.js";
import type { World } from "./world.js";

// ---- tuning constants ------------------------------------------------------
const DEITY_MANIFEST_YEAR = 40;        // first god manifests after ~40y of story
const DEITY_MANIFEST_PROB = 0.008;     // ~1 in 125y after that

// After the Great Vanishing, a full century must pass before the world will
// even entertain a new god manifesting (mortals must rebuild trust). Once past
// that window, the manifestation rate is a fraction of the pre-Vanishing pace.
const POST_VANISHING_SKEPTIC_YEARS = 100;
const POST_VANISHING_PROB_SCALE = 0.15;

// The ladder to the ascended plane closed at the Vanishing. Nothing new can
// ascend all the way — the highest post-Vanishing form is a DEMIGOD:
// powerful, domain-bearing, but anchored to a mortal vessel and killable.
const DEMIGOD_PEAK_POWER = 0.4;   // hard cap on demigod peakPower
const DEMIGOD_INITIAL_POWER = 0.25;
const DEMIGOD_SLAY_BASE_PROB = 0.05;  // per year, per demigod — a hero may try
const MAX_LIVING_DEITIES = 8;          // small pantheon; keep prose readable
const CHURCH_FORMATION_PROB = 0.06;    // per-eligible-province per-year
const CHURCH_FLOURISH_THRESHOLD = 0.7;
const DRIFT_GAIN_PER_YEAR = 0.008;     // pact adherence erodes quietly
const DRIFT_WRATH_THRESHOLD = 0.6;     // deity flips to wrathful past this
const DRIFT_SCHISM_THRESHOLD = 0.8;    // a wing defects at this drift
const DEITY_POWER_DEATH_YEARS = 20;    // years at power=0 → dead
const DEITY_WRATH_DAMAGE = 0.15;       // province wealth/pop shave when smited
const MILITANT_ORDER_PRESTIGE = 0.6;   // must be this prestigious to spawn one
const INVESTITURE_CONFLICT_PRESTIGE = 0.65;

const DOMAINS: DeityDomain[] = [
  "war", "harvest", "sea", "death", "knowledge", "forge",
  "hearth", "shadow", "stars", "beasts", "trickery", "law",
];

// Procedural deity names — theonym roots + suffixes. The chronicler doesn't
// care about linguistic realism, only that each god has a unique memorable
// handle. Historical parallel: "Nergal", "Innana", "Baldr" are all just
// syllable clusters that stuck.
const DEITY_NAME_ROOTS = [
  "Iku", "Vaz", "Nym", "Kor", "Sil", "Bel", "Zar", "Ashun", "Grom", "Vespar",
  "Ilra", "Yorn", "Kaen", "Threa", "Ossen", "Mor", "Ath", "Kirenn", "Xul", "Ophir",
];
const DEITY_NAME_SUFFIXES = [
  "the Grim", "the Bright", "the Deep", "Sun-Eyed", "of the Salt Road",
  "the Watching", "the Nameless", "Bearer-of-Fires", "the Forge-Wright",
  "Storm-Herald", "of the Silent Shore", "the Rime-Crowned", "the Hollow",
];

const PACT_TEMPLATES: Record<DeityDomain, string[]> = {
  war:       ["Blood before every campaign", "No warrior slain while praying"],
  harvest:   ["First sheaf offered at harvest", "No plough on the tenth day"],
  sea:       ["No ships on the death-day", "A pearl for every safe crossing"],
  death:     ["Bury with copper coins", "No corpse burnt within city walls"],
  knowledge: ["Every scholar tithes a book", "No lie under the moot-oath"],
  forge:     ["Iron cooled only in blessed water", "The first blade of every smith is given"],
  hearth:    ["Fires never fully quenched", "Guest-right sacred under my roof"],
  shadow:    ["No name spoken thrice in the dark", "Silver at every threshold"],
  stars:     ["Watch the eastern star at midwinter", "No roof between priest and sky"],
  beasts:    ["No hunt in the birthing season", "Bear-heart burned, never eaten"],
  trickery:  ["A tenth of every gain to the thieves-den", "No oath in my name is binding"],
  law:       ["Judges wear no adornment", "No verdict without three witnesses"],
};

// Called from tick.ts once per year, AFTER runInnovations / runAcademies so
// that scholars are already advanced and any invention benefits are settled.
export function runReligion(w: World): void {
  if (!w.magicEnabled) return;
  maybeManifestDeity(w);
  formNewChurches(w);
  ageDeities(w);
  ageChurches(w);
}

// ---------------------------------------------------------------------------
// Deity manifestation. A new god arrives when:
//   - the world is at least DEITY_MANIFEST_YEAR years old
//   - there are fewer than MAX_LIVING_DEITIES living deities
//   - the roll succeeds
// Domain is biased by the province where it emerges (high-mana → shadow/stars,
// coastal → sea, etc.).
// ---------------------------------------------------------------------------
function maybeManifestDeity(w: World): void {
  if (w.year < DEITY_MANIFEST_YEAR) return;
  if (w.livingDeities().length >= MAX_LIVING_DEITIES) return;

  // Post-Vanishing scepticism — the world just spent 500-2000 years without
  // gods answering; new manifestations meet suspicion, not devotion.
  let prob = DEITY_MANIFEST_PROB;
  const postVanishing = w.godsVanishedYear !== null;
  if (postVanishing) {
    const yearsSinceStart = w.year;
    if (yearsSinceStart < POST_VANISHING_SKEPTIC_YEARS) return;
    prob *= POST_VANISHING_PROB_SCALE;
  }
  if (!w.rng.chance(prob)) return;

  // Pick an anchor province — favours high-mana and populous, but any works.
  const provinces = [...w.provinces.values()].filter((p) => !p.subsurface);
  if (provinces.length === 0) return;
  const anchor = provinces[Math.floor(w.rng.next() * provinces.length)];

  // Domain lean by province flavour.
  let domainPool: DeityDomain[] = [...DOMAINS];
  if (anchor.manaDensity > 0.6) domainPool = ["shadow", "stars", "death", "beasts"];
  else if (anchor.terrain === "coast") domainPool = ["sea", "trickery", "war"];
  else if (anchor.terrain === "mountain") domainPool = ["forge", "law", "stars"];
  else if (anchor.terrain === "forest") domainPool = ["beasts", "shadow", "hearth"];
  else if (anchor.terrain === "steppe") domainPool = ["war", "beasts", "trickery"];
  const domain = domainPool[Math.floor(w.rng.next() * domainPool.length)];

  // Name it.
  const root = DEITY_NAME_ROOTS[Math.floor(w.rng.next() * DEITY_NAME_ROOTS.length)];
  const suffix = DEITY_NAME_SUFFIXES[Math.floor(w.rng.next() * DEITY_NAME_SUFFIXES.length)];
  const name = `${root} ${suffix}`;

  // Pact terms — two of the templates for this domain.
  const pool = PACT_TEMPLATES[domain];
  const pactTerms = shuffle(w, [...pool]).slice(0, Math.min(2, pool.length));

  const id: DeityId = w.freshId("dt");
  const tier: "true" | "demigod" = postVanishing ? "demigod" : "true";
  const startPower = postVanishing ? DEMIGOD_INITIAL_POWER : 0.5;
  const deity: Deity = {
    id,
    name,
    domain,
    tier,
    mood: "attentive",
    power: startPower,
    peakPower: startPower,
    followerCount: 0,
    emergedYear: w.year,
    slumberSince: null,
    diedYear: null,
    slayerId: null,
    pactTerms,
    homeProvinceId: anchor.id,
    rivalDeityIds: [],
  };
  w.deities.set(id, deity);

  // Rivalries with any existing wrathful god, or with a same-domain competitor.
  for (const other of w.livingDeities()) {
    if (other.id === id) continue;
    if (other.domain === domain || other.mood === "wrathful") {
      deity.rivalDeityIds.push(other.id);
      other.rivalDeityIds.push(id);
    }
  }

  w.log("DEITY_MANIFESTS", {
    provinceId: anchor.id,
    data: {
      deityId: id,
      deity: name,
      domain,
      pact: pactTerms.join(" · "),
      home: anchor.name,
      postVanishing,
      tier,
    },
  });
}

// ---------------------------------------------------------------------------
// Church formation. Provinces with a living deity in scope, no active church
// for that deity yet, and at least one adult character in-province can host a
// consecration. Weighted toward high-piety cultures (zealous_faith) but not
// gated on them — even secular provinces sometimes get a chapel.
// ---------------------------------------------------------------------------
function formNewChurches(w: World): void {
  const gods = w.livingDeities();
  if (gods.length === 0) return;

  for (const p of w.provinces.values()) {
    if (p.subsurface) continue;
    // Pick a deity — bias toward the province's "home" god (if any), else
    // the domain-fit god, else uniform.
    const homeGod = gods.find((g) => g.homeProvinceId === p.id);
    const candidateGods = homeGod ? [homeGod] : gods;

    for (const god of candidateGods) {
      if (churchOfAt(w, god.id, p.id)) continue;
      // Only ordain if any adult lives here (need a first patriarch).
      const locals = w.living().filter((c) => c.provinceId === p.id && w.age(c) >= 20);
      if (locals.length === 0) continue;

      // Culture pressure — a zealous_faith culture almost always founds; a
      // secular one rolls low.
      let prob = CHURCH_FORMATION_PROB * (god.mood === "attentive" ? 1 : 0.3);
      const holder = [...w.titles.values()].find((t) => t.provinceId === p.id);
      const holderChar = w.char(holder?.holderId ?? null);
      if (holderChar) {
        const dyn = w.dynasty(holderChar.dynastyId);
        if (dyn?.cultureId) {
          const state = w.cultureState(dyn.cultureId);
          const starting = w.cultures.get(dyn.cultureId)?.startingTraits ?? [];
          if (state.eliteTraits.has("zealous_faith") || starting.includes("zealous_faith")) prob *= 3;
          if (state.eliteTraits.has("meritocracy")) prob *= 0.5;   // meritocratic → less church
          if (state.eliteTraits.has("literacy_valued")) prob *= 1.2; // literate → texts, priests
        }
      }
      if (!w.rng.chance(prob)) continue;

      // The patriarch is the eldest highest-level scholar or, failing that,
      // the eldest local. Gives a scholar-class founder when possible.
      const patriarch = [...locals]
        .sort((a, b) => {
          const rankA = (a.charClass === "scholar" ? 1000 : 0) + a.level * 10 + w.age(a);
          const rankB = (b.charClass === "scholar" ? 1000 : 0) + b.level * 10 + w.age(b);
          return rankB - rankA;
        })[0];

      const id: ChurchId = w.freshId("ch");
      const church: Church = {
        id,
        name: `Temple of ${god.name}`,
        deityId: god.id,
        foundedYear: w.year,
        disbandedYear: null,
        headProvinceId: p.id,
        patriarchId: patriarch.id,
        memberIds: [patriarch.id],
        prestige: 0.3,
        peakPrestige: 0.3,
        doctrineDrift: 0,
        schismedFromId: null,
        militantOrder: false,
        investitureConflictWithIds: [],
        flourishesLoggedAt: null,
      };
      w.churches.set(id, church);
      w.log("CHURCH_FOUNDED", {
        actorId: patriarch.id,
        provinceId: p.id,
        data: {
          churchId: id,
          church: church.name,
          deityId: god.id,
          deity: god.name,
          domain: god.domain,
        },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Deity aging — power tracks follower count (grows fast when the pantheon is
// small, saturates as churches spread). Wrath and death cascades fire here.
// ---------------------------------------------------------------------------
function ageDeities(w: World): void {
  for (const god of w.deities.values()) {
    if (god.mood === "dead") continue;
    const followers = countFollowers(w, god.id);
    god.followerCount = followers;

    // Power drift.
    // Attentive: +0.02 per living faithful-church, -0.03 baseline entropy.
    // Withdrawing: -0.05/y (unless miracle intervenes).
    // Wrathful: -0.02 (angry gods burn hot but bleed).
    let delta = 0;
    const churches = w.churchesOf(god.id);
    switch (god.mood) {
      case "attentive":
        delta = 0.02 * churches.length - 0.03;
        break;
      case "distant":
        delta = 0.01 * churches.length - 0.04;
        break;
      case "wrathful":
        delta = -0.02;
        break;
      case "withdrawing":
        delta = -0.05;
        break;
      default:
        break;
    }
    // Post-Vanishing demigods live under a hard power ceiling — the ascended
    // plane is closed, so they cannot grow into full gods.
    const ceiling = god.tier === "demigod" ? DEMIGOD_PEAK_POWER : 1;
    god.power = Math.max(0, Math.min(ceiling, god.power + delta));
    if (god.power > god.peakPower) god.peakPower = god.power;

    // Mood transitions.
    if (god.mood === "attentive" && churches.length === 0 && w.year - god.emergedYear > 40) {
      god.mood = "distant";
      god.slumberSince = w.year;
    } else if (god.mood === "attentive" && churches.some((c) => c.doctrineDrift >= DRIFT_WRATH_THRESHOLD)) {
      god.mood = "wrathful";
    } else if (god.mood === "wrathful" && churches.every((c) => c.doctrineDrift < DRIFT_WRATH_THRESHOLD - 0.2)) {
      god.mood = "attentive";  // pact restored
    }
    if (god.power <= 0.05 && god.mood !== "withdrawing") {
      god.mood = "withdrawing";
      god.slumberSince = god.slumberSince ?? w.year;
      w.log("DEITY_WITHDRAWS", {
        provinceId: god.homeProvinceId,
        data: { deityId: god.id, deity: god.name, domain: god.domain, followers },
      });
    }
    if (god.mood === "withdrawing" && god.power === 0 && (w.year - (god.slumberSince ?? w.year)) >= DEITY_POWER_DEATH_YEARS) {
      god.mood = "dead";
      god.diedYear = w.year;
      w.log("DEITY_DIES", {
        provinceId: god.homeProvinceId,
        data: {
          deityId: god.id,
          deity: god.name,
          domain: god.domain,
          agedYears: w.year - god.emergedYear,
        },
      });
      // Cascade: mark all this god's churches as adrift.
      for (const ch of w.churchesOf(god.id)) {
        ch.doctrineDrift = 1;  // maximum drift; they'll either dissolve or migrate patron
      }
    }

    // Wrathful gods smite one of their misaligned churches occasionally.
    if (god.mood === "wrathful" && w.rng.chance(0.15)) {
      const targets = churches.filter((c) => c.doctrineDrift >= DRIFT_WRATH_THRESHOLD);
      if (targets.length > 0) {
        const victim = targets[Math.floor(w.rng.next() * targets.length)];
        const prov = w.province(victim.headProvinceId);
        if (prov) {
          prov.population = Math.max(50, Math.floor(prov.population * (1 - DEITY_WRATH_DAMAGE)));
          // Divine wrath leaves a slight taint on the land — a nudge of blight.
          prov.blightLevel = Math.min(1, prov.blightLevel + 0.05);
        }
        w.log("DIVINE_WRATH", {
          provinceId: victim.headProvinceId,
          data: {
            deityId: god.id,
            deity: god.name,
            churchId: victim.id,
            church: victim.name,
            drift: Math.round(victim.doctrineDrift * 100) / 100,
          },
        });
      }
    }

    // Demigods are killable — the ascended plane is closed, so nothing they
    // can do makes them safe from a strong mortal. Odds rise when the god is
    // wrathful (making enemies), scale with the god's power (a target worth
    // hunting), and require a high-level warrior or mage to be alive.
    if (god.tier === "demigod" && god.mood !== "dead") {
      let slayProb = DEMIGOD_SLAY_BASE_PROB * (0.5 + god.power);
      if (god.mood === "wrathful") slayProb *= 3;
      if (w.rng.chance(slayProb)) {
        const heroes = w.living().filter(
          (c) => c.level >= 15 && (c.charClass === "knight" || c.charClass === "soldier"
              || c.charClass === "stormcaller" || c.charClass === "necromancer" || c.charClass === "warden"),
        );
        if (heroes.length > 0) {
          const slayer = heroes.reduce((a, b) => (b.level > a.level ? b : a));
          god.power = 0;
          god.mood = "dead";
          god.diedYear = w.year;
          god.slayerId = slayer.id;
          w.log("DEMIGOD_SLAIN", {
            actorId: slayer.id,
            provinceId: god.homeProvinceId,
            data: {
              deityId: god.id,
              deity: god.name,
              domain: god.domain,
              slayer: slayer.name,
              slayerLevel: slayer.level,
              slayerClass: slayer.charClass,
            },
          });
          // Cascade: all this demigod's churches are cut loose.
          for (const ch of w.churchesOf(god.id)) ch.doctrineDrift = 1;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Church aging — drift, prestige, schisms, militant orders, investiture.
// ---------------------------------------------------------------------------
function ageChurches(w: World): void {
  for (const ch of w.churches.values()) {
    if (ch.disbandedYear !== null) continue;

    // Prune dead clergy.
    ch.memberIds = ch.memberIds.filter((id) => w.characters.get(id)?.alive === true);
    const god = w.deities.get(ch.deityId);
    if (!god) continue;

    if (ch.memberIds.length === 0) {
      ch.disbandedYear = w.year;
      w.log("CHURCH_DISSOLVED", {
        provinceId: ch.headProvinceId,
        data: {
          churchId: ch.id,
          church: ch.name,
          cause: god.mood === "dead" ? "no clergy — patron dead" : "no clergy remain",
        },
      });
      continue;
    }

    // Update patriarch to highest-level clergyman.
    const members = ch.memberIds.map((id) => w.characters.get(id)!).filter((c) => c);
    ch.patriarchId = members.reduce((p, c) => (c.level > p.level ? c : p), members[0]).id;

    // Recruit local adults into the clergy — slow drip.
    if (w.rng.chance(0.1)) {
      const candidates = w.living().filter(
        (c) => c.provinceId === ch.headProvinceId
            && w.age(c) >= 18 && w.age(c) <= 60
            && !ch.memberIds.includes(c.id),
      );
      if (candidates.length > 0) {
        const pick = candidates[Math.floor(w.rng.next() * candidates.length)];
        ch.memberIds.push(pick.id);
      }
    }

    // Drift naturally rises; attentive god slows it, wrathful accelerates it,
    // dead god pegs it at max.
    let drift = ch.doctrineDrift;
    if (god.mood === "attentive") drift += DRIFT_GAIN_PER_YEAR * 0.5;
    else if (god.mood === "distant") drift += DRIFT_GAIN_PER_YEAR;
    else if (god.mood === "wrathful") drift += DRIFT_GAIN_PER_YEAR * 2;
    else if (god.mood === "withdrawing") drift += DRIFT_GAIN_PER_YEAR * 1.5;
    ch.doctrineDrift = Math.max(0, Math.min(1, drift));

    // Prestige tracks clergy + god's power + drift penalty.
    const prestigeTarget = Math.min(1, 0.15 + 0.05 * ch.memberIds.length + 0.4 * god.power - 0.3 * ch.doctrineDrift);
    ch.prestige = ch.prestige + (prestigeTarget - ch.prestige) * 0.2;
    ch.prestige = Math.max(0, Math.min(1, ch.prestige));
    if (ch.prestige > ch.peakPrestige) ch.peakPrestige = ch.prestige;

    if (ch.prestige >= CHURCH_FLOURISH_THRESHOLD && ch.flourishesLoggedAt === null) {
      ch.flourishesLoggedAt = w.year;
      w.log("CHURCH_FLOURISHES", {
        provinceId: ch.headProvinceId,
        data: {
          churchId: ch.id,
          church: ch.name,
          deity: god.name,
          prestige: Math.round(ch.prestige * 100) / 100,
        },
      });
    }

    // Militant order — Templars pattern. Requires high prestige + attentive god
    // + local martial character in the clergy.
    if (!ch.militantOrder && ch.prestige >= MILITANT_ORDER_PRESTIGE && god.mood === "attentive") {
      const knight = members.find((c) => c.charClass === "knight" || c.charClass === "soldier");
      if (knight && w.rng.chance(0.05)) {
        ch.militantOrder = true;
        w.log("MILITANT_ORDER_FOUNDED", {
          actorId: knight.id,
          provinceId: ch.headProvinceId,
          data: {
            churchId: ch.id,
            church: ch.name,
            deity: god.name,
            captain: knight.name,
          },
        });
      }
    }

    // Schism — a wing of the church defects to another patron (if any) when
    // drift is too high and the god is not attentive. This is the "patron
    // switching" schism unique to real-gods worlds.
    if (ch.doctrineDrift >= DRIFT_SCHISM_THRESHOLD && ch.memberIds.length >= 3) {
      const other = w.livingDeities().find((g) => g.id !== god.id && g.mood === "attentive");
      if (other && w.rng.chance(0.2)) {
        splitChurch(w, ch, other.id);
      }
    }

    // Investiture conflict — attentive high-prestige church + non-devotee
    // holder at province → the patriarch demands submission.
    if (
      god.mood === "attentive"
      && ch.prestige >= INVESTITURE_CONFLICT_PRESTIGE
      && ch.investitureConflictWithIds.length === 0
    ) {
      const provTitles = [...w.titles.values()].filter((t) => t.provinceId === ch.headProvinceId);
      for (const t of provTitles) {
        if (t.tier !== "kingdom" && t.tier !== "duchy") continue;
        const holder = w.char(t.holderId);
        if (!holder) continue;
        if (ch.memberIds.includes(holder.id)) continue; // holder IS in the church
        if (w.rng.chance(0.15)) {
          ch.investitureConflictWithIds.push(t.id);
          w.log("INVESTITURE_CONFLICT", {
            actorId: ch.patriarchId,
            targetId: holder.id,
            titleId: t.id,
            provinceId: ch.headProvinceId,
            data: {
              church: ch.name,
              deity: god.name,
              title: t.name,
            },
          });
        }
      }
    }
    // Resolve open investiture conflicts if the holder has changed OR after
    // enough time — concordat prose.
    if (ch.investitureConflictWithIds.length > 0 && w.rng.chance(0.08)) {
      const resolved = ch.investitureConflictWithIds[0];
      ch.investitureConflictWithIds.shift();
      const t = w.titles.get(resolved);
      w.log("CONCORDAT_SIGNED", {
        actorId: ch.patriarchId,
        titleId: resolved,
        provinceId: ch.headProvinceId,
        data: { church: ch.name, deity: god.name, title: t?.name ?? "the crown" },
      });
    }

    // Divine intervention — an attentive god occasionally answers a war
    // prayer. Look for a war involving a holder who is a church member,
    // and shift the outcome via a logged event (mechanics stay light —
    // primarily a narrative hook, not a world-changing lever).
    if (god.mood === "attentive" && ch.militantOrder && w.rng.chance(0.06)) {
      const beneficiary = members.find((c) => c.charClass === "knight" || c.charClass === "soldier");
      if (beneficiary) {
        w.log("DIVINE_INTERVENTION", {
          actorId: beneficiary.id,
          provinceId: ch.headProvinceId,
          data: { church: ch.name, deity: god.name },
        });
      }
    }
  }
}

// Split a church: half its members leave with a new church name serving the
// target deity, keeping the schismedFromId as a trail.
function splitChurch(w: World, parent: Church, newDeityId: DeityId): void {
  const god = w.deities.get(newDeityId);
  if (!god) return;
  const takers = parent.memberIds.slice(0, Math.floor(parent.memberIds.length / 2));
  const stayers = parent.memberIds.slice(takers.length);
  if (takers.length === 0) return;
  parent.memberIds = stayers;
  parent.doctrineDrift = Math.max(0, parent.doctrineDrift - 0.3);

  const id: ChurchId = w.freshId("ch");
  const newChurch: Church = {
    id,
    name: `Sanctuary of ${god.name}`,
    deityId: newDeityId,
    foundedYear: w.year,
    disbandedYear: null,
    headProvinceId: parent.headProvinceId,
    patriarchId: takers[0],
    memberIds: takers,
    prestige: 0.25,
    peakPrestige: 0.25,
    doctrineDrift: 0,
    schismedFromId: parent.id,
    militantOrder: false,
    investitureConflictWithIds: [],
    flourishesLoggedAt: null,
  };
  w.churches.set(id, newChurch);
  w.log("CHURCH_SCHISM", {
    actorId: takers[0],
    provinceId: parent.headProvinceId,
    data: {
      fromChurchId: parent.id,
      fromChurch: parent.name,
      toChurchId: id,
      toChurch: newChurch.name,
      newDeity: god.name,
      defectors: takers.length,
    },
  });
}

function churchOfAt(w: World, deityId: DeityId, provinceId: ProvinceId): Church | undefined {
  for (const ch of w.churches.values()) {
    if (ch.disbandedYear !== null) continue;
    if (ch.deityId === deityId && ch.headProvinceId === provinceId) return ch;
  }
  return undefined;
}

// Rough follower count = clergy + a share of provincial population where the
// church stands. Used only for narrative colour + power growth, not exact
// mechanics, so a light estimate is fine.
function countFollowers(w: World, deityId: DeityId): number {
  let total = 0;
  for (const ch of w.churchesOf(deityId)) {
    total += ch.memberIds.length;
    const prov = w.province(ch.headProvinceId);
    if (prov) total += Math.floor(prov.population * 0.1 * ch.prestige);
  }
  return total;
}

// Deterministic shuffle: pull elements in RNG-chosen indices.
function shuffle<T>(w: World, arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(w.rng.next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Explicit "unused" reference to silence tsc's strict mode on Character import.
export function _churchClerics(w: World, ch: Church): Character[] {
  return ch.memberIds
    .map((id) => w.characters.get(id))
    .filter((c): c is Character => !!c);
}
