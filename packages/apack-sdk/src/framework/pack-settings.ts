import type { SettingsDefinition } from './settings-definition.ts';
import { _boundBackendHost } from '../runtime/backend-port.ts';

/** Data-only definitions for every settings owner, including disabled installed packs. */
export interface SettingsCatalog {
  readonly revision: number;
  readonly app: SettingsDefinition;
  readonly packs: Readonly<Record<string, Readonly<Record<string, SettingsDefinition>>>>;
  readonly features: Readonly<Record<string, SettingsDefinition>>;
  readonly dependencies: Readonly<Record<string, readonly string[]>>;
}

export function getSettingsCatalog(): SettingsCatalog {
  return _boundBackendHost().packs.settingsCatalog();
}
