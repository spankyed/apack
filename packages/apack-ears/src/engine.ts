// An EARS engine: its stores, indexes and caches, and the operations over them as the engine's own members, with the
// creator's privileges beside them in `admin`. A program is handed the engine typed as `Ears`, which has no `admin`:
// the faces define the contract, not a security boundary (packs run in-process).
import { createChangeTracking, type ChangeSet } from './changes.ts';
import type { EARS } from './entities.ts';
import { noopSink, type EARSRuntimeDeps } from './runtime.ts';
import { createAttributeStorage, entityTypeOf, type EntityRow, type MemoryStats, type SchemaStats } from './attribute-storage.ts';
import { createQuery, type Query } from './query.ts';
import { createHierarchy } from './hierarchy.ts';
import { createWrites, type Create, type Upsert, type Write } from './write.ts';
import { createEntityCounters } from './numbering.ts';
import { createRelations, type RelationMatch, type RelationRow } from './relations.ts';
import { createJournal, unitWrites } from './journal.ts';
import { createNameChecks } from './names.ts';

/** How a unit (`transact`) commits */
export interface TransactOptions {
  /**
   * The unit is on disk when `transact` returns, so it survives the machine losing power, not only the app crashing:
   * the commit waits for the disk, and so costs a sync. A durable unit inside another makes the outer one durable
   */
  durable?: boolean;
}

/** An engine's operations — its queries, writes and transactions: what a program is handed */
export interface Ears {
  /** Queries the engine, untyped (a pack's `#generated/ears` types it) */
  query: Query;
  /** Creates an entity of a registered type, with a new id or the one given */
  create: Create;
  /** Writes to the entity with an id, creating it as the type when no entity has it */
  upsert: Upsert;
  /** Writes to the entity with an id, which must exist */
  write: Write;
  /**
   * Runs `fn` as one unit: if it throws, every write it made is undone and none reaches persistence; if it
   * returns, persistence receives them together. Reads inside see its own writes. `fn` must be synchronous,
   * and a unit inside another commits into it.
   */
  transact<T>(fn: () => T, options?: TransactOptions): T;
  /**
   * Resolves once every write that has returned is on disk. A write survives the app crashing when it returns, and
   * the machine losing power within about a second (the store's background sync); a caller that needs the second
   * at once waits for this, or writes in a `durable` unit. With no store behind the engine it resolves at once.
   */
  durable(): Promise<void>;
  /**
   * Calls `onChange` with what `read` returns, now and after every commit that changes it: `read` runs again when a
   * commit wrote an entity, type, attribute kind or relation it read, and `onChange` is called only when the result
   * is no longer the same value (`sameValue`). `read` is synchronous and reads through the engine; returns what stops
   * the subscription. A live query: what a view shows follows the data without anyone announcing a change.
   */
  subscribe<T>(read: () => T, onChange: (value: T) => void): () => void;
  /** Calls `listener` with each commit's change set — what the outermost unit wrote — or a replacement of the data */
  onCommit(listener: (changes: ChangeSet) => void): () => void;
  /** Whether `name` is an entity type the engine's creator registered */
  isEntityType(name: string): boolean;
  /** Whether `name` is a relation kind the engine's creator registered */
  isRelationKind(name: string): boolean;
  /** Whether `name` is a role the engine's creator registered */
  isRole(name: string): boolean;
  /** The entity's row — its id, type and every attribute, each exactly as written, the trash included — or undefined */
  getRow(id: EARS.EntityId): EntityRow | undefined;
  /** One field of the entity's row, read as `getRow` reads it (the trash included), or undefined when it holds none */
  getAttr(id: EARS.EntityId, field: EARS.AttrKind): EARS.AttributeValue | undefined;
  getRoles(id: EARS.EntityId): string[];
  /** What the engine holds, keyed by the names its data holds: entities per type, attribute, relation and role use */
  getSchemaStats(): SchemaStats;
  /** The relation's row — its id, kind, ends and info — or undefined when no relation has the id */
  getRelation(relId: EARS.RelationId): RelationRow | undefined;
  /** The rows of the relations matching every end and kind named; with none named, every relation */
  findRelations(match?: RelationMatch): RelationRow[];
  /** Moves a relation to new ends, or replaces its info, keeping its id; refuses an id no relation has */
  updateRelation(relId: EARS.RelationId, patch: { source?: EARS.EntityId; target?: EARS.EntityId; info?: unknown }): void;
  /** Removes the relation with the id, refusing an id no relation has */
  removeRelation(relId: EARS.RelationId): void;
  /** Whether linking `source` to `target` would close a cycle through `kinds` */
  wouldCreateCycle(source: EARS.EntityId, target: EARS.EntityId, kinds: readonly EARS.RelKind[]): boolean;
  /** `<base> <n>`, numbered per type and base and never handed out twice: a default label that must be unique */
  nextLabel(type: EARS.Entity, base: string): string;
}

/** An engine's data lifecycle and direct writes: for the code that created it (the app's composition root, tests, tooling) */
export interface EarsAdmin {
  /** Empties the engine's attributes, entity index and relation index, and tells subscriptions the data was replaced */
  clear(): void;
  /** Tells subscriptions the data was replaced: what a bulk load (hydration) calls once it has loaded */
  replaced(): void;
  /** Every entity's id, the engine's numbering sequences and those in the trash included: a raw listing */
  getAllEntities(): EARS.EntityId[];
  /** Every id of a type, the engine's own types and those in the trash included: a raw listing */
  getEntitiesOfType(type: EARS.Entity): EARS.EntityId[];
  /** Loads a stored attribute value, without telling persistence; it is held in memory, whatever its size */
  bulkLoadAttr(id: EARS.EntityId, kind: EARS.AttrKind, value: unknown): void;
  /**
   * Loads a stored attribute the store keeps out of line, by its `size` (`sizeOf`) and its `length` when it is a list:
   * the engine reads it back with `PersistenceSink.readAttr` when it is first read
   */
  bulkLoadOutOfLine(id: EARS.EntityId, kind: EARS.AttrKind, size: number, length: number | undefined): void;
  /** What the engine holds in memory per type, what it keeps out of it, and its cache: a walk of every value */
  memoryStats(): MemoryStats;
  /** Writes an attribute's value, any kind the engine owns included */
  putAttr(id: EARS.EntityId, kind: EARS.AttrKind, value: unknown): void;
  /** Removes an attribute */
  deleteAttr(id: EARS.EntityId, kind: EARS.AttrKind): void;
  /** Links any kind between any ids, either end missing included: unchecked, as loaded data is */
  addRelation(source: EARS.EntityId, kind: string, target: EARS.EntityId, info?: unknown): EARS.RelationId;
  /** `updateRelation` without its checks: any relation, to any ends */
  updateRelation(relId: EARS.RelationId, patch: { source?: EARS.EntityId; target?: EARS.EntityId; info?: unknown }): void;
  /** Loads a stored relation, without telling persistence */
  bulkLoadRelation(relId: EARS.RelationId, kind: string, source: EARS.EntityId, target: EARS.EntityId, info?: unknown): void;
}

/** An EARS engine as its creator holds it: its operations, and the creator's privileges in `admin` */
export interface EarsEngine extends Ears {
  admin: EarsAdmin;
}

/**
 * A new, empty engine. `isEntityType` says which names are entity types `create` and `query` accept, and
 * `isRelationKind` which are relation kinds a link, and a read or walk over links, may name, and `isRole` which are roles
 * a role write or a query by role may name; `persistence` receives every write (nothing by default). Whoever holds the engine calls its operations on it;
 * the app's is the SDK's bound engine (`boundEars`, `@apackdev/sdk/ears`).
 */
export function createEarsEngine({ persistence = noopSink, isEntityType, isRelationKind, isRole, rowRules = () => undefined }: EARSRuntimeDeps): EarsEngine {
  const names = createNameChecks({ isRelationKind, isRole });
  const changes = createChangeTracking(entityTypeOf);
  const { journal, unitSink, transact } = createJournal(persistence, changes);
  // Every write is made in a unit, so the sink sees nothing but units, and one it refuses is undone in memory
  const storage = unitWrites(journal, createAttributeStorage({ persistence: unitSink, journal, changes, readAttr: persistence.readAttr?.bind(persistence) }), [
    'putAttr', 'appendAttr', 'mergeAttr', 'removeAt', 'removeValue', 'deleteAttr', 'entityCreated', 'grantRole', 'revokeRole',
    'destroyEntity',
  ]);
  const relations = unitWrites(journal, createRelations({ persistence: unitSink, journal, changes }), [
    'add', 'replace', 'update', 'remove', 'unlink', 'removeEntity',
  ]);
  const query = createQuery({ storage, relations, isEntityType, names });
  const hierarchy = createHierarchy({ query, names });
  const counters = createEntityCounters(storage);
  const { create, upsert, write, updateRelation, removeRelation } = createWrites({ storage, relations, hierarchy, isEntityType, rowRules, counters, names, journal });

  const operations: Ears = {
    query, create, upsert, write, transact, isEntityType, isRelationKind, isRole,
    durable: () => persistence.durable?.() ?? Promise.resolve(),
    subscribe: changes.subscribe,
    onCommit: changes.onCommit,
    nextLabel: counters.nextLabel,
    ...hierarchy,
    getRow: storage.getRow,
    getAttr: (id, field) => (storage.hasAttr(id, field) ? storage.getAttr(id, field) : undefined),
    getRoles: storage.getRoles,
    getSchemaStats: () => ({ ...storage.entityStats(), relations: relations.stats() }),
    getRelation: relations.get,
    findRelations: (match = {}) => {
      if (match.kind !== undefined) names.relationKinds(match.kind, 'findRelations');
      return relations.find(match);
    },
    updateRelation,
    removeRelation,
  };

  const admin: EarsAdmin = {
    // Attribute storage refuses a clear inside a unit before anything is emptied
    clear: () => {
      storage.clear();
      relations.clear();
      changes.replaced();
    },
    replaced: changes.replaced,
    getAllEntities: storage.getAllEntities,
    getEntitiesOfType: storage.getEntitiesOfType,
    bulkLoadAttr: storage.bulkLoadAttr,
    bulkLoadOutOfLine: storage.bulkLoadOutOfLine,
    memoryStats: storage.memoryStats,
    putAttr: storage.putAttr,
    deleteAttr: storage.deleteAttr,
    addRelation: relations.add,
    updateRelation: (relId, { source, target, info }) => relations.update(relId, source, target, info),
    bulkLoadRelation: relations.bulkLoad,
  };

  return { ...operations, admin };
}
