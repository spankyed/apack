import * as fs from 'node:fs';
import type { Database } from 'lmdb';
import type { PersistenceSink } from '../runtime.ts';
import type { EarsAdmin } from '../engine.ts';
import { openEnvAt, closeEnv, isAlreadyClosed, DATA_DATABASES, type LmdbDbs } from './envs.ts';
import { makeLmdbAdapter } from './adapter.ts';
import { hydrate } from './hydrate.ts';
import { LmdbReader } from './reader.ts';

/**
 * The longest a commit waits to be flushed to disk. A commit survives the app crashing as soon as it returns; this
 * bounds what an OS crash or a power loss can take, which is the commits since the last sync (decided 2026-10-23:
 * SQLite's WAL with `synchronous=NORMAL` makes the same trade). A caller that can't lose a write waits for `durable()`.
 */
export const SYNC_INTERVAL_MS = 1000;

/**
 * How long writes must pause before what they committed is flushed: a burst of commits shares one sync (group commit),
 * and a lone write is on disk this long after it returns rather than `SYNC_INTERVAL_MS`
 */
export const SYNC_IDLE_MS = 100;

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
  /** Loads the database into the store's engine, and logs what it loaded and what that took */
  hydrate(): Promise<void>;
  /** What the store has done since it opened: its readings, for a person or a budget to read */
  stats(): LmdbStoreStats;
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

/** What an LMDB store has done since it opened (`LmdbStore.stats`) */
export interface LmdbStoreStats {
  /** How long hydrating took, or null before it has */
  hydrateMs: number | null;
  /** Units committed */
  commits: number;
  /** Of those, the ones flushed as they committed (durable units, a reset, an import) */
  flushedCommits: number;
  /** Background and `durable()` syncs that finished */
  syncs: number;
  /** How long the store has been open, for the rates */
  openMs: number;
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
  const opened = performance.now();
  let hydrateMs: number | null = null;
  let flushedCommits = 0;
  let syncs = 0;
  // Commits are counted, so a sync knows which of them it made durable: the ones made before it started
  let committed = 0;
  let synced = 0;
  const unsynced = () => synced < committed;
  /** What `durable()` callers wait for: the commit count each needs synced */
  let waiting: Array<{ through: number; resolve: () => void; reject: (error: Error) => void }> = [];
  let syncing = false;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let overdue: ReturnType<typeof setTimeout> | undefined;

  const settle = (error?: Error) => {
    const still: typeof waiting = [];
    for (const waiter of waiting) {
      if (error) waiter.reject(error);
      else if (waiter.through <= synced) waiter.resolve();
      else still.push(waiter);
    }
    waiting = still;
  };
  /** Marks every commit so far durable: a flushed commit flushes every page before it */
  const flushedThrough = (count: number) => {
    synced = Math.max(synced, count);
    if (!unsynced()) {
      clearTimeout(idle);
      clearTimeout(overdue);
      idle = overdue = undefined;
    }
    settle();
  };
  /** Flushes what was committed, off the main thread; one sync runs at a time, and the next follows if needed */
  const sync = () => {
    // The running sync's end starts the next one, or arms the timers for it
    if (syncing) return;
    clearTimeout(idle);
    clearTimeout(overdue);
    idle = overdue = undefined;
    if (!env || !unsynced()) return;
    syncing = true;
    const through = committed;
    (env.root as unknown as { sync(done: (error?: Error) => void): void }).sync((error) => {
      syncing = false;
      if (error) {
        log(`[LMDB] Syncing ${path} failed: ${error.message}`);
        settle(error);
      } else {
        syncs++;
        flushedThrough(through);
      }
      // Commits made while it ran: at once for a caller waiting on them, else once writes pause
      if (!unsynced()) return;
      if (waiting.length > 0) sync();
      else schedule();
    });
  };
  /** After a commit: a sync once writes pause, and at the latest `SYNC_INTERVAL_MS` after the first unsynced one */
  const schedule = () => {
    clearTimeout(idle);
    idle = setTimeout(sync, SYNC_IDLE_MS);
    idle.unref();
    if (!overdue) {
      overdue = setTimeout(sync, SYNC_INTERVAL_MS);
      overdue.unref();
    }
  };
  const stats = (): LmdbStoreStats => ({ hydrateMs, commits: committed, flushedCommits, syncs, openMs: performance.now() - opened });
  const adapter = makeLmdbAdapter(env, (flushed) => {
    committed++;
    if (flushed) {
      flushedCommits++;
      flushedThrough(committed);
    }
    else schedule();
  });

  const openEnv = (): LmdbDbs => {
    if (!env) throw new Error(`The LMDB store at ${path} is closed`);
    return env;
  };
  const writable = (): void => {
    if (readOnly) throw new Error(`The LMDB store at ${path} is open read-only`);
    openEnv();
  };

  /** Runs `fn` in one write transaction that waits for the disk: a reset and an import are each durable when they return */
  const durably = (fn: () => void) => {
    writable();
    openEnv().root.transactionSync(() => { fn(); });
    flushedCommits++;
    flushedThrough(++committed);
  };

  /** Removes every row of the data databases; keys are read first, since a range is a live cursor */
  const empty = (dbs: LmdbDbs) => {
    // eslint-disable-next-line no-useless-spread -- a range is a live cursor, read whole before it is removed from
    for (const name of DATA_DATABASES) for (const key of [...dbs[name].getKeys()]) dbs[name].remove(key);
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
    onUnitEnd: (options) => { writable(); adapter.onUnitEnd(options); },
    readAttr: (kind, entityId) => { openEnv(); return adapter.readAttr(kind, entityId); },
    durable() {
      if (!unsynced()) return Promise.resolve();
      if (!env) return Promise.reject(new Error(`The LMDB store at ${path} is closed`));
      const done = new Promise<void>((resolve, reject) => waiting.push({ through: committed, resolve, reject }));
      sync();
      return done;
    },
    close: () => close(),
  };

  function close(): void {
    if (!env) return;
    clearTimeout(idle);
    clearTimeout(overdue);
    const closing = env;
    env = null;
    try {
      // lmdb-js has no synchronous sync, so one flushed write, to the environment's own records, makes every commit
      // before it durable
      if (unsynced() && !readOnly) {
        const meta = closing.root.openDB({ name: 'meta', encoding: 'json' });
        closing.root.transactionSync(() => { meta.put('syncedAt', Date.now()); });
      }
      flushedThrough(committed);
    } catch (error) {
      log(`[LMDB] Flushing ${path} before closing failed: ${(error as Error).message}`);
      settle(error as Error);
    }
    try {
      closeEnv(closing);
      const { commits, flushedCommits: flushed, syncs: synced, openMs } = stats();
      log(`[LMDB] Environment closed: ${commits} commits (${flushed} flushed) and ${synced} syncs over ${(openMs / 1000).toFixed(1)} s`);
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
    async hydrate() {
      const started = performance.now();
      await hydrate({ engine: engine(), env: openEnv(), log });
      hydrateMs = performance.now() - started;
    },
    stats,
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
          for (const name of DATA_DATABASES) {
            const into = live[name] as Database<unknown, string>;
            for (const { key, value } of (source[name] as Database<unknown, string>).getRange()) into.put(key, value);
          }
        });
      } finally {
        closeEnv(source);
      }
    },
  };
}
