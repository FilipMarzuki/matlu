/**
 * Acceptance test for #1711 — the Reach's generated history and a people's ways, in Swedish (phase 4
 * of #1685).
 *
 * The story engine writes its history in English (storytelling/render.ts), and its golden hashes are
 * of that English, so it's never asked for Swedish. The page reads each sentence back through the
 * `hist.*` templates instead (sim-words.ts `simLine`, history-words.ts), so what's checked here is
 * that it can: over several seeds' told histories, every line the HISTORY tab draws, every
 * province's lines on the MAP, every fact the road's people answer from (what a village and its
 * country remember, its recent local past, old history bending as it's retold, eyewitnesses), every
 * journal label and every rumour of the past reads in Swedish, with no English words left in it.
 * Then a people's and a culture's ways: every claim anyone on the road can voice, at every trust.
 *
 * A sentence no template matches is drawn in English, never guessed at. Any such shape known to
 * fall through is listed in KNOWN_ENGLISH below; today the list is empty.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { runHistory, type ReachHistory } from '../artificer/world/history';
import { generateReach } from '../artificer/world/reach';
import { provincesOf } from '../artificer/world/provinces';
import { cultureName } from '../artificer/world/peoples';
import { ruleFeatures } from '../artificer/features';
import { forgetHistories, historyFacts, keepHistory, pastEventOf, tellHistoriesWith } from '../artificer/history-in-play';
import { runRumourFacts } from '../artificer/run-rumours';
import { scopedClaims, type ScopedClaim } from '../artificer/culture-lore';
import { answerQuestion, loreKeyOf } from '../artificer/knowledge-questions';
import { VILLAGES, TRAVELLERS, HUMANS_ON_THE_ROAD, type Person } from '../artificer/villages';
import { historyTab, provinceInfo, chronicleSentence } from './history-view';
import { questionAboutText, simLine } from './sim-words';

const sv = makeT('sv');
const en = makeT('en');

/** What a player sees of some HTML: its text and its tooltips. */
function shown(html: string): string {
  const attrs = [...html.matchAll(/\b(title|aria-label|placeholder|alt)="([^"]*)"/g)].map(m => m[2]);
  return [html.replace(/<[^>]*>/g, ' '), ...attrs].join(' ').replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n))).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

/**
 * English words a history or a people's ways would give away if a sentence went untranslated.
 * Whole words, any case; none of them a Swedish word too, and none a name in the Reach (no "smith"
 * or "mason": the engine names houses Smith and Mason, and names stay names; nor "goblins", the
 * Goblins' own name in Swedish too).
 */
const ENGLISH = [
  'the', 'and', 'of', 'was', 'were', 'with', 'from', 'their', 'they', 'who', 'what', 'which', 'when', 'into', 'about',
  'died', 'death', 'seized', 'took', 'lord', 'lords', 'house', 'houses', 'year', 'years', 'ago', 'held', 'holds', 'heir',
  'plague', 'famine', 'winter', 'harvest', 'country', 'plot', 'murdered', 'feud', 'war', 'wars', 'seat', 'seats', 'vacant',
  'people', 'trade', 'market', 'bread', 'times', 'good', 'hard', 'thriving', 'failing', 'closed', 'road', 'village',
  'happened', 'here', 'we', 'our', 'us', 'you', 'your', 'never', 'always', 'every', 'everyone', 'nobody', 'think',
  'elves', 'dwarves', 'humans', 'fae', 'giants', 'dragons', 'constructs', 'beastkin',
];
const ENGLISH_RE = new RegExp(`(?<![\\p{L}])(${ENGLISH.join('|')})(?![\\p{L}])`, 'giu');
const englishIn = (text: string): string[] => [...text.matchAll(ENGLISH_RE)].map(m => text.slice(Math.max(0, m.index! - 40), m.index! + 40).replace(/\s+/g, ' ').trim());

/** Sentence shapes known to stay English (none today): add one here, with why, rather than loosen the check. */
const KNOWN_ENGLISH: readonly RegExp[] = [];
const known = (line: string): boolean => KNOWN_ENGLISH.some(re => re.test(line));

/** A few seeds' told histories (the engine's 150 years each: a quarter to half a second apiece). */
const SEEDS = [11, 2024, 70301, 424242];
let histories: ReachHistory[] = [];

beforeAll(() => {
  histories = SEEDS.map(seed => runHistory(seed));
  tellHistoriesWith(runHistory);
});
afterAll(() => { tellHistoriesWith(null); forgetHistories(); });

describe('The Reach\'s history, in Swedish (#1711)', () => {
  it('draws the HISTORY tab of several seeds with every chronicle line in Swedish', () => {
    for (const h of histories) {
      const r = generateReach(h.seed);
      const provinces = provincesOf(r);
      const camp = provinces.list[provinces.at[r.camp.y * r.w + r.camp.x]].id;
      const html = historyTab(h, camp, sv);
      expect(englishIn(shown(html))).toEqual([]);
      // Line by line too, so a failure names the sentence: every one read through a template.
      const untold = h.chronicle.split('\n').map(l => l.replace(/^\s*\d+\s{2}/, '').trim().replace(/^◇ /, ''))
        .filter(l => l && !/^[─═]+$/.test(l) && !known(l) && chronicleSentence(l, sv) === l);
      expect(untold).toEqual([]);
      // The English tab is the engine's chronicle, untouched.
      expect(historyTab(h, camp, en)).toContain(h.chronicle.split('\n').find(l => /^\s*\d+\s{2}/.test(l))!.replace(/^\s*\d+\s{2}/, '').replace(/^◇ /, '').replace(/'/g, '&#39;').replace(/"/g, '&#34;').replace(/&(?!#)/g, '&#38;'));
    }
    // Not just "not English": real Swedish, names kept.
    const html = shown(historyTab(histories[0], null, sv));
    expect(html).toContain('KRÖNIKAN');
    expect(html).toContain('MANNAMINNE');
    expect(historyTab(null, null, sv)).toContain('De gamla håller fortfarande på att berätta');
  });

  it('says every province\'s history on the MAP in Swedish', () => {
    for (const h of histories) {
      const provinces = provincesOf(generateReach(h.seed));
      for (const p of provinces.list) {
        const ph = h.provinces.find(q => q.id === p.id)!;
        expect(englishIn(shown(provinceInfo(p.name, cultureName(p.culture), ph, sv)))).toEqual([]);
        expect(englishIn(shown(provinceInfo(p.name, cultureName(p.culture), null, sv)))).toEqual([]);
      }
    }
  });

  it('reads every fact the road\'s people tell of the past, every journal label and every rumour of it in Swedish', () => {
    const features = ruleFeatures();
    let facts = 0;
    for (const h of histories) {
      keepHistory(h);
      for (const f of [...historyFacts(h, features), ...runRumourFacts(h, features)]) {
        facts++;
        const said = simLine(f.text, sv);
        if (!known(f.text)) expect(said, f.text).not.toBe(f.text);
        expect(englishIn(said), f.text).toEqual([]);
        const label = pastEventOf(f)?.label;
        if (label) expect(englishIn(simLine(label, sv)), label).toEqual([]);
        // And what a question about it was about ("what happened here", "the house of Crowhelm").
        for (const topic of f.about.filter(a => a.startsWith('past:'))) expect(englishIn(questionAboutText(topic, sv)), topic).toEqual([]);
        // In English, the sim's words as they are.
        expect(simLine(f.text, en)).toBe(f.text);
      }
    }
    expect(facts).toBeGreaterThan(400);
  });

  it('says a few lines as a Swedish reader would expect', () => {
    expect(simLine('Ivar II of Hedlund seized the vacant Hundred of Ravenford amid the disorder.', sv))
      .toBe('Ivar II av Hedlund grep makten över häradet Ravenford, som stod utan herre, mitt i oredan.');
    expect(simLine('Plague swept through the Hollowford country, 3 of its 5 lands.', sv)).toBe('Pesten svepte genom Hollowfordbygden, 3 av dess 5 bygder.');
    expect(simLine('Famine struck Ravenford, in the Kestrel Gate country. Among the dead was Åsa of Crowhelm.', sv))
      .toBe('Svält drabbade Ravenford, i Kestrel Gate-bygden. Bland de döda fanns Åsa av Crowhelm.');
    expect(simLine('12 years ago, in year 138: The house of Tallow lost its last seat in Leoric\'s Land.', sv))
      .toBe('För 12 år sedan, år 138: Ätten Tallow förlorade sitt sista säte i Leorics land.');
    expect(simLine('Bread is dear in the Timberwold: 1.6 times its usual price.', sv)).toBe('Brödet är dyrt i Timmerskogen: 1,6 gånger det vanliga priset.');
    expect(simLine('The plague in the Wrenwood country, year 68', sv)).toBe('Pesten i Wrenwoodbygden, år 68');
    expect(chronicleSentence('The Feud of Stig of Tallow and Folke of Tallow (58–64)', sv)).toBe('Fejden mellan Stig av Tallow och Folke av Tallow (58–64)');
    expect(chronicleSentence('Plague swept through the Greyhurst country, 2 of its 4 lands (86).', sv)).toBe('Pesten svepte genom Greyhurstbygden, 2 av dess 4 bygder (86).');
    // A sentence no template knows stays as it came.
    expect(simLine('A thing the engine has never written.', sv)).toBe('A thing the engine has never written.');
  });
});

describe('A people\'s and a culture\'s ways, in Swedish (#1711)', () => {
  const everyone: Person[] = [...Object.values(VILLAGES).flatMap(v => v.people), ...TRAVELLERS];
  // As any run can play them: with `humans-on-the-road`, some are of a human People.
  const played = [...everyone, ...everyone.filter(p => HUMANS_ON_THE_ROAD[p.id]).map(p => ({ ...p, people: HUMANS_ON_THE_ROAD[p.id] }))];

  /** Every lore key a person can be asked: their People's and culture's every topic, and every view by whom it's of. */
  const keysOf = (p: Person): string[] => {
    const groups = new Map<string, ScopedClaim[]>();
    for (const c of [...scopedClaims({ kind: 'people', id: p.people }), ...scopedClaims({ kind: 'culture', id: p.culture })]) {
      const k = `${c.scope.kind}:${c.scope.id}|${c.topic}|${c.of?.id ?? ''}`;
      groups.set(k, [...(groups.get(k) ?? []), c]);
    }
    return [...groups.values()].map(cs => loreKeyOf(cs)!).filter(Boolean);
  };

  it('says every claim anyone on the road can voice, at every trust, in Swedish', () => {
    let answers = 0;
    for (const p of played) {
      for (const key of keysOf(p)) {
        for (const trust of [0, 25, 50, 75, 100]) {
          const a = answerQuestion(p, key, trust, []);
          const line = simLine(a.line, sv);
          expect(englishIn(line), a.line).toEqual([]);
          if (a.kind === 'told') {
            answers++;
            expect(simLine(a.answer.text, sv), a.answer.text).not.toBe(a.answer.text);
            expect(englishIn(simLine(a.answer.text, sv)), a.answer.text).toEqual([]);
          }
        }
        expect(englishIn(questionAboutText(key, sv)), key).toEqual([]);
      }
    }
    expect(answers).toBeGreaterThan(1000);
  });

  it('keeps names and reads the hedges', () => {
    const maren = everyone.find(p => p.id === 'hf-maren')!;
    const said = simLine(answerQuestion(maren, 'culture:fieldborn/mourning', 100, []).line, sv);
    expect(said).toBe('Du frågar Maren om hur deras folk sörjer. Maren: "Inga böner: de gamla gudarna är döda och deras namn sägs inte. Familjen går den dödas åkrar och nämner vad hen odlade."');
    expect(simLine("Between us: Goblins are pests, not people. Since it's you: Elf healing is feeling, not real magic.", sv))
      .toBe('Oss emellan: Goblins är skadedjur, inte folk. Eftersom det är du: Alvernas läkedom är känsla, inte riktig magi.');
  });
});
