/** In-memory test doubles for the crafting ports (used by unit tests). */
import type { Emitter, SaveStore } from './ports';

export class MemoryStore implements SaveStore {
  readonly data = new Map<string, string>();
  load(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  save(key: string, value: string): void {
    this.data.set(key, value);
  }
}

export class RecordingEmitter implements Emitter {
  readonly calls: [string, ...unknown[]][] = [];
  emit(event: string, ...args: unknown[]): void {
    this.calls.push([event, ...args]);
  }
  /** Argument lists for every emit of `event`, in order. */
  argsFor(event: string): unknown[][] {
    return this.calls.filter(c => c[0] === event).map(c => c.slice(1));
  }
}
