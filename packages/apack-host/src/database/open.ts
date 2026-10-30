import { directoryIdentity, holdRecoveryExclusion, openProfileDatabase } from './recovery-lock.ts';
import { assertNoImportRecovery } from '../backup/recovery.ts';
// Opening an app's database: the one composition of the elmdb database and the engine, which the API's boot and tools
// (apack db) share, so both open a data dir the same way
import { createEarsEngine, type EarsAdmin, type EarsDatabase, type EarsEngine, type Ears } from '@apackdev/ears';
import { _bindEars } from '@apackdev/sdk/ears';
import { configuredDatabaseFormat, databaseStorage } from './storage.ts';
import { _RUN_HISTORY_SCHEMA } from '@apackdev/sdk/services';
import { resolveAppEnvironment, type AppEnv } from '@apackdev/sdk/env';
import type { _AppDataPaths } from '@apackdev/sdk/utils';
import { findAppDataPaths } from './layout.ts';
import { engineSchemaOf, readInstalledSchema, type DatabaseSchema, type InstalledSchema } from './schema.ts';
import { errorMessage } from '@apackdev/sdk/utils/pure';
import { createLogger } from '@apackdev/sdk/logger';
import * as fs from 'node:fs';

const logger = createLogger('run-history');

export interface DatabaseStoreOptions {
  /** Explicit constructor selection; otherwise uses the isolated candidate boot setting or production elmdb. */
  storageFormat?: string;
  /** Told when a query does something its data will make slow (the engine's `warn`); the app passes one in development */
  warn?: (message: string) => void;
  /** The database directory */
  path: string;
  /** The entity types: the app's registered packs, or the installed packs' manifests */
  schema: DatabaseSchema;
  readOnly?: boolean;
}

/**
 * The elmdb database at `path` and a new engine reading and writing it. The database keeps the schema it was last
 * held to; opened to write, it is held to what `schema` names too (`admin.declare`), and again each time those names
 * change (`onRegistrationChanged`: the app's registry, as packs register), so a declaration another pack made stays
 * while that pack registers. Nothing is installed.
 */
export function openDatabaseStore({ path, schema, readOnly, warn, storageFormat = configuredDatabaseFormat() }: DatabaseStoreOptions): { database: EarsDatabase; engine: EarsEngine } {
  if (!readOnly) assertNoImportRecovery(path);
  const database = openProfileDatabase(path, readOnly, () => databaseStorage(storageFormat).open({ path, readOnly }));
  const engine = createEarsEngine({ database, warn });
  if (!readOnly) {
    try {
      engine.admin.declare(engineSchemaOf(schema));
    } catch (error) {
      database.close();
      throw error;
    }
    schema.onRegistrationChanged?.(() => { if (database.isOpen) engine.admin.declare(engineSchemaOf(schema)); });
  }
  return { database, engine };
}

/** The run history's database and the engine over it, which no `transact` on the app's engine reaches */
export interface RunsDatabase {
  database: EarsDatabase;
  engine: EarsEngine;
}

/**
 * The run history's database at `dir` (`runs`), held to the run history's schema. Opened to write, files that can't be
 * read — another format, a record store's from before, damaged — are moved aside, to `<dir>.unreadable-<time>`, and a
 * new database is started: the history is a log, so what that costs is past runs, and refusing would keep the whole app
 * from starting over it. Any other failure (a full disk, a permission, the system's lock table) says nothing about the
 * files and throws, as it does opened read-only. Explicit maintenance sets replaceUnreadable=false to refuse
 * damaged history without moving or replacing the incumbent.
 */
export function openRunHistory(dir: string, { readOnly, storageFormat = configuredDatabaseFormat(), replaceUnreadable = true }: { readOnly?: boolean; storageFormat?: string; replaceUnreadable?: boolean } = {}): RunsDatabase {
  if (!readOnly) assertNoImportRecovery(dir);
  const incumbent = directoryIdentity(dir);
  const open = (): RunsDatabase => {
    const database = openProfileDatabase(dir, readOnly, () => databaseStorage(storageFormat).open({ path: dir, readOnly, ...(!readOnly && { schema: _RUN_HISTORY_SCHEMA }) }));
    return { database, engine: createEarsEngine({ database }) };
  };
  try {
    return open();
  } catch (error) {
    if (readOnly || !replaceUnreadable || !fs.existsSync(dir) || !databaseStorage(storageFormat).isUnreadableOpenError(error)) throw error;
    const aside = `${dir}.unreadable-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const exclusion = holdRecoveryExclusion(dir, 'store');
    try {
      if (!incumbent || directoryIdentity(dir) !== incumbent) throw Object.assign(
        new Error(`Run-history directory identity cannot be confirmed; retry or inspect ${dir} before replacing it`),
        { code: 'PUBLICATION_REFUSED' });
      fs.renameSync(dir, aside);
    }
    finally { exclusion.release(); }
    const replacement = open();
    logger.warn(`The run history at ${dir} couldn't be opened (${errorMessage(error)}): it was moved to ${aside}, and a new one started`);
    return replacement;
  }
}

/** An app's database opened outside the app */
export interface AppDatabase {
  userDataDir: string;
  /** The data dir's stores */
  paths: _AppDataPaths;
  /** The installed packs' entity types and relation kinds */
  schema: InstalledSchema;
  database: EarsDatabase;
  ears: Ears;
  admin: EarsAdmin;
  /** Syncs and closes the database, putting back the engine that was installed before this one */
  close(): void;
}

export interface OpenAppDatabaseOptions {
  /** The data dir's environment (production, beta, development or test), which names its app */
  env: AppEnv;
  userDataDir: string;
  /** Opens the files without writing to them: writes through the engine throw */
  readOnly?: boolean;
  /**
   * Packs to read the names a tool reports from when the data dir publishes none of its own (`--schema-from`): a
   * snapshot file, a pack directory, or a directory of pack directories (`readInstalledSchema`).
   */
  schemaFrom?: string;
  /** Explicit format for an isolated candidate profile; otherwise uses the process boot selection. */
  storageFormat?: string;
}

/**
 * Opens the database in `userDataDir` as the app does, held to the schema the app last declared, beside the installed
 * packs' names read from their manifests (no pack code runs), which a tool reports. The engine is bound, so `@apackdev/sdk/ears`'s
 * operations act on it until `close()`. The run history is a database of its own (`openRunHistory`).
 */
export async function openAppDatabase({ env, userDataDir, readOnly = false, schemaFrom, storageFormat = configuredDatabaseFormat(userDataDir) }: OpenAppDatabaseOptions): Promise<AppDatabase> {
  const context = resolveAppEnvironment({ env, userDataDir });
  const paths = findAppDataPaths(userDataDir);
  const schema = readInstalledSchema(context, { schemaFrom });
  // The database is held to the schema the app last declared, which a tool doesn't change: the app declares what its
  // packs' code says (their required fields among it), and no manifest carries all of that
  if (!readOnly) assertNoImportRecovery(paths.lmdb);
  const database = openProfileDatabase(paths.lmdb, readOnly, () => databaseStorage(storageFormat).open({ path: paths.lmdb, readOnly }));
  if (!readOnly && database.schema === null) {
    database.close();
    throw new Error(`The database in ${userDataDir} holds no schema yet: start apack on it once, which declares its packs', then run this again.`);
  }
  const engine = createEarsEngine({ database });
  // Bound so the SDK's engine operations (`@apackdev/sdk/ears`) read this database until `close()`, which
  // puts back whatever was bound before rather than leaving none. `apack db`, the one caller today, has no
  // engine of its own, so it gets none back; what this is for is a caller that does — a test file, or a command
  // holding one data dir open while it reads another, where unbinding would leave the first unreachable.
  const previousEngine = _bindEars(engine);

  return {
    userDataDir,
    paths,
    schema,
    database,
    ears: engine,
    admin: engine.admin,
    close() {
      _bindEars(previousEngine);
      database.close();
    },
  };
}
