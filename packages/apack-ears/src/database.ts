// The structured database boundary and connection shared by EARS backends. The connection owns units,
// instrumentation and commit delivery; each backend owns its transport and persistence representation.
import { callSite, createCallTally, type CallCounting, type CallReport, type CallTally } from './calls.ts';
import { EarsError, type EarsErrorCode } from './errors.ts';
import type { Op, ReadOp, Load, Answer } from './storage.ts';
export type { Op, ReadOp, Load, Answer } from './storage.ts';

/** A synchronous read batch, optionally recording dependencies for one watch. */
export interface ReadRequest {
  readonly reads: readonly ReadOp[];
  readonly track?: number;
}

/** A mutation batch sharing one logical write timestamp. */
export interface WriteRequest {
  readonly ops: readonly Op[];
  readonly now?: number;
}

/** The identity and dependency owners affected by this particular commit. */
export interface Changes {
  readonly sequence: number;
  readonly touched: number[];
}

export interface WriteResult {
  readonly results: OpResult[];
  readonly changes?: Changes;
}

/** How `transact` commits */
export interface UnitOptions {
  /** On disk when `transact` returns, rather than with the database's next sync */
  durable?: boolean;
}

/** A backend transaction held open across synchronous engine calls. */
export interface EarsUnit {
  write(batch: WriteRequest): WriteResult;
  read(reads: ReadRequest): Answer[];
  savepoint(): number;
  rollbackTo(depth: number): void;
  release(depth: number): void;
  commit(durable?: boolean | null): Changes;
  abort(): void;
  readonly isOpen: boolean;
}

/** An elmdb change to a schema: its path, what changed, and what was done about it */
export interface SchemaChange {
  path: string;
  change: string;
  effect: string;
}

/** The structured storage port used by the engine; each backend owns its wire and persistence codecs. */
export interface EarsDatabase {
  /** Storage format identity for host backup/open policy; opening the actual files still validates them. */
  readonly format: string;
  readonly path: string;
  readonly readOnly: boolean;
  readonly isOpen: boolean;
  /** The schema the database holds, in elmdb's canonical JSON */
  readonly schema: unknown;
  write(batch: WriteRequest, durable?: boolean | null): WriteResult;
  readSync(reads: ReadRequest): Answer[];
  begin(): EarsUnit;
  setSchema(schema: object): SchemaChange[];
  /** Every entry removed but the database's format and schema */
  reset(): void;
  /** A compacted copy of one moment of the database into `target`, which opens as a database of its own */
  backup(target: string): void;
  /** Every entry replaced by another database's primary data, the derived data rebuilt under this one's schema */
  replaceWith(source: string): void;
  stats(): { types: Record<string, { live: number; trashed: number }>; relations: Record<string, number>; fileBytes: number };
  bulkLoad(loads: readonly Load[]): void;
  /** The last commit's sequence, or 0: a number that only increases for as long as the database exists */
  readonly sequence: number;
  /** Drops what the reads tracked under `token` touched (`{ reads, track: token }`) */
  untrack(token: number): void;
  /** How many tokens have tracked reads filed, and how many keys and ranges they hold */
  trackStats(): { owners: number; keys: number; ranges: number };
  durable(): Promise<void>;
  /** Exclusive same-handle maintenance; other async scopes cannot mutate until the owner settles. Reads continue. */
  withExclusiveWrites<T>(operation: () => Promise<T>): Promise<T>;
  /** Observers must not inherit a maintenance caller's authority to mutate a database. */
  withoutWriteAuthority<T>(operation: () => T): T;
  /** Resolves when all current index generations are ready. Call outside write units; rejects if indexing cannot complete. */
  indexesReady(): Promise<void>;
  /** Backend visibility changes after a derived generation commits; no new logical commit is invented. */
  onIndexesChanged?(listener: (changes: Changes) => void): () => void;
  close(): void;
}

/** `value` and everything inside it, frozen */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
  }
  return value;
}

/**
 * The stored values an answer holds, frozen: each row's field values, a field's value and an edge's info. The rows and
 * lists a read builds are the caller's own to change, as they would be in the app
 */
function freezeValues(answer: Answer): Answer {
  const row = (r: unknown) => {
    if (r && typeof r === 'object') for (const value of Object.values(r)) deepFreeze(value);
  };
  if (answer.kind === 'visited') freezeValues(answer.answer as Answer);
  if (answer.kind === 'row') row(answer.row);
  if (answer.kind === 'rows') (answer.rows as unknown[]).forEach(row);
  if (answer.kind === 'hits') for (const hit of answer.hits as Array<{ row?: unknown }>) row(hit.row);
  if (answer.kind === 'field') deepFreeze(answer.value);
  if (answer.kind === 'relation' && answer.relation) deepFreeze((answer.relation as { info?: unknown }).info);
  if (answer.kind === 'relations') for (const relation of answer.relations as Array<{ info?: unknown }>) deepFreeze(relation.info);
  return answer;
}

/** Backend refusal codes that the engine names as an EarsError. */
const CODES: Record<string, EarsErrorCode> = {
  UNKNOWN_TYPE: 'UNKNOWN_ENTITY_TYPE',
  RESERVED_FIELD: 'RESERVED_ATTRIBUTE',
  RESERVED_TYPE: 'RESERVED_ENTITY_TYPE',
  NO_SUCH_ENTITY: 'NO_SUCH_ENTITY',
  NO_SUCH_RELATION: 'NO_SUCH_RELATION',
  ID_IN_USE: 'ID_IN_USE',
  TYPE_MISMATCH: 'TYPE_MISMATCH',
  NOT_A_LIST: 'NOT_A_LIST',
  UNKNOWN_RELATION_KIND: 'UNKNOWN_RELATION_KIND',
  UNKNOWN_ROLE: 'UNKNOWN_ROLE',
  REQUIRED_FIELD: 'REQUIRED_FIELD',
  INVALID_SHORT_CODE: 'INVALID_SHORT_CODE',
  SHORT_CODE_IN_USE: 'SHORT_CODE_IN_USE',
  SELF_LINK: 'SELF_LINK',
  CYCLE: 'CYCLE',
  VALUE_INVALID: 'VALUE_INVALID',
  UNKNOWN_INDEX: 'UNKNOWN_INDEX',
  INDEX_BUILDING: 'INDEX_BUILDING',
  INDEX_FAILED: 'INDEX_FAILED',
  FIELD_TYPE: 'FIELD_TYPE',
  PATTERN_INVALID: 'PATTERN_INVALID',
};

/**
 * Runs `fn`, a backend call, rethrowing a refusal the engine names as an `EarsError`; other storage errors
 * (including COMMIT_UNKNOWN, a full disk or a closed database) retain their original codes and causes
 */
export function crossing<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    const mapped = typeof code === 'string' ? CODES[code] : undefined;
    if (mapped) throw new EarsError(mapped, (error as Error).message);
    throw error;
  }
}

/** Reports committed state before returning or rethrowing a failed sync. A refusal before commit does not notify.
 * A failed refresh after NOT_DURABLE preserves both errors and the committed-outcome code; ordinary refresh errors
 * propagate without being mistaken for operation failures. */
export function runCommitted<T>(operation: () => T, notify: () => void): T {
  let result: T;
  try {
    result = operation();
  } catch (error) {
    if ((error as { code?: unknown })?.code === 'NOT_DURABLE') {
      try { notify(); }
      catch (notification) {
        throw Object.assign(new AggregateError([error, notification],
          'The operation committed but failed to sync, and refreshing committed state also failed', { cause: error }),
        { code: 'NOT_DURABLE' });
      }
    }
    throw error;
  }
  notify();
  return result;
}

/** One answer of a batch */
export type OpResult = { kind: 'done' } | { kind: 'entity'; id: string; shortCode: string | null; created: boolean }
  | { kind: 'relation'; id: string; linked: boolean } | { kind: 'label'; label: string } | { kind: 'stale' };

/**
 * A commit, as a commit listener hears it: its sequence, and the tokens whose tracked reads it wrote into, or `all` for
 * one whose writes aren't known key by key (an emptied or replaced database, a schema change, a load)
 */
export interface Commit {
  readonly sequence: number;
  readonly touched: ReadonlySet<number> | 'all';
}

/** The engine's crossing to its database: reads and writes, in the unit `transact` holds open or each its own */
export interface Connection {
  read(reads: readonly ReadOp[]): Answer[];
  write(ops: readonly Op[], now?: number): OpResult[];
  /** Unchecked loads, one durable unit of their own (`Database.bulkLoad`); refused while a unit is open */
  load(loads: readonly Load[]): void;
  transact<T>(fn: () => T, options?: UnitOptions): T;
  /** Whether `transact` holds a unit open */
  readonly inUnit: boolean;
  readonly database: EarsDatabase;
  /** Runs `fn` with every read it makes tracked under `token`, adding what they touch to what the token holds */
  track<T>(token: number, fn: () => T): T;
  untrack(token: number): void;
  trackStats(): { keys: number; ranges: number };
  /**
   * Calls `listener` for logical commits and committed derived-index visibility changes, with affected tokens.
   * Derived visibility reuses the current logical sequence. Returns the unregistration.
   */
  onCommit(listener: (commit: Commit) => void): () => void;
  /** Tells the commit listeners of a commit made past the connection, whose writes aren't known key by key */
  committedEverything(): void;
  /** The last commit's sequence, or 0 */
  lastCommit(): number;
  /** Counting the calls this connection makes, off until started */
  readonly calls: CallCounting;
  /** The count being kept, while counting runs: what the watch scheduler records each watch's runs into */
  tally(): CallTally | undefined;
}

export function createConnection(database: EarsDatabase, { freeze = false }: { freeze?: boolean } = {}): Connection {
  /**
   * The units `transact` is inside, outermost first. elmdb's unit opens at the first write, so a unit that writes
   * nothing commits nothing, and a read before it sees what a snapshot would; each level inside the outermost is a
   * savepoint of it, taken then or as the level begins, whichever is later. A level `kept` a write when one landed in
   * it or a level inside it that returned, so an outermost one that kept none aborts its unit rather than commit it
   */
  const levels: Array<{ savepoint?: number; kept?: boolean }> = [];
  let unit: EarsUnit | undefined;
  /** The token the reads being made are tracked under, while `track` runs */
  let tracking: number | undefined;
  const listeners = new Set<(commit: Commit) => void>();
  let unlistenIndexes: (() => void) | undefined;
  /** Calls every commit listener; a listener's throw is reported, not handed to the writer */
  const committed = (commit: Commit) => database.withoutWriteAuthority(() => {
    for (const listener of listeners) {
      try {
        listener(commit);
      } catch (error) {
        queueMicrotask(() => { throw error; });
      }
    }
  });
  const heard = (changes: { sequence: number; touched: number[] }) => {
    if (listeners.size > 0) committed({ sequence: changes.sequence, touched: new Set(changes.touched) });
  };

  /** The count being kept while counting runs, and the unit it is counting until that commits or aborts */
  let tally: CallTally | undefined;
  let counted: { site: string; writes: number; ops: number; ms: number } | undefined;
  /** What `transact`'s outermost level counted, once its unit ends: a unit that wrote nothing opened none */
  const unitEnded = () => {
    if (tally && counted && counted.writes > 0) tally.record('unit', counted.site, false, counted.ops, counted.ms, counted.writes);
    counted = undefined;
  };
  /** Runs `fn`, adding its time to the unit being counted */
  const timedInUnit = <T>(fn: () => T): T => {
    const into = counted;
    if (!into) return fn();
    const start = performance.now();
    try {
      return fn();
    } finally {
      into.ms += performance.now() - start;
    }
  };

  /** The open unit, opened now for a write when none is */
  const writable = (): EarsUnit => {
    if (unit) return unit;
    const opened = crossing(() => database.begin());
    unit = opened;
    for (const level of levels.slice(1)) level.savepoint = crossing(() => opened.savepoint());
    return opened;
  };

  function transact<T>(fn: () => T, options?: UnitOptions): T {
    const level: { savepoint?: number; kept?: boolean } = {};
    const outermost = levels.length === 0;
    if (outermost && tally) counted = { site: callSite(), writes: 0, ops: 0, ms: 0 };
    if (!outermost && unit) {
      const held = unit;
      level.savepoint = crossing(() => held.savepoint());
    }
    levels.push(level);
    let value: T;
    try {
      value = fn();
      if (value !== null && typeof value === 'object' && typeof (value as { then?: unknown }).then === 'function') {
        // The body has already started and cannot be stopped; what it does after its first await lands outside any
        // unit. Its own rejection is handled here so it isn't an unhandled one: the refusal is the report
        (value as unknown as PromiseLike<unknown>).then(undefined, () => {});
        throw new Error('transact() takes a synchronous function: an await inside it would split the unit');
      }
    } catch (error) {
      levels.pop();
      const held = unit;
      if (outermost) {
        unit = undefined;
        if (held?.isOpen) timedInUnit(() => held.abort());
        unitEnded();
      } else if (held?.isOpen && level.savepoint !== undefined) {
        held.rollbackTo(level.savepoint);
      }
      throw error;
    }
    levels.pop();
    const held = unit;
    if (!outermost) {
      // A unit inside another commits with the outermost
      if (held && level.savepoint !== undefined) crossing(() => held.release(level.savepoint!));
      if (level.kept) levels.at(-1)!.kept = true;
      return value;
    }
    unit = undefined;
    if (!held) {
      unitEnded();
      return value;
    }
    if (!level.kept) {
      // Every write it held was rolled back with a level that threw
      timedInUnit(() => held.abort());
      unitEnded();
      return value;
    }
    try {
      // The unit's deferred checks run as it commits; one that fails aborts it
      const changes = timedInUnit(() => crossing(() => held.commit(options?.durable ?? false)));
      unitEnded();
      heard(changes as { sequence: number; touched: number[] });
    } catch (error) {
      const open = held.isOpen;
      if (open) held.abort();
      unitEnded();
      // A durable commit whose sync failed was made all the same, and its change set didn't cross with the error
      if (!open && (error as { code?: unknown })?.code === 'NOT_DURABLE') committed({ sequence: database.sequence, touched: 'all' });
      throw error;
    }
    return value;
  }

  /** A read's or a write's call, counted when counting runs */
  function counting<T>(kind: 'read' | 'write', ops: number, fn: () => T): T {
    if (!tally) return fn();
    // A write inside a unit is the unit's, counted with it; one inside a unit begun before counting is not counted
    const inUnit = kind === 'write' && levels.length > 0;
    const site = inUnit ? undefined : callSite();
    const start = performance.now();
    try {
      return fn();
    } finally {
      const ms = performance.now() - start;
      if (site !== undefined) tally?.record(kind, site, tracking !== undefined, ops, ms);
      else if (counted) {
        counted.writes += 1;
        counted.ops += ops;
        counted.ms += ms;
      }
    }
  }

  /** The report `stop` answered, which `report` repeats until counting starts again */
  let stopped: CallReport | undefined;
  const calls: CallCounting = {
    start() {
      tally = createCallTally();
      stopped = undefined;
      // A unit begun before this count started isn't the count's, as one begun before counting at all isn't
      counted = undefined;
    },
    report: () => tally?.report(true) ?? stopped ?? createCallTally().report(false),
    stop() {
      stopped = (tally ?? createCallTally()).report(false);
      tally = undefined;
      counted = undefined;
      return stopped;
    },
  };

  return {
    read(reads) {
      return counting('read', reads.length, () => {
        const request: ReadRequest = tracking === undefined ? { reads } : { reads, track: tracking };
        const held = unit;
        const answers = crossing(() => (held ? held.read(request) : database.readSync(request)));
        return freeze ? answers.map(freezeValues) : answers;
      });
    },
    write(ops, now = Date.now()) {
      const written = counting('write', ops.length, () => {
        const request = { ops, now };
        const target = levels.length ? writable() : undefined;
        const answer = crossing(() => (target ? target.write(request) : database.write(request, false)));
        if (target) levels.at(-1)!.kept = true;
        return answer;
      });
      if (written.changes) heard(written.changes);
      return written.results;
    },
    load(loads) {
      runCommitted(
        () => crossing(() => database.bulkLoad(loads)),
        () => committed({ sequence: database.sequence, touched: 'all' }),
      );
    },
    transact,
    get inUnit() { return levels.length > 0; },
    database,
    track(token, fn) {
      const outer = tracking;
      tracking = token;
      try {
        return fn();
      } finally {
        tracking = outer;
      }
    },
    untrack: (token) => database.untrack(token),
    trackStats: () => {
      const { keys, ranges } = database.trackStats();
      return { keys, ranges };
    },
    onCommit(listener) {
      if (!listeners.size) unlistenIndexes = database.onIndexesChanged?.(heard);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) { unlistenIndexes?.(); unlistenIndexes = undefined; }
      };
    },
    committedEverything: () => committed({ sequence: database.sequence, touched: 'all' }),
    lastCommit: () => database.sequence,
    calls,
    tally: () => tally,
  };
}
