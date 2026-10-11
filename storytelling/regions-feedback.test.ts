// regions-feedback.test.ts — #1608: the regional level pushes back into the
// simulation. Excluded from storytelling/tsconfig (it imports `vitest`); run by
// `npm run unit:story`.
//
// Each test builds two identical worlds from the same seed (the engine is
// deterministic, so they start byte-identical), hands one region a year with
// some trouble in it (pushBack's `Pressure`) and the other a control year, and
// checks the difference. That isolates one feedback at a time, without having
// to find a seed where a levy or a hard winter happens to fall.

import { describe, expect, test } from "vitest";
import { loadWorld } from "./seed.js";
import { DEFAULT_SPEC } from "./world-spec.js";
import { FEEDBACK, hardship, pushBack, type Pressure } from "./regions.js";
import { regenerateGoals } from "./goals.js";
import { regionalSignificance } from "./sifter.js";
import { renderRegionalEvent } from "./render.js";
import { runSim, GOLDEN } from "./testkit.js";
import type { Province, Region, RegionalEvent, TradeRoute } from "./types.js";
import type { World } from "./world.js";

const SEED = 42;
const fresh = () => loadWorld(DEFAULT_SPEC, SEED);
/** The world's biggest region, and one of its provinces that isn't the market town. */
const regionOf = (w: World): Region => [...w.regions.values()].sort((a, b) => b.provinceIds.length - a.provinceIds.length)[0];
const village = (w: World, r: Region): Province => w.province(r.provinceIds[1])!;
const quiet = (r: Region, over: Partial<Pressure> = {}): Pressure => ({
  levyLords: [], hardWinter: false, famine: [], bandits: null, prosperityBefore: r.prosperity, news: [], ...over,
});
const holderOf = (w: World, p: Province) => w.title(p.titleId)!.holderId!;
const news = (r: Region, kind: RegionalEvent["kind"], data: RegionalEvent["data"] = {}): RegionalEvent => ({
  id: 0, year: 0, regionId: r.id, kind, category: "politics", provinceId: null, actorId: null, targetId: null,
  titleId: null, otherRegionId: null, causeEventId: null, data, significance: 0,
});

describe("regions push back (#1608)", () => {
  test("a levy thins the province whose lord fought, and slows its work", () => {
    const a = fresh(), b = fresh();
    const ra = regionOf(a), rb = regionOf(b);
    const pa = village(a, ra), pb = village(b, rb);
    expect(pa.population).toBe(pb.population);
    ra.levy = rb.levy = 0.6;
    pushBack(a, ra, quiet(ra, { levyLords: [holderOf(a, pa)] }));
    pushBack(b, rb, quiet(rb));
    expect(pa.population).toBeLessThan(pb.population);
    expect(pb.population - pa.population).toBe(Math.round(pb.population * FEEDBACK.levyToll * 0.6));
    // The other provinces' lords didn't fight: their people are untouched.
    for (const id of ra.provinceIds.slice(2)) expect(a.province(id)!.population).toBe(b.province(id)!.population);

    // Slows its work: with the men away, wealth falls behind a region with no levy.
    const c = fresh(), rc = regionOf(c);
    rc.levy = 0;
    pushBack(c, rc, quiet(rc));
    expect(pb.wealth!).toBeLessThan(village(c, rc).wealth!);
  });

  test("a hard winter costs lives and stores, more where the region is poor", () => {
    const [cold, mild] = [fresh(), fresh()];
    const rc = regionOf(cold), rm = regionOf(mild);
    pushBack(cold, rc, quiet(rc, { hardWinter: true }));
    pushBack(mild, rm, quiet(rm));
    for (const id of rc.provinceIds) {
      expect(cold.province(id)!.population).toBeLessThan(mild.province(id)!.population);
      expect(cold.province(id)!.wealth!).toBeLessThan(mild.province(id)!.wealth!);
    }

    // The same winter in a poor region and a rich one: the poor one loses more.
    const [poor, rich] = [fresh(), fresh()];
    const rp = regionOf(poor), rr = regionOf(rich);
    const winter = news(rp, "HARD_WINTER");
    pushBack(poor, rp, quiet(rp, { hardWinter: true, prosperityBefore: 0.2, winterEvent: winter }));
    pushBack(rich, rr, quiet(rr, { hardWinter: true, prosperityBefore: 0.8 }));
    const people = (w: World, r: Region) => r.provinceIds.reduce((s, id) => s + w.province(id)!.population, 0);
    expect(people(poor, rp)).toBeLessThan(people(rich, rr));
    expect(hardship(0.2)).toBeGreaterThan(hardship(0.8));
    // The winter's own event learns its toll, and a killing winter is worth a point more.
    expect(Number(winter.data["deaths"])).toBeGreaterThan(0);
    expect(winter.significance).toBe(regionalSignificance("HARD_WINTER", winter.data));
    expect(renderRegionalEvent(poor, winter)).toMatch(/died of the cold/);
  });

  test("famine costs more lives and stores where the region is poor", () => {
    const [poor, rich, none] = [fresh(), fresh(), fresh()];
    const rp = regionOf(poor), rr = regionOf(rich), rn = regionOf(none);
    const target = rp.provinceIds[1];
    pushBack(poor, rp, quiet(rp, { famine: [target], prosperityBefore: 0.15 }));
    pushBack(rich, rr, quiet(rr, { famine: [target], prosperityBefore: 0.85 }));
    pushBack(none, rn, quiet(rn));
    const [pp, pr, pn] = [poor, rich, none].map((w) => w.province(target)!);
    expect(pr.population).toBeLessThan(pn.population); // famine costs lives even in a rich region
    expect(pp.population).toBeLessThan(pr.population); // and more in a poor one
    expect(pp.wealth!).toBeLessThan(pr.wealth!);
    expect(pr.wealth!).toBeLessThan(pn.wealth!);
  });

  test("bandits rob where they work, and the trade on the region's roads", () => {
    const [hit, safe] = [fresh(), fresh()];
    const rh = regionOf(hit), rs = regionOf(safe);
    const route = (w: World, r: Region): TradeRoute => ({
      id: "tr_test", fromProvinceId: r.provinceIds[1], toProvinceId: r.centreId, conduit: "road" as TradeRoute["conduit"],
      foundedYear: w.year, closedYear: null, dormantSince: null, wealth: 0.5, peakWealth: 0.5, flourishesLoggedAt: null, shockCount: 0,
    });
    hit.tradeRoutes.set("tr_test", route(hit, rh));
    safe.tradeRoutes.set("tr_test", route(safe, rs));
    const spot = rh.provinceIds[1];
    pushBack(hit, rh, quiet(rh, { bandits: spot }));
    pushBack(safe, rs, quiet(rs));
    expect(hit.province(spot)!.wealth!).toBeLessThan(safe.province(spot)!.wealth!);
    expect(hit.tradeRoutes.get("tr_test")!.wealth).toBeCloseTo(0.5 - FEEDBACK.banditRoute, 6);
    expect(safe.tradeRoutes.get("tr_test")!.wealth).toBe(0.5);
  });

  test("trade and prosperity make a province rich, and its lord stronger", () => {
    const [good, bad] = [fresh(), fresh()];
    const rg = regionOf(good), rb = regionOf(bad);
    const pg = village(good, rg), pb = village(bad, rb);
    for (let y = 0; y < 12; y++) {
      rg.prosperity = 0.9; for (const k of Object.keys(rg.roads)) rg.roads[k] = 0.8;
      rb.prosperity = 0.2; for (const k of Object.keys(rb.roads)) rb.roads[k] = 0.1;
      pushBack(good, rg, quiet(rg));
      pushBack(bad, rb, quiet(rb));
    }
    expect(pg.wealth!).toBeGreaterThan(0.7);
    expect(pb.wealth!).toBeLessThan(0.3);
    // The market town gains most from the roads.
    expect(good.province(rg.centreId)!.wealth!).toBeGreaterThanOrEqual(pg.wealth!);
    // Same people, same seat: the rich province's lord raises more for a war.
    expect(pg.population).toBe(pb.population);
    const lord = holderOf(good, pg);
    expect(good.power(good.char(lord)!)).toBeGreaterThan(bad.power(bad.char(lord)!));
  });

  test("a lord's death or a seized seat unsettles the region: its lords trust each other less", () => {
    const [shaken, calm] = [fresh(), fresh()];
    const rs = regionOf(shaken), rc = regionOf(calm);
    pushBack(shaken, rs, quiet(rs, { news: [news(rs, "SEAT_SEIZED"), news(rs, "LORD_DIED", { tier: "duchy" })] }));
    pushBack(calm, rc, quiet(rc));
    expect(rs.unsettled).toBeCloseTo(FEEDBACK.unsettleSeized + FEEDBACK.unsettleGreatDeath, 6);
    expect(rc.unsettled).toBe(0);
    // Two of its lords of different houses now think less of each other.
    const lords = rs.provinceIds.map((id) => holderOf(shaken, shaken.province(id)!));
    const [x, y] = lords.flatMap((a) => lords.filter((b) => shaken.char(a)!.dynastyId !== shaken.char(b)!.dynastyId).map((b) => [a, b] as const))[0];
    expect(shaken.opinionOf(shaken.char(x)!, y)).toBeLessThan(calm.opinionOf(calm.char(x)!, y));
    // And it fades over quiet years.
    pushBack(shaken, rs, quiet(rs));
    expect(rs.unsettled).toBeLessThan(FEEDBACK.unsettleSeized + FEEDBACK.unsettleGreatDeath);
  });

  test("in an unsettled region an old feud can flare into a claim, and a claim into a war goal", () => {
    const w = fresh();
    const r = regionOf(w);
    const lords = r.provinceIds.map((id) => w.char(holderOf(w, w.province(id)!))!);
    const [a, b] = lords.flatMap((x) => lords.filter((y) => x.dynastyId !== y.dynastyId).map((y) => [x, y] as const))[0];
    r.feuds[[a.dynastyId, b.dynastyId].sort().join("|")] = w.year - 5;
    let flare: RegionalEvent | undefined;
    for (let i = 0; i < 40 && !flare; i++) {
      w.year++;
      pushBack(w, r, quiet(r, { news: [news(r, "SEAT_SEIZED"), news(r, "SEAT_SEIZED"), news(r, "SEAT_SEIZED"), news(r, "SEAT_SEIZED")] }));
      flare = w.regionalEvents.find((e) => e.kind === "FEUD_FLARES");
    }
    expect(flare, "a feud flared within 40 fully unsettled years").toBeDefined();
    const claimant = w.char(flare!.actorId)!;
    expect(claimant.claims.some((c) => c.titleId === flare!.titleId)).toBe(true);
    expect(renderRegionalEvent(w, flare!)).toMatch(/old feud flared/);
    // The engine's own goals now see the claim: a SEIZE_TITLE goal, the way into a war.
    regenerateGoals(w);
    expect(w.goals.some((g) => g.type === "SEIZE_TITLE" && g.actorId === claimant.id && g.targetTitleId === flare!.titleId)).toBe(true);
  });

  test("never draws from the engine's own stream (World.rng)", () => {
    const w = fresh();
    const r = regionOf(w);
    const state = (x: World) => (x.rng as unknown as { state: number }).state;
    const before = state(w);
    r.feuds["x|y"] = w.year - 1;
    pushBack(w, r, quiet(r, { hardWinter: true, famine: [r.provinceIds[1]], bandits: r.centreId, news: [news(r, "SEAT_SEIZED")] }));
    expect(state(w)).toBe(before);
  });

  test("same seed, same regional consequences; and they move the world", () => {
    const key = (w: World) => JSON.stringify([[...w.provinces.values()].map((p) => [p.population, p.wealth]), [...w.regions.values()].map((r) => r.unsettled)]);
    const t0 = performance.now();
    const a = runSim(GOLDEN[0]);
    const ms = performance.now() - t0;
    expect(key(a)).toBe(key(runSim(GOLDEN[0])));
    // Wealth has moved off "getting by" somewhere, and stays in bounds.
    const wealth = [...a.provinces.values()].map((p) => p.wealth!);
    expect(wealth.some((x) => Math.abs(x - 0.5) > 0.05)).toBe(true);
    expect(wealth.every((x) => x >= 0 && x <= 1)).toBe(true);
    console.log(`${GOLDEN[0].name} with regional feedback: ${ms.toFixed(0)} ms`);
  }, 15000);
});
