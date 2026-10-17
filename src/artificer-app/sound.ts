/**
 * The ambient sound's switch and volume (#1828): the player's choice, kept per browser, and the one
 * place that decides when the audio engine is made.
 *
 * Browsers only let a page make sound after the player has done something (a tap, a key): an
 * AudioContext made before that starts "suspended" and plays nothing (Chrome's autoplay policy).
 * So the engine is built only from a gesture: the Sound on toggle, or (for a player who left it on
 * last visit) their first tap on the page. A redraw only hands the engine its new mix, and does
 * nothing at all while there's no engine. The factory is passed in, so the tests check that without
 * any audio.
 */

import { mixKey, type AmbienceMix } from './ambience-mix';

export interface SoundPrefs {
  on: boolean;
  /** 0–1. */
  volume: number;
}

/** Off by default: sound starts only when the player turns it on. */
export const DEFAULT_SOUND: SoundPrefs = { on: false, volume: 0.6 };
const KEY = 'artificer.sound';

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const storage = (): Store | null => { try { return localStorage; } catch { return null; } };

/** The kept choice, or the default when there's none (or storage is blocked, or it's garbled). */
export function loadSound(store: Store | null = storage()): SoundPrefs {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return { ...DEFAULT_SOUND };
    const p = JSON.parse(raw) as Partial<SoundPrefs>;
    return {
      on: p.on === true,
      volume: typeof p.volume === 'number' && Number.isFinite(p.volume) ? Math.min(1, Math.max(0, p.volume)) : DEFAULT_SOUND.volume,
    };
  } catch { return { ...DEFAULT_SOUND }; }
}

export function saveSound(p: SoundPrefs, store: Store | null = storage()): void {
  try { store?.setItem(KEY, JSON.stringify(p)); } catch { /* this visit only */ }
}

/** What the switch drives: ambience.ts's engine (or a fake in the tests). */
export interface AmbienceEngine {
  setMix(m: AmbienceMix): void;
  /** Start (or carry on) playing. Called from a gesture the first time. */
  start(): void;
  /** Stop playing (the context suspended), keeping the graph for the next start. */
  stop(): void;
}

/**
 * The switch: the prefs, the engine once made, and the last mix it was given. `make` returns null
 * where there's no Web Audio, and then nothing ever plays (and nothing throws).
 */
export class SoundSwitch {
  prefs: SoundPrefs;
  private engine: AmbienceEngine | null = null;
  private tried = false;
  private key = '';
  private last: AmbienceMix | null = null;
  /** The engine is playing (not stopped by the toggle or silenced by the feature switch). */
  private playing = false;

  constructor(private readonly make: () => AmbienceEngine | null, private readonly store: Store | null = storage()) {
    this.prefs = loadSound(store);
  }

  get built(): boolean { return this.engine !== null; }

  /** On a redraw: the mix for what's shown. Never builds the engine; cheap when nothing changed. */
  update(m: AmbienceMix): void {
    this.last = m;
    if (!this.engine || !this.prefs.on) return;
    // Back after the ui switch silenced it: the context was unlocked by an earlier gesture, so it may resume.
    if (!this.playing) { this.engine.start(); this.playing = true; this.key = ''; }
    const k = mixKey(m);
    if (k === this.key) return;
    this.key = k;
    this.engine.setMix(m);
  }

  /** The Sound on/off toggle (a gesture): turning it on builds the engine and starts it. */
  toggle(): void {
    this.prefs = { ...this.prefs, on: !this.prefs.on };
    saveSound(this.prefs, this.store);
    if (this.prefs.on) this.begin(); else this.halt();
  }

  /** The volume slider. The mix's master follows on the next `update`. */
  setVolume(v: number): void {
    this.prefs = { ...this.prefs, volume: Math.min(1, Math.max(0, v)) };
    saveSound(this.prefs, this.store);
  }

  /** Any tap on the page (a gesture): a player who left the sound on gets it back now. */
  gesture(): void {
    if (this.prefs.on && !this.engine) this.begin();
  }

  /** The ui feature switched off: silence, and the section is gone. */
  silence(): void { this.halt(); }

  private halt(): void {
    if (this.playing) this.engine?.stop();
    this.playing = false;
  }

  private begin(): void {
    if (!this.engine && !this.tried) {
      this.tried = true;
      try { this.engine = this.make(); } catch { this.engine = null; }
    }
    if (!this.engine) return;
    this.engine.start();
    this.playing = true;
    this.key = '';
    if (this.last) this.update(this.last);
  }
}
