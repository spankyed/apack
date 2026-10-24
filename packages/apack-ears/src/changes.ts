// What a commit changed, and what a subscription read. Every write in a unit names what it touched — the entity, its
// type, the attribute kind, a relation's kind and ends — and the outermost commit publishes them as one change set. A
// subscription's read names the same things as it reads them; it runs again when a commit's change set meets them,
// and calls back only when its result is no longer the same value.
import type { EARS } from './entities.ts';
import { sameValue } from './utils.ts';

/** What one commit changed: the outermost unit's writes, or the whole of the data (`replaced`) */
export interface ChangeSet {
  /** Entities written, created or destroyed, and the ends of every relation added, changed or removed */
  readonly entities: ReadonlySet<EARS.EntityId>;
  /** The types of those entities */
  readonly types: ReadonlySet<string>;
  /** Attribute kinds written */
  readonly kinds: ReadonlySet<string>;
  /** Relations added, changed or removed, and their kinds */
  readonly relations: ReadonlySet<EARS.RelationId>;
  readonly relationKinds: ReadonlySet<string>;
  /** The data was replaced whole (emptied, or loaded again): every read may have changed */
  readonly replaced: boolean;
}

/** What a read touched, in the same terms */
interface Reads {
  entities: Set<EARS.EntityId>;
  types: Set<string>;
  kinds: Set<string>;
  relations: Set<EARS.RelationId>;
  relationKinds: Set<string>;
  /** It listed every entity, or every relation */
  everything: boolean;
}

/** The open unit's writes, gathering */
interface Pending {
  entities: Set<EARS.EntityId>;
  types: Set<string>;
  kinds: Set<string>;
  relations: Set<EARS.RelationId>;
  relationKinds: Set<string>;
}

const newReads = (): Reads => ({ entities: new Set(), types: new Set(), kinds: new Set(), relations: new Set(), relationKinds: new Set(), everything: false });
const newPending = (): Pending => ({ entities: new Set(), types: new Set(), kinds: new Set(), relations: new Set(), relationKinds: new Set() });

const meets = <V>(a: ReadonlySet<V>, b: ReadonlySet<V>) => {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const v of small) if (large.has(v)) return true;
  return false;
};

/** Whether a commit's changes can have changed what a read read */
function affects(changes: ChangeSet, reads: Reads): boolean {
  if (changes.replaced || reads.everything) return true;
  return meets(changes.entities, reads.entities) || meets(changes.types, reads.types) || meets(changes.kinds, reads.kinds)
    || meets(changes.relations, reads.relations) || meets(changes.relationKinds, reads.relationKinds);
}

/** An engine's change sets and subscriptions: the writes and reads report here, and the journal says when a unit ends */
export function createChangeTracking(entityTypeOf: (id: EARS.EntityId) => string) {
  /** The open unit's writes, null outside a unit: a bulk load or an undo outside one is not a change */
  let pending: Pending | null = null;
  /** The reads the running subscription makes, null when none is reading */
  let reading: Reads | null = null;
  const subscriptions = new Set<{ reads: Reads; run: () => void }>();
  const listeners = new Set<(changes: ChangeSet) => void>();
  /** Change sets published while subscribers ran, published in turn once they return */
  const queue: ChangeSet[] = [];
  let publishing = false;

  const wroteEntity = (id: EARS.EntityId) => {
    if (!pending) return;
    pending.entities.add(id);
    pending.types.add(entityTypeOf(id));
  };

  const publish = (changes: ChangeSet) => {
    queue.push(changes);
    if (publishing) return;
    publishing = true;
    try {
      for (let next = queue.shift(); next; next = queue.shift()) {
        // Copies, since a listener or subscriber may subscribe or stop while these are walked
        for (const listener of Array.from(listeners)) listener(next);
        for (const subscription of Array.from(subscriptions)) {
          if (subscriptions.has(subscription) && affects(next, subscription.reads)) subscription.run();
        }
      }
    } finally {
      publishing = false;
    }
  };

  return {
    // ─── Writes, and the journal's unit ─────────────────────────────────────
    /** A unit has begun: what is written from here is its change set */
    unitStarted() { pending ??= newPending(); },
    /** The outermost unit committed: its change set is published */
    unitCommitted() {
      const done = pending;
      pending = null;
      if (done && (done.entities.size > 0 || done.relations.size > 0)) publish({ ...done, replaced: false });
    },
    /** The outermost unit rolled back: nothing it wrote happened */
    unitRolledBack() { pending = null; },
    wroteAttribute(id: EARS.EntityId, kind: string) {
      if (!pending) return;
      wroteEntity(id);
      pending.kinds.add(kind);
    },
    wroteRelation(relId: EARS.RelationId, ...rows: Array<{ kind: string; source: EARS.EntityId; target: EARS.EntityId } | undefined>) {
      if (!pending) return;
      pending.relations.add(relId);
      for (const row of rows) {
        if (!row) continue;
        pending.relationKinds.add(row.kind);
        wroteEntity(row.source);
        wroteEntity(row.target);
      }
    },
    /** The data was replaced whole: every subscription reads again */
    replaced() { publish({ ...newPending(), replaced: true }); },

    // ─── Reads ──────────────────────────────────────────────────────────────
    readEntity(id: EARS.EntityId) { reading?.entities.add(id); },
    readType(type: string) { reading?.types.add(type); },
    readKind(kind: string) { reading?.kinds.add(kind); },
    readRelation(relId: EARS.RelationId) { reading?.relations.add(relId); },
    readRelationKind(kind: string) { reading?.relationKinds.add(kind); },
    readEverything() { if (reading) reading.everything = true; },

    // ─── Who hears ──────────────────────────────────────────────────────────
    /** Calls `listener` with each commit's change set; returns what stops it */
    onCommit(listener: (changes: ChangeSet) => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    /**
     * Calls `onChange` with what `read` returns, now and after every commit that changes it: `read` runs again when a
     * commit wrote something it read, and `onChange` is called only when the result is not the same value as before
     * (`sameValue`). Returns what stops it.
     */
    subscribe<T>(read: () => T, onChange: (value: T) => void): () => void {
      let last: T;
      const subscription = {
        reads: newReads(),
        run: () => {
          const outer = reading;
          const reads = newReads();
          reading = reads;
          let value: T;
          try {
            value = read();
          } finally {
            reading = outer;
          }
          subscription.reads = reads;
          if (!first && sameValue(value, last)) return;
          first = false;
          last = value;
          onChange(value);
        },
      };
      let first = true;
      subscription.run();
      subscriptions.add(subscription);
      return () => { subscriptions.delete(subscription); };
    },
  };
}

export type ChangeTracking = ReturnType<typeof createChangeTracking>;
