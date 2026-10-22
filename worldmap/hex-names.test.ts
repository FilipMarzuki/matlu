/**
 * #1898 — hex names: what people call each hex of the known world, in English and Swedish
 * (docs/spikes/artificer-hex-world.md §6 Views: "the birch valley", "the marsh country").
 *
 * One test per naming scenario (1, 4): names and summaries must come out the same however often and
 * in whatever order they're asked for (1), and no two hexes of the known world may share a name
 * (4). A few checks of the rules behind them follow: every land and qualifier gives its own name,
 * so the names stay distinct on any seed, not only the 20 tried; the nearest hex of each land keeps
 * the plain name; and a hex beyond the known world gets its land's plain name.
 */

import { describe, it, expect, vi } from 'vitest';
import * as summaryModule from './hex-summary';
import * as namesModule from './hex-names';
import { hexName, landName, QUALIFIERS, type HexNameLang } from './hex-names';
import { summariesAround, KNOWN_RADIUS, type HexLand } from './hex-summary';
import { hexDistance, hexKey, type Hex } from './coords';
import { seedOf } from './rng';

const HW_SEEDS = Array.from({ length: 20 }, (_, i) => seedOf(`hw${i}`));
const LANDS: readonly HexLand[] = ['fells', 'heights', 'pinewood', 'birch-valley', 'marsh', 'lakes', 'meadows', 'heath'];
const LANGS: readonly HexNameLang[] = ['en', 'sv'];

describe('worldmap/hex-names: a name for every hex of the known world (#1898)', () => {
  it("scenario 1: given seedOf('w-vega'), summariesAround and every hexName (en and sv), computed twice, deep-equal, and there are 61 summaries", async () => {
    const seed = seedOf('w-vega');
    type Summaries = typeof summaryModule;
    type Names = typeof namesModule;
    // The second run asks for the names in the opposite order, so a name can't depend on which
    // hex was asked for first.
    const run = (s: Summaries, n: Names, backwards: boolean) => {
      const summaries = s.summariesAround(seed);
      const hexes = summaries.map(x => x.hex);
      const asked = backwards ? [...hexes].reverse() : hexes;
      const named = new Map(asked.map(h => [hexKey(h), { en: n.hexName(seed, h, 'en'), sv: n.hexName(seed, h, 'sv') }]));
      return { summaries, names: hexes.map(h => named.get(hexKey(h))) };
    };

    const first = run(summaryModule, namesModule, false);
    // A fresh copy of the modules, so nothing remembered from the first run is reused.
    vi.resetModules();
    const second = run(await import('./hex-summary'), await import('./hex-names'), true);

    expect(first.summaries).toHaveLength(61);
    expect(second).toEqual(first);
  });

  it('scenario 4: given the 20 seeds hw0..hw19, the 61 en names and the 61 sv names of each are, in each language, 61 distinct non-empty strings', () => {
    for (const seed of HW_SEEDS) {
      const hexes = summariesAround(seed).map(s => s.hex);
      expect(hexes).toHaveLength(61);
      for (const lang of LANGS) {
        const names = hexes.map(h => hexName(seed, h, lang));
        expect(names.every(n => typeof n === 'string' && n.trim().length > 0), `seed ${seed}, ${lang}: ${names.join(' | ')}`).toBe(true);
        const repeated = names.filter((n, i) => names.indexOf(n) !== i);
        expect(repeated, `seed ${seed}, ${lang}`).toEqual([]);
        expect(new Set(names).size).toBe(61);
      }
    }
  });

  it('every land, plain or with any qualifier, gives a distinct name in each language, and there are qualifiers enough for 60 hexes', () => {
    // 61 hexes in the known world, and the nearest of each land keeps the plain name, so at most 60
    // ever need a qualifier. Each qualifier is used once a seed, so 60 always suffice.
    expect(QUALIFIERS.length).toBeGreaterThanOrEqual(1 + 3 * KNOWN_RADIUS * (KNOWN_RADIUS + 1) - 1);
    for (const lang of LANGS) {
      const all: string[] = [];
      for (const land of LANDS) {
        all.push(landName(land, lang));
        for (const q of QUALIFIERS) all.push(landName(land, lang, q));
      }
      expect(all.every(n => n.trim().length > 0)).toBe(true);
      const repeated = all.filter((n, i) => all.indexOf(n) !== i);
      expect(repeated, lang).toEqual([]);
    }
  });

  it('the nearest hex of each land to (0,0) (ties by hexKey) keeps the plain name; every other hex of that land is qualified', () => {
    const seed = seedOf('w-vega');
    const summaries = summariesAround(seed);
    const origin: Hex = { q: 0, r: 0 };
    for (const land of new Set(summaries.map(s => s.land))) {
      const mine = summaries.filter(s => s.land === land).map(s => s.hex);
      const nearest = [...mine].sort((a, b) => hexDistance(a, origin) - hexDistance(b, origin) || (hexKey(a) < hexKey(b) ? -1 : 1))[0];
      for (const h of mine)
        for (const lang of LANGS) {
          const plain = landName(land, lang);
          if (hexKey(h) === hexKey(nearest)) expect(hexName(seed, h, lang), `${land} at ${hexKey(h)}`).toBe(plain);
          else expect(hexName(seed, h, lang), `${land} at ${hexKey(h)}`).not.toBe(plain);
        }
    }
  });

  it("a hex beyond the known world is called by its land's plain name", () => {
    const seed = seedOf('w-vega');
    const far: Hex = { q: 0, r: KNOWN_RADIUS + 3 };
    const { land } = summaryModule.hexSummary(seed, far);
    for (const lang of LANGS) expect(hexName(seed, far, lang)).toBe(landName(land, lang));
  });
});
