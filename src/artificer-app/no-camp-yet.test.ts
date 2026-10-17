/**
 * #1834: a new run has no camp (camp as an action, #1732, on in a new game), so until Make camp no
 * player-facing text may speak of "the camp" as if it exists. The land is told from where you stand:
 * "Du står på en äng." / "You're standing in a meadow.", with distances "härifrån" / "from here".
 * Once camp is made, "Lägret ligger …" / "Camp is …" is back; with the switch off (camp from the
 * start) nothing changes.
 *
 * Scans what a player and an AI read on day 1: the PLAN screen's journal and its Make camp box, the
 * LAND tab, the play API's text view (what the console shows) and the AI's observation.
 */

import { describe, expect, it } from 'vitest';
import { makeT, type T } from '../artificer/i18n';
import { createRegion1, runAction, type Region1State } from '../artificer/region1';
import { FULL_WORLD } from '../artificer/world';
import { ruleFeatures } from '../artificer/features';
import { SUGGESTED_PACK } from '../artificer/kit';
import { CAMP_AS_ACTION, knownSpots } from '../artificer/camp-sites';
import { describeLand } from '../artificer/descriptive-map';
import { startGame, view } from '../artificer-play/session';
import { htmlText, viewText } from '../artificer-play/view-words';
import { observe } from '../artificer-ai/observe';
import { landTab } from './land-view';
import { describedMap, firstJournalLine, sitesBlock } from './camp-blocks';
import { journalItems } from './journal-view';
import { withCampLine } from './camp-view';
import { lookAroundLand } from './map-session-view';
import { distanceT, landLines } from './sim-words';
import type { AppState } from './controller';

const sv = makeT('sv');
const en = makeT('en');

/**
 * Camp spoken of as already there. Not the action's name ("Make camp", "Slå läger"), the places to
 * camp ("Lägerplatser", "places to camp") or what an action does once there is one ("a cold pit at camp").
 */
const CAMP_EXISTS = {
  en: /(?<![\p{L}])(?:(?<!make )camp is|camp lies|from camp|around camp|the camp|your camp)(?![\p{L}])/iu,
  sv: /(?<![\p{L}])(?:lägret|lägrets)(?![\p{L}])/iu,
};

/** A new run as the page starts one: camp as an action on, the land described, no camp yet. */
function fresh(campAsAction = true): Region1State {
  return createRegion1({ world: { ...FULL_WORLD, encounters: false, features: ruleFeatures({ [CAMP_AS_ACTION]: campAsAction }) } }, undefined, { id: 'w-no-camp', pack: [...SUGGESTED_PACK] });
}
const camped = (s: Region1State): Region1State => runAction(s, { q: 'camp', opts: { spot: knownSpots(s)[0].id } });

/** What PLAN shows before camp (the journal, its first line, the Make camp box) and the LAND tab, as text. */
function planAndLand(s: Region1State, t0: T): string {
  const t = distanceT(s, t0);
  const journal = journalItems(withCampLine(s.log), 6, 'D', t, l => lookAroundLand(s, l, t)) || firstJournalLine(s, t);
  return [htmlText(journal), htmlText(sitesBlock(s, t)), htmlText(landTab(s, t)), htmlText(describedMap(s, t))].join('\n');
}

const hits = (text: string, re: RegExp): string[] => text.split('\n').filter(l => re.test(l));

describe('No camp at the start: no text speaks of the camp before you make one (#1834)', () => {
  it('a new run\'s PLAN and LAND, in Swedish and English, say where you stand, not where camp is', () => {
    const s = fresh();
    expect(s.campSpot).toBeUndefined();
    const svText = planAndLand(s, sv), enText = planAndLand(s, en);
    expect(hits(svText, CAMP_EXISTS.sv)).toEqual([]);
    expect(hits(enText, CAMP_EXISTS.en)).toEqual([]);
    expect(svText).toMatch(/Du står (på|bland|vid|i|uppe)/);
    expect(enText).toMatch(/You're standing (in|on|among|by)/);
    expect(svText).toContain('LANDET — det du vet om det, sett härifrån');
    expect(enText).toContain('THE LAND — what you know of it, from here');
    // Distances from where you stand.
    expect(svText).toMatch(/härifrån\./);
    expect(enText).toMatch(/from here\./);
  });

  it('the English the page shows is the sim\'s own (what the AI reads), word for word', () => {
    const s = fresh();
    expect(landLines(s, en)).toEqual(describeLand(s));
    expect(describeLand(s)[0]).toMatch(/^You're standing /);
  });

  it('the AI\'s observation and the play API\'s text (the console\'s) on day 1 say nothing of a camp that isn\'t there', () => {
    const s = fresh();
    const seen = observe(s);
    expect(hits(seen, CAMP_EXISTS.en)).toEqual([]);
    expect(seen).toContain('WHAT YOU KNOW OF THE LAND AROUND YOU');
    for (const lang of ['sv', 'en'] as const) {
      const g = startGame({ seed: 'no-camp-yet', lang });
      expect(g.app.sim.campSpot).toBeUndefined();
      expect(hits(view(g).text, CAMP_EXISTS[lang])).toEqual([]);
    }
    // The Swedish view drawn straight from the app state, as the API draws it.
    const a = startGame({ seed: 'no-camp-yet', lang: 'sv' }).app as AppState;
    expect(hits(viewText(a, 'day', distanceT(a.sim, sv)), CAMP_EXISTS.sv)).toEqual([]);
  });

  it('after Make camp the camp lines come back', () => {
    const s = camped(fresh());
    expect(s.campSpot).toBeDefined();
    const svLand = htmlText(landTab(s, distanceT(s, sv))), enLand = htmlText(landTab(s, distanceT(s, en)));
    expect(svLand).toContain('Lägret ligger');
    expect(svLand).toContain('LANDET — det du vet om det, sett från lägret');
    expect(svLand).not.toContain('Du står');
    expect(enLand).toMatch(/Camp is (in|on|among|by)/);
    expect(enLand).toContain('THE LAND — what you know of it, from camp');
    expect(enLand).not.toContain("You're standing");
    expect(enLand).not.toMatch(/from here\./);
    expect(describeLand(s)[0]).toMatch(/^Camp is /);
    expect(observe(s)).toContain('WHAT YOU KNOW OF THE LAND AROUND CAMP');
    expect(landLines(s, en)).toEqual(describeLand(s));
  });

  it('with the switch off (camp from the start), nothing changes', () => {
    const s = fresh(false);
    const lines = describeLand(s);
    expect(lines[0]).toMatch(/^Camp is /);
    expect(lines.some(l => /from here|standing/.test(l))).toBe(false);
    expect(landLines(s, en)).toEqual(lines);
    const svLand = htmlText(landTab(s, distanceT(s, sv)));
    expect(svLand).toContain('Lägret ligger');
    expect(svLand).not.toContain('härifrån.');
    expect(htmlText(landTab(s, distanceT(s, en)))).toContain('THE LAND — what you know of it, from camp');
    expect(observe(s)).toContain('WHAT YOU KNOW OF THE LAND AROUND CAMP');
  });
});
