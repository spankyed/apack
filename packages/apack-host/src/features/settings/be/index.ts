// The app's settings, as a program that composes the app reaches them: the store and the pack-facing service over
// it, and the document check the Settings view runs before it offers to save. The rest — the pure operations, the
// row's entity type, the lookup kind — is this feature's own, and its own code imports it by path.
export { createSettingsStore, type SettingsDocument, type SettingsStore } from './store.ts';
export { settingsProblems, SettingsRefusedError } from '../document.ts';
export { createSettingsService } from '../../../services/settings.ts';
export { createSettingsBackupValidator } from './backup.ts';
export { createSettingsAccess, bindSettingsRequest, settingsRequestAccess, SETTINGS_MUTATIONS, type SettingsAccess } from './access.ts';

export { compileSettingsCatalog } from '../validation.ts';
export {
  compileSettingsDefinition,
  nativeDeclarationSettingsProblem,
  settingsDeclarationDiagnostics,
  SettingsDefaultsError,
  type SettingsDeclarationContainer,
} from '../compile.ts';
