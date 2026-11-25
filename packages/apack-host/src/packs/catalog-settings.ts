import type { SettingsCatalog, SettingsDefinition, NativePackDeclaration } from '@apackdev/sdk/framework';
import { resolveName, PACK_ID_PATTERN, FEATURE_ID_PATTERN } from '@apackdev/sdk/ids';
import { compileSettingsDefinition } from '../features/settings/compile.ts';

/** One projection for installed, native and prospective settings declarations. */
export function settingsForDeclarations(app: SettingsDefinition, declarations: readonly Pick<NativePackDeclaration, 'id' | 'dependencies' | 'settings' | 'features'>[], revision = 0): SettingsCatalog {
  const ids = new Set<string>();
  const groups: Record<string, Record<string, SettingsDefinition>> = {};
  const features: Record<string, SettingsDefinition> = {};
  const dependencies: Record<string, string[]> = {};
  for (const pack of declarations) {
    if (!PACK_ID_PATTERN.test(pack.id) || ids.has(pack.id)) throw new Error(`Duplicate or invalid declaration owner "${pack.id}"`);
    ids.add(pack.id);
    groups[pack.id] = {};
    dependencies[pack.id] = Object.keys(pack.dependencies ?? {});
    for (const [id, definition] of Object.entries(pack.settings ?? {})) {
      if (!FEATURE_ID_PATTERN.test(id)) throw new Error(`Invalid settings group "${pack.id}/${id}"`);
      compileSettingsDefinition(definition);
      groups[pack.id][id] = definition;
    }
    for (const [id, feature] of Object.entries(pack.features ?? {})) {
      if (!FEATURE_ID_PATTERN.test(id)) throw new Error(`Invalid feature "${pack.id}/${id}"`);
      if (feature.settings) {
        compileSettingsDefinition(feature.settings);
        features[resolveName(id, pack.id)] = feature.settings;
      }
    }
  }
  return { revision, app, packs: groups, features, dependencies };
}
