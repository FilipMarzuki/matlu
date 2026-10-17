/**
 * #1824: the two-row header (place, day, ⚙, feedback; then the Warden and the three resources as
 * words, bars from day 8), and #1825: the weather and the time of day in one row on Plan, which
 * unfolds into the full weather box. Both behind the `two-row-header` ui switch.
 */

import { describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { FEATURES, featureById, ruleFeatures, uiFeatureOn } from '../artificer/features';
import { BARS_FROM_DAY, TWO_ROW_FEATURE, barsOn, vitalChip, vitalLevel, vitalWord, wardenRow, type VitalId, type VitalReading } from './vital-words';
import { headerRows, menyButton, menyPage } from './meny';
import { wardenButton } from './html';
import { weatherRow, weatherRowText, type RowChip } from './weather-row';
import { weatherChips } from './camp-blocks';
import { ackWeather, toggleWeather, weatherFoldState, FIRST_VISIT } from './weather-fold';
import { makeWarden, act } from './controller';
import { revealedNow, suggestedAction } from './reveal';

const en = makeT('en');
const sv = makeT('sv');

const reading = (id: VitalId, current: number, cap = 100): VitalReading => ({ id, current, cap, max: 100 });
const full: VitalReading[] = [reading('vigor', 90), reading('clarity', 90), reading('reserve', 90)];

describe('the switch (#1824)', () => {
  it('is a ui feature, experimental, on by default, last, and no run saves it', () => {
    expect(featureById(TWO_ROW_FEATURE)).toMatchObject({ kind: 'ui', stage: 'experimental', default: true, absent: false, issue: 1824 });
    expect(uiFeatureOn({}, TWO_ROW_FEATURE)).toBe(true);
    expect(uiFeatureOn({ [TWO_ROW_FEATURE]: false }, TWO_ROW_FEATURE)).toBe(false);
    expect(Object.keys(ruleFeatures())).not.toContain(TWO_ROW_FEATURE);
    expect(FEATURES.at(-1)?.id).toBe(TWO_ROW_FEATURE);
  });
});

describe('the resources\' levels and words (#1824)', () => {
  it('four levels: above 75%, above 45%, above 20%, and the rest, the status bar\'s colour bands', () => {
    expect(vitalLevel(100, 100)).toBe(0);
    expect(vitalLevel(76, 100)).toBe(0);
    expect(vitalLevel(75, 100)).toBe(1);
    expect(vitalLevel(46, 100)).toBe(1);
    expect(vitalLevel(45, 100)).toBe(2);
    expect(vitalLevel(21, 100)).toBe(2);
    expect(vitalLevel(20, 100)).toBe(3);
    expect(vitalLevel(0, 100)).toBe(3);
    // Against today's cap, not the bar's width: 40 of a cap of 50 is high.
    expect(vitalLevel(40, 50)).toBe(0);
    expect(vitalLevel(5, 0)).toBe(3);
  });

  it('the words in English', () => {
    const words = (id: VitalId) => ([0, 1, 2, 3] as const).map(l => vitalWord(id, l, en));
    expect(words('vigor')).toEqual(['Energized', 'Steady', 'Tired', 'Exhausted']);
    expect(words('clarity')).toEqual(['Alert', 'Clear', 'Drowsy', 'Foggy']);
    expect(words('reserve')).toEqual(['Well', 'Worn', 'Hurt', 'Failing']);
  });

  it('the words in Swedish', () => {
    const words = (id: VitalId) => ([0, 1, 2, 3] as const).map(l => vitalWord(id, l, sv));
    expect(words('vigor')).toEqual(['Pigg', 'Stadig', 'Trött', 'Utmattad']);
    expect(words('clarity')).toEqual(['Klar', 'Ok', 'Dåsig', 'Dimmig']);
    expect(words('reserve')).toEqual(['Frisk', 'Sliten', 'Skadad', 'Svag']);
  });

  it('the word sits in a border coloured by its level, and is labelled with the resource\'s name', () => {
    const html = vitalChip(reading('vigor', 10), 1, en);
    expect(html).toContain('class="vword lv-3"');
    expect(html).toContain('>Exhausted<');
    expect(html).toContain('aria-label="VIGOR: Exhausted"');
    expect(vitalChip(reading('clarity', 60), 1, sv)).toContain('aria-label="KLARHET: Ok"');
  });
});

describe('words for the first week, bars from day 8 (#1824)', () => {
  it('the day is one constant', () => {
    expect(BARS_FROM_DAY).toBe(8);
    expect(barsOn(BARS_FROM_DAY - 1)).toBe(false);
    expect(barsOn(BARS_FROM_DAY)).toBe(true);
  });

  it('days 1–7: the word, no bar and no number', () => {
    for (const day of [1, 7]) {
      const html = vitalChip(reading('vigor', 50), day, en);
      expect(html).toContain('>Steady<');
      expect(html).not.toContain('class="mt"');
      expect(html).not.toContain('50');
    }
  });

  it('day 8 on: the bar, labelled with the same bordered word', () => {
    const html = vitalChip(reading('vigor', 50), 8, en);
    expect(html).toContain('vital bars');
    expect(html).toContain('class="vword lv-1"');
    expect(html).toContain('class="mf ok" style="width:50%"');
    expect(html).toContain('aria-label="VIGOR: Steady, 50"');
  });
});

describe('the header\'s two rows (#1824)', () => {
  const warden = wardenButton({ name: 'Ada', portrait: null, rank: 'Novice', open: false, data: 'tab' }, en);
  const rows = (vitals = full, shown = true) => headerRows({
    title: '<h1>❄ THE <span class="mark">WILDERNESS</span></h1>',
    counters: '<span class="counter ctl">DAY <b>3</b></span>',
    week: '<span class="weekchip">📅</span>',
    experiment: '',
    feedback: '<button class="pill fbbtn" data-cmd="feedback">💬</button>',
    row2: wardenRow({ warden, vitals, day: 3, shown }, en),
  }, menyButton(false, en, '', true));

  it('row 1: the place, the day, the week, the ⚙ and last the feedback, with no ?', () => {
    const html = rows();
    const row1 = html.slice(0, html.indexOf('hrow2'));
    const order = ['<h1>', 'counter ctl', 'weekchip', 'data-cmd="meny"', 'data-cmd="feedback"'].map(s => row1.indexOf(s));
    expect(order.every(i => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain('data-cmd="help"');
    expect(row1).not.toContain('class="who');
  });

  it('row 2: the Warden, then Vigor, Clarity and Condition', () => {
    const html = rows();
    const row2 = html.slice(html.indexOf('hrow2'));
    const order = ['class="who', 'VIGOR', 'CLARITY', 'RESERVE'].map(s => row2.indexOf(s));
    expect(order.every(i => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('the ⚙ keeps its word in a span a narrow screen can hide, and its aria-label', () => {
    const b = menyButton(false, sv, '', true);
    expect(b).toContain('⚙</span><span class="menyword">MENY</span>');
    expect(b).toContain('aria-label="Meny"');
    // Without `short`, the one-row header's button is as before.
    expect(menyButton(false, sv)).toContain('>⚙ MENY</button>');
  });

  it('on the road, the road\'s title takes the place\'s, and its 🧪 stays', () => {
    const html = headerRows({ title: '<h1>🛞 THE CARAVAN ROAD</h1>', counters: '', week: '', experiment: '<span class="pill exp">🧪</span>', feedback: '', row2: '' }, menyButton(false, en, '', true));
    expect(html).toContain('CARAVAN');
    expect(html).toContain('pill exp');
  });

  it('the guide holds the resources back until the first action, never the Warden', () => {
    const a = makeWarden({ id: 'w-probe-1', name: 'Ada' });
    const ctx = (x: typeof a) => ({ sim: x.sim, queued: x.queue.length, weatherAcked: true });
    expect(revealedNow(ctx(a)).has('vitals')).toBe(false);
    const before = rows(full, revealedNow(ctx(a)).has('vitals'));
    expect(before).toContain('class="who');
    expect(before).not.toContain('hvitals');
    const after = act(a, suggestedAction(a.sim));
    expect(revealedNow(ctx(after)).has('vitals')).toBe(true);
    expect(rows(full, revealedNow(ctx(after)).has('vitals'))).toContain('hvitals');
  });
});

describe('How to play in the Menu (#1824)', () => {
  it('comes right after the guide, and isn\'t drawn without a body', () => {
    const html = menyPage({ guide: '<i>g</i>', howto: '<p class="lede">how</p>', visual: '<i>v</i>' }, en);
    expect(html.indexOf('data-meny="guide"')).toBeLessThan(html.indexOf('data-meny="howto"'));
    expect(html.indexOf('data-meny="howto"')).toBeLessThan(html.indexOf('data-meny="visual"'));
    expect(html).toContain('>HOW TO PLAY</h3>');
    expect(menyPage({ guide: '<i>g</i>', howto: '' }, en)).not.toContain('data-meny="howto"');
  });
});

describe('the weather and the time of day in one row (#1825)', () => {
  const chips = (_t: typeof en, sky: string, felt: string): RowChip[] => [
    { id: 'sky', icon: '🌧', text: sky, full: `${sky}.` },
    { id: 'felt', icon: '🌡', text: felt, full: `${felt}.` },
    { id: 'season', icon: '🍂', text: 'Early autumn', full: 'Autumn.' },
  ];

  it('reads "🌧 Rain · Cool · early morning", and in Swedish "🌧 Regn · Svalt · tidig morgon"', () => {
    expect(weatherRowText(chips(en, 'Rain', en('wx.short.felt.cool')), en('time.short.early'))).toBe('🌧 Rain · Cool · early morning');
    expect(weatherRowText(chips(sv, 'Regn', sv('wx.short.felt.cool')), sv('time.short.early'))).toBe('🌧 Regn · Svalt · tidig morgon');
  });

  it('adds the snow underfoot when there is some, and the hours while they\'re shown', () => {
    const c = [...chips(en, 'Snow', 'Frosty'), { id: 'ground', icon: '❄', text: 'Ankle-deep', full: '' }];
    expect(weatherRowText(c, '6/14H')).toBe('🌧 Snow · Frosty · ❄ Ankle-deep · 6/14h');
  });

  it('a real run\'s chips make the row', () => {
    const s = makeWarden({ id: 'w-probe-1', name: 'Ada' }).sim;
    const text = weatherRowText(weatherChips(s, en), en('time.short.early'));
    expect(text.endsWith(' · early morning')).toBe(true);
    expect(text.split(' · ').length).toBeGreaterThanOrEqual(2);
  });

  it('folded, one row that is its own toggle; a tap unfolds the full box under it, another folds it', () => {
    const c = chips(en, 'Rain', 'Cool');
    // After the first time's card ("Got it"): folded, with #1788's hint until it's opened once.
    let fold = ackWeather(FIRST_VISIT);
    let st = weatherFoldState(fold);
    expect(st.mode).toBe('condensed');
    const folded = weatherRow({ chips: c, time: 'EARLY MORNING', open: st.mode === 'open', hint: st.hint, details: '<p>FULL</p>' }, en);
    expect(folded).toContain('data-wxfold aria-expanded="false"');
    expect(folded).toContain('🌧 Rain · Cool · early morning');
    expect(folded).not.toContain('FULL');
    expect(folded).toContain(en('wx.hint'));
    // A tap: open, the full lines under the row, no hint.
    fold = toggleWeather(fold);
    st = weatherFoldState(fold);
    const open = weatherRow({ chips: c, time: 'EARLY MORNING', open: st.mode === 'open', hint: st.hint, details: '<p>FULL</p>' }, en);
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain('<p>FULL</p>');
    expect(open).not.toContain(en('wx.hint'));
    // Again: folded, and the hint is gone for good.
    st = weatherFoldState(toggleWeather(fold));
    expect(st).toEqual({ mode: 'condensed', hint: false });
  });

  it('a blizzard\'s warning shows while folded', () => {
    const html = weatherRow({ chips: [], time: 'MORNING', open: false, hint: false, banner: '<p class="lockbanner">BLIZZARD</p>', details: '' }, sv);
    expect(html).toContain('BLIZZARD');
  });
});
