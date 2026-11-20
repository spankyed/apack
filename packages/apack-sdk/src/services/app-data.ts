
/** A store a backup can hold: the database, or the run history. API keys are never backed up. */
export type BackupDatabase = 'lmdb' | 'runHistory';

export interface BackupSummary {
  timestamp: number;
  databases: BackupDatabase[];
  /** Bytes, across the backed-up databases */
  size: number;
  hasMedia: boolean;
  /** The apack that made it; missing from backups made before this was recorded */
  appVersion?: string;
}

/**
 * Whole-app data administration: reset it, back it up and restore a backup. The host implements it.
 */
export interface AppDataService {
  /**
   * Resets the whole app: deletes all stored data and keys, reopens empty stores (the in-memory database is cleared
   * too), then runs each pack's init hook, the boot apply and the app migrations. Onboarding starts over.
   *
   * Refused with `AppDataBusyError`, having changed nothing, while the data is being replaced or a pack is being
   * installed or changed. Any other error is a reset that began: some of the data is already gone.
   */
  reset(): Promise<void>;
  /** Copies the chosen databases (and media, with the primary database) into a new backup directory under `targetPath`; returns its path */
  exportBackup(targetPath: string, name?: string, databases?: BackupDatabase[]): Promise<string>;
  /**
   * Replaces stored data with a backup and reloads the in-memory database from it. On failure the
   * previous data is restored and reloaded, and the error is rethrown.
   *
   * A backup holding stores this apack doesn't have (one a newer version made) is refused with
   * `UnknownBackupDatabasesError`, since restoring it would replace the user's data with an incomplete copy.
   * `skipUnknownDatabases` imports it anyway, without those stores, once the user has said so.
   */
  importBackup(backupPath: string, options?: { skipUnknownDatabases?: boolean }): Promise<{
    databases: BackupDatabase[];
    /** Stores the backup listed with no folder to restore: nothing came back for them */
    missingDatabases: BackupDatabase[];
    /**
     * Entity types the restored data holds that no installed pack declares, with how many rows each has: a pack
     * that was installed when the backup was made and isn't now. The rows are kept, and nothing reads them until
     * that pack is installed again.
     */
    unknownEntityTypes: Array<[string, number]>;
  }>;
  /** A backup's metadata, or null when `backupPath` isn't a backup */
  readBackupSummary(backupPath: string): Promise<BackupSummary | null>;
}

/**
 * The app's data could not be reset or replaced now, because something else is writing it: another replacement,
 * or a pack being installed or changed. Nothing was touched, which is what tells it from an operation that began
 * and failed partway, so a caller may simply ask again once the other work has finished.
 */
export class AppDataBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppDataBusyError';
  }
}

/**
 * A backup holds stores this apack doesn't have, so restoring it would replace the user's data with an
 * incomplete copy of it. The app asks the user before importing it without them; `apack db import` takes
 * `--skip-unknown`.
 */
export class UnknownBackupDatabasesError extends Error {
  constructor(readonly databases: string[]) {
    super(`The backup holds data this apack doesn't have: ${databases.join(', ')}. It was made by a newer apack, and importing it would replace your data with an incomplete copy.`);
    this.name = 'UnknownBackupDatabasesError';
  }
}
