import * as fs from 'node:fs';
import type { PersistenceSink } from '../runtime.ts';
import type { EarsAdmin } from '../engine.ts';
import { openEnvAt, closeEnv, isAlreadyClosed, type LmdbDbs } from './envs.ts';
import { makeLmdbAdapter } from './adapter.ts';
import { hydrate } from './hydrate.ts';
import { LmdbReader } from './reader.ts';

/**
 * How often what was committed since the last sync is flushed to disk. A commit survives the app crashing as soon as
 * it returns; this bounds what an OS crash or a power loss can take, which is the commits since the last sync
 * (decided 2026-10-23: SQLite's WAL with `synchronous=NORMAL` makes the same trade).
 */
export const SYNC_INTERVAL_MS = 1000;

/** The data databases, which a reset empties and an import replaces; the environment's own `meta` stays */
const DATA = ['entities', 'attrs', 'relations'] as const;

/** An app's LMDB store: one environment, and the sink that writes the engine's changes to it */
export interface LmdbStore {
  /**
   * The engine's persistence: create the engine with it (`createEarsEngine({ persistence: store.sink })`). Each unit
   * is committed when its last write returns, or refused, which the engine undoes; a closed store refuses every write.
   */
  readonly sink: Required<PersistenceSink>;
  /** The database directory */
  readonly path: string;
  /** Whether the store was opened read-only: its sink then throws on every write */
  readonly readOnly: boolean;
  /** The open environment. Throws while the store is closed */
  readonly env: LmdbDbs;
  /** Whether the environment is open */
  isOpen(): boolean;
  /** Loads the database into the store's engine */
  hydrate(): Promise<void>;
  /** Direct reads of the environment, without hydrating it */
  read(): LmdbReader;
  /**
   * Writes a consistent copy of the database into `targetDir` (as `data.mdb`, which the directory is created for).
   * LMDB copies one read transaction's worth of data, so the copy is the database as of a single moment even
   * while the app goes on writing; nothing is buffered, so it holds every write that returned before it started.
   */
  copyTo(targetDir: string): Promise<void>;
  /** Flushes what was committed to disk and closes the environment; closing a closed store does nothing */
  close(): void;
  /**
   * Empties the database in one transaction, keeping its storage format, with the environment open throughout: a
   * write made after it returns lands in the empty database. Doesn't touch the engine's memory, which the caller
   * clears in the same turn, so no write falls between the two.
   */
  reset(): void;
  /**
   * Replaces the database with the one at `dir` (a backup, or a rollback copy) in one transaction: the files there
   * are opened read-only and checked like any (`LMDB_FORMAT_VERSION`), and the environment stays open. Doesn't touch
   * the engine's memory, which the caller hydrates again.
   */
  replaceWith(dir: string): void;
}

/** What an LMDB store is opened with */
export interface LmdbStoreOptions {
  /** The database directory */
  path: string;
  /**
   * The engine the store persists, which hydration loads into. A function, because the engine is created with the
   * store's sink.
   */
  engine: () => EarsAdmin;
  /** Opens existing environments without writing to them (tools reading a copy, or a running app's files) */
  readOnly?: boolean;
  /** Where the store's lines go (hydration counts, relations it skipped, errors closing and syncing); `console.log` by default */
  log?: (message: string) => void;
}

/**
 * Opens the LMDB environment at `path` and returns the store. Nothing reaches the engine until the caller creates
 * it with `store.sink` and hydrates.
 */
export function openLmdbStore({ path, engine, readOnly = false, log = console.log }: LmdbStoreOptions): LmdbStore {
  let env: LmdbDbs | null = openEnvAt(path, { readOnly });
  /** Whether anything was committed since the last sync */
  let unsynced = false;
  const adapter = makeLmdbAdapter(env, () => { unsynced = true; });

  const openEnv = (): LmdbDbs => {
    if (!env) throw new Error(`The LMDB store at ${path} is closed`);
    return env;
  };
  const writable = (): void => {
    if (readOnly) throw new Error(`The LMDB store at ${path} is open read-only`);
    openEnv();
  };

  // The background sync: one flush makes every commit before it durable, off the main thread
  const timer = readOnly ? undefined : setInterval(() => {
    if (!unsynced || !env) return;
    unsynced = false;
    (env.root as unknown as { sync(done: (error?: Error) => void): void }).sync((error) => {
      if (error) log(`[LMDB] Syncing ${path} failed: ${error.message}`);
    });
  }, SYNC_INTERVAL_MS);
  timer?.unref();

  /** Runs `fn` in one write transaction that waits for the disk: a reset and an import are each durable when they return */
  const durably = (fn: () => void) => {
    writable();
    openEnv().root.transactionSync(() => { fn(); });
    unsynced = false;
  };

  /** Removes every row of the data databases; keys are read first, since a range is a live cursor */
  const empty = (dbs: LmdbDbs) => {
    // eslint-disable-next-line no-useless-spread -- a range is a live cursor, read whole before it is removed from
    for (const name of DATA) for (const key of [...dbs[name].getKeys()]) dbs[name].remove(key);
  };

  const sink: Required<PersistenceSink> = {
    onCreateEntity: (...args) => { writable(); adapter.onCreateEntity(...args); },
    onDestroyEntity: (...args) => { writable(); adapter.onDestroyEntity(...args); },
    onDropAttr: (...args) => { writable(); adapter.onDropAttr(...args); },
    onPutAttr: (...args) => { writable(); adapter.onPutAttr(...args); },
    onAddRelation: (...args) => { writable(); adapter.onAddRelation(...args); },
    onUpdateRelation: (...args) => { writable(); adapter.onUpdateRelation(...args); },
    onRemoveRelation: (...args) => { writable(); adapter.onRemoveRelation(...args); },
    onUnitStart: () => { writable(); adapter.onUnitStart(); },
    onUnitEnd: () => { writable(); adapter.onUnitEnd(); },
    close: () => close(),
  };

  function close(): void {
    if (!env) return;
    clearInterval(timer);
    const closing = env;
    env = null;
    try {
      // lmdb-js has no synchronous sync, so one flushed write, to the environment's own records, makes every commit
      // before it durable
      if (unsynced && !readOnly) {
        const meta = closing.root.openDB({ name: 'meta', encoding: 'json' });
        closing.root.transactionSync(() => { meta.put('syncedAt', Date.now()); });
      }
      unsynced = false;
    } catch (error) {
      log(`[LMDB] Flushing ${path} before closing failed: ${(error as Error).message}`);
    }
    try {
      closeEnv(closing);
      log('[LMDB] Environment closed successfully');
    } catch (error) {
      if (!isAlreadyClosed(error)) log(`[LMDB] Closing ${path} met an error: ${(error as Error).message}`);
    }
  }

  return {
    sink,
    path,
    readOnly,
    get env() { return openEnv(); },
    isOpen: () => env !== null,
    hydrate: () => hydrate({ engine: engine(), env: openEnv(), log }),
    read: () => new LmdbReader(openEnv()),
    async copyTo(targetDir) {
      // LMDB writes data.mdb into a directory that already exists, and no lock.mdb: it makes one when opened
      fs.mkdirSync(targetDir, { recursive: true });
      await openEnv().root.backup(targetDir, false);
    },
    close,
    reset() {
      durably(() => empty(openEnv()));
    },
    replaceWith(dir) {
      writable();
      const source = openEnvAt(dir, { readOnly: true });
      try {
        durably(() => {
          const live = openEnv();
          empty(live);
          for (const name of DATA) for (const { key, value } of source[name].getRange()) live[name].put(key, value);
        });
      } finally {
        closeEnv(source);
      }
    },
  };
}
