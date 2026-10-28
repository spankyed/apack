// services.appData: reset, back up and restore the app's stored data
import type { AppDataService, BackupDatabase, RunHistory, SettingsAdmin } from '@apackdev/sdk/services';
import type { EarsDatabase, EarsEngine } from '@apackdev/ears';
import { databaseBackupStore, exportDatabase, readBackupSummary, importDatabase, type BackupStores } from '../backup/index.ts';
import { secretsStore } from '../secrets/index.ts';
import { _getMediaPath } from '@apackdev/sdk/utils';
import { getAppVersion } from '@apackdev/sdk/env';
import type { PackRegistry } from '../packs/registry.ts';
import { startPacks } from '../packs/runtime/start.ts';
import { runAppMigrations, runPackMigrations } from '../migrations/index.ts';
import { createSettingsBackupValidator } from '../features/settings/be/backup.ts';

/**
 * `onReplaced` runs after either operation has rebuilt the world, and after a failed one too: a failed import has
 * already put back what was there. What it does with that is the caller's — replacing the data is this service's
 * job, and telling the app is not.
 */
export function createAppData({ database, engine, history, registry, settings, onReplaced }: {
  database: EarsDatabase;
  /** The engine reading `database`, through which it is emptied and replaced, so the engine's watches hear of it */
  engine: EarsEngine;
  /** The run history and its database, which a backup copies and a reset empties with the app's */
  history: { service: RunHistory; database: EarsDatabase };
  registry: PackRegistry; settings: SettingsAdmin; onReplaced: () => void;
}): AppDataService {
  const stores: BackupStores = { lmdb: databaseBackupStore(database, engine), runHistory: databaseBackupStore(history.database) };
  let replacing = false;
  /** One replacement at a time, and none while a pack is being installed or changed: both write the same data */
  async function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (replacing) throw new Error('App data is already being replaced. Wait for it to finish.');
    if (!registry.claimAllPackOperations()) throw new Error('A pack is being installed or changed. Try again once it finishes.');
    replacing = true;
    try { return await operation(); }
    finally {
      replacing = false;
      registry.releaseAllPackOperations();
    }
  }

  async function replaceData<T>(replace: () => Promise<T>): Promise<T> {
    try { return await settings.whileReplacingData(replace); }
    finally { onReplaced(); }
  }

  return {
    // The app as a fresh boot leaves it: the packs stop as when the app exits, the stores empty, then the packs
    // start as a boot starts them (onInit, migrations, content). Their systems keep running.
    async reset() {
      await exclusive(() => replaceData(async () => {
        registry.runShutdownHooks();
        // The engine reads the database, so emptying the database empties the engine, in one unit; its schema stays
        engine.admin.clear();
        history.database.reset();
        // Stored API keys go too, with their data keys, after the database is emptied, since the settings system hears of it
        secretsStore.clearAll();
        await startPacks(registry);
      }));
    },
    exportBackup: (targetPath, name, databases) =>
      exportDatabase(stores, targetPath, { name, databases, mediaPath: _getMediaPath(), appVersion: getAppVersion() }),
    async importBackup(backupPath, options) {
      return exclusive(async () => {
        const entityTypes = registry.getRegisteredEntityTypes();
        const validate = createSettingsBackupValidator(registry.settingsCatalog());
        return importDatabase(stores, backupPath, _getMediaPath(), {
          ...options, entityTypes, validate,
          withReplacement: replaceData,
          accept: async () => {
            // What a restored history left running can't be running now
            history.service.stopActive();
            await Promise.all([database.indexesReady(), history.database.indexesReady()]);
            // Run declared versioned data changes after restore, before notifying consumers.
            if (runAppMigrations(registry)) runPackMigrations(registry.packMigrationTargets('pack'));
          },
        });
      });
    },
    async readBackupSummary(backupPath) {
      const info = await readBackupSummary(backupPath);
      return info && { ...info, databases: info.databases as BackupDatabase[] };
    },
  };
}
