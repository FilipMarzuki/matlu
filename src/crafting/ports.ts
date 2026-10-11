/**
 * Small interfaces the crafting systems depend on instead of Phaser / the
 * browser. Core Warden plugs in `game.events` and localStorage; tests and the
 * crafting sim plug in in-memory versions.
 */

/** Anything that can emit named events. Phaser.Events.EventEmitter fits as-is. */
export interface Emitter {
  emit(event: string, ...args: unknown[]): unknown;
}

/** Key/value persistence. Must never throw — swallow storage errors. */
export interface SaveStore {
  load(key: string): string | null;
  save(key: string, value: string): void;
}

/** Emitter that drops every event — handy default when nobody listens. */
export const nullEmitter: Emitter = { emit: () => undefined };

/** SaveStore backed by window.localStorage; silently no-ops when unavailable. */
export const localStorageStore: SaveStore = {
  load(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  save(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // localStorage unavailable (private mode, quota) — fail silently.
    }
  },
};
