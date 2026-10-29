/**
 * The UI re-measure (#1997): the design review's findings F1–F8 (#1914,
 * docs/design/artificer-vs-runescape-walkscape.md §1.4) measured again, on a tablet (1024 × 700) and
 * a phone (400 × 860), in English and Swedish, with touch on (so `pointer: coarse` applies):
 *
 * - day 1: a new game from a cleared page, tapping through to the first real choice, as a new player;
 * - day 14: the playtest's scripted Warden on the morning of day 14 with its plan queued
 *   (scripts/artificer-ui-saves.ts), as a returning player (through the guide, the weather box's
 *   "tap here" hint already retired).
 *
 * Writes `measure.json` and screenshots to the out dir. Needs the built site served (`npm run build`,
 * then `npm run preview`):
 *
 *   node scripts/artificer-ui-measure.mjs <out-dir> [base-url]
 *
 * PW_CHROMIUM=<path> launches that Chromium instead of Playwright's own.
 */
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const [out, base = 'http://localhost:4173'] = process.argv.slice(2);
if (!out) throw new Error('usage: node scripts/artificer-ui-measure.mjs <out-dir> [base-url]');
mkdirSync(out, { recursive: true });
const SAVES = JSON.parse(execFileSync('npx', ['tsx', new URL('./artificer-ui-saves.ts', import.meta.url).pathname], { encoding: 'utf8' }));
const BASE = `${base}/artificer.html`;
const SIZES = { tablet: { width: 1024, height: 700 }, phone: { width: 400, height: 860 } };
const browser = await chromium.launch(process.env['PW_CHROMIUM'] ? { executablePath: process.env['PW_CHROMIUM'] } : {});

// Everything measured in one page.evaluate, so the numbers come from one layout.
const MEASURE = () => {
  const vw = innerWidth, vh = innerHeight;
  const cs = el => getComputedStyle(el);
  const vis = el => { const r = el.getBoundingClientRect(); const c = cs(el); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none' && +c.opacity !== 0; };
  const top = el => Math.round(el.getBoundingClientRect().top + scrollY);
  const sel = el => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
  const acts = [...document.querySelectorAll('button.act')];
  const shown = acts.filter(vis);
  const folded = acts.filter(a => !vis(a) && a.closest('details'));
  const cards = { total: acts.length, shown: shown.length, greyedShown: shown.filter(a => a.classList.contains('greyed')).length, folded: folded.length,
    cantLines: [...document.querySelectorAll('.cantline')].filter(vis).map(e => e.innerText.trim()) };
  const firstCard = shown.length ? Math.min(...shown.map(top)) : null;
  // The smallest type: every visible element with its own text.
  const texts = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (!vis(el)) continue;
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim();
    if (!own) continue;
    const c = cs(el);
    texts.push({ px: parseFloat(c.fontSize), font: c.fontFamily.split(',')[0].replace(/["']/g, ''), sel: sel(el), text: own.slice(0, 30) });
  }
  texts.sort((a, b) => a.px - b.px);
  const smallest = texts.slice(0, 6);
  const under12 = texts.filter(t => t.px < 12);
  const pixelSmall = texts.filter(t => /silkscreen/i.test(t.font) && t.px < 16);
  // Tap targets.
  const targets = [...document.querySelectorAll('button,a[href],summary,[role=button],input,select,[data-cmd],[data-tab]')].filter(vis).filter(el => !el.disabled)
    .map(el => { const r = el.getBoundingClientRect(); return { sel: sel(el), text: (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; });
  const small = targets.filter(t => t.h < 44 || t.w < 24);
  const named = q => { const el = document.querySelector(q); if (!el || !vis(el)) return null; const r = el.getBoundingClientRect(); return `${Math.round(r.width)} × ${Math.round(r.height)} at y ${Math.round(r.top)}`; };
  const F5 = { menu: named('.menybtn'), feedback: named('.fbbtn'), weather: named('[data-wxfold]'), standing: named('.standline'), guideOk: named('.guidetip button'), tab: named('.tabbtn'), journal: named('.jbtn'), run: named('[data-cmd="run"], .runbar .btn.go') };
  const text = q => [...document.querySelectorAll(q)].filter(vis).map(e => e.innerText.replace(/\s+/g, ' ').trim()).join(' | ') || null;
  const log = document.querySelector('.log');
  return {
    vw, vh, pageHeight: document.documentElement.scrollHeight, firstCard, cards,
    smallest, under12: under12.length, under12Sample: under12.slice(0, 8), pixelUnder16: pixelSmall.length, pixelSample: pixelSmall.slice(0, 6),
    targets: targets.length, small: small.length, smallSample: small.slice(0, 12), F5,
    status: text('.statusbar'), standing: text('.standline'), dayend: text('.dayend, .qsline'), qtot: text('.qtot'),
    tabbar: (() => { const t = document.querySelector('.tabbar'); if (!t || !vis(t)) return null; const r = t.getBoundingClientRect(); return { y: Math.round(r.top), h: Math.round(r.height), fixed: cs(t).position }; })(),
    journal: log && vis(log) ? { y: top(log), screens: +(top(log) / vh).toFixed(2) } : null,
    // What sits above the first card, block by block (top and height at scroll 0).
    stack: ['header', '.statusbar', '.standline', '.tabbar', '.seasonbox', '.guidetip'].map(q => {
      const el = [...document.querySelectorAll(q)].find(vis); if (!el) return null;
      const r = el.getBoundingClientRect(); return `${q} ${Math.round(r.top + scrollY)}+${Math.round(r.height)}`;
    }).filter(Boolean),
  };
};

// What stays on screen once scrolled: the fixed and sticky parts, full-width ones (the chrome) and narrow ones (a side column).
const FROZEN = () => {
  const vw = innerWidth, vh = innerHeight;
  const spans = [], side = [];
  for (const el of document.body.querySelectorAll('*')) {
    const p = getComputedStyle(el).position;
    if (p !== 'fixed' && p !== 'sticky') continue;
    // The painted backdrop (backdrop-view.ts) sits behind the page; it isn't chrome.
    if (el.closest('.bd') || el.tagName === 'CANVAS') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.bottom <= 0 || r.top >= vh) continue;
    const span = [Math.max(0, r.top), Math.min(vh, r.bottom)];
    (r.width >= vw * 0.6 ? spans : side).push({ el: `${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/)[0]}`, top: Math.round(span[0]), bottom: Math.round(span[1]), w: Math.round(r.width) });
  }
  const iv = spans.map(s => [s.top, s.bottom]).sort((a, b) => a[0] - b[0]);
  let px = 0, cur = null;
  for (const [a, b] of iv) { if (!cur || a > cur[1]) { if (cur) px += cur[1] - cur[0]; cur = [a, b]; } else cur[1] = Math.max(cur[1], b); }
  if (cur) px += cur[1] - cur[0];
  return { px, pct: Math.round((px / vh) * 100), parts: spans, side };
};

async function open(page, lang, save) {
  await page.goto(BASE);
  await page.evaluate(({ k, g, save, lang }) => {
    localStorage.clear();
    localStorage.setItem('artificer.lang', lang);
    // A returning player's: through the guide, and the weather box opened once (so its "tap here" hint is retired).
    if (save) { localStorage.setItem(k, save); localStorage.setItem(g, JSON.stringify({ done: true, run: null })); localStorage.setItem('artificer.tab', 'plan'); localStorage.setItem('artificer.weatherFold', JSON.stringify({ acked: true, open: false, hintSeen: true })); }
  }, { k: SAVES.saveKey, g: SAVES.guideKey, save, lang });
  await page.reload();
  await page.waitForTimeout(600);
}

const results = {};
for (const lang of ['en', 'sv']) for (const [size, vp] of Object.entries(SIZES)) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const key = `${lang}-${size}`;
  const r = results[key] = { errors };

  // Day 1: a new game, the way a new player comes in: the language, then whatever's next, to the first real choice.
  await page.goto(BASE); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(600);
  const taps = [];
  // The topmost screen: the intro's dialog while it's up (the game and its weather card wait behind it).
  const press = async re => {
    const intro = page.locator('.intro').filter({ visible: true });
    const scope = (await intro.count()) ? intro.first() : page.locator('body');
    const b = scope.locator('button,a[href],[role=button]').filter({ hasText: re }).filter({ visible: true }).first();
    taps.push((await b.innerText()).replace(/\s+/g, ' ').trim()); await b.click(); await page.waitForTimeout(500);
  };
  await press(lang === 'en' ? /^English/ : /^Svenska/);
  for (let i = 0; i < 12; i++) {
    if (await page.locator('.tabbar').filter({ visible: true }).count() && !(await page.locator('.intro').filter({ visible: true }).count())) break;
    await press(/CONTINUE|FORTSÄTT|PLAY|SPELA|Got it|Uppfattat|OK/i);
  }
  r.firstRun = { taps, screen: await page.evaluate(() => document.querySelector('.tabbtn.on')?.innerText) };
  await page.screenshot({ path: `${out}/${key}-day1-first.png` });
  r.day1Land = await page.evaluate(MEASURE);
  // The first real choice: Explore.
  const explore = page.locator('button').filter({ hasText: /^Explore$|^Utforska$/ }).filter({ visible: true }).first();
  if (await explore.count()) { taps.push((await explore.innerText()).trim()); await explore.click(); await page.waitForTimeout(500); }
  // The first morning's weather card, if the guide shows it before the chooser.
  await page.screenshot({ path: `${out}/${key}-day1-explore.png` });
  const wx = page.locator('[data-wxack]').filter({ visible: true });
  if (await wx.count()) { taps.push((await wx.first().innerText()).trim()); await wx.first().click(); await page.waitForTimeout(500); }
  await page.screenshot({ path: `${out}/${key}-day1-plan.png` });
  r.day1Plan = await page.evaluate(MEASURE);
  await page.screenshot({ path: `${out}/${key}-day1-plan-full.png`, fullPage: true });

  // Day 14.
  await open(page, lang, SAVES.save);
  const ack = page.locator('[data-wxack]');
  if (await ack.isVisible()) { await ack.click(); await page.waitForTimeout(300); }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${out}/${key}-day14.png` });
  r.day14 = await page.evaluate(MEASURE);
  await page.screenshot({ path: `${out}/${key}-day14-full.png`, fullPage: true });
  await page.evaluate(() => window.scrollTo(0, Math.min(900, document.documentElement.scrollHeight - innerHeight)));
  await page.waitForTimeout(300);
  r.day14Frozen = await page.evaluate(FROZEN);
  await page.screenshot({ path: `${out}/${key}-day14-scrolled.png` });
  await ctx.close();
  console.log(key, 'done', errors.length ? `errors: ${errors.join('; ')}` : '');
}
writeFileSync(`${out}/measure.json`, JSON.stringify(results, null, 2));
await browser.close();
