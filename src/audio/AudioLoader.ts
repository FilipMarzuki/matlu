import manifest from '../data/audio-manifest.json';

export type AudioCategory = 'music' | 'sfx' | 'ambience' | 'creature';

export interface AudioManifestEntry {
  label: string;
  description: string;
  category: AudioCategory;
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
  for (const [key, entry] of Object.entries(audioManifest)) {
    const formats = entry.fallback ? [...entry.files, ...entry.fallback] : entry.files;
    scene.load.audio(key, formats);
  }
}
