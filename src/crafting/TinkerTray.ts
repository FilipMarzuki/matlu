import type { Emitter, SaveStore } from './ports';

export const TRAY_PROGRESS_CHANGED = 'tray-progress-changed';
export const TRAY_DISCOVERY = 'tray-discovery';
export const TINKER_TRAY_SAVE_KEY = 'matlu_tinker_tray';

export interface TrayCombo { tray: string[]; possibleResults: { type: string; id: string; hint: string }[] }
export interface TinkerTrayDeps { emitter: Emitter; store: SaveStore }

export class TinkerTray {
  slots: (string | null)[] = [null, null, null, null, null];
  progress = 0;
  constructor(_deps: TinkerTrayDeps) {}
  loadCombos(_data: { craftingExamples?: TrayCombo[]; loreExamples?: TrayCombo[] }): void { throw new Error('not implemented'); }
  setSlot(_index: number, _value: string | null): void { throw new Error('not implemented'); }
  tick(_qualityBonus = 0): unknown { throw new Error('not implemented'); }
}
