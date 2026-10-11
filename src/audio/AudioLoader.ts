import manifest from '../data/audio-manifest.json';

export type AudioCategory = 'music' | 'sfx' | 'ambience' | 'creature';

export interface AudioManifestEntry {
  label: string;
  description: string;
  category: AudioCategory;
  /**
   * Source files, relative to `public/`. Empty means the sound is a slot that
   * hasn't been sourced yet: it stays in the manifest (so the dev/ audio editor
   * can upload a file for it) but nothing is loaded, and code that plays it
   * checks `cache.audio.has(key)` first.
   */
  files: string[];
  fallback?: string[];
  volume: number;
  loop: boolean;
}

export type AudioManifest = Record<string, AudioManifestEntry>;

export const audioManifest: AudioManifest = manifest as AudioManifest;

/**
 * Queues every sound in the manifest for loading via `scene.load.audio()`.
 * Centralising the load paths here means a sound's source files can change
 * (e.g. via the audio editor tool in dev/) without touching scene code —
 * only the manifest and the files on disk change.
 */
export function loadAudioManifest(scene: Phaser.Scene): void {
  // Only the Web Audio sound manager decodes; HTML5 Audio and "no audio" have no context.
  if ('context' in scene.sound) guardDecodeRejections(scene.sound.context);

  for (const [key, entry] of Object.entries(audioManifest)) {
    const formats = entry.fallback ? [...entry.files, ...entry.fallback] : entry.files;
    // Don't request a file we don't have (#1489). The servers answer a missing
    // path with index.html and a 200 (Vite's SPA fallback; Vercel's catch-all
    // rewrite), so the loader would hand a web page to the audio decoder.
    if (formats.length === 0) continue;
    scene.load.audio(key, formats);
  }
}

/** Contexts already wrapped, so a second scene's preload doesn't wrap the wrapper. */
const guardedContexts = new WeakSet<BaseAudioContext>();

/**
 * Makes a sound that can't be decoded a logged load error instead of an
 * uncaught one (#1489, #1537).
 *
 * WHY this is needed: Phaser's loader decodes each sound with
 * `context.decodeAudioData(data, onSuccess, onError)`. When decoding fails
 * (a corrupt or truncated file, a format this device can't play, or an HTML
 * page served in place of a missing file), Phaser's `onError` logs
 * "Error decoding audio: <key>" and marks the file as failed, and the game
 * carries on without that sound. But `decodeAudioData` also returns a
 * Promise, and the browser rejects that too. Phaser never looks at the
 * Promise, so the rejection goes unhandled: it reaches
 * `window.onunhandledrejection` (logged to Better Stack as a crash) and fails
 * the Playwright smoke test as a page error, "Unable to decode audio data".
 *
 * The wrapper attaches an empty `.catch()` only when the caller passed an
 * error callback, i.e. when the failure is already handled. It still returns
 * the original Promise, so a caller that awaits it sees the rejection as before.
 */
export function guardDecodeRejections(context: BaseAudioContext): void {
  if (guardedContexts.has(context)) return;
  guardedContexts.add(context);

  // Assigning to the instance shadows the prototype's method for this one
  // context only (the game's), leaving every other AudioContext untouched.
  const decode = context.decodeAudioData.bind(context);
  context.decodeAudioData = (audioData, onSuccess, onError) => {
    // Old Safari (webkitAudioContext) returns undefined instead of a Promise.
    const decoding = decode(audioData, onSuccess, onError) as Promise<AudioBuffer> | undefined;
    if (onError) decoding?.catch(() => { /* already reported through onError */ });
    return decoding as Promise<AudioBuffer>;
  };
}
