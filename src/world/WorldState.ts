/**
 * WorldState — shared runtime state contract for Matlu's game systems.
 *
 * WorldState is a single observable object passed to systems on registration.
 * Systems read state via getters and write via the mutation methods. Mutations
 * emit typed Phaser events so any scene or system can react without coupling
 * to the emitting system.
 *
 * ## Event names (emitted on the owning Phaser.Scene's event emitter)
 *
 * | Event                        | Payload                          |
 * |------------------------------|----------------------------------|
 * | `ws:zone-cleanse-updated`    | `{ zoneId, percent }`            |
 * | `ws:corruption-updated`      | `{ zoneId, type, level }`        |
 * | `ws:combat-state-changed`    | `{ active: boolean }`            |
 * | `ws:weather-changed`         | `{ weather: WeatherCondition }`  |
 * | `ws:parent-meeting-triggered`| `{ x, y }`                      |
 *
 * ## Usage in GameScene
 * ```ts
 * this.worldState = new WorldState(this);
 * this.worldState.registerSystem(new NpcSystem(this, this.worldState));
 * // ...
 * // In update():
 * this.worldState.update(delta);
 * ```
 */

import type { WorldClock } from './WorldClock';

// ─── Shared type vocabulary ───────────────────────────────────────────────────

export type CorruptionType =
  | 'thermal'
  | 'species-death'
  | 'stone'
  | 'water-poison'
  | 'spore'
  | 'crystal'
  | 'void'
  | 'solar'
  | 'ash';

export type WeatherCondition = 'clear' | 'rain' | 'ash';

/** 0–100 percentage of a zone's corruption that has been cleansed. */
export type CleansePercent = number;

// ─── System interface ─────────────────────────────────────────────────────────

/** Anything registered with WorldState as an updatable system. */
export interface GameSystem {
  readonly systemId: string;
  /** Called once per frame with millisecond delta. */
  update(delta: number): void;
  /** Optional teardown when the scene stops. */
  destroy?(): void;
}

// ─── Zone state ───────────────────────────────────────────────────────────────

export interface ZoneCorruption {
  zoneId: string;
  type: CorruptionType;
  /** 0–1 intensity. */
  level: number;
}

// ─── WorldState ───────────────────────────────────────────────────────────────

export class WorldState {
  private readonly scene: Phaser.Scene;
  private readonly systems: GameSystem[] = [];

  /** Per-zone cleanse progress (0–100). */
  private readonly cleanse: Map<string, CleansePercent> = new Map();

  /** Per-zone corruption entries. */
  private readonly corruption: Map<string, ZoneCorruption> = new Map();

  /** Whether combat is currently active anywhere in the scene. */
  private _combatActive = false;

  /** Current weather. */
  private _weather: WeatherCondition = 'clear';

  /** Exposed WorldClock so systems can query time without direct import. */
  readonly clock: WorldClock | null;

  constructor(scene: Phaser.Scene, clock: WorldClock | null = null) {
    this.scene = scene;
    this.clock = clock;
  }

  // ─── System registration ─────────────────────────────────────────────────

  registerSystem(system: GameSystem): void {
    if (!this.systems.find(s => s.systemId === system.systemId)) {
      this.systems.push(system);
    }
  }

  unregisterSystem(systemId: string): void {
    const idx = this.systems.findIndex(s => s.systemId === systemId);
    if (idx !== -1) {
      this.systems[idx]?.destroy?.();
      this.systems.splice(idx, 1);
    }
  }

  /** Forward delta to all registered systems. Call from GameScene.update(). */
  update(delta: number): void {
    for (const system of this.systems) {
      system.update(delta);
    }
  }

  /** Destroy all systems. Call from GameScene's shutdown event. */
  destroy(): void {
    for (const system of [...this.systems]) {
      system.destroy?.();
    }
    this.systems.length = 0;
  }

  // ─── Cleanse ─────────────────────────────────────────────────────────────

  getCleansePercent(zoneId: string): CleansePercent {
    return this.cleanse.get(zoneId) ?? 0;
  }

  setCleansePercent(zoneId: string, percent: CleansePercent): void {
    const clamped = Math.max(0, Math.min(100, percent));
    this.cleanse.set(zoneId, clamped);
    this.scene.events.emit('ws:zone-cleanse-updated', { zoneId, percent: clamped });
  }

  // ─── Corruption ──────────────────────────────────────────────────────────

  getCorruption(zoneId: string): ZoneCorruption | undefined {
    return this.corruption.get(zoneId);
  }

  setCorruption(zoneId: string, type: CorruptionType, level: number): void {
    const clamped = Math.max(0, Math.min(1, level));
    const entry: ZoneCorruption = { zoneId, type, level: clamped };
    this.corruption.set(zoneId, entry);
    this.scene.events.emit('ws:corruption-updated', entry);
  }

  // ─── Combat ──────────────────────────────────────────────────────────────

  get combatActive(): boolean { return this._combatActive; }

  setCombatActive(active: boolean): void {
    if (this._combatActive === active) return;
    this._combatActive = active;
    this.scene.events.emit('ws:combat-state-changed', { active });
  }

  // ─── Weather ─────────────────────────────────────────────────────────────

  get weather(): WeatherCondition { return this._weather; }

  setWeather(weather: WeatherCondition): void {
    if (this._weather === weather) return;
    this._weather = weather;
    this.scene.events.emit('ws:weather-changed', { weather });
  }

  // ─── Conviction ──────────────────────────────────────────────────────────

  /** 0–100. Fills on enemy kills, drains on damage taken. Starts at 50. */
  private _conviction = 50;

  get conviction(): number { return this._conviction; }

  /**
   * Adjust conviction by delta (positive = gain, negative = drain).
   * Clamps result to 0–100 and emits `ws:conviction-updated`.
   */
  adjustConviction(delta: number): void {
    const next = Math.max(0, Math.min(100, this._conviction + delta));
    if (next === this._conviction) return;
    this._conviction = next;
    this.scene.events.emit('ws:conviction-updated', { conviction: next });
  }

  // ─── Parent meeting ──────────────────────────────────────────────────────

  triggerParentMeeting(x: number, y: number): void {
    this.scene.events.emit('ws:parent-meeting-triggered', { x, y });
  }
}
