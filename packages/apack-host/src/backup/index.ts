import fs from 'fs-extra';
import path from 'node:path';
import { createLogger } from '@apackdev/sdk/logger';
import { createEarsEngine, type Ears, type EarsDatabase, type EarsEngine } from '@apackdev/ears';
import { DATABASE_FORMAT, openDatabase } from '@apackdev/ears/lmdb';
import { UnknownBackupDatabasesError } from '@apackdev/sdk/services';

const logger = createLogger('database:backup');

/**
 * Where a backup's progress lines go. The app leaves this out and they go to the log, as every other app message
 * does; a tool passes its own sink, so the lines don't land in output meant to be read by something else (`apack
 * db import` writes results on stdout and everything else on stderr).
 */
export interface BackupLog {
  info(message: string): void;
  warn(message: string, detail?: Record<string, unknown>): void;
}

const defaultLog: BackupLog = {
  info: (message) => logger.info(message),
  warn: (message, detail) => logger.warn(message, detail),
};

/** A store a backup copies from and an import puts back into: the database, or the run history's record store */
export interface BackupStore {
  readonly path: string;
  /** The store's own copy of one moment of itself into `targetDir` */
  copyTo(targetDir: string): Promise<void>;
  /** Replaces the store's contents with those of the copy at `dir`, in one unit, while it stays open */
  replaceWith(dir: string): void;
}

/**
 * The database as a backup copies it: elmdb's compacted copy, and its replacement from another database's data —
 * through the engine reading it when there is one, so the engine's watches hear of it
 */
export function databaseBackupStore(database: EarsDatabase, engine?: EarsEngine): BackupStore {
  return {
    path: database.path,
    copyTo: async (targetDir) => database.backup(targetDir),
    replaceWith: (dir) => (engine ? engine.admin.replaceWith(dir) : database.replaceWith(dir)),
  };
}

/**
 * A backup's database folders, each a store of the app's: the storage format this version writes it in, and how a
 * backup's copy of it is checked — opened read-only, so one in a format this version can't read is refused, and closed
 */
const DATABASES = {
  lmdb: { format: DATABASE_FORMAT, check: (dir: string) => openDatabase({ path: dir, readOnly: true }).close() },
  runHistory: { format: DATABASE_FORMAT, check: checkRunHistory },
} as const;

export type DatabaseName = keyof typeof DATABASES;

/** Opens a backup's run history, refusing a database that holds no run nodes' type: the app's own, copied there */
function checkRunHistory(dir: string): void {
  const database = openDatabase({ path: dir, readOnly: true });
  try {
    const types = (database.schema as { types?: Record<string, unknown> } | null)?.types ?? {};
    if (!Object.prototype.hasOwnProperty.call(types, 'RunNode')) {
      throw new Error(`${dir} is a database, but not a run history: its schema declares no RunNode`);
    }
  } finally {
    database.close();
  }
}
export const isKnownDatabase = (name: string): name is DatabaseName => Object.hasOwn(DATABASES, name);

/** The app's stores, by the backup folder each is copied to: the database always, the run history where there is one */
export type BackupStores = { lmdb: BackupStore } & Partial<Record<Exclude<DatabaseName, 'lmdb'>, BackupStore>>;

/**
 * Copies the stores in `databases` (and the media folder `mediaPath`, with the database) into a new backup folder.
 * Each is copied by elmdb itself (`copyTo`, its compacted copy), so a backup taken while the app is running holds each store as of one
 * moment rather than whatever the files happened to say as they were read.
 */
export async function exportDatabase(
  stores: BackupStores,
  targetPath: string,
  { name, databases = ['lmdb'], mediaPath, appVersion, log = defaultLog }:
    { name?: string; databases?: DatabaseName[]; mediaPath: string; appVersion?: string; log?: BackupLog },
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fullBackupPath = path.join(targetPath, name || `apack-backup-${timestamp}`);

  await fs.ensureDir(fullBackupPath);

  let includesMedia = false;
  if (databases.includes('lmdb')) {
    if (await fs.pathExists(mediaPath)) {
      includesMedia = true;
    }
  }

  await fs.writeJson(path.join(fullBackupPath, 'metadata.json'), {
    timestamp: Date.now(),
    databases,
    includesMedia,
    // What wrote it, for the refusal message and for reading a backup folder by eye. Provenance only: whether a
    // backup restores is settled by opening its databases (readBackup), never by what this says.
    ...(appVersion !== undefined && { appVersion }),
    storageFormats: Object.fromEntries(databases.map((name) => [name, DATABASES[name].format])),
  });

  for (const dbName of databases) {
    const store = stores[dbName];
    if (store && await fs.pathExists(store.path)) {
      await store.copyTo(path.join(fullBackupPath, dbName));
      log.info(`Backed up ${dbName}`);
    }
  }

  if (includesMedia) {
    await fs.copy(mediaPath, path.join(fullBackupPath, 'media'));
    log.info('Backed up media assets');
  }

  log.info(`Backup completed: ${fullBackupPath}`);
  return fullBackupPath;
}

export type DatabaseImportResult = Pick<BackupContents, 'databases' | 'missingDatabases' | 'unknownEntityTypes'>;

/** Keep previous files until both installation and the caller's acceptance succeed. */
export async function importDatabase(
  stores: BackupStores,
  backupPath: string,
  mediaPath: string,
  { skipUnknownDatabases = false, entityTypes = [], log = defaultLog, validate, accept, restored, withReplacement = replace => replace() }:
    {
      skipUnknownDatabases?: boolean; entityTypes?: Iterable<string>; log?: BackupLog;
      validate?: (ears: Ears) => void;
      /** Hydrate and accept the installed data before the rollback copy can be removed. */
      accept?: (result: DatabaseImportResult) => Promise<void>;
      /** Reload the previous data after a refused installation has been restored. */
      restored?: () => Promise<void>;
      /** Runs only after the candidate validates; the app uses this to suspend and refresh settings. */
      withReplacement?: (replace: () => Promise<DatabaseImportResult>) => Promise<DatabaseImportResult>;
    } = {},
): Promise<DatabaseImportResult> {
  const temporary = await fs.mkdtemp(path.join(path.dirname(stores.lmdb.path), '.apack-import-'));
  const candidate = path.join(temporary, 'candidate');
  const rollback = path.join(temporary, 'rollback');
  let preserveRollback = false;
  try {
    await fs.copy(backupPath, candidate);
    let contents: BackupContents;
    try {
      contents = readBackup(candidate, entityTypes, validate);
    } catch (error) {
      if (error instanceof Error && error.message.includes(candidate)) {
        throw new Error(error.message.replaceAll(candidate, backupPath), { cause: error });
      }
      throw error;
    }
    const { databases, unknownDatabases, missingDatabases, unknownEntityTypes } = contents;
    if (unknownDatabases.length && !skipUnknownDatabases) throw new UnknownBackupDatabasesError(unknownDatabases);
    if (unknownDatabases.length) log.warn('Importing without the stores this apack does not have', { unknownDatabases });
    if (missingDatabases.length) log.warn('The backup lists stores it has no folder for; they are omitted from restore', { missingDatabases });
    if (unknownEntityTypes.length) {
      log.warn('The backup holds entities of types no installed pack declares', { types: unknownEntityTypes.map(([type, count]) => `${type} (${count})`) });
    }
    // A store the backup holds and the caller has none for is left out, as a store it doesn't know is
    const restoring = databases.flatMap((name) => {
      const store = stores[name];
      return store ? [{ name, store }] : [];
    });
    return await withReplacement(async () => {
      for (const { name, store } of restoring) await store.copyTo(path.join(rollback, name));
      const candidateMedia = path.join(candidate, 'media');
      const hasMedia = await fs.pathExists(candidateMedia);
      if (hasMedia && await fs.pathExists(mediaPath)) await fs.copy(mediaPath, path.join(rollback, 'media'));
      try {
        // Each store takes the backup's contents in one unit, open all the while: a reader sees the old or the new
        for (const { name, store } of restoring) {
          store.replaceWith(path.join(candidate, name));
          log.info(`Imported ${name}`);
        }
        if (hasMedia) {
          await fs.remove(mediaPath);
          await fs.copy(candidateMedia, mediaPath);
          log.info('Restored media assets');
        }
        const result = { databases, missingDatabases, unknownEntityTypes };
        await accept?.(result);
        log.info('Import completed');
        return result;
      } catch (error) {
        try {
          for (const { name, store } of restoring) store.replaceWith(path.join(rollback, name));
          if (hasMedia) {
            await fs.remove(mediaPath);
            const previousMedia = path.join(rollback, 'media');
            if (await fs.pathExists(previousMedia)) await fs.copy(previousMedia, mediaPath);
          }
          await restored?.();
        } catch (restoreError) {
          preserveRollback = true;
          throw new AggregateError([error, restoreError], `Import and rollback failed; previous data is retained at ${rollback}`);
        }
        throw error;
      }
    });
  } finally {
    if (!preserveRollback) await fs.remove(temporary);
  }
}

export async function readBackupSummary(backupPath: string) {
  try {
    const metadataPath = path.join(backupPath, 'metadata.json');
    if (!await fs.pathExists(metadataPath)) return null;

    const metadata = await fs.readJson(metadataPath);
    // The databases a restore would bring back (see importDatabase)
    const databases = (metadata.databases as string[]).filter(isKnownDatabase);
    let totalSize = 0;

    for (const dbName of databases) {
      const dbPath = path.join(backupPath, dbName);
      if (await fs.pathExists(dbPath)) {
        totalSize += (await fs.stat(dbPath)).size;
      }
    }

    const hasMedia = await fs.pathExists(path.join(backupPath, 'media'));

    return {
      timestamp: metadata.timestamp,
      databases,
      size: totalSize,
      hasMedia,
      ...(typeof metadata.appVersion === 'string' && { appVersion: metadata.appVersion }),
    };
  } catch {
    return null;
  }
}

/** What a backup holds, read without changing it */
export interface BackupContents {
  timestamp?: number;
  /** The apack that made it, when it recorded one */
  appVersion?: string;
  /**
   * The storage format each of its databases was written in, when it recorded them. Provenance only: whether this
   * build can read them is settled by opening them, so a backup that opens restores whatever this says.
   */
  storageFormats?: Record<string, unknown>;
  /** The databases it restores */
  databases: DatabaseName[];
  hasMedia: boolean;
  /** Entities per type in its primary database, for the given types that have some */
  counts: Array<[string, number]>;
  /** Stores the backup holds that this apack doesn't have: importing leaves them out */
  unknownDatabases: string[];
  /** Stores its metadata lists with no folder to restore: empty when the backup was made, or lost since */
  missingDatabases: DatabaseName[];
  /**
   * Entity types in its primary database that no installed pack declares, with how many rows each has: a pack that
   * was installed when the backup was made and isn't now. Restoring keeps those rows, but nothing reads them until
   * that pack is back. Empty when the caller named no entity types to check against.
   */
  unknownEntityTypes: Array<[string, number]>;
}

/**
 * Checks the backup at `dir` restores into this app and reads what it holds: its metadata lists the primary database
 * (`lmdb`), which is there and opens (so a backup in another storage format is refused here, not half-way through an
 * import; the refusal names the apack that made it when the backup recorded one). A listed database whose folder is missing was empty and is left out, as the import leaves it out, and one
 * this apack doesn't have is reported as `unknownDatabases` for the caller to decide about. Throws naming what's
 * wrong. `entityTypes` are the types to count, and any type the backup holds that isn't among them comes back as
 * `unknownEntityTypes`.
 */
export function readBackup(dir: string, entityTypes: Iterable<string> = [], validate?: (ears: Ears) => void): BackupContents {
  const metadataFile = path.join(dir, 'metadata.json');
  if (!fs.existsSync(metadataFile)) throw new Error(`${dir} isn't a backup: it has no metadata.json`);
  let metadata: { timestamp?: unknown; databases?: unknown; appVersion?: unknown; storageFormats?: unknown };
  try {
    metadata = fs.readJsonSync(metadataFile);
  } catch (error) {
    throw new Error(`${metadataFile} can't be read: ${(error as Error).message}`);
  }
  if (!Array.isArray(metadata.databases)) throw new Error(`${metadataFile} lists no databases`);
  const appVersion = typeof metadata.appVersion === 'string' ? metadata.appVersion : undefined;
  const unknownDatabases = metadata.databases.filter((name) => !isKnownDatabase(String(name))).map(String);
  const listed = metadata.databases.filter((name) => isKnownDatabase(String(name))) as DatabaseName[];
  const missingDatabases = listed.filter((name) => !fs.existsSync(path.join(dir, name, 'data.mdb')));
  if (!listed.includes('lmdb')) throw new Error("The backup doesn't include the database (lmdb)");
  // A listed database whose folder isn't there was empty when the backup was made, and the import skips it too
  const databases = listed.filter((name) => !missingDatabases.includes(name));
  if (!databases.includes('lmdb')) throw new Error(`The backup's lmdb folder is missing or has no data.mdb`);

  // Whether a backup can be restored is the files' answer, not the metadata's: a backup whose databases open is
  // restorable whatever metadata.json claims. What it recorded about its origin goes into the message, no more.
  const refusing = <T>(open: () => T): T => {
    try {
      return open();
    } catch (error) {
      const made = appVersion ? ` (backup made by apack ${appVersion})` : '';
      throw new Error(`${(error as Error).message}${made}`, { cause: error });
    }
  };
  // Every database the import would put in place, so one this version can't read is found before anything is
  // replaced, not when the store opens the new files again
  for (const name of databases) refusing(() => DATABASES[name].check(path.join(dir, name)));
  const database = refusing(() => openDatabase({ path: path.join(dir, 'lmdb'), readOnly: true }));
  try {
    // An engine over the backup's files, held to the schema they hold, since what a backup holds is what is being asked
    const engine = createEarsEngine({ database });
    validate?.(engine);
    const perType = new Map(Object.entries(engine.admin.countEntities()));
    const known = new Set(entityTypes);
    const counts = [...known].sort()
      .flatMap((type) => (perType.has(type) ? [[type, perType.get(type)!] as [string, number]] : []));
    // With no types to check against there is nothing to call unknown, so an import that doesn't ask stays quiet
    const unknownEntityTypes = known.size === 0
      ? []
      : [...perType].filter(([type]) => !known.has(type)).sort(([a], [b]) => a.localeCompare(b));
    return {
      ...(typeof metadata.timestamp === 'number' && { timestamp: metadata.timestamp }),
      ...(appVersion !== undefined && { appVersion }),
      ...(isRecord(metadata.storageFormats) && { storageFormats: metadata.storageFormats }),
      databases,
      unknownDatabases,
      missingDatabases,
      unknownEntityTypes,
      hasMedia: fs.existsSync(path.join(dir, 'media')),
      counts,
    };
  } finally {
    database.close();
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
