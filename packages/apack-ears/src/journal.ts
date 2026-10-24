// What makes `transact` a transaction: while a unit is open, every write first records how to undo itself, and
// the sink calls it makes are held rather than sent. A unit that returns sends them, and keeps its undos until the
// sink has committed them: a sink that refuses runs them in reverse, so memory never holds what the sink did not
// take. One that throws runs the undos and sends nothing. A write made outside any unit is a unit of its own (`unit`).
import type { PersistenceSink } from './runtime.ts';

/** One open unit: the keys it has recorded an undo for, the undos, where its sink calls start, and its checks */
interface Level {
  seen: Set<string>;
  undos: Array<() => void>;
  sinkMark: number;
  checks: Array<() => void>;
  /** What runs once the unit's writes are stored */
  after: Array<() => void>;
  /** Whether the unit, or one inside it, asked to be on disk when it commits */
  durable: boolean;
}

/** An engine's unit of work, shared by the stores that write */
export interface Journal {
  /** Whether a unit is open: a writer checks it before building a key, so writes outside a unit cost nothing */
  readonly open: boolean;
  /**
   * Records how to undo a change about to be made to `key`. `capture` runs only inside a unit and only on the
   * first change to that key in the innermost unit, before the change, and returns the undo.
   */
  touch(key: string, capture: () => () => void): void;
  /**
   * Runs `check` when the outermost unit commits, before anything reaches the sink — at once outside a unit, where
   * a write is its own unit. A check that throws rolls the whole unit back. This is a deferred constraint: what a
   * unit leaves inconsistent part way is allowed, what it commits is not.
   */
  atCommit(check: () => void): void;
  /** Runs `fn` inside the open unit, or as a unit of its own when none is open: what every write is made through */
  unit<T>(fn: () => T): T;
  /**
   * Runs `fn` once the outermost unit's writes are stored — at once outside a unit — and never when the unit rolls
   * back: for what may only follow a commit, such as letting memory forget a value the files now hold
   */
  afterCommit(fn: () => void): void;
}

/**
 * `writes` with each of the named methods made through `journal.unit`: a write the caller makes outside `transact`
 * is then a unit of its own, stored whole or not at all, and one inside a unit joins it
 */
export function unitWrites<T extends object, K extends keyof T>(journal: Pick<Journal, 'unit'>, writes: T, names: readonly K[]): T {
  const wrapped = { ...writes };
  for (const name of names) {
    const write = writes[name] as unknown as (...args: unknown[]) => unknown;
    (wrapped as Record<K, unknown>)[name] = (...args: unknown[]) => journal.unit(() => write(...args));
  }
  return wrapped;
}

/** Who hears where the outermost unit is: it began, it committed (its after-commit work done), or it rolled back */
export interface UnitHooks {
  unitStarted(): void;
  unitCommitted(): void;
  unitRolledBack(): void;
}

const NO_HOOKS: UnitHooks = { unitStarted() {}, unitCommitted() {}, unitRolledBack() {} };

/** A journal, and the sink that holds an open unit's calls back from `sink` */
export function createJournal(sink: PersistenceSink, hooks: UnitHooks = NO_HOOKS) {
  const levels: Level[] = [];
  const held: Array<() => void> = [];

  const journal: Journal = {
    get open() { return levels.length > 0; },
    touch(key, capture) {
      const level = levels[levels.length - 1];
      if (!level || level.seen.has(key)) return;
      level.seen.add(key);
      level.undos.push(capture());
    },
    atCommit(check) {
      const level = levels[levels.length - 1];
      if (level) level.checks.push(check);
      else check();
    },
    unit: (fn) => (levels.length > 0 ? fn() : transact(fn)),
    afterCommit(fn) {
      const level = levels[levels.length - 1];
      if (level) level.after.push(fn);
      else fn();
    },
  };

  // A held call copies an array it carries: the caller who wrote it may still change it before the unit commits
  const hold = <A extends unknown[]>(write: (...args: A) => void) => (...args: A): void => {
    if (levels.length === 0) return write(...args);
    const copied = args.map((arg) => (Array.isArray(arg) ? [...arg] : arg)) as A;
    held.push(() => write(...copied));
  };

  /** `sink`, except that its writes wait for the outermost unit to commit */
  const unitSink: PersistenceSink = {
    onCreateEntity: hold((...args) => sink.onCreateEntity(...args)),
    onDestroyEntity: hold((...args) => sink.onDestroyEntity(...args)),
    onDropAttr: hold((...args) => sink.onDropAttr(...args)),
    onPutAttr: hold((...args) => sink.onPutAttr(...args)),
    onAddRelation: hold((...args) => sink.onAddRelation(...args)),
    onUpdateRelation: hold((...args) => sink.onUpdateRelation(...args)),
    onRemoveRelation: hold((...args) => sink.onRemoveRelation(...args)),
    onUnitStart: () => sink.onUnitStart(),
    onUnitEnd: (options) => sink.onUnitEnd(options),
    close: sink.close && (() => sink.close?.()),
  };

  /**
   * Runs `fn` as one unit; a unit inside another commits into it and rolls back only its own writes. A `durable` unit
   * makes the outermost one it is in durable
   */
  function transact<T>(fn: () => T, { durable = false }: { durable?: boolean } = {}): T {
    const level: Level = { seen: new Set(), undos: [], sinkMark: held.length, checks: [], after: [], durable };
    if (levels.length === 0) hooks.unitStarted();
    levels.push(level);
    let result: T;
    try {
      result = fn();
      if (result !== null && typeof result === 'object' && typeof (result as { then?: unknown }).then === 'function') {
        // The body has already started and cannot be stopped; what it does after its first await lands outside
        // any unit. Its own rejection is handled here so it isn't an unhandled one: the refusal is the report
        (result as unknown as PromiseLike<unknown>).then(undefined, () => {});
        throw new Error('transact() takes a synchronous function: an await inside it would split the unit');
      }
      // The outermost unit is what commits, so it is where the unit's checks run; an inner one hands them up
      if (levels.length === 1) for (const check of level.checks) check();
    } catch (error) {
      levels.pop();
      for (let i = level.undos.length - 1; i >= 0; i--) level.undos[i]();
      held.length = level.sinkMark;
      if (levels.length === 0) hooks.unitRolledBack();
      throw error;
    }
    levels.pop();
    const parent = levels[levels.length - 1];
    if (parent) {
      // The parent can still roll back, to before this unit and before its own earlier writes: this unit's
      // undos restore what it found, and run before the parent's earlier ones
      parent.undos.push(...level.undos);
      parent.checks.push(...level.checks);
      parent.after.push(...level.after);
      parent.durable ||= level.durable;
      for (const key of level.seen) parent.seen.add(key);
      return result;
    }
    const calls = held.splice(0);
    if (calls.length) {
      try {
        sink.onUnitStart();
        for (const call of calls) call();
        sink.onUnitEnd(level.durable ? { durable: true } : undefined);
      } catch (error) {
        // The sink refused the unit: memory goes back to what the sink holds
        for (let i = level.undos.length - 1; i >= 0; i--) level.undos[i]();
        hooks.unitRolledBack();
        throw error;
      }
    }
    for (const fn of level.after) fn();
    hooks.unitCommitted();
    return result;
  }

  return { journal, unitSink, transact };
}
