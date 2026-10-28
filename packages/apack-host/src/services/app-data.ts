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
 * `onReplaced` runs after installation or successful rollback. An uncertain/failed recovery closes both stores
 * and leaves the persistent import preparation for explicit recovery; it never announces settled replacement.
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
    try { return await database.withExclusiveWrites(() => history.database.withExclusiveWrites(operation)); }
    finally {
      replacing = false;
      registry.releaseAllPackOperations();
    }
  }

  async function replaceData<T>(replace: () => Promise<T>): Promise<T> {
    let settled = true;
    try { return await settings.whileReplacingData(replace); }
    catch (error) {
      const code = (error as { code?: unknown })?.code;
      if (code === 'COMMIT_UNKNOWN' || code === 'RECOVERY_REQUIRED') {
        settled = false;
        const errors: unknown[] = [error];
        for (const store of [database, history.database]) {
          try { store.close(); } catch (cleanup) { errors.push(cleanup); }
        }
        if (errors.length > 1) throw Object.assign(new AggregateError(errors, 'Data replacement requires recovery and closing stores also failed', { cause: error }),
          { code, recoveryPath: (error as { recoveryPath?: unknown }).recoveryPath });
      }
      throw error;
    } finally { if (settled) onReplaced(); }
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
      exclusive(() => exportDatabase(stores, targetPath, { name, databases, mediaPath: _getMediaPath(), appVersion: getAppVersion() })),
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
