import type { PackManifest } from '@apackdev/pack-format';
import { errorMessage } from '@apackdev/sdk/utils/pure';
import { appSettingsDefinition } from '../features/settings/be/app-definition.ts';
import { compileSettingsCatalog } from '../features/settings/validation.ts';
import { settingsForDeclarations } from './catalog-settings.ts';

/** A new declaration must accept existing explicit choices before its build replaces the incumbent. */
export function assertPackSettings(manifest: Readonly<PackManifest>, overrides: unknown): void {
  const declarations = settingsForDeclarations(appSettingsDefinition, [{
    id: manifest.id, dependencies: manifest.dependencies,
    settings: manifest.extensions?.settings, features: manifest.features,
  }]);
  try { compileSettingsCatalog(declarations).validate(overrides); }
  catch (error) { throw new Error(`Pack "${manifest.id}" settings were refused: ${errorMessage(error)}`); }
}
