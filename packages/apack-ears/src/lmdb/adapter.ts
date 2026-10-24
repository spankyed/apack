import type { TransactionFlags } from 'lmdb';
import type { LmdbDbs } from './envs.ts';
import type { PersistenceSink } from '../runtime.ts';

type Encoded = { t: string; v: any };

function enc(value: unknown): Encoded {
  if (value instanceof Date) return { t: 'date', v: value.toISOString() };
  const t = value === null ? 'null'
    : Array.isArray(value) ? 'array'
    : typeof value === 'object' ? 'object'
    : typeof value; // string|number|boolean|undefined
  return { t, v: value };
}

// Use same separator throughout for consistency
const SEP = '\x1F';

/** An attribute's row: one per `(kind, entityId)`, holding its one value */
function attrKey(kind: string, entityId: string) {
  validateKey(kind, 'kind');
  validateKey(entityId, 'entityId');
  return `${kind}${SEP}${entityId}`;
}

function validateKey(value: string, name: string) {
  if (value.includes(SEP)) {
    throw new Error(`Invalid ${name}: contains forbidden separator character \\x1F`);
  }
}

/** The attribute kinds stored in `attrs`: keys sort by kind, so each lookup skips past the kind before it */
function* storedKinds(attrs: LmdbDbs['attrs']): Iterable<string> {
  let start = '';
  for (;;) {
    const [key] = attrs.getKeys({ start, limit: 1 }) as Iterable<string>;
    if (key === undefined) return;
    const kind = String(key).split(SEP)[0];
    yield kind;
    // Past every `kind␟…` key (ids sort below \xFF)
    start = `${kind}${SEP}\xFF`;
  }
}

/**
 * How a unit commits: synchronously, so it is visible to every reader when the call returns and survives the app
 * crashing, but without waiting for the disk to flush, which the store does in the background (`openLmdbStore`).
 * `ABORTABLE | SYNCHRONOUS_COMMIT | NO_SYNC_FLUSH`, lmdb-js's `TransactionFlags`.
 */
const COMMIT_WITHOUT_FLUSH = 0x10003 as TransactionFlags;

/** Refuses a relation end that names no entity id: the unit it is in stores nothing */
function requireEnd(relId: string, end: string, value: unknown): asserts value is string {
  if (typeof value !== 'string' || value === '' || value === 'undefined' || value === 'null' || !value.includes('-')) {
    throw new Error(`Relation ${relId}: its ${end} ${JSON.stringify(value)} is not an entity id`);
  }
}

/**
 * The LMDB sink: each unit (`onUnitStart` to `onUnitEnd`) is one transaction, committed when `onUnitEnd` returns, or
 * a throw, having stored none of it — which the engine answers by undoing the unit in memory. Its writes run in the
 * order they were made, so a unit that destroys an entity and creates its id again stores the second. A call made
 * outside a unit commits on its own. `onCommit` hears every commit, for the store's background sync.
 */
export function makeLmdbAdapter(dbs: LmdbDbs, onCommit: () => void = () => {}): Required<PersistenceSink> {
  const { root, entities, attrs, relations } = dbs;
  /** The open unit's writes, or none outside one */
  let unit: Array<() => void> | null = null;

  const commit = (steps: Array<() => void>) => {
    // Each step has a block body: a step returning lmdb's put promise would turn the transaction asynchronous
    root.transactionSync(() => {
      for (const step of steps) step();
    }, COMMIT_WITHOUT_FLUSH);
    onCommit();
  };
  const write = (step: () => void) => {
    if (unit) unit.push(step);
    else commit([step]);
  };

  /** An entity's row and its attributes, one row per kind (keys are kind␟id); its relations went before */
  function removeEntityRows(entityId: string): void {
    entities.remove(entityId);
    // `storedKinds` reads the store this loop removes from, so it is materialised first: an lmdb range is a live
    // cursor the body would invalidate
    // eslint-disable-next-line no-useless-spread -- a range is a live cursor, read whole before it is removed from
    for (const kind of [...storedKinds(attrs)]) attrs.remove(attrKey(kind, entityId));
  }

  return {
    onUnitStart() {
      // A unit that threw part way left its writes here; they are not this one's
      unit = [];
    },
    onUnitEnd() {
      const steps = unit ?? [];
      unit = null;
      if (steps.length > 0) commit(steps);
    },
    onCreateEntity(entityId: string, type: string) {
      write(() => { entities.put(entityId, { type }); });
    },
    // Its relations were removed before this, each with onRemoveRelation
    onDestroyEntity(entityId: string) {
      write(() => { removeEntityRows(entityId); });
    },
    onPutAttr(kind: string, entityId: string, value: unknown) {
      const key = attrKey(kind, entityId);
      write(() => { attrs.put(key, enc(value)); });
    },
    onDropAttr(kind: string, entityId: string) {
      const key = attrKey(kind, entityId);
      write(() => { attrs.remove(key); });
    },
    onAddRelation(relId: string, kind: string, source: string, target: string, info: unknown) {
      requireEnd(relId, 'source', source);
      requireEnd(relId, 'target', target);
      write(() => {
        // A relation written again keeps when it was first stored
        const createdAt = (relations.get(relId) as { createdAt?: number } | undefined)?.createdAt ?? Date.now();
        relations.put(relId, { kind, src: source, tgt: target, info: info ?? null, createdAt });
      });
    },
    onUpdateRelation(relId: string, patch: { source?: string; target?: string; info?: unknown }) {
      if (patch.source !== undefined) requireEnd(relId, 'source', patch.source);
      if (patch.target !== undefined) requireEnd(relId, 'target', patch.target);
      write(() => {
        // Read inside the transaction, so a relation added earlier in the same unit is found
        const stored = relations.get(relId) as { src: string; tgt: string; info: unknown } | undefined;
        if (!stored) throw new Error(`Relation ${relId}: updated, but no relation has the id`);
        relations.put(relId, {
          ...stored,
          ...(patch.source !== undefined && { src: patch.source }),
          ...(patch.target !== undefined && { tgt: patch.target }),
          ...('info' in patch && { info: patch.info ?? null }),
        });
      });
    },
    onRemoveRelation(relId: string) {
      write(() => { relations.remove(relId); });
    },
    close() {},
  };
}
