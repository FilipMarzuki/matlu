/**
 * #1808: the ⚙ Menu. With its ui switch on, the header keeps the title's company only (the Warden,
 * the day, the week's chip, help, feedback, the ⚙) and the rest moves onto the Menu page, in the
 * owner's order; off, the header and the help panel are the ones from before.
 */

import { describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { esc } from './html';
import { en as EN } from '../artificer/i18n/en';
import { sv as SV } from '../artificer/i18n/sv';
import { FEATURES, featureById, ruleFeatures, uiFeatureOn } from '../artificer/features';
import {
  MENY_FEATURE, MENY_SECTIONS, elsewhereBody, experimentsBody, headerControls, helpExtras, menyButton, menyPage,
  newGameBody, newSaveButton, playAiLink, profileBody, weeklyButton, type HeaderParts,
} from './meny';

const en = makeT('en');
const sv = makeT('sv');

/** A header as the page draws it, with the real moved controls and stand-ins for the rest. */
const parts = (t = en): HeaderParts => ({
  warden: '<button class="who" data-tab="warden">W</button>',
  counters: '<span class="counter ctl">DAY <b>3</b></span>',
  week: '<span class="weekchip">📅</span>',
  experiment: '',
  dev: '<span class="pill devchip">DEV</span>',
  playAi: playAiLink(t),
  weekly: weeklyButton(t),
  features: '<button class="pill" data-cmd="features">🧪</button>',
  look: '<span class="ctl lookswitch"></span>',
  help: '<button class="pill" data-cmd="help">?</button>',
  feedback: '<button class="pill fbbtn" data-cmd="feedback">💬</button>',
  reset: newSaveButton(t),
});

const MOVED = ['data-cmd="reset"', 'data-cmd="weekly"', 'href="/play-with-ai/"', 'data-cmd="features"', 'lookswitch', 'devchip'];

describe('the meny ui feature (#1808)', () => {
  it('is a ui feature, experimental, on by default, registered after the ui features before it, and no run saves it', () => {
    expect(featureById(MENY_FEATURE)).toMatchObject({ kind: 'ui', stage: 'experimental', default: true, absent: false, issue: 1808 });
    expect(uiFeatureOn({}, MENY_FEATURE)).toBe(true);
    expect(uiFeatureOn({ [MENY_FEATURE]: false }, MENY_FEATURE)).toBe(false);
    expect(Object.keys(ruleFeatures())).not.toContain(MENY_FEATURE);
    // The ui features after it (the queue beside the actions, #1826) come later; the ones before stay before.
    const at = (id: string): number => FEATURES.findIndex(f => f.id === id);
    expect(at(MENY_FEATURE)).toBeGreaterThan(at('backdrop'));
    expect(at(MENY_FEATURE)).toBeLessThan(at('side-queue'));
  });
});

describe('the header (#1808)', () => {
  it('with the Menu on: the Warden, the day, the week, help, feedback and the ⚙, in that order, and nothing that moved', () => {
    const html = headerControls(true, parts(), menyButton(false, en));
    for (const m of MOVED) expect(html, m).not.toContain(m);
    const order = ['class="who"', 'counter ctl', 'weekchip', 'data-cmd="help"', 'data-cmd="feedback"', 'data-cmd="meny"'].map(s => html.indexOf(s));
    expect(order.every(i => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('on the road the 🧪 chip stays', () => {
    const html = headerControls(true, { ...parts(), experiment: '<span class="pill exp">🧪</span>', help: '' }, menyButton(false, en));
    expect(html).toContain('pill exp');
  });

  it('with the switch off: the header from before, New save and all, and no ⚙', () => {
    const html = headerControls(false, parts(), menyButton(false, en));
    for (const m of MOVED) expect(html, m).toContain(m);
    expect(html).not.toContain('data-cmd="meny"');
    expect(html.indexOf('data-cmd="reset"')).toBeGreaterThan(html.indexOf('data-cmd="feedback"'));
  });

  it('the ⚙ is expanded and gold while the Menu shows, and carries the DEV tag in dev mode', () => {
    expect(menyButton(false, en)).toContain('aria-expanded="false"');
    expect(menyButton(false, en)).not.toContain(' on"');
    const open = menyButton(true, sv, '<span class="devtag">DEV</span>');
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain('menybtn on');
    expect(open).toContain('⚙ MENY');
    expect(open).toContain('devtag');
    expect(menyButton(false, en)).toContain('⚙ MENU');
  });

  it('the help panel keeps only how to play with the Menu on; off, its settings as before', () => {
    expect(helpExtras(true, ['<lang>', '<guide>'])).toBe('');
    expect(helpExtras(false, ['<lang>', '<guide>'])).toBe('<lang><guide>');
  });
});

describe('the Menu page (#1808)', () => {
  const bodies = Object.fromEntries(MENY_SECTIONS.map(id => [id, `<i>${id}</i>`]));

  it('has its sections in the owner\'s order, each with its heading, and no Sound while there is no sound', () => {
    expect(MENY_SECTIONS).toEqual(['newgame', 'profile', 'language', 'guide', 'visual', 'elsewhere', 'experiments', 'developer']);
    const html = menyPage(bodies, en);
    const at = MENY_SECTIONS.map(id => html.indexOf(`data-meny="${id}"`));
    expect(at.every(i => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    for (const h of ['NEW GAME', 'PROFILE', 'LANGUAGE', 'GUIDE', 'LOOK', 'PLAY ELSEWHERE', 'EXPERIMENTS', 'DEVELOPER']) expect(html).toContain(`>${h}</h3>`);
    expect(html).not.toMatch(/sound/i);
    expect(html).toContain('data-cmd="menyclose"');
    expect(html).toContain('id="meny-title" tabindex="-1"');
  });

  it('in Swedish', () => {
    const html = menyPage(bodies, sv);
    for (const h of ['MENY', 'NYTT SPEL', 'PROFIL', 'SPRÅK', 'GUIDE', 'UTSEENDE', 'SPELA PÅ ANNAT SÄTT', 'EXPERIMENT', 'UTVECKLARE']) expect(html).toContain(`>${h}</h`);
  });

  it('leaves out a section with nothing in it (the guide on the road)', () => {
    const html = menyPage({ ...bodies, guide: '' }, en);
    expect(html).not.toContain('data-meny="guide"');
    expect(html).toContain('data-meny="visual"');
  });

  it('New game asks on the page before New save, and has this week\'s world', () => {
    const ask = newGameBody({ asking: false }, en);
    expect(ask).toContain('data-cmd="newgame"');
    expect(ask).not.toContain('data-cmd="reset"');
    expect(ask).toContain('data-cmd="weekly"');
    const sure = newGameBody({ asking: true }, en);
    expect(sure).toContain(esc(en('meny.confirm')));
    expect(sure).toContain('data-cmd="reset"');
    expect(sure).toContain('data-cmd="newgameno"');
  });

  it('Profile: this game\'s id to copy (escaped), and the Records; no count of games played (#1837)', () => {
    const html = profileBody({ runId: 'w-<x>', copied: false }, en);
    expect(html).not.toMatch(/played/i);
    expect(html).toContain('w-&#60;x&#62;');
    expect(html).toContain('data-cmd="copyid"');
    expect(html).toContain('href="/records/"');
    expect(html).not.toContain('Copied');
    expect(profileBody({ runId: 'w', copied: true }, sv)).toContain('Kopierat');
  });

  it('Play elsewhere: with your AI and the text console', () => {
    const html = elsewhereBody(en);
    expect(html).toContain('href="/play-with-ai/"');
    expect(html).toContain('href="/console/"');
  });

  it('Experiments say what they are and whether this game has any on; their switches are dev mode\'s', () => {
    const none = experimentsBody({ on: [], dev: false, controls: '<b>switches</b>' }, en);
    expect(none).toContain('marked 🧪 in the Records');
    expect(none).toContain('This game has no experiments on.');
    expect(none).not.toContain('switches');
    const some = experimentsBody({ on: ['Referrals', 'Ties'], dev: true, controls: '<b>switches</b>' }, en);
    expect(some).toContain('This game has 2 experiments on.');
    expect(some).toContain('<summary>Which ones</summary><p class="mood">Referrals, Ties</p>');
    expect(some).toContain('switches');
  });

  it('has its words in English and Swedish', () => {
    const keys = Object.keys(EN).filter(k => k.startsWith('meny.'));
    expect(keys.length).toBeGreaterThan(20);
    for (const k of keys) expect((SV as Record<string, string>)[k], k).toBeTruthy();
  });
});
