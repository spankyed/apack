// Opening an app's database: the one composition of the LMDB store and the engine, which the API's boot and tools
// (apack db) share, so both hydrate a data dir the same way
import { createEarsEngine, type EarsAdmin, type EarsEngine, type Ears, type RecordStore } from '@apackdev/ears';
import { _bindEars } from '@apackdev/sdk/ears';
import { openLmdbStore, openRecordStore, type LmdbStore } from '@apackdev/ears/lmdb';
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
  /** Told when a query does something its data will make slow (the engine's `warn`); the app passes one in development */
  warn?: (message: string) => void;
  /** The database directory */
  path: string;
  /** The entity types: the app's registered packs, or the installed packs' manifests */
  schema: DatabaseSchema;
  readOnly?: boolean;
}

/**
 * The LMDB store at `path` and a new engine reading and writing it, which checks entity types against `schema`
 * (consulted per call, so a type registered later counts). Nothing is installed.
 */
export function openDatabaseStore({ path, schema, readOnly, warn }: DatabaseStoreOptions): { store: LmdbStore; engine: EarsEngine } {
  const store = openLmdbStore({ path, readOnly });
  const engine = createEarsEngine({
    kv: store.kv,
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
  /** Syncs and closes the store, putting back the engine that was installed before this one */
  close(): void;
}

export interface OpenAppDatabaseOptions {
  /** The data dir's environment (production, beta, development or test), which names its app */
  env: AppEnv;
  userDataDir: string;
  /** Opens the files without writing to them: writes through the engine throw */
  readOnly?: boolean;
  /**
   * Packs to read the schema from when the data dir publishes none of its own (`--schema-from`): a snapshot
   * file, a pack directory, or a directory of pack directories.
   * See `readInstalledSchema`: without it such a dir opens read-only, knowing only apack's own types.
   */
  schemaFrom?: string;
}

/**
 * Opens the database in `userDataDir` as the app does: the installed packs' schema (their manifests; no pack code
 * runs) and the store in the layout the data dir uses, which the engine reads. The engine is bound, so `@apackdev/sdk/ears`'s
 * operations act on it until `close()`. The run history is a store of its own (`openRunHistoryStore`).
 */
export async function openAppDatabase({ env, userDataDir, readOnly = false, schemaFrom }: OpenAppDatabaseOptions): Promise<AppDatabase> {
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
  // `query('Note')` and `create('Note')` would throw over rows that are plainly there. `isEntityType` is a live closure
  // consulted per call, so the types the data holds are added to this set once the store is open. It stays separate
  // from `schema`, whose `getRegisteredEntityTypes` is a backup's yardstick for "no installed pack declares this"
  // (`apack-cli/src/commands/db/destructive.ts`), which an observed set would answer wrongly.
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
  });
  try {
    for (const type of Object.keys(engine.admin.countEntities())) knownToEngine.add(type);
    // Relation kinds and roles the same way: links and roles a removed pack left are still there to read. The stats
    // walk the store, which an offline tool can afford once
    const held = engine.getSchemaStats();
    for (const kind of Object.keys(held.relations)) kindsKnownToEngine.add(kind);
    for (const role of Object.keys(held.roles)) rolesKnownToEngine.add(role);
  } catch (error) {
    store.close();
    throw error;
  }
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
      store.close();
    },
  };
}
