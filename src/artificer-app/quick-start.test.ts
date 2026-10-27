/**
 * The quick start (#1928, roadmap item 6 of #1914): which intro screens play, what the card says
 * and offers, and that Play's Warden is the play API's quick start, which the server's replay of
 * the log makes the same. How it looks is checked by screenshot (the issue is `ui-menus`).
 */

import { describe, it, expect } from 'vitest';
import { makeT } from '../artificer/i18n';
import { featureById, uiFeatureOn } from '../artificer/features';
import { DEFAULT_STATS } from '../artificer/stats';
import { DEFAULT_AGE, grownStats } from '../artificer/growing';
import { suggestedPack } from '../artificer/kit';
import { difficultyOfCharacter } from '../artificer/difficulty';
import { serialize, makeWarden } from './controller';
import { introBeats, introHtml, fillName, QUICK_START_FEATURE, QUICK_NAME, type QuickStep } from './intro';
import { webStart } from '../artificer-play/web-log';
import { startOf, startProblem } from '../artificer-play/web-run';

const READY: QuickStep = { step: 'ready', age: DEFAULT_AGE };
const CHANGE: QuickStep = { step: 'change', age: DEFAULT_AGE };
const ids = (s: Parameters<typeof introBeats>[0], quick: QuickStep) => introBeats(s, makeT('en'), quick).map(b => b.id);

describe('the quick start switch (#1928)', () => {
  it('is a ui switch, on by default, that a player can turn off', () => {
    expect(featureById(QUICK_START_FEATURE)).toMatchObject({ kind: 'ui', default: true, issue: 1928 });
    expect(uiFeatureOn({}, QUICK_START_FEATURE)).toBe(true);
    expect(uiFeatureOn({ [QUICK_START_FEATURE]: false }, QUICK_START_FEATURE)).toBe(false);
  });
});

describe('the quick start\'s screens (#1928)', () => {
  const s = makeWarden({ id: 'w-1928-beats' }).sim;

  it('plays one story page, then the card, in en and sv', () => {
    for (const lang of ['en', 'sv'] as const) {
      const t = makeT(lang);
      const [fall, ready, ...rest] = introBeats(s, t, READY);
      expect(rest).toEqual([]);
      // The hike and the seam you fall through: LAND's first note assumes you know you're somewhere else.
      expect(fall).toEqual({ id: 'fall', kind: 'narration', portal: true, lines: [t('intro.hike1'), t('intro.seam1'), t('intro.seam2')] });
      expect(ready.kind).toBe('ready');
      expect(ready.lines.at(-1)).toBe(t('intro.winter'));
    }
    const en = introBeats(s, makeT('en'), READY)[1], sv = introBeats(s, makeT('sv'), READY)[1];
    expect(fillName(en.lines[0], QUICK_NAME)).toBe("You're Saga, 12, a scout. Your pack is ready.");
    expect(fillName(sv.lines[0], QUICK_NAME, makeT('sv'))).toBe('Du är Saga, 12 år, scout. Packningen är klar.');
    // The card says the age the draft has, and the name the player wrote.
    expect(fillName(introBeats(s, makeT('en'), { step: 'ready', age: 14 })[1].lines[0], 'Vega')).toBe("You're Vega, 14, a scout. Your pack is ready.");
  });

  it('Change puts the creation and pack screens between the two, in the run\'s order, and comes back to the card', () => {
    expect(ids(s, CHANGE)).toEqual(['fall', 'create', 'pack', 'ready']);
    expect(ids(makeWarden({ id: 'w-1928-off' }, undefined, { 'stats-before-pack': false }).sim, CHANGE)).toEqual(['fall', 'pack', 'create', 'ready']);
    // Asked in the scout's own voice either way: the portal's voice doesn't play in the quick start.
    for (const lang of ['en', 'sv'] as const) {
      const t = makeT(lang);
      expect(introBeats(s, t, CHANGE).find(b => b.id === 'create')!.lines).toEqual([t('intro.whoAreYou')]);
    }
  });

  it('a Warden who follows someone hears what was left on the card, before the winter', () => {
    const left = makeWarden({ id: 'w-1928-left' }, { known: [], concepts: {}, heirlooms: [{ item: 'stone-knife', grade: 'masterwork' }] }).sim;
    const t = makeT('en');
    const ready = introBeats(left, t, READY)[1];
    expect(ready.lines.slice(1)).toEqual([t('intro.before'), expect.stringMatching(/^They left: .*stone knife\.$/), t('intro.winter')]);
  });

  it('without the switch the whole arrival plays as before', () => {
    expect(introBeats(s).map(b => b.id)).toEqual(['hike', 'create', 'pack', 'portal', 'stone', 'arrival', 'class', 'registered', 'title']);
  });
});

describe('the card\'s buttons (#1928)', () => {
  const s = makeWarden({ id: 'w-1928-html' }).sim;
  const view = (i: number, lang: 'en' | 'sv' = 'en') => {
    const beats = introBeats(s, makeT(lang), READY);
    return introHtml({ beat: beats[i], i, count: beats.length, name: QUICK_NAME, form: '', nextDisabled: false, feedback: '', t: makeT(lang) });
  };

  it('offers Play and Change, and no Skip, in en and sv', () => {
    expect(view(1)).toContain('data-intro="change">Change who I am / what I packed</button>');
    expect(view(1)).toMatch(/data-intro="next"\s*>PLAY ▸<\/button>/);
    expect(view(1)).not.toContain('data-intro="skip"');
    expect(view(1, 'sv')).toContain('data-intro="change">Ändra vem jag är / vad jag packat</button>');
    expect(view(1, 'sv')).toMatch(/>SPELA ▸<\/button>/);
    expect(view(1)).toContain("You&#39;re Saga, 12, a scout.");
  });

  it('the story page before it keeps Skip and Continue', () => {
    expect(view(0)).toContain('data-intro="skip"');
    expect(view(0)).not.toContain('data-intro="change"');
  });
});

describe('Play\'s Warden (#1928)', () => {
  // What main.ts commitQuick makes, and what its log's start says.
  const spec = { name: QUICK_NAME, portrait: 'loke', age: DEFAULT_AGE };
  const page = makeWarden({ id: 'w-1928-play', ...spec });

  it('is the play API\'s quick start: average stats, no talents chosen, ×1.00, the pack ticked for them', () => {
    const c = page.sim.character;
    expect(c.name).toBe('Saga');
    expect(c.age).toBe(12);
    expect(difficultyOfCharacter(c)).toBe(1);
    expect(c.talents.filter(x => x.known)).toEqual([]);
    expect(page.sim.kit?.items).toEqual(suggestedPack(page.sim.config.world.features ?? {}, grownStats(DEFAULT_STATS, DEFAULT_AGE), []));
  });

  it('is what the server makes from its log\'s start', () => {
    const start = webStart(page, spec, null);
    expect(startProblem(start)).toBeNull();
    expect(serialize(startOf(start))).toBe(serialize(page));
  });
});
