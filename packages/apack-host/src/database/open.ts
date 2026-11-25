// Opening an app's database: the one composition of the elmdb database and the engine, which the API's boot and tools
// (apack db) share, so both open a data dir the same way
import { createEarsEngine, type EarsAdmin, type EarsClock, type EarsDatabase, type EarsEngine, type Ears, type EarsWarning } from '@elmdb/ears';
import { _bindEars, _EARS_CALL_SITES } from '@apackdev/sdk/ears';
import { openDatabase as openElmdb, type DatabaseOptions } from '@elmdb/ears/database';
import { _RUN_HISTORY_SCHEMA } from '@apackdev/sdk/services';
import { resolveAppEnvironment, type AppEnv } from '@apackdev/sdk/env';
import type { _AppDataPaths } from '@apackdev/sdk/utils';
import { findAppDataPaths } from './layout.ts';
import { refuseInvalidSettings } from './settings-rule.ts';
import { engineSchemaOf, readInstalledSchema, type DatabaseSchema, type InstalledSchema } from './schema.ts';
import { errorMessage } from '@apackdev/sdk/utils/pure';
import { createLogger } from '@apackdev/sdk/logger';
import * as fs from 'node:fs';

const logger = createLogger('run-history');
const databaseLogger = createLogger('database');

/**
 * Opens the elmdb database `options` name, as every open here does, saying what the open found: that a power loss or a
 * failed sync took it back to its last synced commit, the commits after it gone, and that the record of its last sync
 * named another file than the one opened. elmdb reports a restore at every open until it is acknowledged, which a
 * writable open does once it has said so; a read-only open can't, and says so each time until the app opens it to write
 */
function openDatabase(options: DatabaseOptions): EarsDatabase {
  const database = openElmdb(options);
  const { restored, notBorneOut } = database.openReport;
  if (restored) {
    const at = restored.sequence === null ? 'its last synced commit' : `its last synced commit, sequence ${restored.sequence}`;
    databaseLogger.warn(`The database at ${options.path} was taken back to ${at}: a power loss or a failed sync lost the commits made after it`);
    // A notice that couldn't be cleared is said again at the next open, which costs less than refusing this one
    if (!options.readOnly) {
      try { database.acknowledgeRestore(); } catch (error) { databaseLogger.warn(`The restore of ${options.path} couldn't be marked read (${errorMessage(error)}): the next open says it again`); }
    }
  }
  if (notBorneOut) {
    databaseLogger.warn(`The database at ${options.path} isn't the file its record of the last sync names, as when one database's file is copied over another's: it was opened as it is`);
  }
  return database;
}

export interface DatabaseStoreOptions {
  /**
   * Told when a query does something its data will make slow (the engine's `warn`, with the `apack.json` entry that
   * declares an index's fix); the app passes one in development
   */
  warn?: (message: string) => void;
  /** The database directory */
  path: string;
  /** The entity types: the app's registered packs, or the installed packs' manifests */
  schema: DatabaseSchema;
  readOnly?: boolean;
  /** Clock for timestamps, watch gaps, and call timings (defaults to the engine's system clock) */
  clock?: EarsClock;
}

/**
 * The elmdb database at `path` and a new engine reading and writing it. The database keeps the schema it was last
 * held to; opened to write, it is held to what `schema` names too (`admin.declare`), and again each time those names
 * change (`onRegistrationChanged`: the app's registry, as packs register), so a declaration another pack made stays
 * while that pack registers. Nothing is installed.
 */
export function openDatabaseStore({ path, schema, readOnly, warn, clock }: DatabaseStoreOptions): { database: EarsDatabase; engine: EarsEngine } {
  using unwind = new DisposableStack();
  const database = openDatabase({ path, readOnly });
  unwind.defer(() => database.close());
  const engine = createEarsEngine({
    database,
    ...(clock && { clock }),
    callSites: _EARS_CALL_SITES,
    // A value index the engine names in a type's row rules is the `indexes` of that type's entry in a pack's apack.json
    warn: warn && ((message: string, warning: EarsWarning) => warn(warning.kind === 'unindexedWalk'
      ? `${message}, which a pack declares in the ${warning.types.join('/')} entry of its apack.json`
      : message)),
  });
  if (!readOnly) {
    engine.admin.declare(engineSchemaOf(schema));
    schema.onRegistrationChanged?.(() => { if (database.isOpen) engine.admin.declare(engineSchemaOf(schema)); });
  }
  unwind.move();
  return { database, engine };
}

/** The run history's database and the engine over it, which no `transact` on the app's engine reaches */
export interface RunsDatabase extends Disposable {
  database: EarsDatabase;
  engine: EarsEngine;
}

/** elmdb's codes for files no open of them will read: not elmdb's, in another format, or damaged */
const UNREADABLE_CODES: readonly unknown[] = ['NOT_A_DATABASE', 'WRONG_FORMAT', 'CORRUPTED'];

/**
 * The run history's database at `dir` (`runs`), held to the run history's schema. Opened to write, files that can't be
 * read — another format, a record store's from before, damaged — are moved aside, to `<dir>.unreadable-<time>`, and a
 * new database is started: the history is a log, so what that costs is past runs, and refusing would keep the whole app
 * from starting over it. Any other failure (a full disk, a permission, the system's lock table) says nothing about the
 * files and throws, as it does opened read-only.
 */
export function openRunHistory(dir: string, { readOnly, clock }: { readOnly?: boolean; clock?: EarsClock } = {}): RunsDatabase {
  const open = (): RunsDatabase => {
    using unwind = new DisposableStack();
    const database = openDatabase({ path: dir, readOnly, ...(!readOnly && { schema: _RUN_HISTORY_SCHEMA }) });
    unwind.defer(() => database.close());
    const engine = createEarsEngine({ database, ...(clock && { clock }), callSites: _EARS_CALL_SITES });
    unwind.move();
    return { database, engine, [Symbol.dispose]() { database.close(); } };
  };
  try {
    return open();
  } catch (error) {
    if (readOnly || !fs.existsSync(dir) || !UNREADABLE_CODES.includes((error as { code?: unknown })?.code)) throw error;
    const aside = `${dir}.unreadable-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.renameSync(dir, aside);
    logger.warn(`The run history at ${dir} couldn't be opened (${errorMessage(error)}): it was moved to ${aside}, and a new one started`);
    return open();
  }
}

/**
 * Empties the run history at `dir` where it is, beside an app that may hold it open: opened as it stands, declaring no
 * schema and moving nothing aside, since either would change it under that app
 */
export function resetRunHistoryInPlace(dir: string): void {
  const database = openDatabase({ path: dir });
  try { database.reset(); } finally { database.close(); }
}

/** An app's database opened outside the app */
export interface AppDatabase extends Disposable {
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
  /** Clock for timestamps, watch gaps, and call timings (defaults to the engine's system clock) */
  clock?: EarsClock;
}

/**
 * Opens the database in `userDataDir` as the app does, held to the schema the app last declared, beside the installed
 * packs' names read from their manifests (no pack code runs), which a tool reports. The engine is bound, so `@apackdev/sdk/ears`'s
 * operations act on it until `close()`. The run history is a database of its own (`openRunHistory`).
 */
export async function openAppDatabase({ env, userDataDir, readOnly = false, schemaFrom, clock }: OpenAppDatabaseOptions): Promise<AppDatabase> {
  const context = resolveAppEnvironment({ env, userDataDir });
  const paths = findAppDataPaths(userDataDir);
  const schema = readInstalledSchema(context, { schemaFrom });
  using unwind = new DisposableStack();
  // The database is held to the schema the app last declared, which a tool doesn't change: the app declares what its
  // packs' code says (their required fields among it), and no manifest carries all of that
  const database = openDatabase({ path: paths.lmdb, readOnly });
  unwind.defer(() => database.close());
  if (!readOnly && database.schema === null) {
    throw new Error(`The database in ${userDataDir} holds no schema yet: start apack on it once, which declares its packs', then run this again.`);
  }
  const engine = createEarsEngine({ database, ...(clock && { clock }), callSites: _EARS_CALL_SITES });
  if (!readOnly) engine.admin.beforeCommit(refuseInvalidSettings(engine, context));
  // Bound so the SDK's engine operations (`@apackdev/sdk/ears`) read this database until `close()`, which
  // puts back whatever was bound before rather than leaving none. `apack db`, the one caller today, has no
  // engine of its own, so it gets none back; what this is for is a caller that does — a test file, or a command
  // holding one data dir open while it reads another, where unbinding would leave the first unreachable.
  const previousEngine = _bindEars(engine);
  unwind.defer(() => _bindEars(previousEngine));

  const owned = unwind.move();
  const close = () => owned.dispose();
  return {
    userDataDir,
    paths,
    schema,
    database,
    ears: engine,
    admin: engine.admin,
    close,
    [Symbol.dispose]: close,
  };
}
