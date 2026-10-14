/**
 * Tests for #1707 — the sim's words in the viewer's language (sim-words.ts).
 *
 * The sim keeps writing English for the AI and the API; the page reads it through the catalog. So
 * the checks here are that the two agree: every reason the sim gives (over a few played-out runs)
 * has a template, filling a template with English gives back exactly what the sim said, and the
 * catalog's English names are the sim's names. If someone rewords a reason in region1.ts, the
 * first test fails and names it, instead of the Swedish page quietly showing it in English.
 */

import { describe, expect, it } from 'vitest';
import { en } from '../artificer/i18n/en';
import { makeT, type Key, type T } from '../artificer/i18n';
import { ACTIONS, SITES, blockedReason, createRegion1, runAction, endDay, queueId, type ActionId, type Region1State, type SiteId } from '../artificer/region1';
import { FULL_WORLD, FLAT_WORLD } from '../artificer/world';
import { RINGS, RING_NAME } from '../artificer/exploration';
import { RANK_NAMES } from '../rank-names';
import { WEATHER, WEATHER_IDS, weatherName } from '../artificer/weather';
import { GOALS, GOAL_IDS } from '../artificer/focus';
import { SKILLS, SKILL_IDS } from '../artificer/skills';
import { TALENTS, TALENT_IDS } from '../artificer/talents';
import { STATS, STAT_IDS, statNote } from '../artificer/stats';
import { KIT_GROUPS, SUGGESTED_PACK, type KitGroup, type KitId } from '../artificer/kit';
import { BIOME_NAME, describeCell, type Biome } from '../artificer/world/reach';
import { describeLand, mapNeeds, reachOfRun, DESCRIPTIVE_MAP } from '../artificer/descriptive-map';
import { createExploration, scout, survey } from '../artificer/exploration';
import { DEFAULT_CALENDAR } from '../artificer/winter';
import { cellText, landLines, mapNeedsText, matchSimLine, optionGroupLabel, optionLabel, readBack, simLine, statNoteText } from './sim-words';

const enT: T = makeT('en');
const svT: T = makeT('sv');
const IDS = Object.keys(ACTIONS) as ActionId[];

/** A tiny seeded stream, so the played-out runs are the same every time. */
function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 2 ** 32; };
}

/**
 * Every reason and option the sim gives over a few runs: two worlds (the full one with the
 * switches on, the flat test world), each played for a stretch of days with random actions, and at
 * every step every action asked in every ring, with its options' choices too.
 */
function sample(): { reasons: Set<string>; options: { group: string; label: string; choice: { label: string; value: string; note: string; blocked: string | null } }[] } {
  const reasons = new Set<string>();
  const options: ReturnType<typeof sample>['options'] = [];
  const starts: Region1State[] = [
    createRegion1({ world: { ...FULL_WORLD, luck: false, accidents: false, encounters: false } }, undefined, { id: 'w-words-a' }),
    createRegion1({ world: { ...FULL_WORLD, encounters: false, features: { 'action-visibility': false, 'action-length': false, [DESCRIPTIVE_MAP]: false } } }, undefined, { id: 'w-words-b', pack: [] }),
    createRegion1({ world: FLAT_WORLD }, undefined, { id: 'w-words-c' }),
  ];
  for (const [n, start] of starts.entries()) {
    const rnd = lcg(n + 7);
    let s = start;
    for (let step = 0; step < 90 && !s.outcome; step++) {
      for (const id of IDS) for (const r of RINGS) {
        const why = blockedReason(s, id, r);
        if (why) reasons.add(why);
        for (const g of ACTIONS[id].options?.(s, {}, r) ?? []) {
          for (const c of g.choices) {
            options.push({ group: g.key, label: g.label, choice: { label: c.label, value: c.value, note: c.note, blocked: c.blocked } });
            const w = blockedReason(s, id, r, { [g.key]: c.value });
            if (w) reasons.add(w);
          }
        }
      }
      // A step of play: settle once the land is known, then mostly do things that are open.
      const open = IDS.filter(id => !blockedReason(s, id, 1));
      const pick = open.length && rnd() < 0.8 ? open[Math.floor(rnd() * open.length)] : IDS[Math.floor(rnd() * IDS.length)];
      const ring = RINGS[Math.floor(rnd() * RINGS.length)];
      s = runAction(s, queueId(pick, ACTIONS[pick].ringed ? ring : 1));
      if (s.pending) s = { ...s, pending: null };
      if (s.hoursToday >= 12) s = endDay(s);
    }
  }
  return { reasons, options };
}

describe('The sim\'s words in the viewer\'s language (#1707)', () => {
  const { reasons, options } = sample();

  it('has a template for every reason the sim gives, and English filled in gives back the sim\'s words', () => {
    expect(reasons.size).toBeGreaterThan(15);
    const unmatched = [...reasons].filter(r => !matchSimLine(r));
    expect(unmatched).toEqual([]);
    for (const r of reasons) expect(simLine(r, enT)).toBe(r);
    // And in Swedish none of them comes through as it was.
    const same = [...reasons].filter(r => simLine(r, svT) === r);
    expect(same).toEqual([]);
  });

  it('says every option of a queued action in Swedish, and English back unchanged', () => {
    expect(options.length).toBeGreaterThan(20);
    for (const o of options) {
      const g = { key: o.group, label: o.label, value: null, choices: [] };
      const c = { ...o.choice, blocked: o.choice.blocked };
      expect(optionGroupLabel(g, enT)).toBe(o.label);
      // A concept is named as the focus picker names it ("Edge & Point"), not by its capitalised id.
      if (o.group !== 'concept') expect(optionLabel(g, c, enT)).toBe(o.choice.label);
      expect(simLine(o.choice.note, enT)).toBe(o.choice.note);
      expect(matchSimLine(o.choice.note), o.choice.note).not.toBeNull();
      if (o.choice.blocked) expect(matchSimLine(o.choice.blocked), o.choice.blocked).not.toBeNull();
    }
    // A few by hand, in Swedish.
    expect(simLine('up to 90% warm · your camp', svT)).toBe('upp till 90% varmt · ditt läger');
    expect(simLine("3 materials · 5h · crude won't hold up through a winter", svT)).toBe('3 material · 5h · grova håller inte en hel vinter');
    expect(simLine("you haven't worked out how to make a crude shovel yet", svT)).toBe('du har inte listat ut hur man gör det här än: enkel spade');
    expect(simLine("the far ring isn't known yet — scout it first", svT)).toBe('den yttre ringen är inte känd än — spana i den först');
    expect(simLine('needs 2 materials (have 0)', svT)).toBe('kräver 2 material (du har 0)');
    // A line no template knows is shown as it came, not guessed at.
    expect(simLine('a wholly new reason', svT)).toBe('a wholly new reason');
  });

  it('names things as the sim does, in English', () => {
    for (const id of IDS) expect(en[`act.${id}`]).toBe(ACTIONS[id].name);
    for (const id of Object.keys(SITES) as SiteId[]) expect(en[`site.${id}`]).toBe(SITES[id].name);
    for (const r of RINGS) expect(en[`ring.${r}`]).toBe(RING_NAME[r]);
    for (const r of RANK_NAMES) expect(en[`rank.${r}`]).toBe(r);
    for (const w of WEATHER_IDS) expect(en[`weather.${w}`]).toBe(WEATHER[w].name);
    expect(weatherName('snow', 40, DEFAULT_CALENDAR)).toBe(en['weather.snow.winter']);
    expect(weatherName('storm', 40, DEFAULT_CALENDAR)).toBe(en['weather.storm.winter']);
    for (const g of GOAL_IDS) expect(en[`goal.${g}`]).toBe(GOALS[g].name);
    for (const k of SKILL_IDS) expect(en[`skill.${k}`]).toBe(SKILLS[k].name);
    for (const k of TALENT_IDS) { expect(en[`talent.${k}`]).toBe(TALENTS[k].name); expect(en[`talent.${k}.blurb`]).toBe(TALENTS[k].blurb); }
    for (const k of STAT_IDS) {
      expect([en[`stat.${k}`], en[`stat.${k}.short`], en[`stat.${k}.blurb`]]).toEqual([STATS[k].name, STATS[k].short, STATS[k].blurb]);
      for (let v = 7; v <= 15; v++) expect(statNoteText(k, v, enT)).toBe(statNote(k, v));
    }
    for (const g of Object.keys(KIT_GROUPS) as KitGroup[]) expect(en[`kitgroup.${g}`]).toBe(KIT_GROUPS[g]);
    for (const b of Object.keys(BIOME_NAME) as Biome[]) expect(en[`biome.${b}` as Key]).toBe(BIOME_NAME[b]);
    // Recipes and the tools they make, by recipe id.
    for (const def of Object.values(ACTIONS)) if (def.recipe) expect(en[`recipe.${def.recipe.id}` as Key]).toBe(def.recipe.name);
  });

  it('describes the land as the sim does, in English, and says it in Swedish', () => {
    const world = { ...FULL_WORLD, luck: false, accidents: false, darkness: false, weather: 'clear' as const, encounters: false, features: { [DESCRIPTIVE_MAP]: true } };
    const packs: KitId[][] = [[...SUGGESTED_PACK], SUGGESTED_PACK.filter(k => k !== 'map-compass' && k !== 'notebook')];
    for (const id of ['w-astrid', 'w-words-a', 'w-words-b', 'w-words-c', 'w-words-d']) {
      for (const pack of packs) {
        const s0 = createRegion1({ world }, undefined, { id, pack });
        for (const explore of [createExploration(), scout(createExploration(), 1), survey(scout(scout(createExploration(), 1), 2), 1)]) {
          const s = { ...s0, explore };
          expect(landLines(s, enT)).toEqual(describeLand(s));
          expect(mapNeedsText(s, enT)).toBe(mapNeeds(s).join(' and '));
          const sv = landLines(s, svT);
          expect(sv.length).toBe(describeLand(s).length);
          for (const l of sv) expect(l).not.toMatch(/\b(the|is|about|minutes|ish|you)\b/);
        }
      }
      const r = reachOfRun({ character: { id } as Region1State['character'] });
      for (let y = 0; y < r.h; y += 3) for (let x = 0; x < r.w; x += 3) expect(cellText(r, x, y, enT)).toBe(describeCell(r, x, y));
    }
  });
});

describe('The journal\'s lines in the viewer\'s language (#1709)', () => {
  /**
   * Whole years and roads as the AI players play them — the scripted plan and two random legal
   * players — and every line their journals wrote: each must be a catalog phrase or match a
   * template, and filling the template with what it matched must give back the sim's line exactly.
   * If someone rewords a journal line in the sim, this fails and names it, instead of the Swedish
   * journal quietly showing it in English.
   */
  it('reads every journal line of played years and roads, and gives the English back unchanged', async () => {
    const { playRun, aiCharacterId } = await import('../artificer-ai/runner');
    const { scriptedPlayer } = await import('../artificer-ai/players/scripted');
    const { randomPlayer } = await import('../artificer-ai/players/random');
    const lines = new Set<string>();
    for (const [i, player] of [scriptedPlayer(), randomPlayer({ seed: 3 }), randomPlayer({ seed: 4 })].entries()) {
      const res = await playRun(player, { characterId: aiCharacterId(`${player.name}-${i}`, 'a') });
      for (const l of res.final.log) lines.add(l.text);
      for (const l of res.road?.final.log ?? []) lines.add(l.text);
    }
    expect(lines.size).toBeGreaterThan(150);
    // A phrase said whole, or a template filled with what it matched (readBack is null when neither reads it).
    expect([...lines].filter(l => readBack(l) !== l)).toEqual([]);
    // And Swedish actually differs: no line falls through untranslated.
    expect([...lines].filter(l => simLine(l, svT) === l)).toEqual([]);
    for (const l of lines) expect(simLine(l, enT)).toBe(l);
  }, 60_000);
});
