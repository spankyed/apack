// Physical and logical imports use the same current installed-pack settings contract.
import { resolveAppEnvironment, type AppEnv } from '@apackdev/sdk/env';
import { readInstalledContributionCatalog, disabledPackIds } from '@apackdev/host/packs';
import { createSettingsBackupValidator } from '@apackdev/host/settings';
import type { AppDatabase } from '@apackdev/host/database';
export function settingsBackupValidator(database: AppDatabase, env: AppEnv) {
  const environment = resolveAppEnvironment({ env, userDataDir: database.userDataDir });
  const catalog = readInstalledContributionCatalog(environment.packsDir, disabledPackIds(environment.installedPacksFile));
  return createSettingsBackupValidator(catalog.settings());
}
