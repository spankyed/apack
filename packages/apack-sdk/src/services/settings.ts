import type { SettingsTarget, SettingsDocument, SettingsOverrides, SettingsSnapshot, SettingsRecovery, SettingsRecoveryRequest, SettingsWriteCondition } from '../types/settings.ts';

/** Caller-bound preference access. A target never supplies the caller's identity. */
export interface SettingsService {
  get<T = unknown>(target: SettingsTarget): T;
  set(target: SettingsTarget, path: readonly string[], value: unknown, condition?: SettingsWriteCondition): void;
  reset(target: SettingsTarget): void;
  onChange(listener: (change: SettingsChange) => void): () => void;
}

/** Trusted host operations; unavailable on pack-facing services. */
export interface SettingsAdmin extends SettingsService {
  getAll(): SettingsDocument;
  getSnapshot(): SettingsSnapshot;
  /** Boot found stored values the declarations reject: reads refuse until the app restarts. */
  enterRecovery(): void;
  getRecovery(): SettingsRecovery | undefined;
  recover(request: SettingsRecoveryRequest): void;
  getOverrides(): SettingsOverrides;
  replaceAll(document: unknown, condition?: SettingsWriteCondition): void;
  removeOverrides(path: readonly string[]): void;
  resetAll(): void;
  whileReplacingData<T>(replace: () => Promise<T>): Promise<T>;
  forPack(packId: string): SettingsService;
}

export type SettingsChange = 'written' | 'replacing' | 'replaced';
