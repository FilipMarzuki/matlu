/**
 * The ambient sound's switch (#1828): the player's choice kept per browser (off by default), and
 * the engine made only from a gesture, never by a redraw.
 */

import { describe, expect, it } from 'vitest';
import { mixFor, type AmbienceInput, type AmbienceMix } from './ambience-mix';
import { DEFAULT_SOUND, SoundSwitch, loadSound, saveSound, type AmbienceEngine } from './sound';

/** A Storage stand-in: a Map, or one whose every call throws (a private window, blocked site data). */
const fakeStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
};
const throwing = { getItem: (): string | null => { throw new Error('blocked'); }, setItem: (): void => { throw new Error('blocked'); } };

const input: AmbienceInput = { weather: 'rain', blizzard: false, season: 'late-autumn', time: 'night', place: 'cave', fire: true, clarity: 1, out: false, volume: 0.6 };

/** An engine that records what it's told, and a factory that counts how often it's asked to make one. */
function fakes() {
  const calls: string[] = [];
  const mixes: AmbienceMix[] = [];
  let made = 0;
  const engine: AmbienceEngine = { setMix: m => { mixes.push(m); calls.push('mix'); }, start: () => { calls.push('start'); }, stop: () => { calls.push('stop'); } };
  return { calls, mixes, made: () => made, make: () => { made += 1; return engine; } };
}

describe('the sound prefs (#1828)', () => {
  it('are off by default, with nothing kept', () => {
    expect(DEFAULT_SOUND.on).toBe(false);
    expect(loadSound(fakeStore())).toEqual(DEFAULT_SOUND);
    expect(loadSound(null)).toEqual(DEFAULT_SOUND);
  });

  it('round-trip under artificer.sound, the volume clamped', () => {
    const s = fakeStore();
    saveSound({ on: true, volume: 0.3 }, s);
    expect(s.m.has('artificer.sound')).toBe(true);
    expect(loadSound(s)).toEqual({ on: true, volume: 0.3 });
    s.setItem('artificer.sound', JSON.stringify({ on: 'yes', volume: 9 }));
    expect(loadSound(s)).toEqual({ on: false, volume: 1 });
  });

  it('a garbled value or throwing storage gives the default, and saving doesn\'t throw', () => {
    const s = fakeStore();
    s.setItem('artificer.sound', '{not json');
    expect(loadSound(s)).toEqual(DEFAULT_SOUND);
    expect(loadSound(throwing)).toEqual(DEFAULT_SOUND);
    expect(() => saveSound({ on: true, volume: 1 }, throwing)).not.toThrow();
    expect(() => new SoundSwitch(() => null, throwing).toggle()).not.toThrow();
  });
});

describe('the engine is made only from a gesture (#1828)', () => {
  it('a redraw never makes it, even with sound kept on; the first tap does', () => {
    const f = fakes(), s = fakeStore();
    saveSound({ on: true, volume: 0.6 }, s);
    const sw = new SoundSwitch(f.make, s);
    for (let i = 0; i < 5; i++) sw.update(mixFor(input));
    expect(f.made()).toBe(0);
    expect(sw.built).toBe(false);
    sw.gesture();
    expect(f.made()).toBe(1);
    expect(f.calls).toEqual(['start', 'mix']);
    sw.gesture();
    expect(f.made()).toBe(1);
  });

  it('with sound off, a tap makes nothing; the toggle makes it, starts it, and keeps the choice', () => {
    const f = fakes(), s = fakeStore();
    const sw = new SoundSwitch(f.make, s);
    sw.update(mixFor(input));
    sw.gesture();
    expect(f.made()).toBe(0);
    sw.toggle();
    expect(f.made()).toBe(1);
    expect(f.calls).toEqual(['start', 'mix']);
    expect(loadSound(s).on).toBe(true);
    sw.toggle();
    expect(f.calls.at(-1)).toBe('stop');
    expect(loadSound(s).on).toBe(false);
    // Off: the mix isn't sent.
    sw.update(mixFor({ ...input, weather: 'clear' }));
    expect(f.calls.at(-1)).toBe('stop');
  });

  it('an unchanged mix isn\'t sent again; a changed one is', () => {
    const f = fakes();
    const sw = new SoundSwitch(f.make, fakeStore());
    sw.toggle();
    sw.update(mixFor(input));
    sw.update(mixFor(input));
    expect(f.mixes).toHaveLength(1);
    sw.update(mixFor({ ...input, weather: 'storm' }));
    expect(f.mixes).toHaveLength(2);
  });

  it('the volume is kept, and the next update carries it', () => {
    const f = fakes(), s = fakeStore();
    const sw = new SoundSwitch(f.make, s);
    sw.toggle();
    sw.setVolume(0.2);
    expect(loadSound(s).volume).toBe(0.2);
    sw.update(mixFor({ ...input, volume: sw.prefs.volume }));
    expect(f.mixes.at(-1)?.master).toBeLessThanOrEqual(0.2);
  });

  it('silenced by the ui switch, it stops once; back on, the next update starts it again', () => {
    const f = fakes();
    const sw = new SoundSwitch(f.make, fakeStore());
    sw.toggle();
    sw.silence(); sw.silence();
    expect(f.calls.filter(c => c === 'stop')).toHaveLength(1);
    sw.update(mixFor(input));
    expect(f.calls.slice(-2)).toEqual(['start', 'mix']);
  });

  it('without Web Audio (a factory that gives null, or throws) nothing plays and nothing throws', () => {
    const none = new SoundSwitch(() => null, fakeStore());
    expect(() => { none.toggle(); none.update(mixFor(input)); none.gesture(); none.silence(); }).not.toThrow();
    expect(none.built).toBe(false);
    const bad = new SoundSwitch(() => { throw new Error('no audio'); }, fakeStore());
    expect(() => bad.toggle()).not.toThrow();
    expect(bad.built).toBe(false);
  });
});
