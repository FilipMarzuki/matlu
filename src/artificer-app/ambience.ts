/**
 * The ambient sound's engine (#1828): every sound synthesized live with Web Audio, no files.
 *
 * Web Audio works as a graph of nodes: sources (looping noise buffers, oscillators) flow through
 * filters and gains to the speakers, and the browser renders it on its own audio thread. JavaScript
 * only sets the knobs (an `AudioParam` like a gain or a filter's frequency) and schedules one-shot
 * sounds ahead of time, so there's no per-frame JS work:
 *
 * - wind: brown noise through a band-pass that gusts move, plus a thin whistle band in strong wind;
 * - rain: pink noise, hissy, with scattered droplets; snow: a low-pass "hush" over the whole bed;
 * - the fire: a low rumble with crackles and the odd pop;
 * - a stream: white noise through three resonant bands that slow oscillators (LFOs) keep moving;
 * - drips: tiny falling tones, sparse; a cave adds a generated echo (a convolver);
 * - thunder: a rare long low rumble; unease: a faint beating drone (and a heartbeat when it's bad).
 *
 * Levels come from ambience-mix.ts `mixFor`; `setMix` glides every knob there with
 * `setTargetAtTime` (an exponential approach, about four seconds to settle), so a new day or the
 * walk out crossfades rather than jumps. The scattered sounds are put on the audio clock a little
 * ahead by one timeout five times a second (the usual Web Audio "look-ahead" pattern), which runs
 * only while sound is on and the page is visible. Hidden (a tablet locked, another tab), the context
 * is suspended and the timeout stopped; visible again, both resume.
 *
 * `Math.random` here is fine: it's the sound's own texture, never the sim's RNG streams.
 */

import type { AmbienceMix } from './ambience-mix';
import type { AmbienceEngine } from './sound';

/** The crossfade's time constant, in seconds: ~63% of the way in this, ~95% in three times it. */
const XF = 1.3;
/** How often the scheduler wakes, and how far ahead it puts sounds on the audio clock. */
const PUMP_MS = 200;
const AHEAD = 0.3;

type Ctor = new () => AudioContext;

/** The engine, or null where there's no Web Audio (it then simply does nothing). Call from a gesture. */
export function createAmbience(): AmbienceEngine | null {
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  const AC = w.AudioContext ?? w.webkitAudioContext;
  if (!AC) return null;
  try { return new Ambience(new AC()); } catch { return null; }
}

const ZERO: AmbienceMix = { wind: 0, gusts: 0, rain: 0, snow: 0, fire: 0, stream: 0, drips: 0, thunderRate: 0, echo: 0, unease: 0, master: 0 };
const STREAM_BANDS = [520, 980, 1650];

class Ambience implements AmbienceEngine {
  private mix: AmbienceMix = ZERO;
  private wanted = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private next = { gust: 0, drop: 0, crack: 0, drip: 0, thunder: 0, beat: 0 };
  private thunderBuf: AudioBuffer | null = null;
  private readonly ticks: AudioBuffer[];
  private readonly pops: AudioBuffer[];
  private readonly n: {
    master: GainNode; hush: BiquadFilterNode; dry: GainNode; wet: GainNode;
    windG: GainNode; windF: BiquadFilterNode; whistleG: GainNode; whistleF: BiquadFilterNode;
    rainG: GainNode; dropBus: GainNode; fireG: GainNode; crackBus: GainNode; popBus: GainNode;
    streamG: GainNode; dripBus: GainNode; thunderBus: GainNode; fearG: GainNode; beatBus: GainNode;
  };

  constructor(private readonly ctx: AudioContext) {
    const white = this.noise('white'), pink = this.noise('pink'), brown = this.noise('brown');
    const master = this.gain(0);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3;
    comp.connect(master); master.connect(ctx.destination);
    // The bed: everything but the thunder and the unease goes through the hush (snow, a cave's muffle)
    // and splits dry and into the cave's echo.
    const hush = this.filt('lowpass', 18000, 0.5);
    const dry = this.gain(1), wet = this.gain(0), verb = ctx.createConvolver();
    verb.buffer = this.caveImpulse();
    hush.connect(dry); hush.connect(wet); wet.connect(verb);
    dry.connect(comp); verb.connect(comp);

    // One looping source per noise colour, fanned out to the layers that use it (fewer nodes).
    const brownSrc = this.loop(brown), pinkSrc = this.loop(pink), whiteSrc = this.loop(white);
    // Wind, and its whistle.
    const windF = this.filt('bandpass', 450, 0.9), windG = this.gain(0);
    this.chain(brownSrc, windF, windG, hush);
    const whistleF = this.filt('bandpass', 1400, 8), whistleG = this.gain(0);
    this.chain(pinkSrc, whistleF, whistleG, hush);
    // Rain, and the droplets' bus (each droplet is a short buffer at its own pitch).
    const rainG = this.gain(0);
    this.chain(pinkSrc, this.filt('highpass', 700), this.filt('lowpass', 7000), rainG, hush);
    const dropBus = this.gain(0);
    this.chain(dropBus, this.filt('bandpass', 3500, 1), hush);
    // The fire's rumble; the crackles and pops have their own buses.
    const fireG = this.gain(0);
    this.chain(brownSrc, this.filt('lowpass', 420), fireG, hush);
    const crackBus = this.gain(0), popBus = this.gain(0);
    this.chain(crackBus, this.filt('highpass', 2500), hush);
    this.chain(popBus, this.filt('bandpass', 1200, 0.8), hush);
    // The stream: three resonant bands, each wobbled by its own slow oscillator, so it babbles.
    const streamLP = this.filt('lowpass', 2600), streamG = this.gain(0);
    STREAM_BANDS.forEach((f, i) => {
      const band = this.filt('bandpass', f, 6);
      const lfo = ctx.createOscillator(), depth = this.gain(f * 0.18);
      lfo.frequency.value = 0.7 + i * 0.63;
      lfo.connect(depth); depth.connect(band.frequency); lfo.start();
      whiteSrc.connect(band); band.connect(streamLP);
    });
    this.chain(streamLP, streamG, hush);
    const dripBus = this.gain(1); dripBus.connect(hush);
    // Thunder and the unease go past the hush: felt more than heard.
    const thunderBus = this.gain(1); thunderBus.connect(comp);
    const fearG = this.gain(0), fearLP = this.filt('lowpass', 200);
    for (const hz of [55, 55.7]) { const o = ctx.createOscillator(); o.frequency.value = hz; o.connect(fearLP); o.start(); }
    fearLP.connect(fearG); fearG.connect(comp);
    const beatBus = this.gain(1); beatBus.connect(comp);

    this.ticks = Array.from({ length: 8 }, (_, i) => this.burst(0.005 + i * 0.0015, 2.5));
    this.pops = [this.burst(0.03, 1), this.burst(0.045, 1)];
    this.n = { master, hush, dry, wet, windG, windF, whistleG, whistleF, rainG, dropBus, fireG, crackBus, popBus, streamG, dripBus, thunderBus, fearG, beatBus };

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
      else if (this.wanted) this.play();
    });
  }

  setMix(m: AmbienceMix): void {
    this.mix = m;
    const n = this.n, t = this.ctx.currentTime;
    const to = (p: AudioParam, v: number, tc = XF): void => { p.setTargetAtTime(v, t, tc); };
    to(n.master.gain, m.master, 0.3);
    to(n.windG.gain, 0.55 * m.wind);
    to(n.whistleG.gain, 0.1 * Math.max(0, m.wind - 0.55));
    to(n.rainG.gain, 0.32 * m.rain);
    to(n.dropBus.gain, m.rain > 0.02 ? 1 : 0);
    to(n.fireG.gain, 0.5 * m.fire);
    to(n.crackBus.gain, m.fire > 0.02 ? 1 : 0);
    to(n.popBus.gain, m.fire > 0.02 ? 1 : 0);
    to(n.streamG.gain, 0.4 * m.stream);
    to(n.wet.gain, m.echo);
    to(n.dry.gain, 1 - m.echo * 0.35);
    to(n.hush.frequency, Math.max(900, 18000 * (1 - 0.82 * m.snow) * (m.echo > 0 ? 0.45 : 1)), XF);
    to(n.fearG.gain, 0.1 * m.unease, 2);
    if (this.wanted && !document.hidden && !this.timer) this.pump();
  }

  start(): void {
    this.wanted = true;
    if (!document.hidden) this.play();
  }

  stop(): void {
    this.wanted = false;
    this.pause();
  }

  private play(): void {
    void this.ctx.resume().catch(() => undefined);
    if (!this.timer) this.pump();
  }

  private pause(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    void this.ctx.suspend().catch(() => undefined);
  }

  // ── The scheduler ─────────────────────────────────────────────────────────

  /** Put the next moment's scattered sounds on the audio clock, then sleep. */
  private pump(): void {
    this.timer = null;
    const m = this.mix, t = this.ctx.currentTime, ahead = t + AHEAD, nx = this.next, n = this.n;
    // Gusts: the wind's band and level wander, more with gustier weather.
    if (nx.gust < t && m.wind > 0.02) {
      const g = m.gusts, dur = 1.2 + Math.random() * 3;
      n.windF.frequency.setTargetAtTime(380 + 400 * m.wind * (1 + g * (Math.random() * 1.4 - 0.3)), t, dur / 3);
      n.windG.gain.setTargetAtTime(0.55 * m.wind * (1 - g * 0.6 + Math.random() * g * 1.2), t, dur / 3);
      n.whistleF.frequency.setTargetAtTime(1100 + Math.random() * 900, t, dur / 2);
      nx.gust = t + dur;
    }
    // Rain droplets, denser in harder rain.
    while (m.rain > 0.02 && nx.drop < ahead) {
      const at = Math.max(t, nx.drop);
      this.shot(this.ticks, n.dropBus, at, 0.1 + Math.random() * 0.16, 0.7 + Math.random());
      nx.drop = at + (0.008 + Math.random() * 0.05) / (m.rain + 0.05);
    }
    // The fire: crackles in little runs, and now and then a pop.
    while (m.fire > 0.02 && nx.crack < ahead) {
      const at = Math.max(t, nx.crack);
      if (Math.random() < 0.07) this.shot(this.pops, n.popBus, at, 0.5 * m.fire, 0.8 + Math.random() * 0.5);
      else this.shot(this.ticks, n.crackBus, at, 0.18 * m.fire, 0.8 + Math.random() * 0.8);
      nx.crack = at + (Math.random() < 0.2 ? 0.02 : 0.08 + Math.random() * 0.35) / (m.fire + 0.2);
    }
    // Drips: sparse falling tones.
    while (m.drips > 0.02 && nx.drip < ahead) {
      const at = Math.max(t, nx.drip);
      this.plink(at, 0.05 + Math.random() * 0.08 * m.drips);
      nx.drip = at + (0.3 + Math.random() * 1.6) / (m.drips + 0.1);
    }
    // Thunder: rare; the first only after a wait, so turning sound on in a storm doesn't start with a crack.
    if (m.thunderRate > 0.02) {
      if (nx.thunder === 0) nx.thunder = t + 4 + Math.random() * 8;
      else if (nx.thunder < t) { this.thunder(t + Math.random(), 0.9 * m.thunderRate); nx.thunder = t + 9 + (Math.random() * 22) / (m.thunderRate + 0.2); }
    } else nx.thunder = 0;
    // A heartbeat only when the mind is badly worn; the drone (setMix) carries the rest.
    if (m.unease >= 0.75 && nx.beat < ahead) {
      const at = Math.max(t, nx.beat);
      this.heartbeat(at, 0.35 * m.unease);
      nx.beat = at + 0.95 + Math.random() * 0.1;
    }
    if (this.wanted && !document.hidden) this.timer = setTimeout(() => this.pump(), PUMP_MS);
  }

  // ── Building blocks ───────────────────────────────────────────────────────

  private gain(v: number): GainNode { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  private filt(type: BiquadFilterType, f: number, q = 0.7): BiquadFilterNode {
    const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b;
  }
  private chain(...nodes: AudioNode[]): void { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); }
  private loop(buf: AudioBuffer): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s;
  }

  /** Four seconds of noise: white (flat), pink (softer highs) or brown (a rumble). */
  private noise(kind: 'white' | 'pink' | 'brown'): AudioBuffer {
    const len = this.ctx.sampleRate * 4, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'pink') { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
      else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    }
    return buf;
  }

  /** A short decaying click of noise, made once and replayed at different pitches. */
  private burst(dur: number, curve: number): AudioBuffer {
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur)), b = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, curve);
    return b;
  }

  /** A cave's echo: two seconds of decaying noise as the convolver's impulse. */
  private caveImpulse(): AudioBuffer {
    const len = Math.floor(this.ctx.sampleRate * 2.4), buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    return buf;
  }

  /** One of the clicks, at a time, level and pitch. */
  private shot(bufs: AudioBuffer[], dest: AudioNode, at: number, level: number, rate: number): void {
    const s = this.ctx.createBufferSource();
    s.buffer = bufs[Math.floor(Math.random() * bufs.length)];
    s.playbackRate.value = rate;
    const g = this.gain(level);
    s.connect(g); g.connect(dest); s.start(at);
  }

  private plink(t: number, level: number): void {
    const o = this.ctx.createOscillator(), g = this.gain(0), f0 = 900 + Math.random() * 900;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.09);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g); g.connect(this.n.dripBus); o.start(t); o.stop(t + 0.2);
  }

  private thunder(t: number, level: number): void {
    if (!this.thunderBuf) {
      const sr = this.ctx.sampleRate, len = sr * 6, b = this.ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = last * 3.5 * Math.min(1, i / (sr * 0.4)) * Math.pow(1 - i / len, 1.6) * (1 + 0.6 * Math.sin((i / sr) * 3));
      }
      this.thunderBuf = b;
    }
    const s = this.ctx.createBufferSource(); s.buffer = this.thunderBuf;
    s.playbackRate.value = 0.85 + Math.random() * 0.3;
    this.chain(s, this.filt('lowpass', 160), this.gain(level), this.n.thunderBus);
    s.start(t);
  }

  private heartbeat(t: number, level: number): void {
    for (const [dt, lv] of [[0, 1], [0.28, 0.7]] as const) {
      const o = this.ctx.createOscillator(), g = this.gain(0);
      o.frequency.setValueAtTime(70, t + dt); o.frequency.exponentialRampToValueAtTime(42, t + dt + 0.12);
      g.gain.setValueAtTime(0, t + dt); g.gain.linearRampToValueAtTime(level * lv, t + dt + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.22);
      o.connect(g); g.connect(this.n.beatBus); o.start(t + dt); o.stop(t + dt + 0.3);
    }
  }
}
