/**
 * Tests for #1489 / #1537 — the game smoke test went red at random on
 * "Unable to decode audio data".
 *
 * Cause: the manifest listed four animal calls whose files were never added
 * (public/assets/audio/animal/ only has a README). A missing file doesn't 404
 * here: Vite's preview server and Vercel both answer any unknown path with
 * index.html and a 200, so Phaser handed a web page to the audio decoder. The
 * decoder's rejected Promise went unhandled and surfaced as a page error. It
 * happened on every page load; the test only caught it when the errors landed
 * inside its one-second listening window, which is why it looked flaky.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { audioManifest, guardDecodeRejections, loadAudioManifest } from './AudioLoader';

const publicDir = join(__dirname, '..', '..', 'public');

describe('audio manifest', () => {
  it('names only files that exist under public/', () => {
    const missing: string[] = [];
    for (const [key, entry] of Object.entries(audioManifest)) {
      for (const file of [...entry.files, ...(entry.fallback ?? [])]) {
        if (!existsSync(join(publicDir, file))) missing.push(`${key}: ${file}`);
      }
    }
    // A sound that isn't sourced yet keeps its entry with `files: []`.
    expect(missing).toEqual([]);
  });
});

describe('loadAudioManifest', () => {
  it('queues every sourced sound and skips the ones with no files', () => {
    const audio = vi.fn();
    // `sound` without a `context` stands in for the HTML5 / no-audio managers.
    const scene = { load: { audio }, sound: {} } as unknown as Phaser.Scene;

    loadAudioManifest(scene);

    const queued = audio.mock.calls.map(([key]) => key as string);
    const sourced = Object.entries(audioManifest).filter(([, e]) => e.files.length > 0).map(([k]) => k);
    expect(queued).toEqual(sourced);
    for (const key of ['animal-bird', 'animal-deer', 'animal-hare', 'animal-fox']) {
      expect(queued).not.toContain(key);
    }
  });

  it('guards the Web Audio context it loads into', () => {
    const decodeAudioData = vi.fn(() => Promise.resolve({} as AudioBuffer));
    const context = { decodeAudioData } as unknown as BaseAudioContext;
    const scene = { load: { audio: vi.fn() }, sound: { context } } as unknown as Phaser.Scene;

    loadAudioManifest(scene);

    expect(context.decodeAudioData).not.toBe(decodeAudioData);
  });
});

describe('guardDecodeRejections', () => {
  /**
   * A stand-in AudioContext whose decoder fails the way Chromium's does: it calls
   * the error callback AND rejects the Promise it returns. A plain function, not
   * vi.fn(): a Vitest mock subscribes to the Promises it returns (to record how
   * they settled), which would mark the rejection handled and hide the bug.
   */
  function failingContext() {
    const calls = { count: 0 };
    const decodeAudioData = (_data: ArrayBuffer, _ok?: DecodeSuccessCallback | null, onError?: DecodeErrorCallback | null) => {
      calls.count++;
      const err = new Error('Unable to decode audio data') as DOMException;
      onError?.(err);
      return Promise.reject(err);
    };
    return { context: { decodeAudioData } as unknown as BaseAudioContext, calls };
  }

  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
  beforeAll(() => { process.on('unhandledRejection', onUnhandled); });
  afterAll(() => { process.off('unhandledRejection', onUnhandled); });
  afterEach(() => { unhandled.length = 0; });

  /** Node reports an unhandled rejection after the microtask queue drains. */
  const settle = () => new Promise(resolve => setTimeout(resolve, 10));

  it('reports a failed decode through the error callback and leaves no unhandled rejection', async () => {
    const { context } = failingContext();
    guardDecodeRejections(context);

    const onError = vi.fn();
    void context.decodeAudioData(new ArrayBuffer(8), () => {}, onError);
    await settle();

    expect(onError).toHaveBeenCalledOnce();
    expect(unhandled).toEqual([]);
  });

  it('still rejects for a caller that awaits the Promise without an error callback', async () => {
    const { context } = failingContext();
    guardDecodeRejections(context);

    await expect(context.decodeAudioData(new ArrayBuffer(8))).rejects.toThrow('Unable to decode audio data');
  });

  it('passes a successful decode through unchanged', async () => {
    const buffer = { duration: 1 } as AudioBuffer;
    const decodeAudioData = vi.fn((_d: ArrayBuffer, ok?: DecodeSuccessCallback | null) => {
      ok?.(buffer);
      return Promise.resolve(buffer);
    });
    const context = { decodeAudioData } as unknown as BaseAudioContext;
    guardDecodeRejections(context);

    const onSuccess = vi.fn();
    await expect(context.decodeAudioData(new ArrayBuffer(8), onSuccess)).resolves.toBe(buffer);
    expect(onSuccess).toHaveBeenCalledWith(buffer);
  });

  it('wraps a context once, however many scenes load the manifest', async () => {
    const { context, calls } = failingContext();
    guardDecodeRejections(context);
    const wrapped = context.decodeAudioData;
    guardDecodeRejections(context);

    expect(context.decodeAudioData).toBe(wrapped);
    void context.decodeAudioData(new ArrayBuffer(8), () => {}, () => {});
    await settle();
    expect(calls.count).toBe(1);
    expect(unhandled).toEqual([]);
  });
});
