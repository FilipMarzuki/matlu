/**
 * The living backdrop's drawing (#1802; the scene itself is backdrop.ts).
 *
 * Two canvases fixed behind the page, under `#app`, and three mood layers over them (still behind
 * every box):
 *
 * - **the still layer** — the sky, the silhouettes of spruce and birch, the place's foreground (rock,
 *   water, a hill, a track, roofs), the snow, the night's dark and a faint noise for the murk. It's
 *   drawn only when the scene changes (`sceneKey`) or the window is resized: a full-screen redraw is
 *   the expensive part, and a mid-range tablet shouldn't do it sixty times a second.
 * - **the particle layer** — rain, snow, drifting fog and blown leaves. A light `requestAnimationFrame`
 *   loop clears and draws only these, at a capped resolution (particles don't need the screen's full
 *   pixel density). The loop runs only when something moves, and never with reduced motion, with the
 *   setting under ? off, or while the tab is hidden; then the particles are drawn once, frozen.
 * - **the mood layers** — CSS gradients (vignette, red-dark edges, frost corners) whose opacity
 *   follows the scene's mood, so a change fades in rather than jumping.
 *
 * Text is never drawn here, and the boxes are opaque, so contrast stays the boxes' own.
 */

import { moves, paletteFor, sceneKey, type Palette, type Scene } from './backdrop';

interface Tree { x: number; h: number; w: number; kind: 'spruce' | 'birch'; far: boolean }
interface Drop { x: number; y: number; s: number }

/** A small seeded random, so the treeline is the same on every load (and in every screenshot). */
const seeded = (seed: number): (() => number) => { let x = seed; return () => (x = (x * 16807) % 2147483647) / 2147483647; };

export interface Backdrop {
  /** Show this scene (null: take the backdrop away, and the page is as it was without it). */
  show(scene: Scene | null): void;
  /** Animate or keep still (the setting under ?). */
  setStill(still: boolean): void;
}

export function createBackdrop(doc: Document = document): Backdrop {
  const win = doc.defaultView ?? window;
  const reduce = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  let still = false;
  let scene: Scene | null = null;
  let pal: Palette | null = null;
  let key = '';
  let els: { still: HTMLCanvasElement; parts: HTMLCanvasElement; vignette: HTMLElement; fear: HTMLElement; frost: HTMLElement } | null = null;
  let W = 0, H = 0;
  let trees: Tree[] = [];
  let drops: Drop[] = [];
  let fogs: { x: number; y: number; r: number; v: number }[] = [];
  let noise: HTMLCanvasElement | null = null;
  let raf = 0;
  let t0 = 0;

  const mount = (): NonNullable<typeof els> => {
    if (els) return els;
    const c = (cls: string): HTMLCanvasElement => { const e = doc.createElement('canvas'); e.className = `bd ${cls}`; e.setAttribute('aria-hidden', 'true'); return e; };
    const d = (cls: string): HTMLElement => { const e = doc.createElement('div'); e.className = `bd bdmood ${cls}`; e.setAttribute('aria-hidden', 'true'); return e; };
    els = { still: c('bdstill'), parts: c('bdparts'), vignette: d('bdvignette'), fear: d('bdfear'), frost: d('bdfrost') };
    // First in <body>, so they sit under #app (they're fixed, with z-index -1: style.css).
    doc.body.prepend(els.still, els.parts, els.vignette, els.fear, els.frost);
    doc.documentElement.classList.add('backdrop');
    layout();
    return els;
  };

  const unmount = (): void => {
    stop();
    if (!els) return;
    for (const e of Object.values(els)) e.remove();
    els = null;
    key = '';
    doc.documentElement.classList.remove('backdrop');
  };

  /** Sizes and the seeded layout (trees, particles, fog banks) for the window as it is now. */
  function layout(): void {
    if (!els) return;
    W = Math.max(1, win.innerWidth); H = Math.max(1, win.innerHeight);
    // The still layer at up to 1.5× (it's murky: sharper buys nothing), the particles at 1×.
    const dpr = Math.min(1.5, win.devicePixelRatio || 1);
    els.still.width = Math.round(W * dpr); els.still.height = Math.round(H * dpr);
    els.still.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
    els.parts.width = W; els.parts.height = H;
    const rnd = seeded(7);
    trees = [];
    const n = Math.max(14, Math.round(W / 26));
    for (let i = 0; i < n; i++) {
      trees.push({ x: ((i + rnd() * 0.9) / n) * W, h: 0.6 + rnd() * 0.9, w: 0.75 + rnd() * 0.5, kind: rnd() < 0.36 ? 'birch' : 'spruce', far: rnd() < 0.5 });
    }
    // Far trees first, so the near ones stand in front.
    trees.sort((a, b) => Number(b.far) - Number(a.far));
    drops = Array.from({ length: Math.min(420, Math.round((W * H) / 4200)) }, () => ({ x: rnd() * W, y: rnd() * H, s: 0.6 + rnd() * 0.8 }));
    fogs = Array.from({ length: 7 }, () => ({ x: rnd() * W, y: H * (0.5 + rnd() * 0.4), r: 160 + rnd() * 240, v: 0.08 + rnd() * 0.12 }));
    key = '';
  }

  /** The murk: a small tile of grey noise, made once and laid over the still layer at low opacity. */
  function noiseTile(): HTMLCanvasElement {
    if (noise) return noise;
    noise = doc.createElement('canvas');
    noise.width = noise.height = 128;
    const g = noise.getContext('2d');
    if (g) {
      const img = g.createImageData(128, 128);
      const rnd = seeded(11);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.round(rnd() * 255);
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    }
    return noise;
  }

  function drawStill(sc: Scene, p: Palette): void {
    const ctx = els?.still.getContext('2d');
    if (!ctx) return;
    // The scene scales with the window's height: a tall phone has tall trees, not a strip at the bottom.
    const k = Math.min(1.5, Math.max(0.75, H / 720));
    // The horizon: lower on the hilltop (the open skyline), higher over the river (the water in front).
    const gy = H * (sc.place === 'hill' ? 0.9 : sc.place === 'river' ? 0.78 : 0.86);
    const sky = ctx.createLinearGradient(0, 0, 0, gy);
    sky.addColorStop(0, p.sky[0]); sky.addColorStop(0.62, p.sky[1]); sky.addColorStop(1, p.sky[2]);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    if (p.stars > 0) {
      const rnd = seeded(23);
      ctx.fillStyle = `rgba(210,220,235,${0.35 * p.stars})`;
      const n = Math.round((W * gy) / 9000 * (sc.place === 'hill' ? 1.6 : 1));
      for (let i = 0; i < n; i++) { const r = rnd() < 0.15 ? 1.2 : 0.7; ctx.fillRect(rnd() * W, rnd() * gy * 0.7, r, r); }
    }
    if (p.glow) {
      const gx = W * p.glow.x, gyy = H * p.glow.y, R = Math.max(W, H) * 0.45;
      const rg = ctx.createRadialGradient(gx, gyy, 0, gx, gyy, R);
      rg.addColorStop(0, p.glow.color); rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    }
    // The hilltop: one long rise in front, the woods far below and away.
    if (sc.place === 'hill') {
      ctx.fillStyle = p.ground;
      ctx.beginPath(); ctx.moveTo(0, gy - 10 * k);
      ctx.quadraticCurveTo(W * 0.45, gy - 70 * k, W, gy - 18 * k); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = p.ground; ctx.fillRect(0, gy, W, H - gy);
    // The cave: a mass of rock rising on the left, its mouth a darker hollow at the foot.
    if (sc.place === 'cave') {
      const cw = Math.min(W * 0.42, 520 * k);
      ctx.fillStyle = p.rock;
      ctx.beginPath(); ctx.moveTo(0, H * 0.3);
      ctx.lineTo(cw * 0.35, H * 0.36); ctx.lineTo(cw * 0.6, H * 0.47); ctx.lineTo(cw * 0.82, H * 0.6); ctx.lineTo(cw, gy + 4); ctx.lineTo(0, gy + 4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = mixC(p.rock, NIGHTISH, 0.6);
      ctx.beginPath(); ctx.ellipse(cw * 0.48, gy, cw * 0.16, 46 * k, 0, Math.PI, 0); ctx.fill();
    }
    drawTrees(ctx, sc, p, gy, k);
    // The village: a few roofs on the ground line, one window lit.
    if (sc.place === 'village') {
      const rnd = seeded(31);
      for (let i = 0; i < 5; i++) {
        const x = W * (0.12 + i * 0.19 + rnd() * 0.05), w = (46 + rnd() * 30) * k, h = (26 + rnd() * 14) * k;
        ctx.fillStyle = p.spruce;
        ctx.fillRect(x - w / 2, gy - h, w, h);
        ctx.beginPath(); ctx.moveTo(x - w * 0.6, gy - h); ctx.lineTo(x, gy - h - w * 0.45); ctx.lineTo(x + w * 0.6, gy - h); ctx.closePath(); ctx.fill();
        if (i % 2 === 0) { ctx.fillStyle = 'rgba(230,160,70,.28)'; ctx.fillRect(x - 5 * k, gy - h * 0.62, 8 * k, 7 * k); }
      }
    }
    // The road: a pale track running away to the horizon.
    if (sc.place === 'road') {
      ctx.fillStyle = mixA(p.birch, 0.16);
      ctx.beginPath(); ctx.moveTo(W * 0.47, gy); ctx.lineTo(W * 0.53, gy); ctx.lineTo(W * 0.7, H); ctx.lineTo(W * 0.3, H); ctx.closePath(); ctx.fill();
    }
    // The river: the water in front, the sky in it, a few pale streaks.
    if (sc.place === 'river') {
      const wy = gy + 10 * k;
      const wg = ctx.createLinearGradient(0, wy, 0, H);
      wg.addColorStop(0, p.sky[2]); wg.addColorStop(0.4, p.water); wg.addColorStop(1, p.water);
      ctx.fillStyle = wg; ctx.fillRect(0, wy, W, H - wy);
      const rnd = seeded(41);
      ctx.fillStyle = mixA(p.sky[2], 0.35);
      for (let i = 0; i < 26; i++) ctx.fillRect(rnd() * W, wy + rnd() * (H - wy), 18 + rnd() * 60, 1);
    }
    if (sc.snow > 0 && sc.place !== 'river') {
      ctx.fillStyle = `rgba(225,232,240,${0.08 + sc.snow * 0.12})`;
      ctx.fillRect(0, gy - 2, W, (4 + sc.snow * 8) * k);
    }
    // A low murk hanging over the ground, always: the woods at night are never quite clear.
    const mist = ctx.createLinearGradient(0, gy - H * 0.3, 0, gy + 20);
    mist.addColorStop(0, 'rgba(0,0,0,0)'); mist.addColorStop(1, mixA(p.sky[2], 0.35 + p.fog * 0.3));
    ctx.fillStyle = mist; ctx.fillRect(0, gy - H * 0.3, W, H * 0.3 + 20);
    // The night (and the cloud) over all of it, then the murk: a faint grain, like an old dark photograph.
    ctx.fillStyle = `rgba(5,7,11,${p.dark * 0.35})`; ctx.fillRect(0, 0, W, H);
    const pat = ctx.createPattern(noiseTile(), 'repeat');
    if (pat) { ctx.globalAlpha = p.murk; ctx.fillStyle = pat; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  }

  function drawTrees(ctx: CanvasRenderingContext2D, sc: Scene, p: Palette, gy: number, k: number): void {
    const fogCol = p.sky[2];
    const fogAmt = p.fog;
    for (const [i, tr] of trees.entries()) {
      // How the place thins or thickens the wood: the tree line is dense, the hilltop nearly bare,
      // the cave's rock and the river's far bank leave room.
      if (sc.place === 'hill' && (!tr.far || i % 3 !== 0)) continue;
      if ((sc.place === 'road' || sc.place === 'village') && !tr.far && i % 2 === 0) continue;
      if (sc.place === 'cave' && tr.x < Math.min(W * 0.42, 520 * k) * 0.9 && !tr.far) continue;
      if (sc.place === 'river' && !tr.far && i % 2 === 0) continue;
      const dense = sc.place === 'tree' ? 1.3 : 1;
      const far = tr.far;
      const base = (sc.place === 'hill' ? gy - 40 * k : gy) + (far ? -4 : 4);
      // Tall enough to stand up beside the boxes: a wood, not a hedge along the bottom.
      const unit = Math.max(150 * k, H * 0.3);
      const h = tr.h * unit * (far ? 0.66 : 1) * (sc.place === 'hill' ? 0.4 : dense);
      const w = tr.w * unit * 0.2 * (far ? 0.7 : 1) * (sc.place === 'hill' ? 0.45 : dense);
      const fade = far ? Math.min(0.85, 0.28 + fogAmt * 0.5) : fogAmt * 0.45;
      if (tr.kind === 'spruce' || sc.place === 'tree' && i % 4 !== 0) {
        spruce(ctx, tr.x, base, w, h, mixC(p.spruce, fogCol, fade), sc.snow > 0 ? mixC('#c9d2da', fogCol, 0.4 + fade * 0.4) : null);
      } else {
        ctx.fillStyle = mixC(p.birch, fogCol, fade);
        ctx.fillRect(tr.x - 1.5 * k, base - h, 3 * k, h);
        ctx.fillStyle = mixC(p.spruce, fogCol, Math.min(1, fade + 0.2));
        for (let m = 0; m < 5; m++) ctx.fillRect(tr.x - 1.5 * k, base - h * (0.2 + m * 0.15), 3 * k, 1.5 * k);
        if (p.leafAmt > 0) {
          ctx.fillStyle = mixC(p.leaf, fogCol, fade);
          const blobs = Math.round(9 * p.leafAmt) + 1;
          for (let m = 0; m < blobs; m++) {
            const a = (m / blobs) * Math.PI * 2;
            ctx.beginPath(); ctx.arc(tr.x + Math.cos(a) * w * 0.35, base - h * 0.78 + Math.sin(a) * h * 0.14, w * 0.2, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
      // The tree line's extra trunks fill the gaps: a wall of wood.
      if (sc.place === 'tree' && !far) spruce(ctx, tr.x + w * 0.6, base + 2, w * 0.8, h * 0.8, mixC(p.spruce, NIGHTISH, 0.3), null);
    }
  }

  function spruce(ctx: CanvasRenderingContext2D, x: number, base: number, w: number, h: number, col: string, snow: string | null): void {
    for (let m = 0; m < 4; m++) {
      const ty = base - h * (m / 4), tw = w * (1 - m / 5);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(x - tw / 2, ty); ctx.lineTo(x + tw / 2, ty); ctx.lineTo(x, ty - h * 0.42); ctx.closePath(); ctx.fill();
      if (snow) {
        ctx.fillStyle = snow;
        ctx.beginPath(); ctx.moveTo(x - tw * 0.2, ty - h * 0.31); ctx.lineTo(x + tw * 0.2, ty - h * 0.31); ctx.lineTo(x, ty - h * 0.42); ctx.closePath(); ctx.fill();
      }
    }
  }

  /** The particles at time `t` seconds. */
  function drawParts(t: number): void {
    const ctx = els?.parts.getContext('2d');
    if (!ctx || !pal) return;
    ctx.clearRect(0, 0, W, H);
    const p = pal;
    const nightDim = 1 - p.dark * 0.45;
    if (p.fog > 0) {
      for (const f of fogs) {
        const x = ((f.x + t * f.v * 60) % (W + f.r * 2)) - f.r;
        const rg = ctx.createRadialGradient(x, f.y, 0, x, f.y, f.r);
        rg.addColorStop(0, `rgba(150,156,160,${0.22 * p.fog * nightDim})`); rg.addColorStop(1, 'rgba(150,156,160,0)');
        ctx.fillStyle = rg; ctx.fillRect(x - f.r, f.y - f.r, f.r * 2, f.r * 2);
      }
    }
    if (p.rain > 0) {
      ctx.strokeStyle = `rgba(170,186,200,${0.32 * nightDim})`; ctx.lineWidth = 1;
      ctx.beginPath();
      const slant = 220 * p.wind;
      for (const d of drops) {
        const y = ((d.y + t * 900 * d.s) % (H + 40)) - 20, x = ((d.x + t * slant * d.s) % (W + 40)) - 20;
        ctx.moveTo(x, y); ctx.lineTo(x - 6 * d.s * p.wind, y - 18 * d.s);
      }
      ctx.stroke();
    }
    if (p.flakes > 0) {
      ctx.fillStyle = `rgba(232,238,244,${0.75 * nightDim})`;
      const fast = p.flakes > 0.8;
      const wind = fast ? 420 : 30, fall = fast ? 260 : 45;
      const n = Math.round(drops.length * (fast ? 1 : 0.55));
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const d = drops[i];
        const y = ((d.y + t * fall * d.s) % (H + 20)) - 10;
        const x = ((((d.x + t * wind * d.s + Math.sin(t + i) * 12) % (W + 20)) + W + 20) % (W + 20)) - 10;
        const r = fast ? 1.3 * d.s : 1.8 * d.s;
        ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    if (p.leaves > 0) {
      ctx.fillStyle = mixC(p.leaf, '#000000', 0.2);
      for (let i = 0; i < 40; i++) {
        const d = drops[i % drops.length];
        const x = ((d.x + t * 160 * d.s * p.wind) % (W + 20)) - 10;
        const y = ((d.y + t * 30 * d.s + Math.sin(t * 2 + i) * 20) % (H + 20)) - 10;
        ctx.fillRect(x, y, 3 * d.s, 2 * d.s);
      }
    }
  }

  const animating = (): boolean => !!pal && moves(pal) && !still && !reduce?.matches && !doc.hidden;

  function loop(now: number): void {
    drawParts((now - t0) / 1000);
    raf = win.requestAnimationFrame(loop);
  }
  function stop(): void { if (raf) win.cancelAnimationFrame(raf); raf = 0; }
  /** Start or stop the loop as things stand; stopped, the particles are drawn once, frozen. */
  function settle(): void {
    if (animating()) { if (!raf) { t0 = performance.now() - 4000; raf = win.requestAnimationFrame(loop); } return; }
    stop();
    drawParts(4);
  }

  function redraw(): void {
    if (!els || !scene || !pal) return;
    const k = sceneKey(scene);
    if (k !== key) { key = k; drawStill(scene, pal); }
    const m = scene.mood;
    els.vignette.style.opacity = String(m.vignette * 0.9);
    els.fear.style.opacity = String(m.fear * 0.85);
    els.frost.style.opacity = String(m.frost * 0.8);
    settle();
  }

  let resizeQueued = false;
  win.addEventListener('resize', () => {
    if (!els || resizeQueued) return;
    resizeQueued = true;
    win.requestAnimationFrame(() => { resizeQueued = false; layout(); redraw(); });
  });
  doc.addEventListener('visibilitychange', () => { if (els) settle(); });
  reduce?.addEventListener?.('change', () => { if (els) settle(); });

  return {
    show(next) {
      if (!next) { scene = null; pal = null; unmount(); return; }
      mount();
      scene = next;
      pal = paletteFor(next);
      redraw();
    },
    setStill(s) { still = s; if (els) settle(); },
  };
}

const NIGHTISH = '#05070b';
const mixC = (a: string, b: string, k: number): string => {
  const p = (h: string): number[] => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return `rgb(${x.map((c, i) => Math.round(c + (y[i] - c) * Math.min(1, Math.max(0, k)))).join(',')})`;
};
/** A #rrggbb colour at an alpha. */
const mixA = (h: string, a: number): string => {
  const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${c.join(',')},${a})`;
};
