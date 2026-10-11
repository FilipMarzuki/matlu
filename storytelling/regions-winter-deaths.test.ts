// regions-winter-deaths.test.ts — #1617: hard winters and famine can carry off
// named people. Excluded from storytelling/tsconfig (it imports `vitest`); run
// by `npm run unit:story`.
//
// #1608 made a hard winter and a famine thin a province's abstract population.
// Now the old, the sick and the poor among a region's NAMED residents can die
// too, with odds scaled by how hard the times bite (hardship), drawn from the
// regional stream only. A succession sweep after the regional pass passes a
// dead lord's title the same year, and the regional level's log cursor reads
// those late deaths and successions the following year.
//
// Like regions-feedback.test.ts, most tests hand pushBack a year directly. To
// see "who CAN die" without hunting for a seed, a few replace the regional
// stream's next() with a tiny constant: every roll then comes up a death, so
// exactly the people with any risk at all die, and nobody else.

import { beforeAll, describe, expect, test } from "vitest";
import { loadWorld } from "./seed.js";
import { DEFAULT_SPEC } from "./world-spec.js";
import { FEEDBACK, frailty, hardTimesRisk, hardship, pushBack, type Pressure } from "./regions.js";
import { regionalSignificance } from "./sifter.js";
import { renderEvent, renderRegionalEvent } from "./render.js";
import { runSim, GOLDEN } from "./testkit.js";
import { tick } from "./tick.js";
import type { Character, Region, RegionalEvent, WorldEvent } from "./types.js";
import type { World } from "./world.js";

const SEED = 42;
const fresh = () => loadWorld(DEFAULT_SPEC, SEED);
const regionOf = (w: World): Region => [...w.regions.values()].sort((a, b) => b.provinceIds.length - a.provinceIds.length)[0];
const quiet = (r: Region, over: Partial<Pressure> = {}): Pressure => ({
  levyLords: [], hardWinter: false, famine: [], bandits: null, prosperityBefore: r.prosperity, news: [], ...over,
});
const news = (r: Region, kind: RegionalEvent["kind"], data: RegionalEvent["data"] = {}): RegionalEvent => ({
  id: 0, year: 0, regionId: r.id, kind, category: "event", provinceId: null, actorId: null, targetId: null,
  titleId: null, otherRegionId: null, causeEventId: null, data, significance: 0,
});
/** Every regional roll comes up "yes" (a tiny constant, not 0, so a gaussian draw stays finite). */
const everyRollDeadly = (w: World) => { (w.regionRng as unknown as { next: () => number }).next = () => 0.001; };
/** The region's seated lords, one per province. */
const lordsOf = (w: World, r: Region): Character[] => r.provinceIds.map((id) => w.char(w.title(w.province(id)!.titleId)!.holderId)!);
/** Make someone healthy, in their prime and on clean land (not old, not sick). */
const hale = (w: World, c: Character) => { c.birthYear = w.year - 30; c.psyche.inbreedingCoeff = 0; w.province(c.provinceId)!.plaguedYear = undefined; };
/** Everyone named who lives in the region. */
const residents = (w: World, r: Region) => w.living().filter((c) => r.provinceIds.includes(c.provinceId));

describe("hard winters and famine carry off named people (#1617)", () => {
  // Scenario 1
  // Given a hard winter in a region, a frail resident (old) and a hale lord,
  // When the region pushes back with every roll a death,
  // Then the frail one dies of the cold and the hale lord lives.
  test("a hard winter takes the old, the sick and the poor, never the hale", () => {
    const w = fresh();
    const r = regionOf(w);
    const lords = lordsOf(w, r);
    for (const l of lords) hale(w, l);
    const [old, sick] = [lords[1], lords[2]];
    old.birthYear = w.year - 120;
    sick.psyche.inbreedingCoeff = 0.25;
    expect(frailty(w, old)).toBeGreaterThan(0);
    expect(frailty(w, sick)).toBeGreaterThan(0);
    expect(frailty(w, lords[0])).toBe(0);
    const frailBefore = residents(w, r).filter((c) => frailty(w, c) > 0 && !w.province(c.provinceId)!.subsurface);
    const haleBefore = residents(w, r).filter((c) => frailty(w, c) === 0);
    const winter = news(r, "HARD_WINTER");
    everyRollDeadly(w);
    pushBack(w, r, quiet(r, { hardWinter: true, winterEvent: winter, prosperityBefore: 0.2 }));
    expect(old.alive).toBe(false);
    expect(old.causeOfDeath).toBe("cold");
    expect(sick.alive).toBe(false);
    for (const c of frailBefore) expect(c.alive, c.name).toBe(false);
    for (const c of haleBefore) expect(c.alive, c.name).toBe(true);
    // The deaths are the engine's: logged, so successions and the chronicle see them.
    const deaths = w.events.filter((e) => e.type === "DEATH" && e.data["cause"] === "cold");
    expect(deaths.length).toBe(frailBefore.length);
    // The winter's own event knows who it took, and tells the most notable.
    expect(winter.data["named_dead"]).toBe(frailBefore.length);
    expect(winter.actorId).not.toBeNull();
    expect(renderRegionalEvent(w, winter)).toMatch(/Among the dead was/);
    expect(winter.significance).toBe(regionalSignificance("HARD_WINTER", winter.data));
    expect(renderEvent(w, deaths[0])).toMatch(/died of cold/);
  });

  // Scenario 2
  // Given the same frail person,
  // When the times are harder (a poorer region, famine on top of a winter),
  // Then the odds of dying are higher; and in a quiet year, or for a hale person, they are nil.
  test("the odds scale with hardship and with frailty, and are nil for the hale or in a quiet year", () => {
    const poor = hardship(0.15), rich = hardship(0.85);
    expect(hardTimesRisk(1, poor, true, false)).toBeGreaterThan(hardTimesRisk(1, rich, true, false));
    expect(hardTimesRisk(1, poor, true, true)).toBeGreaterThan(hardTimesRisk(1, poor, true, false));
    expect(hardTimesRisk(1, poor, false, true)).toBeGreaterThan(hardTimesRisk(1, poor, true, false)); // famine is the deadlier
    expect(hardTimesRisk(2, poor, true, false)).toBeGreaterThan(hardTimesRisk(1, poor, true, false));
    expect(hardTimesRisk(0, poor, true, true)).toBe(0);
    expect(hardTimesRisk(3, poor, false, false)).toBe(0);
    expect(hardTimesRisk(99, 99, true, true)).toBeLessThanOrEqual(FEEDBACK.namedCap);
    expect(hardTimesRisk(1, 1, true, false)).toBeCloseTo(FEEDBACK.winterNamed, 6);
  });

  // Scenario 3
  // Given someone old, someone sick (fever in their province lately, or close-kin blood) and someone poor (landless and lowborn),
  // When their frailty is read,
  // Then each counts, a seat keeps its holder from being poor, and frailties add up.
  test("who is frail: the old, the sick and the poor", () => {
    const w = fresh();
    const r = regionOf(w);
    const [a, b] = lordsOf(w, r);
    hale(w, a);
    expect(frailty(w, a)).toBe(0);
    a.birthYear = w.year - 120;
    expect(frailty(w, a)).toBeCloseTo(FEEDBACK.frailOld, 6);
    w.province(a.provinceId)!.plaguedYear = w.year - 1;
    expect(frailty(w, a)).toBeCloseTo(FEEDBACK.frailOld + FEEDBACK.frailSick, 6);
    // A seated lord is never poor, even lowborn: the seat has stores.
    hale(w, b);
    b.lowborn = true;
    expect(frailty(w, b)).toBe(0);
    // A landless lowborn is.
    const landless = w.living().find((c) => w.titlesHeldBy(c.id).length === 0)!;
    hale(w, landless);
    landless.lowborn = true;
    expect(frailty(w, landless)).toBeCloseTo(FEEDBACK.frailPoor, 6);
  });

  // Scenario 4
  // Given a famine in one of a region's provinces and no hard winter,
  // When the region pushes back with every roll a death,
  // Then the frail of that province die of famine, the frail elsewhere in the region live,
  // and the region's famine event counts the named dead.
  test("famine takes the frail where it struck, and only there", () => {
    const w = fresh();
    const r = regionOf(w);
    const target = r.provinceIds[1];
    for (const c of residents(w, r)) { c.birthYear = w.year - 120; c.psyche.inbreedingCoeff = 0; }
    const there = residents(w, r).filter((c) => c.provinceId === target);
    const elsewhere = residents(w, r).filter((c) => c.provinceId !== target);
    expect(there.length).toBeGreaterThan(0);
    expect(elsewhere.length).toBeGreaterThan(0);
    const famine = news(r, "FAMINE", { provinces: 1 });
    everyRollDeadly(w);
    pushBack(w, r, quiet(r, { famine: [target], news: [famine] }));
    for (const c of there) { expect(c.alive).toBe(false); expect(c.causeOfDeath).toBe("famine"); }
    for (const c of elsewhere) expect(c.alive).toBe(true);
    expect(famine.data["named_dead"]).toBe(there.length);
  });

  // Scenario 5
  // Given underground halls in a hard winter,
  // When the region pushes back,
  // Then their people are spared the cold (as #1608 spares their population).
  test("underground halls are spared the cold", () => {
    const w = fresh();
    const r = regionOf(w);
    const hall = w.province(r.provinceIds[1])!;
    hall.subsurface = true;
    const below = residents(w, r).filter((c) => c.provinceId === hall.id);
    for (const c of below) c.birthYear = w.year - 120;
    everyRollDeadly(w);
    pushBack(w, r, quiet(r, { hardWinter: true }));
    for (const c of below) expect(c.alive).toBe(true);
  });

  // Scenario 6
  // Given a lord frail enough to die in a hard winter,
  // When the year is ticked,
  // Then his title passes the same year (an heir holds it, or a crisis is logged that year),
  // And next year the region tells the lord's death, dated the year he died.
  test("a lord who dies in the winter is succeeded the same year, and the region hears of it", () => {
    const w = fresh();
    const r = regionOf(w);
    const lord = lordsOf(w, r)[1];
    const seat = w.title(w.province(r.provinceIds[1])!.titleId)!;
    hale(w, lord);
    lord.psyche.inbreedingCoeff = 0.25; // sickly blood: frail, but not old enough for the engine's own mortality to take him first
    everyRollDeadly(w);
    tick(w);
    const year = w.year;
    expect(lord.alive).toBe(false);
    expect(lord.causeOfDeath).toBe("cold");
    expect(lord.deathYear).toBe(year);
    // No title is left held by the dead at the end of the year.
    for (const t of w.titles.values()) if (t.holderId) expect(w.char(t.holderId)?.alive, t.name).toBe(true);
    const passed = w.events.find((e: WorldEvent) => e.year === year && (e.type === "SUCCESSION" || e.type === "SUCCESSION_CRISIS") && e.targetId === lord.id && e.titleId === seat.id);
    expect(passed, "the seat passed in the year he died").toBeDefined();

    tick(w);
    const told = w.regionalEvents.find((e) => (e.kind === "LORD_DIED" || e.kind === "SEAT_VACANT") && e.targetId === lord.id);
    expect(told, "the region told the lord's death").toBeDefined();
    expect(told!.year).toBe(year);
  }, 30_000);

  // Scenario 7
  // Given a frail region in a hard winter,
  // When the region pushes back,
  // Then the engine's own stream (World.rng) is untouched.
  test("never draws from the engine's own stream (World.rng)", () => {
    const w = fresh();
    const r = regionOf(w);
    for (const c of residents(w, r)) c.birthYear = w.year - 120;
    const state = (x: World) => (x.rng as unknown as { state: number }).state;
    const before = state(w);
    const deaths = w.events.length;
    pushBack(w, r, quiet(r, { hardWinter: true, famine: [r.provinceIds[1]], prosperityBefore: 0.1 }));
    expect(w.events.length).toBeGreaterThan(deaths); // someone died
    expect(state(w)).toBe(before);
  });
});

// Scenario 8
// Given the default world over 200 years (a heavy run, built once),
// When it is simulated twice from the same seed,
// Then the same named people die of the cold and of hunger, some do, and no title is held by the dead.
describe("over a whole history (#1617)", () => {
  let a: World, b: World;
  beforeAll(() => { a = runSim(GOLDEN[0]); b = runSim(GOLDEN[0]); }, 60_000);
  const winterDead = (w: World) => w.events.filter((e) => e.type === "DEATH" && e.data["cause"] === "cold").map((e) => `${e.year}:${e.actorId}`);

  test("named people die in hard winters, deterministically", () => {
    expect(winterDead(a).length).toBeGreaterThan(0);
    expect(winterDead(a)).toEqual(winterDead(b));
    // And the region's winters know their named dead.
    expect(a.regionalEvents.some((e) => e.kind === "HARD_WINTER" && Number(e.data["named_dead"] ?? 0) > 0)).toBe(true);
  });

  test("no title is held by the dead at the end", () => {
    for (const t of a.titles.values()) if (t.holderId) expect(a.char(t.holderId)?.alive, t.name).toBe(true);
  });

  test("not a cull: the hard times take a modest share of the named dead", () => {
    const all = a.events.filter((e) => e.type === "DEATH").length;
    expect(winterDead(a).length / all).toBeLessThan(0.1);
  });
});
