import type { TransactionFlags } from 'lmdb';
import type { EntityRecord, LmdbDbs } from './envs.ts';
import type { PersistenceSink } from '../runtime.ts';
import { isLarge, sizeOf } from '../values.ts';

/** The key a large value is kept under in `values`: its attribute kind, then its entity */
const SEP = '\x1F';
export const valueKey = (kind: string, entityId: string) => {
  if (kind.includes(SEP)) throw new Error('Invalid kind: contains forbidden separator character \\x1F');
  if (entityId.includes(SEP)) throw new Error('Invalid entityId: contains forbidden separator character \\x1F');
  return `${kind}${SEP}${entityId}`;
};

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
 * The LMDB sink (format 4): each unit (`onUnitStart` to `onUnitEnd`) is one transaction, committed when `onUnitEnd`
 * returns, or a throw, having stored none of it — which the engine answers by undoing the unit in memory. A unit's
 * writes edit working copies of the entity records they touch, in the order they were made, and each record is put
 * once as the unit commits. A large value (`isLarge`) is kept in `values` and marked in its record. A call made
 * outside a unit commits on its own. `onCommit` hears every commit, for the store's background sync.
 */
export function makeLmdbAdapter(dbs: LmdbDbs, onCommit: () => void = () => {}): Required<PersistenceSink> {
  const { root, rows, values, relationRows } = dbs;
  /** The open unit's writes, or none outside one */
  let unit: Array<() => void> | null = null;
  /** The entity records the running commit has changed, or null for one it removed */
  let working: Map<string, EntityRecord | null> | null = null;

  /** An entity's record as the running commit has it, a copy to change */
  const recordOf = (id: string): EntityRecord => {
    const changed = working!.get(id);
    if (changed) return changed;
    const stored = changed === null ? undefined : rows.get(id);
    const record: EntityRecord = stored
      ? { type: stored.type, fields: [...stored.fields], outOfLine: [...stored.outOfLine] }
      // Attributes written to an id no entity was created with: kept, under no type, as format 3 kept them
      : { type: null, fields: [], outOfLine: [] };
    working!.set(id, record);
    return record;
  };
  const dropField = (record: EntityRecord, id: string, kind: string) => {
    record.fields = record.fields.filter(([k]) => k !== kind);
    if (record.outOfLine.some(([k]) => k === kind)) {
      record.outOfLine = record.outOfLine.filter(([k]) => k !== kind);
      values.remove(valueKey(kind, id));
    }
  };

  const commit = (steps: Array<() => void>) => {
    // Each step has a block body: a step returning lmdb's put promise would turn the transaction asynchronous
    root.transactionSync(() => {
      working = new Map();
      try {
        for (const step of steps) step();
        for (const [id, record] of working) {
          if (record) rows.put(id, record);
          else rows.remove(id);
        }
      } finally {
        working = null;
      }
    }, COMMIT_WITHOUT_FLUSH);
    onCommit();
  };
  const write = (step: () => void) => {
    if (unit) unit.push(step);
    else commit([step]);
  };

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
      write(() => { working!.set(entityId, { type, fields: [], outOfLine: [] }); });
    },
    // Its relations were removed before this, each with onRemoveRelation
    onDestroyEntity(entityId: string) {
      write(() => {
        const record = recordOf(entityId);
        for (const [kind] of record.outOfLine) values.remove(valueKey(kind, entityId));
        working!.set(entityId, null);
      });
    },
    onPutAttr(kind: string, entityId: string, value: unknown) {
      const key = valueKey(kind, entityId);
      write(() => {
        const record = recordOf(entityId);
        dropField(record, entityId, kind);
        if (isLarge(value)) {
          values.put(key, value);
          record.outOfLine.push([kind, sizeOf(value), Array.isArray(value) ? value.length : null]);
        } else {
          record.fields.push([kind, value]);
        }
      });
    },
    onDropAttr(kind: string, entityId: string) {
      valueKey(kind, entityId);
      write(() => { dropField(recordOf(entityId), entityId, kind); });
    },
    onAddRelation(relId: string, kind: string, source: string, target: string, info: unknown) {
      requireEnd(relId, 'source', source);
      requireEnd(relId, 'target', target);
      write(() => {
        // A relation written again keeps when it was first stored
        const createdAt = relationRows.get(relId)?.createdAt ?? Date.now();
        relationRows.put(relId, { kind, source, target, info: info ?? null, createdAt });
      });
    },
    onUpdateRelation(relId: string, patch: { source?: string; target?: string; info?: unknown }) {
      if (patch.source !== undefined) requireEnd(relId, 'source', patch.source);
      if (patch.target !== undefined) requireEnd(relId, 'target', patch.target);
      write(() => {
        // Read inside the transaction, so a relation added earlier in the same unit is found
        const stored = relationRows.get(relId);
        if (!stored) throw new Error(`Relation ${relId}: updated, but no relation has the id`);
        relationRows.put(relId, {
          ...stored,
          ...(patch.source !== undefined && { source: patch.source }),
          ...(patch.target !== undefined && { target: patch.target }),
          ...('info' in patch && { info: patch.info ?? null }),
        });
      });
    },
    onRemoveRelation(relId: string) {
      write(() => { relationRows.remove(relId); });
    },
    readAttr(kind: string, entityId: string) {
      const large = values.get(valueKey(kind, entityId));
      if (large !== undefined) return large;
      return rows.get(entityId)?.fields.find(([k]) => k === kind)?.[1];
    },
    close() {},
  };
}
