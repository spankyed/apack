// Opening an app's database: the one composition of the LMDB store and the engine, which the API's boot and tools
// (apack db) share, so both hydrate a data dir the same way
import { createEarsEngine, type EarsAdmin, type EarsEngine, type Ears, type RecordStore } from '@apackdev/ears';
import { _bindEars } from '@apackdev/sdk/ears';
import { openLmdbStore, openRecordStore, type LmdbStore, type WriteFailure } from '@apackdev/ears/lmdb';
import { _RUN_HISTORY_INDEXES, type RunNode } from '@apackdev/sdk/services';
import { resolveAppEnvironment, type AppEnv } from '@apackdev/sdk/env';
import type { _AppDataPaths } from '@apackdev/sdk/utils';
import { findAppDataPaths } from './layout.ts';
import { readInstalledSchema, type DatabaseSchema, type InstalledSchema } from './schema.ts';
import { errorMessage } from '@apackdev/sdk/utils/pure';
import { _withSdkIndexes } from '@apackdev/sdk/types';
import { createLogger } from '@apackdev/sdk/logger';
import * as fs from 'node:fs';

const logger = createLogger('run-history');

export interface DatabaseStoreOptions {
  /** Told when a write is dropped, with the row it was for (`openLmdbStore`'s port) */
  onWriteFailure?: (failure: WriteFailure) => void;
  /** Told when a query does something its data will make slow (the engine's `warn`); the app passes one in development */
  warn?: (message: string) => void;
  /** The database directory */
  path: string;
  /** The entity types: the app's registered packs, or the installed packs' manifests */
  schema: DatabaseSchema;
  readOnly?: boolean;
  /** Where the store's progress lines go; `console.log` by default */
  log?: (message: string) => void;
}

/**
 * The LMDB store at `path` and a new engine persisting to it, which checks entity types against `schema`. Nothing is
 * hydrated or installed: the caller hydrates (`store.hydrate()`) once `schema` holds every entity type.
 */
export function openDatabaseStore({ path, schema, readOnly, log, onWriteFailure, warn }: DatabaseStoreOptions): { store: LmdbStore; engine: EarsEngine } {
  const store = openLmdbStore({ path, onWriteFailure, engine: () => engine.admin, readOnly, log });
  const engine = createEarsEngine({
    persistence: store.sink,
    isEntityType: (name) => schema.getRegisteredEntityTypes().has(name),
    isRelationKind: (name) => schema.getRegisteredRelationKinds().has(name),
    isRole: (name) => schema.getRegisteredRoles().has(name),
    rowRules: (type) => _withSdkIndexes(schema.getRowRules?.(type)),
    warn,
  });
  return { store, engine };
}

/**
 * The run history's store at `dir`, indexed as `services.runHistory` looks its records up. Opened to write, a store
 * that can't be opened — another format, another kind of files, damaged — is moved aside, to
 * `<dir>.unreadable-<time>`, and a new one is started: the history is a log, so what that costs is past runs, and
 * refusing would keep the whole app from starting over it. Opened read-only, it refuses as any store does.
 */
export function openRunHistoryStore(dir: string, { readOnly }: { readOnly?: boolean } = {}): RecordStore<RunNode> {
  const open = () => openRecordStore<RunNode>({ path: dir, indexes: _RUN_HISTORY_INDEXES, readOnly });
  try {
    return open();
  } catch (error) {
    if (readOnly || !fs.existsSync(dir)) throw error;
    const aside = `${dir}.unreadable-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.renameSync(dir, aside);
    logger.warn(`The run history at ${dir} couldn't be opened (${errorMessage(error)}): it was moved to ${aside}, and a new one started`);
    return open();
  }
}

/** An app's database opened outside the app */
export interface AppDatabase {
  userDataDir: string;
  /** The data dir's stores */
  paths: _AppDataPaths;
  /** The installed packs' entity types and relation kinds */
  schema: InstalledSchema;
  store: LmdbStore;
  ears: Ears;
  admin: EarsAdmin;
  /**
   * Flushes the writes made through the engine and closes the store, putting back the engine that was installed
   * before this one. Throws when a write failed to reach the files, in this call's flush or earlier.
   */
  close(): void;
}

export interface OpenAppDatabaseOptions {
  /** The data dir's environment (production, beta, development or test), which names its app */
  env: AppEnv;
  userDataDir: string;
  /** Opens the files without writing to them: writes through the engine throw */
  readOnly?: boolean;
  /** Where the store's progress lines go; `console.log` by default */
  log?: (message: string) => void;
  /**
   * Packs to read the schema from when the data dir publishes none of its own (`--schema-from`): a snapshot
   * file, a pack directory, or a directory of pack directories.
   * See `readInstalledSchema`: without it such a dir opens read-only, knowing only apack's own types.
   */
  schemaFrom?: string;
}

/**
 * Opens the database in `userDataDir` as the app does: the installed packs' schema (their manifests; no pack code
 * runs), the store in the layout the data dir uses, hydrated. The engine is bound, so `@apackdev/sdk/ears`'s
 * operations act on it until `close()`. The run history is a store of its own (`openRunHistoryStore`).
 */
export async function openAppDatabase({ env, userDataDir, readOnly = false, log, schemaFrom }: OpenAppDatabaseOptions): Promise<AppDatabase> {
  const context = resolveAppEnvironment({ env, userDataDir });
  const paths = findAppDataPaths(userDataDir);
  const schema = readInstalledSchema(context, { schemaFrom });
  // A write needs a schema, not most of one. The engine asks it whether a name is an entity type, and refuses
  // one it has never heard of, so a write through an incomplete schema fails part way through on the first
  // type it lacks. Reading is what an incomplete schema is good for.
  if (!readOnly && schema.degraded !== undefined) {
    throw new Error(`${schema.degraded}\n\nThis command changes the database, and an incomplete schema would write the wrong rows.`);
  }
  // **The engine knows the types in the data as well as the declared ones, and `schema` keeps meaning declared.**
  // Rows outlive the pack that declared their types, and the engine refuses a name it has never heard of — so
  // `query('Note')` and `create('Note')` would throw over rows that are plainly there. The
  // types present are only knowable after hydration, and `isEntityType` is a live closure consulted per call,
  // so they are added to this set once their rows are in. It stays separate from `schema`, whose
  // `getRegisteredEntityTypes` is a backup's yardstick for "no installed pack declares this"
  // (`apack-cli/src/commands/db/destructive.ts:190`), which an observed set would answer wrongly.
  const knownToEngine = new Set(schema.getRegisteredEntityTypes());
  const kindsKnownToEngine = new Set(schema.getRegisteredRelationKinds());
  const rolesKnownToEngine = new Set(schema.getRegisteredRoles());
  const { store, engine } = openDatabaseStore({
    path: paths.lmdb,
    schema: {
      getRegisteredEntityTypes: () => knownToEngine,
      getRegisteredRelationKinds: () => kindsKnownToEngine,
      getRegisteredRoles: () => rolesKnownToEngine,
      ...(schema.getRowRules && { getRowRules: schema.getRowRules }),
    },
    readOnly,
    log,
  });
  try {
    // Hydration fills the engine it was given, not the installed one, so nothing is installed until it succeeds:
    // an open that fails leaves this process's engine exactly as it was
    await store.hydrate();
  } catch (error) {
    store.close();
    throw error;
  }
  // Hydration indexes an entity by its type, so this is the set of types the data turned out to hold. It runs
  // after hydration and not during it: nothing hydration does consults the check (a bulk load doesn't), so the
  // set it would be widening from is the data it is reading.
  const held = engine.getSchemaStats();
  for (const type of Object.keys(held.entities)) knownToEngine.add(type);
  // Relation kinds and roles the same way: links and roles a removed pack left are still there to read
  for (const kind of Object.keys(held.relations)) kindsKnownToEngine.add(kind);
  for (const role of Object.keys(held.roles)) rolesKnownToEngine.add(role);
  // Bound so the SDK's engine operations (`@apackdev/sdk/ears`) read this database until `close()`, which
  // puts back whatever was bound before rather than leaving none. `apack db`, the one caller today, has no
  // engine of its own, so it gets none back; what this is for is a caller that does — a test file, or a command
  // holding one data dir open while it reads another, where unbinding would leave the first unreachable.
  const previousEngine = _bindEars(engine);

  return {
    userDataDir,
    paths,
    schema,
    store,
    ears: engine,
    admin: engine.admin,
    close() {
      _bindEars(previousEngine);
      const { errorCount, lastError } = store.close();
      if (errorCount > 0) {
        const cause = (lastError as { error?: unknown } | null)?.error ?? lastError;
        throw new Error(`${errorCount} write(s) didn't reach the database in ${userDataDir}: ${errorMessage(cause)}`, { cause });
      }
    },
  };
}
