/**
 * #1773: feedback reports. The body is checked and cleaned (feedback.ts) and kept through
 * POST /api/v1/feedback (api.ts) in a memory store here, Supabase in production.
 */

import { describe, it, expect } from 'vitest';
import { handle, memoryStore, feedbackKeyOf, FEEDBACK_PATH, LIMITS, type ApiRequest } from './api';
import { checkFeedback, checkImages, cleanEmail, cleanFeedbackText, cleanContext, makeRef, stripWardenName, FEEDBACK_CHARS, IMAGE_BYTES, MAX_IMAGES, REF_PATTERN } from './feedback';

const NOW = Date.parse('2026-10-16T12:00:00Z');
let n = 0;
const deps = (now = () => NOW) => ({ now, newId: () => `id${++n}`, salt: 'pepper' });
const post = (body: unknown, ip = '203.0.113.7'): ApiRequest => ({ method: 'POST', path: FEEDBACK_PATH, body: typeof body === 'string' ? body : JSON.stringify(body), ip });
const report = (extra: Record<string, unknown> = {}) => ({ kind: 'bug', text: 'The camp button did nothing.', wardenId: 'w-abc123-xyz', runId: null, ...extra });

// The smallest real headers of each type: what `looksLike` checks.
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
const b64 = (b: Uint8Array): string => Buffer.from(b).toString('base64');

describe('body validation (#1773)', () => {
  it('accepts a report with a kind, text and the Warden id', () => {
    const r = checkFeedback(report());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body).toMatchObject({ kind: 'bug', text: 'The camp button did nothing.', wardenId: 'w-abc123-xyz', runId: null, picks: [], save: null, images: [], contactEmail: null });
  });

  it('turns away a missing or unknown kind, a text that is not a string or is empty, and a missing Warden id', () => {
    expect(checkFeedback(report({ kind: 'rant' })).ok).toBe(false);
    expect(checkFeedback({ text: 'x', wardenId: 'w-1' }).ok).toBe(false);
    expect(checkFeedback(report({ text: 42 })).ok).toBe(false);
    expect(checkFeedback(report({ text: ' \n\t ​ ' })).ok).toBe(false);
    expect(checkFeedback(report({ wardenId: undefined })).ok).toBe(false);
    expect(checkFeedback(report({ wardenId: 'w 1; drop table' })).ok).toBe(false);
    expect(checkFeedback(report({ runId: '../../x' })).ok).toBe(false);
    expect(checkFeedback(report({ picks: 'all' })).ok).toBe(false);
    expect(checkFeedback(report({ save: [1, 2] })).ok).toBe(false);
    expect(checkFeedback([report()]).ok).toBe(false);
  });

  it('answers 400 over HTTP for a bad body, and for one that is not JSON', async () => {
    const store = memoryStore();
    expect((await handle(post(report({ kind: 'nope' })), store, deps())).status).toBe(400);
    expect((await handle(post('{not json'), store, deps())).status).toBe(400);
    expect(store.feedback).toHaveLength(0);
  });

  it('keeps only the context fields it knows', () => {
    const c = cleanContext({ build: { version: 'abc1234', path: '/?seed=secret#x', extra: 1 }, where: { day: 3.4, tab: 'plan', email: 'a@b.se', features: ['fog', 7] }, journal: ['D1 one'], email: 'a@b.se', junk: true });
    expect(c).toEqual({ build: { version: 'abc1234', path: '/' }, where: { day: 3, tab: 'plan', features: ['fog'] }, journal: ['D1 one'] });
  });
});

describe('cleaning the text (#1773: for everyone, so only control characters go)', () => {
  it('drops control and invisible characters but keeps line breaks', () => {
    expect(cleanFeedbackText('Line one\u0007\r\nLine​ two\u0000\n\n\n\nLine three\t\tend  ')).toBe('Line one\nLine two\n\nLine three end');
  });

  it('leaves emails and numbers typed into the text alone', () => {
    expect(cleanFeedbackText('Mail me at kid@example.com or call 070-123 45 67')).toBe('Mail me at kid@example.com or call 070-123 45 67');
  });

  it('cuts to the length by characters, never half a letter', () => {
    const t = cleanFeedbackText('😀'.repeat(FEEDBACK_CHARS + 50))!;
    expect([...t]).toHaveLength(FEEDBACK_CHARS);
    expect(t.endsWith('😀')).toBe(true);
  });

  it('turns away a text over the length', () => {
    expect(checkFeedback(report({ text: 'a'.repeat(FEEDBACK_CHARS) })).ok).toBe(true);
    expect(checkFeedback(report({ text: 'a'.repeat(FEEDBACK_CHARS + 1) })).ok).toBe(false);
  });
});

describe('the size limit (#1773)', () => {
  it('answers 413 for a body over the feedback limit, and takes one just under', async () => {
    const store = memoryStore();
    const big = JSON.stringify(report({ save: { pad: 'x'.repeat(LIMITS.feedbackBodyBytes) } }));
    expect((await handle(post(big), store, deps())).status).toBe(413);
    const fits = JSON.stringify(report({ save: { pad: 'x'.repeat(LIMITS.feedbackBodyBytes - 400) } }));
    expect((await handle(post(fits), store, deps())).status).toBe(201);
  });

  it('only this path gets the big limit', async () => {
    const r = await handle({ method: 'POST', path: '/api/v1/questions', body: 'x'.repeat(LIMITS.bodyBytes + 1), ip: '1.1.1.1' }, memoryStore(), deps());
    expect(r.status).toBe(413);
  });
});

describe('the rate limit (#1773: 10 an hour per weekly address hash)', () => {
  it('takes 10 in an hour from one address, turns away the 11th, and takes it again an hour later', async () => {
    let now = NOW;
    const clock = () => now;
    const store = memoryStore(clock);
    for (let i = 0; i < LIMITS.feedbackPerIpPerHour; i++) expect((await handle(post(report()), store, deps(clock))).status).toBe(201);
    expect((await handle(post(report()), store, deps(clock))).status).toBe(429);
    // Another address isn't held up.
    expect((await handle(post(report(), '198.51.100.9'), store, deps(clock))).status).toBe(201);
    now += 3600_000 + 1;
    expect((await handle(post(report()), store, deps(clock))).status).toBe(201);
  });

  it('keeps the address only as a hash that changes with the week', async () => {
    const store = memoryStore();
    await handle(post(report()), store, deps());
    const kept = store.feedback[0];
    expect(kept.ipWeekHash).toBe(feedbackKeyOf('203.0.113.7', '2026-W42', 'pepper'));
    expect(kept.ipWeekHash).not.toContain('203.0.113.7');
    expect(feedbackKeyOf('203.0.113.7', '2026-W43', 'pepper')).not.toBe(kept.ipWeekHash);
  });

  it('caps everyone together a day', async () => {
    const store = memoryStore();
    const limits = { ...LIMITS, feedbackPerDay: 2 };
    expect((await handle(post(report(), '1.0.0.1'), store, deps(), limits)).status).toBe(201);
    expect((await handle(post(report(), '1.0.0.2'), store, deps(), limits)).status).toBe(201);
    expect((await handle(post(report(), '1.0.0.3'), store, deps(), limits)).status).toBe(429);
  });
});

describe('the reference (#1773)', () => {
  it('is FB- and four characters a person can read back', () => {
    for (let i = 0; i < 500; i++) expect(makeRef()).toMatch(REF_PATTERN);
    expect(makeRef(() => 0)).toBe('FB-2222');
    expect(makeRef(() => 0.9999999)).toBe('FB-ZZZZ');
    expect(REF_PATTERN.test('FB-0OIL')).toBe(false);
  });

  it('comes back from the endpoint, and a taken one is drawn again', async () => {
    const store = memoryStore();
    const refs = ['FB-AAAA', 'FB-AAAA', 'FB-BBBB'];
    const d = { ...deps(), newRef: () => refs.shift()! };
    const first = await handle(post(report()), store, d);
    expect(first).toEqual({ status: 201, body: { ref: 'FB-AAAA' } });
    const second = await handle(post(report()), store, d);
    expect(second.body).toEqual({ ref: 'FB-BBBB' });
    expect(store.feedback.map(f => f.ref)).toEqual(['FB-AAAA', 'FB-BBBB']);
  });
});

describe("the save goes without the Warden's name (#1773)", () => {
  const save = {
    version: 7,
    sim: { day: 4, character: { id: 'w-1', name: 'Mira Ash', portrait: 'p' }, log: [{ day: 1, text: 'Mira Ash wakes. Miranda waves.' }] },
    road: { character: { name: 'Mira Ash' }, log: [{ day: 2, text: 'Mira Ash rides on.' }] },
  };

  it('blanks the name and takes it out of every line, whole words only', () => {
    const s = stripWardenName(save)!;
    const sim = s.sim as typeof save.sim;
    expect(sim.character.name).toBe('');
    expect(sim.character.id).toBe('w-1');
    expect(sim.log[0].text).toBe('the Warden wakes. Miranda waves.');
    expect((s.road as typeof save.road).log[0].text).toBe('the Warden rides on.');
    expect(JSON.stringify(s)).not.toContain('Mira Ash');
    // The game's own state is untouched.
    expect(save.sim.character.name).toBe('Mira Ash');
  });

  it('is stripped on the server too, whatever the page sent', async () => {
    const store = memoryStore();
    await handle(post(report({ save })), store, deps());
    expect(JSON.stringify(store.feedback[0].save)).not.toContain('Mira Ash');
  });
});

describe('images (#1773)', () => {
  it('takes up to three real images, and stores them in the bucket with the paths on the row', async () => {
    const store = memoryStore();
    const images = [{ type: 'image/png', data: b64(PNG) }, { type: 'image/webp', data: b64(WEBP) }];
    const r = await handle(post(report({ images })), store, deps());
    expect(r.status).toBe(201);
    const paths = store.feedback[0].images;
    expect(paths).toHaveLength(2);
    expect(paths[0]).toMatch(/^2026-10-16\/.+\.png$/);
    expect(paths[1]).toMatch(/\.webp$/);
    expect([...store.images.keys()]).toEqual(paths);
    expect(store.images.get(paths[0])!.bytes).toEqual(PNG);
  });

  it(`turns away more than ${MAX_IMAGES}`, () => {
    const one = { type: 'image/png', data: b64(PNG) };
    expect(checkImages([one, one, one]).ok).toBe(true);
    expect(checkImages([one, one, one, one]).ok).toBe(false);
  });

  it(`turns away one over ${IMAGE_BYTES} bytes`, () => {
    const big = new Uint8Array(IMAGE_BYTES + 1);
    big.set(PNG);
    expect(checkImages([{ type: 'image/png', data: b64(big) }]).ok).toBe(false);
    const fits = new Uint8Array(IMAGE_BYTES);
    fits.set(PNG);
    expect(checkImages([{ type: 'image/png', data: b64(fits) }]).ok).toBe(true);
  });

  it('turns away a file that is not an image, or not the image it says it is', async () => {
    const text = b64(new TextEncoder().encode('just some text, honest'));
    expect(checkImages([{ type: 'text/plain', data: text }]).ok).toBe(false);
    expect(checkImages([{ type: 'image/png', data: text }]).ok).toBe(false);
    expect(checkImages([{ type: 'image/jpeg', data: b64(PNG) }]).ok).toBe(false);
    expect(checkImages([{ type: 'image/png', data: 'not base64!' }]).ok).toBe(false);
    expect(checkImages([{ type: 'image/svg+xml', data: b64(new TextEncoder().encode('<svg/>')) }]).ok).toBe(false);
    const store = memoryStore();
    expect((await handle(post(report({ images: [{ type: 'image/png', data: text }] })), store, deps())).status).toBe(400);
    expect(store.images.size).toBe(0);
  });
});

describe('the optional email (#1773)', () => {
  it('takes a plausible address or nothing', () => {
    expect(cleanEmail(undefined)).toBe('');
    expect(cleanEmail('')).toBe('');
    expect(cleanEmail('   ')).toBe('');
    expect(cleanEmail(' ada@example.com ')).toBe('ada@example.com');
    expect(cleanEmail('a.b+c@mail.example.se')).toBe('a.b+c@mail.example.se');
    for (const bad of ['ada', 'ada@', '@example.com', 'ada@example', 'a b@example.com', 'a@@b.se', 'ada@example.', `${'a'.repeat(250)}@b.se`, 42]) expect(cleanEmail(bad)).toBeNull();
  });

  it('answers 400 for one that is not an address, without quoting it', async () => {
    const r = await handle(post(report({ email: 'not-an-address' })), memoryStore(), deps());
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toContain('not-an-address');
  });

  it('is kept in its own field only: never in the context, the save or the answer', async () => {
    const store = memoryStore();
    const email = 'reply.to.me@example.com';
    // A page that tried to slip it into the context too: the context keeps only the fields it knows.
    const r = await handle(post(report({ email, context: { email, where: { tab: 'plan', email }, build: { version: 'abc', email } }, save: { sim: { character: { name: 'Xa' } } } })), store, deps());
    expect(r.status).toBe(201);
    expect(JSON.stringify(r.body)).not.toContain(email);
    const kept = store.feedback[0];
    expect(kept.contactEmail).toBe(email);
    expect(JSON.stringify(kept.context)).not.toContain(email);
    const { contactEmail: _e, ...rest } = kept;
    expect(JSON.stringify(rest)).not.toContain(email);
  });

  it('is null when not given', async () => {
    const store = memoryStore();
    await handle(post(report()), store, deps());
    expect(store.feedback[0].contactEmail).toBeNull();
  });
});
