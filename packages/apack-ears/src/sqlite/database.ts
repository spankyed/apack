import { checkRelationKeyInfo, sameRelationKey, sameStoredValue } from './relation-identity.ts';
import { relationWeight } from './relation-weights.ts';
import { SqliteReadTracking, type SqliteTrackedRead } from './read-tracking.ts';
import { fieldCellInvalid } from './field-query.ts';
import { loadGraphCommunityCore, type GraphCommunityCore } from './community-core.ts';
import { createWriteLease, withoutWriteAuthority } from '../write-lease.ts';
// SQLite storage for the structured EARS port. Scalar columns own small values; MessagePack is limited
// to composite persistence and canonical metadata.
/// <reference types="node" />
import { inspectDatabaseFiles } from './file-ownership.ts';
import { DATABASE_FORMAT, databaseFormatPragmas, readDatabaseFormat } from './format.ts';
import { repairNativeVectors } from './vector-repair.ts';
import { SqliteVectorIndex } from './vector-index.ts';
import { nativeVectorCandidateOwners } from './vector-candidates.ts';
import type { SqliteEntityScope } from './query-scope.ts';
import NativeDatabase from "better-sqlite3";
import { LRUCache } from "lru-cache";
interface StatementSync {
  iterate(...parameters: any[]): IterableIterator<unknown>;
  all(...parameters: any[]): unknown[];
  get(...parameters: any[]): unknown;
  run(...parameters: any[]): {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  };
}
interface DatabaseSync {
  readonly inTransaction: boolean;
  prepare(sql: string): StatementSync;
  exec(sql: string): unknown;
  loadExtension(path: string): unknown;
  function(name: string, options: { deterministic: boolean }, fn: (...args: unknown[]) => unknown): unknown;
  close(): unknown;
}
import { randomBytes } from "node:crypto";
import { mkdirSync, existsSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { Packr, Unpackr } from "msgpackr";
import type { EarsDatabase, EarsUnit, ReadRequest, WriteRequest, WriteResult, Answer, Changes, OpResult, Load, ReadOp } from "../database.ts";
import type { QueryPlan, StoredRelation } from "../storage.ts";
import type { SqliteStatement } from "../runtime.ts";
import { RESERVED_ATTRIBUTES } from "../errors.ts";
import { sameValue } from "../utils.ts";
import { executeQuery } from "./query.ts";
import { SqliteIndexBuilds, type SqliteIndexSpec } from "./index-builds.ts";
import { SqliteEmbeddings, encodeEmbeddingVector } from './embeddings.ts';
import { SqliteSearch } from "./search.ts";
import { SqliteValues, type SqliteValueLayout } from "./values.ts";
import { logicalValues } from './logical-records.ts';
import { createSchemaValidator } from "./schema-validation.ts";

type Data = Record<string, any>;
const fail = (code: string, message: string): never => {
  throw Object.assign(new Error(message), { code });
};
// Refusal must not checkpoint somebody else's WAL when the final connection closes. Inspect an existing
// writable target through a read-only connection first; only an owned or empty store gets a writable handle.
function inspectExistingDatabase(file: string): void {
  const probe: DatabaseSync = new NativeDatabase(file, { readonly: true, timeout: 0 });
  let refused = false, problem: unknown;
  try { readDatabaseFormat({ get: sql => probe.prepare(sql).get() as Data | undefined }); }
  catch (error) { refused = true; problem = error; }
  try { probe.close(); }
  catch (cleanup) {
    const cause = refused ? problem : cleanup;
    throw Object.assign(new AggregateError(refused ? [problem, cleanup] : [cleanup],
      'Read-only SQLite inspection could not close its connection', { cause }),
      { code: (cause as { code?: unknown })?.code, databaseConnectionUnclosed: true });
  }
  if (refused) throw problem;
}
const typeOf = (id: string) => id.slice(0, id.indexOf("-"));
const has = (o: object, k: string) => Object.hasOwn(o, k);
const own = (o: Data, k: string, value: unknown) =>
  Object.defineProperty(o, k, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
const scalarKey = (v: unknown): string | undefined =>
  v === null
    ? "null"
    : ["string", "boolean", "number"].includes(typeof v)
    ? `${typeof v}:${String(v)}`
    : undefined;

export class SqliteDatabase implements EarsDatabase {
  readonly format = DATABASE_FORMAT;
  readonly path: string;
  readonly readOnly: boolean;
  readonly sql: DatabaseSync;
  private readonly writeLease = createWriteLease();
  private opened = true;
  private draining?: Promise<void>;
  private readonly closeController = new AbortController();
  private vectorTrainingOwner?: symbol;
  get closeSignal(): AbortSignal { return this.closeController.signal; }
  private faulted?: Error;
  private active?: SqliteUnit;
  private schemaValidator?: ReturnType<typeof createSchemaValidator>;
  // Bound owned references and SQL text, not native VM memory. Eviction releases our reference; callers may
  // still hold an in-flight statement. Oversized SQL executes normally without entering the cache.
  private readonly statements = new LRUCache<string, StatementSync>({
    max: 256,
    maxSize: 1024 * 1024,
    sizeCalculation: (_statement, sql) => Buffer.byteLength(sql, 'utf8'),
  });
  private readonly packer = new Packr({
    useRecords: false,
    skipValues: [undefined],
  } as ConstructorParameters<typeof Packr>[0]);
  private readonly fastUnpacker = new Unpackr({
    useRecords: false,
    mapsAsObjects: true,
    int64AsType: "number",
  });
  private readonly unpacker = new Unpackr({
    useRecords: false,
    mapsAsObjects: false,
    int64AsType: "number",
  });
  private readonly tracks = new SqliteReadTracking();
  private readonly indexListeners = new Set<(changes: Changes) => void>();
  private recording?: SqliteTrackedRead;
  private heldSchema: Data;
  private heldRevision: number;
  private schemaPresent: boolean;
  private counter = 0;
  readonly search: SqliteSearch;
  readonly embeddings: SqliteEmbeddings;
  readonly values: SqliteValues;
  readonly indexBuilds: SqliteIndexBuilds;
  private nativeExtension?: string;
  private nativeReader?: SqliteVectorIndex;
  get nativeVectorExtension(): string | undefined { return this.nativeExtension; }
  /** Only the application owner supplies executable paths; stored metadata never chooses one. */
  loadNativeVectors(extension: string): void {
    if (!isAbsolute(extension)) fail('VALUE_INVALID', 'Native vector extension requires an absolute trusted path');
    const path = resolve(extension);
    if (this.nativeExtension && this.nativeExtension !== path) fail('NATIVE_CHANGED', 'This connection already loaded a different native vector extension');
    if (this.nativeExtension) return;
    this.sql.loadExtension(path);
    this.nativeExtension = path;
  }
  nativeVectorOwners(generation: number, vector: Uint8Array, scope: SqliteEntityScope | null, exclude?: string, target?: number): number[] | undefined {
    if (!this.nativeExtension || !this.get("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='vector_indexes'")) return;
    this.nativeReader ??= new SqliteVectorIndex(this, this.nativeExtension);
    return nativeVectorCandidateOwners(this.nativeReader, generation, vector, scope, exclude, target);
  }

  private readonly layouts = new Map<string, SqliteValueLayout>();
  private communityCore?: GraphCommunityCore;
  graphCommunities = () => this.communityCore ??= loadGraphCommunityCore();
  private explaining?: { statements: SqliteStatement[]; count: number };

  constructor(options: {
    path: string;
    schema?: object;
    readOnly?: boolean;
    syncs?: boolean;
    nativeVectorExtension?: string;
    communityCore?: GraphCommunityCore;
  }) {
    this.communityCore = options.communityCore;
    this.path = resolve(options.path);
    this.readOnly = options.readOnly ?? false;
    if (!this.readOnly) mkdirSync(this.path, { recursive: true });
    const file = join(this.path, "data.sqlite3");
    if (existsSync(join(this.path, "data.mdb")))
      fail(
        "WRONG_FORMAT",
        "Refusing an elmdb directory: this experimental backend requires a separate SQLite directory"
      );
    const mainPresent = inspectDatabaseFiles(this.path);
    if (this.readOnly && !mainPresent)
      fail("NO_DATABASE", `No SQLite database at ${file}`);
    if (!this.readOnly && mainPresent) inspectExistingDatabase(file);
    this.sql = new NativeDatabase(file, { readonly: this.readOnly, timeout: 0 });
    try {
      const format = readDatabaseFormat(this);
      if (this.readOnly && format === 'empty') fail('WRONG_FORMAT', 'An empty SQLite file has no EARS database identity');
      if (options.nativeVectorExtension !== undefined) this.loadNativeVectors(options.nativeVectorExtension);
      this.embeddings = new SqliteEmbeddings(this);
      this.values = new SqliteValues(this, { encode: value => this.pack(value), decode: bytes => this.unpack(bytes) });
      this.sql.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0; PRAGMA cache_size=-65536;
        PRAGMA fullfsync=ON; PRAGMA checkpoint_fullfsync=ON;
        PRAGMA synchronous=${options.syncs === false ? 'OFF' : 'FULL'};`);
      // Keep an empty file's identity and primary schema in one publication. A competing initializer may have
      // committed since inspection; recheck under write exclusion before claiming or creating anything.
      const initializing = format === 'empty';
      if (initializing) this.sql.exec('BEGIN IMMEDIATE');
      try {
        if (initializing && readDatabaseFormat(this) === 'empty') this.sql.exec(databaseFormatPragmas);
        this.embeddings.initialize();
        if (!this.readOnly) {
          this.sql.exec(`
          CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value BLOB NOT NULL);
          CREATE TABLE IF NOT EXISTS entities(id TEXT PRIMARY KEY, type TEXT NOT NULL, seq INTEGER NOT NULL UNIQUE,
            trashed INTEGER NOT NULL, short_code TEXT UNIQUE);
          CREATE INDEX IF NOT EXISTS entity_type ON entities(type,trashed,seq);
          CREATE INDEX IF NOT EXISTS entity_admission ON entities(type,seq);
          CREATE TABLE IF NOT EXISTS relations(id TEXT PRIMARY KEY, kind TEXT NOT NULL, source TEXT NOT NULL,
            target TEXT NOT NULL, seq INTEGER NOT NULL UNIQUE, info BLOB, weight BLOB);
          CREATE INDEX IF NOT EXISTS relations_source ON relations(source,kind,seq);
          CREATE INDEX IF NOT EXISTS relations_target ON relations(target,kind,seq);
          CREATE INDEX IF NOT EXISTS relations_kind ON relations(kind,seq);
          CREATE INDEX IF NOT EXISTS relations_between ON relations(source,kind,target,seq);
          CREATE TABLE IF NOT EXISTS field_index(entity_id TEXT NOT NULL, type TEXT NOT NULL, field TEXT NOT NULL,
            value TEXT NOT NULL, seq INTEGER NOT NULL, generation INTEGER NOT NULL, PRIMARY KEY(entity_id,field,value,generation));
          CREATE INDEX IF NOT EXISTS field_lookup ON field_index(type,field,generation,value,seq);
          `);
          this.values.initialize();
        }
        if (initializing) this.sql.exec('COMMIT');
      } catch (error) {
        if (initializing && this.sql.inTransaction) {
          try { this.sql.exec('ROLLBACK'); }
          catch (rollback) {
            throw Object.assign(new AggregateError([error, rollback], 'SQLite initialization and rollback failed', { cause: error }),
              { code: (error as { code?: unknown })?.code });
          }
        }
        throw error;
      }
      // Journal mode changes the file. Only a positively identified, complete store may enter WAL mode.
      if (!this.readOnly) this.sql.exec('PRAGMA journal_mode=WAL');
      this.sql.function('ears_rebuild_members', { deterministic: true }, bytes => {
        if (!(bytes instanceof Uint8Array)) return fail('CORRUPT', 'Invalid authoritative list encoding');
        const value = this.unpack(bytes);
        if (!Array.isArray(value)) return fail('CORRUPT', 'Invalid authoritative list encoding');
        return JSON.stringify(this.values.members(value));
      });
      this.search = new SqliteSearch(this);
      this.heldSchema = this.meta("schema") ?? {
        types: {},
        relations: {},
        roles: {},
      };
      this.schemaPresent = this.meta("schema") !== undefined;
      this.heldRevision = Number(this.meta("schemaRevision") ?? 0);
      if (this.schemaPresent) {
        try { (this.schemaValidator ??= createSchemaValidator())(this.heldSchema); }
        catch (error) {
          if ((error as { code?: string })?.code !== 'SCHEMA_INVALID') throw error;
          throw Object.assign(new Error('Stored SQLite declaration is invalid', { cause: error }), { code: 'CORRUPT' });
        }
      }
      this.indexBuilds = new SqliteIndexBuilds(this, () => !this.active, () => this.checkRevision(),
        (id, type, seq, field, generation) => {
          const row = this.values.read(this.valueLayout(type), [id], [field])[0];
          if (!row) fail('CORRUPT', 'Index backfill found an entity without authoritative values');
          this.refileValue(row!, seq, field, generation);
        });
      const specs = this.indexSpecs(this.heldSchema);
      if (this.readOnly) {
        if (!this.indexBuilds.matches(specs)) fail('CORRUPT', 'Index declarations do not match stored generations');
        this.search.validateStructures(this.heldSchema);
        this.search.loadVectors(this.heldSchema);
      } else if (!this.indexBuilds.matches(specs) || this.search.needsRepair(this.heldSchema)) {
        this.sql.exec('BEGIN IMMEDIATE');
        try {
          this.checkRevision();
          const revision = this.schemaPresent ? this.advanceCounter('schemaRevision') : undefined;
          const incumbent = new Set(this.indexBuilds.jobs().map(job => job.generation));
          this.indexBuilds.admit(specs);
          this.indexBuilds.restart(this.search.missingIndexes(this.heldSchema).filter(job => incumbent.has(job.generation)));
          this.search.ensure(this.heldSchema);
          const state = this.indexBuilds.readState();
          // Other owners may cache value generations. Invalidate them when physical recovery changes the
          // catalog, while preserving the logical data commit identity and the declaration itself.
          if (revision !== undefined) this.putMeta('schemaRevision', revision);
          this.commitWrite();
          if (revision !== undefined) this.heldRevision = revision;
          this.indexBuilds.acceptState(state);
        } catch (error) {
          if (this.sql.inTransaction) {
            try { this.sql.exec('ROLLBACK'); }
            catch (rollback) {
              throw Object.assign(new AggregateError([error, rollback], 'Search admission and rollback failed', { cause: error }),
                { code: (error as { code?: unknown })?.code });
            }
          }
          throw error;
        }
      } else this.search.loadVectors(this.heldSchema);
      if (options.schema) this.setSchema(options.schema);
      this.indexBuilds.resume();
    } catch (error) {
      this.opened = false;
      try { this.sql.close(); }
      catch (cleanup) {
        throw Object.assign(new AggregateError([error, cleanup], 'Opening SQLite failed and closing its connection also failed',
          { cause: error }), { code: (error as { code?: unknown })?.code, databaseConnectionUnclosed: true });
      }
      throw error;
    }
  }

  get isOpen() {
    return this.opened;
  }
  claimVectorTrainingOwner(): () => void {
    this.writable();
    if(this.vectorTrainingOwner)fail('BACKGROUND_OWNER_EXISTS','A native model owner already exists on this connection');
    const token=Symbol('vector training owner');this.vectorTrainingOwner=token;
    return ()=>{if(this.vectorTrainingOwner===token)this.vectorTrainingOwner=undefined;};
  }
  get schema() {
    return this.schemaPresent ? this.clone(this.heldSchema) : null;
  }
  get sequence() {
    return Number(this.meta("commit") ?? 0);
  }
  private assertOpen() {
    if (!this.opened) fail("CLOSED", "The database is closed");
    if (this.faulted) throw this.faulted;
  }
  /** A failed COMMIT is not proof of refusal once SQLite has ended the transaction. */
  commitWrite(): void {
    try { this.sql.exec('COMMIT'); }
    catch (error) {
      const code = (error as { code?: unknown })?.code;
      const refused = typeof code === 'string' && /^(SQLITE_FULL|SQLITE_BUSY|SQLITE_LOCKED|SQLITE_CONSTRAINT)(_|$)/.test(code);
      if (this.sql.inTransaction || refused) this.abortFailedOperation(error);
      const uncertain = Object.assign(new Error(
        'SQLite commit outcome is unknown; close and reopen the database and inspect the result before retrying',
        { cause: error }), { code: 'COMMIT_UNKNOWN' });
      this.faulted = uncertain;
      this.active?.ended(); this.active = undefined;
      this.layouts.clear();
      this.indexBuilds.stop(uncertain);
      throw uncertain;
    }
  }
  /** Preserve the original storage error when SQLite has already rolled back after FULL/IOERR. */
  abortFailedOperation(error: unknown, command: string | null = 'ROLLBACK'): never {
    if (this.faulted) throw this.faulted;
    try {
      if (command && this.sql.inTransaction) this.sql.exec(command);
    } catch (rollback) {
      const problem = Object.assign(new AggregateError([error, rollback],
        'SQLite operation and rollback failed; close and reopen the database', { cause: error }),
        { code: (error as { code?: unknown })?.code });
      // An uncertain transaction cannot accept another write or background batch. close() still releases it.
      this.faulted = problem;
      this.active?.ended(); this.active = undefined;
      this.indexBuilds.stop();
      throw problem;
    } finally {
      this.layouts.clear();
      if (!this.sql.inTransaction) {
        this.active?.ended(); this.active = undefined;
        if (!this.faulted) this.indexBuilds.wake();
      }
    }
    throw error;
  }
  private writable() {
    this.assertOpen();
    this.writeLease.assertWritable();
    if (this.draining) fail("WRITE_PAUSED", "Background shutdown has begun; close and reopen before writing");
    if (this.readOnly) fail("READ_ONLY", "The database was open read-only");
  }
  statement(sql: string) {
    this.assertOpen();
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.sql.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }
  all(sql: string, parameters: any[] = []): Data[] {
    if (!this.explaining) return this.statement(sql).all(...parameters) as Data[];
    const started = performance.now();
    const rows = this.statement(sql).all(...parameters) as Data[];
    this.recordStatement(sql, parameters, rows.length, performance.now() - started);
    return rows;
  }
  *iterate(sql: string, parameters: any[] = []): IterableIterator<Data> {
    const cursor = this.statement(sql).iterate(...parameters), trace = this.explaining;
    let count = 0, ms = 0;
    try {
      for (;;) {
        const started = trace ? performance.now() : 0, next = cursor.next();
        if (trace) ms += performance.now() - started;
        if (next.done) break;
        count++; yield next.value as Data;
      }
    } finally {
      cursor.return?.();
      if (trace) this.recordStatement(sql, parameters, count, ms);
    }
  }
  get(sql: string, parameters: any[] = []): Data | undefined {
    if (!this.explaining) return this.statement(sql).get(...parameters) as Data | undefined;
    const started = performance.now();
    const row = this.statement(sql).get(...parameters) as Data | undefined;
    this.recordStatement(sql, parameters, row ? 1 : 0, performance.now() - started);
    return row;
  }
  private recordStatement(sql: string, parameters: unknown[], returnedRows: number, ms: number) {
    const trace = this.explaining!;
    trace.count++;
    if (trace.statements.length >= 256) return;
    trace.statements.push({ sql, parameters: parameters.map(value => value instanceof Uint8Array ? Uint8Array.from(value) : value),
      returnedRows, ms, plan: [] });
  }
  private explain(plan: QueryPlan): Extract<Answer, { kind: 'explained' }> {
    const previous = this.explaining, statements: SqliteStatement[] = [];
    const trace = { statements, count: 0 };
    this.explaining = trace;
    let answer: import("../storage.ts").QueryAnswer;
    const started = performance.now();
    try { answer = executeQuery(this, plan); }
    finally { this.explaining = previous; }
    const ms = performance.now() - started;
    // Plan the exact statements/bindings after execution, under the same read snapshot. These extra calls are
    // diagnostic overhead, not included in query execution timing or recursively recorded as executed SELECTs.
    for (const statement of statements) statement.plan =
      (this.statement('EXPLAIN QUERY PLAN ' + statement.sql).all(...statement.parameters) as Data[])
        .map(row => ({ id: Number(row.id), parent: Number(row.parent), detail: String(row.detail) }));
    return { kind: 'explained', backend: 'sqlite', answer, ms, statementCount: trace.count, statements };
  }
  run(sql: string, parameters: any[] = []) {
    return this.statement(sql).run(...parameters);
  }
  pack(value: unknown): Buffer {
    return Buffer.from(this.packer.pack(value));
  }
  unpack(bytes: Uint8Array): any {
    if (
      !Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(
        "__proto__"
      )
    )
      return this.fastUnpacker.unpack(bytes);
    const objects = (v: any): any => {
      if (v instanceof Map)
        return Object.fromEntries(
          [...v].map(([k, inner]) => [String(k), objects(inner)])
        );
      if (Array.isArray(v)) return v.map(objects);
      return v;
    };
    return objects(this.unpacker.unpack(bytes));
  }
  clone<T>(v: T): T {
    return this.unpack(this.pack(v)) as T;
  }
  private meta(name: string): any {
    const r = this.get("SELECT value FROM meta WHERE key=?", [name]);
    return r ? this.unpack(r.value) : undefined;
  }
  private putMeta(name: string, value: unknown) {
    this.run("INSERT OR REPLACE INTO meta VALUES (?,?)", [
      name,
      this.pack(value),
    ]);
  }
  /** Imported metadata may reach the representable boundary; never round commit/schema identities. */
  private advanceCounter(name: 'commit' | 'schemaRevision'): number {
    const current: unknown = this.meta(name) ?? 0;
    if (typeof current !== 'number' || !Number.isSafeInteger(current) || current < 0)
      fail('CORRUPT', `Invalid ${name} counter`);
    if (current === Number.MAX_SAFE_INTEGER) fail('NUMBERS_EXHAUSTED', `${name} counter exhausted`);
    return current + 1;
  }
  private next(name: string): number {
    const n = Number(this.meta(name) ?? 1);
    if (!Number.isSafeInteger(n + 1))
      fail("NUMBERS_EXHAUSTED", "Sequence exhausted");
    this.putMeta(name, n + 1);
    return n;
  }
  schemaForQueries(): Data {
    return this.heldSchema;
  }
  isIndexed(type: string, field: string): boolean {
    this.definition(type);
    return this.indexBuilds.ready(type, field);
  }
  definition(type: string): Data {
    if (type === "Relation") fail("RESERVED_TYPE", "Relation is reserved");
    if (!has(this.heldSchema.types, type))
      fail("UNKNOWN_TYPE", `Unknown entity type "${type}"`);
    return this.heldSchema.types[type];
  }
  relationDefinition(kind: string): Data {
    if (!has(this.heldSchema.relations, kind))
      fail("UNKNOWN_RELATION_KIND", `Unknown relation kind "${kind}"`);
    return this.heldSchema.relations[kind];
  }
  private matchingRelation(kind: string, source: string, target: string, fields: readonly string[], info: unknown,
    exclude = ''): Data | undefined {
    // Stop at the first matching identity. for-of closes the native cursor on return or decode failure,
    // before the caller mutates or commits; do not retain every info payload for these endpoints.
    for (const value of this.statement('SELECT * FROM relations WHERE kind=? AND source=? AND target=? AND id<>? ORDER BY seq')
      .iterate(kind, source, target, exclude)) {
      const row = value as Data;
      if (sameRelationKey(fields, row.info === null ? undefined : this.unpack(row.info), info)) return row;
    }
    return undefined;
  }
  private role(role: string) {
    if (!has(this.heldSchema.roles ?? {}, role))
      fail("UNKNOWN_ROLE", `Unknown role "${role}"`);
  }
  private valueLayout(type: string, create = false): SqliteValueLayout {
    let layout = this.layouts.get(type);
    if (!layout) {
      layout = this.values.layout(type);
      if (!layout && create) layout = this.values.declare(type,
        ['createdAt', 'updatedAt', 'trashedAt', 'shortCode', 'role', ...Object.keys(this.heldSchema.types[type]?.fields ?? {})]);
      if (!layout) return fail("CORRUPT", `Missing value layout for ${type}`);
      this.layouts.set(type, layout);
    }
    return layout;
  }
  hydrate(records: Array<{ id: string; type: string }>, fields?: string[]): Data[] {
    const groups = new Map<string, string[]>();
    for (const row of records) {
      const ids = groups.get(row.type) ?? [];
      ids.push(row.id); groups.set(row.type, ids);
    }
    const hydrated = new Map<string, { rows: Data[]; next: number }>();
    for (const [type, ids] of groups) {
      const rows = this.values.read(this.valueLayout(type), ids, fields);
      if (rows.some(row => !row)) fail("CORRUPT", "An entity is missing its authoritative values");
      hydrated.set(type, { rows: rows as Data[], next: 0 });
    }
    return records.map(record => { const group = hydrated.get(record.type)!; return group.rows[group.next++]; });
  }

  rows(ids: string[], fields?: string[]): Data[] {
    return this.hydrate(this.all(`SELECT e.id,e.type FROM json_each(?) seed JOIN entities e ON e.id=seed.value ORDER BY seed.key`,
      [JSON.stringify(ids)]) as Array<{ id: string; type: string }>, fields);
  }
  row(id: string, fields?: string[]): Data | undefined {
    return this.rows([id], fields)[0];
  }
  fieldSource(field: string, types?: readonly string[], includeMissing = false): string {
    if (field === 'id' || field === 'entityType') return `SELECT id,'text' kind,${field === 'id' ? 'id' : 'type'} value${includeMissing ? ',0 invalid' : ''} FROM entities`;
    const text = (value: string) => "'" + value.replaceAll("'", "''") + "'";
    const selected = types ?? this.all('SELECT name FROM value_types').map(row => row.name as string);
    return selected.map(type => {
      const layout = this.layouts.get(type) ?? this.values.layout(type);
      if (layout) this.layouts.set(type, layout);
      if (!layout) return `SELECT NULL id,NULL kind,NULL value${includeMissing ? ',0 invalid' : ''} WHERE 0`;
      const slot = layout.fields.get(field);
      if (slot === undefined) {
        if (includeMissing) return `SELECT v.entity_id id,o.kind,o.value,0 invalid FROM ${layout.table} v
          JOIN entities e ON e.id=v.entity_id AND e.type=${text(type)}
          LEFT JOIN value_overflow o ON o.entity_id=v.entity_id AND o.field=${text(field)}`;
        return `SELECT o.entity_id id,o.kind,o.value FROM value_overflow o JOIN entities e
          ON e.id=o.entity_id WHERE e.type=${text(type)} AND o.field=${text(field)}`;
      }
      return `SELECT v.entity_id id,CASE WHEN v.k${slot} IS NULL OR v.k${slot}='@' THEN o.kind ELSE v.k${slot} END kind,
        CASE WHEN v.k${slot} IS NULL OR v.k${slot}='@' THEN o.value ELSE v.v${slot} END value
        ${includeMissing ? `,${fieldCellInvalid(slot)} invalid` : ''}
        FROM ${layout.table} v LEFT JOIN value_overflow o ON o.entity_id=v.entity_id AND o.field=${text(field)}
        ${includeMissing ? `JOIN entities e ON e.id=v.entity_id AND e.type=${text(type)}` : ''}`;
    }).join(' UNION ALL ') || `SELECT NULL id,NULL kind,NULL value${includeMissing ? ',0 invalid' : ''} WHERE 0`;
  }
  relation(id: string): StoredRelation | undefined {
    const r = this.get("SELECT * FROM relations WHERE id=?", [id]);
    return r ? this.decodeRelation(r) : undefined;
  }
  decodeRelation(row: Data): StoredRelation {
    return {
      id: row.id, kind: row.kind, source: row.source, target: row.target,
      info: row.info === null ? null : this.unpack(row.info),
      ...(this.heldSchema.relations[row.kind]?.weighted ? { weight: row.weight === null ? 1 : this.unpack(row.weight) as number } : {}),
    };
  }

  entity(id: string, fields?: string[]): Data {
    return this.row(id, fields) ?? fail("NO_SUCH_ENTITY", `No entity "${id}"`);
  }
  // The native wire codec omits undefined object properties. Do that per changed value here, without serializing
  // a request or unrelated attributes. Undefined array positions remain invalid stored values.
  private canonical(value: unknown, depth = 0): unknown {
    if (depth > 64) fail('VALUE_INVALID', 'Invalid stored value');
    if (Array.isArray(value)) return value.map(item => this.canonical(item, depth + 1));
    if (value instanceof Map) return Object.fromEntries([...value].map(([key, item]) => {
      if (typeof key !== 'string') fail('VALUE_INVALID', 'Stored maps require string keys');
      return [key, this.canonical(item, depth + 1)];
    }));
    if (value !== null && typeof value === 'object' &&
        (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
      return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
        .map(([name, item]) => [name, this.canonical(item, depth + 1)]));
    }
    return value;
  }
  private validate(value: unknown, depth = 0): void {
    if (
      depth > 64 ||
      value === undefined ||
      typeof value === "function" ||
      typeof value === "symbol" ||
      typeof value === "bigint" ||
      (typeof value === "number" && !Number.isFinite(value))
    )
      fail("VALUE_INVALID", "Invalid stored value");
    if (value instanceof Date) {
      if (!Number.isFinite(value.getTime()))
        fail("VALUE_INVALID", "Invalid date");
      return;
    }
    if (value instanceof Uint8Array || value === null) return;
    if (value instanceof Map) {
      for (const [key, item] of value) {
        if (typeof key !== 'string') fail('VALUE_INVALID', 'Stored maps require string keys');
        this.validate(item, depth + 1);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) this.validate(item, depth + 1);
    } else if (typeof value === "object")
      for (const item of Object.values(value as object))
        this.validate(item, depth + 1);
  }
  private checkFields(row: Data, names: Iterable<string>) {
    const fields = this.definition(row.entityType).fields ?? {};
    const takes = (rule: Data, value: unknown): boolean => {
      switch (rule.type) {
        case "any":
          return true;
        case "string":
          return typeof value === "string";
        case "number":
          return typeof value === "number" && Number.isFinite(value);
        case "integer":
          return (
            typeof value === "number" &&
            Number.isInteger(value) &&
            Math.abs(value) <= 9_007_199_254_740_992
          );
        case "boolean":
          return typeof value === "boolean";
        case "bytes":
          return value instanceof Uint8Array;
        case "object":
          return (
            value !== null &&
            typeof value === "object" &&
            !Array.isArray(value) &&
            !(value instanceof Date) &&
            !(value instanceof Uint8Array)
          );
        case "enum":
          return typeof value === "string" && rule.values.includes(value);
        case "ref":
          return (
            typeof value === "string" &&
            (Array.isArray(rule.to) ? rule.to : [rule.to]).includes(
              value.split("-")[0]
            )
          );
        case "list":
          return (
            Array.isArray(value) && value.every((item) => takes(rule.of, item))
          );
        default:
          return fail("SCHEMA_INVALID", `Unknown field type ${rule.type}`);
      }
    };
    for (const name of names) {
      if (!has(fields, name)) continue;
      const rule = fields[name];
      if (!has(row, name)) {
        if (!rule.optional)
          fail("REQUIRED_FIELD", `${row.entityType} requires "${name}"`);
        continue;
      }
      const value = row[name];
      this.validate(value);
      if (value === null && (rule.nullable || rule.type === "any")) continue;
      if (!takes(rule, value))
        fail(
          "FIELD_TYPE",
          `${row.entityType}.${name} is a ${rule.type}: it got ${
            value === null ? "null" : typeof value
          }`
        );
    }
  }
  private required(row: Data) {
    this.checkFields(
      row,
      Object.keys(this.definition(row.entityType).fields ?? {})
    );
  }
  private save(row: Data, changes: Set<string>, before?: Data) {
    this.validate(row);
    const record = this.get("SELECT seq FROM entities WHERE id=?", [row.id]);
    const seq = record?.seq ?? this.next("seq");
    this.run(`INSERT INTO entities VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      trashed=excluded.trashed,short_code=excluded.short_code`,
      [row.id,row.entityType,seq,has(row, "trashedAt") ? 1 : 0,row.shortCode ?? null]);
    const fields = Object.fromEntries(Object.entries(row).filter(([field, value]) => !before ||
      !has(before, field) || !sameValue(before[field], value)));
    this.values.set(this.valueLayout(row.entityType, true), row.id, fields,
      before ? Object.keys(before).filter(field => !has(row, field)) : []);
    const changed = before ? new Set([...Object.keys(fields), ...Object.keys(before).filter(field => !has(row, field))]) : undefined;
    this.refile(row, seq, this.heldSchema, changed);
    this.search.refile(row, seq, this.heldSchema, changed);
    changes.add(`entity:${row.id}`);
    changes.add(`rows:${row.entityType}`);
    if (!before || has(before, "trashedAt") !== has(row, "trashedAt")) {
      changes.add(`members:${row.entityType}`);
      changes.add('membersAny');
      changes.add(`exists:${row.id}`);
    }
    for (const field of new Set([
      ...Object.keys(before ?? {}),
      ...Object.keys(row),
    ])) {
      if (
        !before ||
        !sameValue(before[field], row[field]) ||
        has(before, field) !== has(row, field)
      ) {
        changes.add(`field:${row.id}:${field}`);
        changes.add(`fieldType:${row.entityType}:${field}`);
        changes.add(`fieldAny:${field}`);
      }
    }
  }
  private refile(row: Data, seq: number, schema = this.heldSchema, changed?: ReadonlySet<string>) {
    const definition = schema.types[row.entityType] ?? {};
    const fields = new Set([
      "role",
      "shortCode",
      ...Object.values(definition.indexes ?? {}).flatMap((d: any) =>
        d.kind === "value" ? d.fields : []
      ),
    ]);
    const updating = [...fields as Set<string>].filter(field => !changed || changed.has(field));
    if (changed) {
      if (!updating.length) return;
      this.run('DELETE FROM field_index WHERE entity_id=? AND field IN (SELECT value FROM json_each(?))',
        [row.id, JSON.stringify(updating)]);
    } else this.run('DELETE FROM field_index WHERE entity_id=?', [row.id]);
    for (const field of updating) {
      const generation = this.indexBuilds.generation(row.entityType, field);
      if (generation !== undefined) this.refileValue(row, seq, field, generation, false);
    }
  }
  private refileValue(row: Data, seq: number, field: string, generation: number, replace = true) {
    if (replace) this.run('DELETE FROM field_index WHERE entity_id=? AND field=? AND generation=?', [row.id, field, generation]);
    const value = row[field];
    for (const item of Array.isArray(value) ? value : [value]) {
      const key = scalarKey(item);
      if (key !== undefined) this.run('INSERT OR IGNORE INTO field_index VALUES (?,?,?,?,?,?)',
        [row.id, row.entityType, field, key, seq, generation]);
    }
  }

  private newRow(
    op: Data,
    now: number,
    changes: Set<string>,
    unchecked = false
  ): Data {
    const type = String(op.type),
      def = unchecked
        ? this.heldSchema.types[type] ?? {}
        : this.definition(type);
    const id = op.id ?? `${type}-${randomBytes(10).toString("hex")}`;
    if (typeOf(id) !== type) fail("TYPE_MISMATCH", `"${id}" isn't a ${type}`);
    if (this.get("SELECT 1 FROM entities WHERE id=? UNION ALL SELECT 1 FROM relations WHERE id=? LIMIT 1", [id,id]))
      fail("ID_IN_USE", `"${id}" is in use`);
    const row = {
      id,
      entityType: type,
      ...(!unchecked ? { createdAt: op.createdAt ?? now, updatedAt: op.updatedAt ?? op.createdAt ?? now } : {}),
    } as Data;
    for (const [k, v] of Object.entries(op.fields ?? {})) {
      if (!unchecked && (RESERVED_ATTRIBUTES as readonly string[]).includes(k))
        fail("RESERVED_FIELD", `"${k}" is reserved`);
      if (v !== undefined) own(row, k, this.canonical(v));
    }
    const prefix = def.shortCode?.prefix;
    if (!unchecked || op.shortCode !== undefined) {
      if (
        op.shortCode !== undefined &&
        (!prefix ||
          !new RegExp(`^${prefix}-[1-9][0-9]*$`).test(String(op.shortCode)))
      )
        fail("INVALID_SHORT_CODE", "Invalid short code");
      if (prefix) {
        const n =
          op.shortCode === undefined
            ? this.next(`shortCode:${type}`)
            : Number(String(op.shortCode).slice(prefix.length + 1));
        const code = `${prefix}-${n}`;
        if (this.get("SELECT 1 FROM entities WHERE short_code=?", [code]))
          fail("SHORT_CODE_IN_USE", `Short code ${code} is in use`);
        row.shortCode = code;
        this.putMeta(
          `shortCode:${type}`,
          Math.max(n + 1, Number(this.meta(`shortCode:${type}`) ?? 1))
        );
      }
    }
    if (!unchecked) this.required(row);
    this.save(row, changes);
    return row;
  }
  private mutate(op: Data, now: number, changes: Set<string>): Data {
    if (has(op, 'value')) op = { ...op, value: this.canonical(op.value) };
    if (has(op, 'info')) op = { ...op, info: this.canonical(op.info) };
    const done = { kind: "done" };
    switch (op.op) {
      case "create": {
        const row = this.newRow(op, now, changes);
        return {
          kind: "entity",
          id: row.id,
          shortCode: row.shortCode ?? null,
          created: true,
        };
      }
      case "upsert": {
        const row = this.row(op.id, ["shortCode"]);
        if (!row) return this.mutate({ ...op, op: "create" }, now, changes);
        if (row.entityType !== op.type)
          fail("TYPE_MISMATCH", "Upsert type differs from id");
        if (op.shortCode !== undefined && row.shortCode !== op.shortCode)
          fail("INVALID_SHORT_CODE", "A short code cannot change");
        this.mutate({ op: "set", id: op.id, fields: op.fields }, now, changes);
        return {
          kind: "entity",
          id: row.id,
          shortCode: row.shortCode ?? null,
          created: false,
        };
      }
      case "set":
      case "append":
      case "merge":
      case "delete":
      case "removeAt":
      case "removeValue": {
        const fields = op.op === "set" ? Object.keys(op.fields).filter(field => op.fields[field] !== undefined) : [op.field];
        const before = this.entity(op.id, [...fields, 'trashedAt', 'shortCode']), row = this.clone(before);
        for (const f of fields)
          if ((RESERVED_ATTRIBUTES as readonly string[]).includes(f))
            fail("RESERVED_FIELD", `${f} is reserved`);
        if (op.op === "set") {
          for (const [f, v] of Object.entries(op.fields)) if (v !== undefined) own(row, f, this.canonical(v));
        } else {
          const f = op.field,
            held = row[f];
          if (op.op === "delete") delete row[f];
          else if (op.op === "append") {
            if (has(row, f) && !Array.isArray(held))
              fail("NOT_A_LIST", `${f} is not a list`);
            own(row, f, [...(held ?? []), op.value]);
          } else if (op.op === "merge") {
            own(
              row,
              f,
              held &&
                op.value &&
                typeof held === "object" &&
                typeof op.value === "object" &&
                !Array.isArray(held) &&
                !Array.isArray(op.value)
                ? { ...held, ...op.value }
                : op.value
            );
          } else {
            if (has(row, f) && !Array.isArray(held))
              fail("NOT_A_LIST", `${f} is not a list`);
            const items = [...(held ?? [])];
            if (op.op === "removeAt") {
              const at = Math.floor(op.index);
              if (at >= 0 && at < items.length) items.splice(at, 1);
            } else {
              const at = items.findIndex((v) =>
                op.value &&
                typeof op.value === "object" &&
                !Array.isArray(op.value) &&
                !(op.value instanceof Date) &&
                !(op.value instanceof Uint8Array)
                  ? !!v &&
                    typeof v === "object" &&
                    Object.entries(op.value).every(([k, x]) =>
                      sameValue(v[k], x)
                    )
                  : sameValue(v, op.value)
              );
              if (at >= 0) items.splice(at, 1);
            }
            if (has(row, f)) own(row, f, items);
          }
        }
        this.checkFields(row, fields);
        if (op.touch !== false) row.updatedAt = now;
        this.save(row, changes, before);
        for (const f of fields) {
          changes.add(`field:${row.id}:${f}`);
          changes.add(`fieldType:${row.entityType}:${f}`);
          changes.add(`fieldAny:${f}`);
        }
        return done;
      }
      case "grant":
      case "revoke":
      case "grantExclusive": {
        this.role(op.role);
        if (op.op === "grantExclusive")
          for (const id of op.among ?? [])
            if (this.row(id))
              this.mutate({ op: "revoke", id, role: op.role }, now, changes);
        const before = this.entity(op.id, ["role", "trashedAt", "shortCode"]),
          row = this.clone(before);
        let roles: string[] = [...(row.role ?? [])];
        if (op.op === "revoke") roles = roles.filter((r) => r !== op.role);
        else if (!roles.includes(op.role)) roles.push(op.role);
        if (roles.length) row.role = roles;
        else delete row.role;
        this.save(row, changes, before);
        return done;
      }
      case "trash":
      case "restore": {
        const before = this.entity(op.id, ["trashedAt", "shortCode"]),
          row = this.clone(before);
        if (op.op === "trash") {
          if (!has(row, "trashedAt")) row.trashedAt = op.at ?? now;
        } else delete row.trashedAt;
        this.save(row, changes, before);
        return done;
      }
      case "destroy": {
        const row = this.entity(op.id, []);
        for (const r of this.all(
          "SELECT id FROM relations WHERE source=? OR target=?",
          [op.id, op.id]
        ))
          this.mutate({ op: "removeRelation", relation: r.id }, now, changes);
        this.search.remove(op.id, row.entityType);
        this.run("DELETE FROM field_index WHERE entity_id=?", [op.id]);
        this.values.delete(this.valueLayout(row.entityType), [op.id]);
        this.run("DELETE FROM entities WHERE id=?", [op.id]);
        changes.add(`entity:${op.id}`);
        changes.add(`exists:${op.id}`);
        changes.add(`rows:${row.entityType}`);
        changes.add(`members:${row.entityType}`);
        changes.add('membersAny');
        return done;
      }
      case "takeLabel": {
        this.definition(op.type);
        let highest = 0;
        for (const r of this.hydrate(this.all("SELECT id,type FROM entities WHERE type=?", [op.type]) as Array<{id:string;type:string}>, ["label"])) {
          const label = r.label;
          if (typeof label === "string" && label.startsWith(op.base + " ")) {
            const n = Number(label.slice(op.base.length + 1));
            if (Number.isSafeInteger(n) && n > highest) highest = n;
          }
        }
        this.putMeta(
          `label:${op.type}:${op.base}`,
          Math.max(
            highest + 1,
            Number(this.meta(`label:${op.type}:${op.base}`) ?? 1)
          )
        );
        let n = this.next(`label:${op.type}:${op.base}`),
          label = `${op.base} ${n}`;
        while (
          this.hydrate(this.all("SELECT id,type FROM entities WHERE type=?", [op.type]) as Array<{id:string;type:string}>, ["label"]).some(r => r.label === label)
        ) {
          n = this.next(`label:${op.type}:${op.base}`);
          label = `${op.base} ${n}`;
        }
        return { kind: "label", label };
      }
      case "embed": {
        const result = this.search.embed(op);
        const owner = this.get('SELECT type FROM entities WHERE id=?', [op.id]);
        if (owner) { changes.add(`rows:${owner.type}`); if (result.kind === 'done') changes.add(`vectors:${owner.type}`); }
        return result;
      }
      case "link": {
        const def = this.relationDefinition(op.kind);
        // Native optional info treats null as omitted. Keep that contract at the structured boundary too.
        const info = op.info ?? undefined;
        if (info !== undefined) this.validate(info);
        checkRelationKeyInfo(def.key ?? [], info);
        const weight = relationWeight(!!def.weighted, op.kind, op.weight);
        const existing = this.matchingRelation(op.kind, op.source, op.target, def.key ?? [], info);
        if (existing) {
          const sameInfo = info === undefined || (existing.info !== null &&
            sameStoredValue(this.unpack(existing.info), info));
          const sameWeight = op.weight === undefined ||
            (existing.weight === null ? 1 : this.unpack(existing.weight)) === (weight ?? 1);
          if (!sameInfo || !sameWeight)
            this.mutate({ op: 'updateRelation', relation: existing.id, info: info, weight: op.weight }, now, changes);
          return { kind: 'relation', id: existing.id, linked: false };
        }
        if (op.source === op.target) fail('SELF_LINK', 'A self link is refused');
        if (def.acyclic && this.wouldCycle(op.source, op.target, [op.kind]))
          fail('CYCLE', 'Link would create a cycle');
        const id = op.id ?? `Relation-${randomBytes(10).toString("hex")}`;
        this.run("INSERT INTO relations VALUES (?,?,?,?,?,?,?)", [
          id,
          op.kind,
          op.source,
          op.target,
          this.next("seq"),
          info === undefined ? null : this.pack(info),
          weight === undefined ? null : this.pack(weight),
        ]);
        changes.add(`relation:${id}`);
        changes.add(`kind:${op.kind}`);
        return { kind: "relation", id, linked: true };
      }
      case "unlink": {
        this.entity(op.source);
        if (op.kind !== undefined) this.relationDefinition(op.kind);
        const found = this.all(
          "SELECT id FROM relations WHERE source=?" +
            (op.kind !== undefined ? " AND kind=?" : "") +
            (op.target !== undefined ? " AND target=?" : ""),
          [
            op.source,
            ...(op.kind !== undefined ? [op.kind] : []),
            ...(op.target !== undefined ? [op.target] : []),
          ]
        );
        for (const r of found)
          this.mutate({ op: "removeRelation", relation: r.id }, now, changes);
        return done;
      }
      case "removeRelation": {
        const r =
          this.relation(op.relation) ??
          fail("NO_SUCH_RELATION", "No such relation");
        this.run("DELETE FROM relations WHERE id=?", [op.relation]);
        changes.add(`relation:${op.relation}`);
        changes.add(`kind:${r.kind}`);
        return done;
      }
      case "updateRelation": {
        const r =
          this.relation(op.relation) ??
          fail("NO_SUCH_RELATION", "No such relation");
        const source = op.source ?? r.source,
          target = op.target ?? r.target;
        const definition = this.relationDefinition(r.kind);
        const key = definition.key ?? [];
        const providedInfo = op.info ?? undefined;
        if (providedInfo !== undefined) this.validate(providedInfo);
        checkRelationKeyInfo(key, providedInfo);
        const info = providedInfo === undefined ? r.info : providedInfo;
        if (source !== r.source || target !== r.target || !sameRelationKey(key, r.info, info)) {
          const duplicate = this.matchingRelation(r.kind, source, target, key, info, r.id);
          if (duplicate) fail('DUPLICATE_EDGE', `An edge of ${r.kind} with these ends and key already exists: ${duplicate.id}`);
        }
        if ((source !== r.source || target !== r.target) && source === target)
          fail("SELF_LINK", "A self link is refused");
        if (
          this.relationDefinition(r.kind).acyclic &&
          (source !== r.source || target !== r.target) &&
          this.wouldCycle(source, target, [r.kind])
        )
          fail("CYCLE", "Moving relation would create a cycle");
        const weight = op.weight === undefined ? this.get('SELECT weight FROM relations WHERE id=?', [r.id])!.weight :
          relationWeight(!!definition.weighted, r.kind, op.weight);
        this.run("UPDATE relations SET source=?,target=?,seq=?,info=?,weight=? WHERE id=?", [
          source,
          target,
          source !== r.source || target !== r.target ? this.next('seq') : this.get('SELECT seq FROM relations WHERE id=?', [r.id])!.seq,
          providedInfo === undefined
            ? r.info === null
              ? null
              : this.pack(r.info)
            : this.pack(providedInfo),
          op.weight === undefined ? weight : weight === undefined ? null : this.pack(weight),
          r.id,
        ]);
        changes.add(`relation:${r.id}`);
        changes.add(`kind:${r.kind}`);
        return done;
      }
      default:
        return fail(
          "UNSUPPORTED",
          `SQLite evaluation has not implemented operation ${op.op}`
        );
    }
  }
  wouldCycle(source: string, target: string, kinds: string[]): boolean {
    if (!kinds.length) return false;
    const marks = kinds.map(() => "?").join(",");
    return !!this.get(
      `WITH RECURSIVE reachable(id) AS (SELECT ? UNION SELECT r.target FROM relations r JOIN reachable p ON r.source=p.id WHERE r.kind IN (${marks})) SELECT 1 FROM reachable WHERE id=? LIMIT 1`,
      [target, ...kinds, source]
    );
  }
  trackKey(key: string) {
    this.tracks.add(this.recording, 'keys', key);
  }
  trackRange(range: string) {
    this.tracks.add(this.recording, 'ranges', range);
  }
  private touched(changes: Set<string>): number[] {
    return this.tracks.affected(changes);
  }
  trackStats() {
    return this.tracks.stats();
  }
  untrack(token: number) {
    this.tracks.untrack(token);
  }
  private answer(read: ReadOp): Answer {
    switch (read.read) {
      case "row":
        this.trackKey(`entity:${read.id}`);
        return {
          kind: "row",
          row: this.row(read.id) ?? null,
          plainObjects: true,
        };
      case "field": {
        this.trackKey(`field:${read.id}:${read.field}`);
        const row = this.row(read.id, [read.field]);
        return {
          kind: "field",
          present: !!row && has(row, read.field),
          value: row?.[read.field] ?? null,
        };
      }
      case "relation":
        this.trackKey(`relation:${read.id}`);
        return { kind: "relation", relation: this.relation(read.id) ?? null };
      case "findRelations": {
        const terms: string[] = [],
          params: any[] = [];
        for (const key of ["kind", "source", "target"] as const)
          if (read[key] !== undefined) {
            terms.push(`${key}=?`);
            params.push(read[key]);
          }
        if (read.kind !== undefined) {
          this.relationDefinition(read.kind);
          this.trackRange(`kind:${read.kind}`);
        } else
          for (const k of Object.keys(this.heldSchema.relations))
            this.trackRange(`kind:${k}`);
        return {
          kind: "relations",
          relations: this.all(
            "SELECT * FROM relations" +
              (terms.length ? " WHERE " + terms.join(" AND ") : "") +
              " ORDER BY seq",
            params
          ).map((r) => this.decodeRelation(r)),
        };
      }
      case "wouldCreateCycle":
        for (const k of read.kinds) this.trackRange(`kind:${k}`);
        return {
          kind: "bool",
          value: this.wouldCycle(read.source, read.target, read.kinds),
        };
      case "pendingEmbeddings":
        this.trackRange(`rows:${read.type}`);
        return this.search.pending(read.type, read.limit ?? 100);
      case "query": {
        if (read.explain) return this.explain(read.plan);
        const answer = executeQuery(this, read.plan, read.visits === true);
        return read.visits
          ? { kind: "visited", answer, visited: answer.__visited ?? 0 }
          : answer;
      }
      default:
        return fail(
          "UNSUPPORTED",
          `SQLite evaluation has not implemented read ${read.read}`
        );
    }
  }
  private checkRevision() {
    if (Number(this.meta("schemaRevision") ?? 0) !== this.heldRevision)
      fail(
        "SCHEMA_CHANGED",
        "The schema or its index generations changed in another handle; reopen this handle"
      );
  }
  readSync(request: ReadRequest): Answer[] {
    this.assertOpen();
    const previous = this.recording;
    if (request.track !== undefined) this.recording = this.tracks.track(request.track);
    const snapshot = !this.active;
    if (snapshot) this.sql.exec("BEGIN");
    try {
      this.checkRevision();
      const answer = request.reads.map((r) => this.answer(r)) as Answer[];
      if (snapshot) this.sql.exec("COMMIT");
      return answer;
    } catch (e) {
      this.abortFailedOperation(e, snapshot ? 'ROLLBACK' : null);
    } finally {
      this.recording = previous;
    }
  }
  begin(): SqliteUnit {
    this.writable();
    if (this.active) fail("UNIT_OPEN", "A unit is already open");
    this.sql.exec("BEGIN IMMEDIATE");
    try {
      this.checkRevision();
    } catch (e) {
      this.abortFailedOperation(e);
    }
    const unit = new SqliteUnit(this);
    this.active = unit;
    return unit;
  }
  write(request: WriteRequest, _durable?: boolean | null): WriteResult {
    const unit = this.begin();
    try {
      const results = unit.write(request).results;
      const changes = unit.commit();
      return { results, changes };
    } catch (e) {
      this.abortFailedOperation(e);
    }
  }
  batch(request: WriteRequest, changes: Set<string>): WriteResult {
    const name = `batch_${++this.counter}`;
    this.sql.exec(`SAVEPOINT ${name}`);
    const pending = new Set<string>();
    try {
      const results = request.ops.map((op: Data) =>
        this.mutate(op, request.now ?? Date.now(), pending) as OpResult
      );
      this.sql.exec(`RELEASE ${name}`);
      for (const key of pending) changes.add(key);
      return { results };
    } catch (e) {
      this.abortFailedOperation(e, `ROLLBACK TO ${name}; RELEASE ${name}`);
    }
  }
  finish(unit: SqliteUnit, commit: boolean): Changes {
    if (this.active !== unit) fail("CLOSED", "This unit has ended");
    try {
      const sequence = commit ? this.advanceCounter("commit") : this.sequence;
      const changes = unit.changesForCommit();
      const result = { sequence, touched: this.touched(changes) };
      if (commit) {
        for (const changed of changes)
          if (changed.startsWith("relation:")) {
            const r = this.relation(changed.slice(9));
            if (r) {
              const missing = !this.get("SELECT 1 FROM entities WHERE id=?", [r.source])
                ? r.source
                : !this.get("SELECT 1 FROM entities WHERE id=?", [r.target])
                ? r.target
                : undefined;
              if (missing)
                fail(
                  "NO_SUCH_ENTITY",
                  `link(${r.kind}, ${JSON.stringify(
                    missing
                  )}): no entity has this id; no entity has the id ${JSON.stringify(
                    missing
                  )}`
                );
            }
          }
        this.putMeta("commit", sequence);
        this.commitWrite();
        this.indexBuilds.committed(changes);
      } else { if (this.sql.inTransaction) this.sql.exec("ROLLBACK"); this.layouts.clear(); }
      return result;
    } catch (e) {
      this.abortFailedOperation(e);
    } finally {
      this.active = undefined;
      unit.ended();
      this.indexBuilds.wake();
    }
  }
  assertNativeMaintenance():void {this.writable();this.checkRevision();}
  assertWriteAuthority() { this.writeLease.assertWritable(); }
  invalidateLayouts() { this.layouts.clear(); }
  private indexSpecs(schema: Data): SqliteIndexSpec[] {
    const indexes: SqliteIndexSpec[] = [];
    for (const [type, definition] of Object.entries(schema.types) as Array<[string, Data]>) {
      const fields = new Set<string>(['role', 'shortCode']);
      for (const [name, index] of Object.entries(definition.indexes ?? {}) as Array<[string, Data]>) {
        if (index.kind === 'value') fields.add(index.fields[0]);
        else indexes.push({ type, name, kind: index.kind, definition: index });
      }
      for (const field of fields) indexes.push({ type, name: field, kind: 'value', definition: { field } });
    }
    return indexes;
  }
  indexesReady(): Promise<void> { return this.indexBuilds.indexesReady(); }
  nativeModelsReady(): Promise<void> { return this.indexBuilds.indexesReady('native'); }
  onIndexesChanged(listener: (changes: Changes) => void): () => void {
    this.indexListeners.add(listener); return () => { this.indexListeners.delete(listener); };
  }
  /** A derived visibility transition reuses the current logical commit identity. */
  indexesChanged(type: string): void {
    const changes = { sequence: this.sequence, touched: this.touched(new Set([`rows:${type}`])) };
    for (const listener of this.indexListeners) {
      try { withoutWriteAuthority(() => listener(changes)); } catch (error) { queueMicrotask(() => { throw error; }); }
    }
  }
  setSchema(schema: object): any[] {
    this.writable();
    if (this.active) fail("UNIT_OPEN", "Commit or abort the open unit first");
    this.checkRevision();
    (this.schemaValidator ??= createSchemaValidator())(schema);
    const next = this.clone(schema) as Data;
    if (sameValue(next, this.heldSchema)) return [];
    const report = Object.keys(next.types)
      .filter((t) => !has(this.heldSchema.types, t))
      .map((t) => ({ path: `types.${t}`, change: "added", effect: "applied" }));
    this.sql.exec("BEGIN IMMEDIATE");
    try {
      this.checkRevision();
      const revision = this.advanceCounter("schemaRevision"), sequence = this.advanceCounter("commit");
      // Incumbent-dependent refusals belong under writer ownership: another handle can issue its first short
      // code between the earlier structural checks and BEGIN IMMEDIATE without changing the schema revision.
      for (const [type, def] of Object.entries(next.types) as Array<[string, Data]>) {
        const old = this.heldSchema.types[type]?.shortCode?.prefix;
        if (
          old !== def.shortCode?.prefix &&
          this.get(
            "SELECT 1 FROM entities WHERE type=? AND short_code IS NOT NULL",
            [type]
          )
        )
          fail(
            "SCHEMA_CHANGE_REFUSED",
            `Cannot change ${type}'s short code prefix`
          );
      }
      for (const [type, definition] of Object.entries(next.types) as Array<[string, Data]>) this.layouts.set(type,
        this.values.declare(type, ['createdAt','updatedAt','trashedAt','shortCode','role', ...Object.keys(definition.fields ?? {})]));
      this.indexBuilds.admit(this.indexSpecs(next));
      this.search.ensure(next);
      this.putMeta("schema", next);
      this.putMeta("schemaRevision", revision);
      this.putMeta("commit", sequence);
      const indexState = this.indexBuilds.readState();
      this.commitWrite();
      this.heldSchema = next;
      this.schemaPresent = true;
      this.heldRevision = revision;
      this.indexBuilds.acceptState(indexState);
      this.indexBuilds.wake();
      return report;
    } catch (e) {
      this.abortFailedOperation(e);
    }
  }
  /** Durably queue physical replacements while preserving canonical data and current native models. */
  refreshNativeModels():void {
    this.writable();
    if(this.active)fail('UNIT_OPEN','Commit or abort the open unit before refreshing native models');
    this.sql.exec('BEGIN IMMEDIATE');
    try {
      this.checkRevision();this.indexBuilds.refreshNativeModels();this.commitWrite();
    } catch(error){this.abortFailedOperation(error);}
    this.indexBuilds.wake();
  }
  /** Admit fresh derived generations without changing primary data or its logical commit identity. */
  rebuildIndexes(options: {repairNative?:boolean} = {}): void {
    this.writable();
    if (this.active) fail('UNIT_OPEN', 'Commit or abort the open unit before rebuilding indexes');
    this.indexBuilds.assertRunning();
    this.sql.exec('BEGIN IMMEDIATE');
    try {
      this.checkRevision();
      const revision = this.advanceCounter('schemaRevision');
      if(options.repairNative){this.indexBuilds.assertNativeMaintenanceOwnership();repairNativeVectors(this);}
      // Explicit offline maintenance rebuilds generationless membership in this same atomic admission.
      // SQLite owns the scan and insertion; the callback only decodes one authoritative array at a time.
      this.values.rebuildMembers();
      this.invalidateNativeModels();
      const jobs = this.indexBuilds.jobs();
      this.indexBuilds.restart(jobs);
      // Offline maintenance already owns the writer. Prove absence natively instead of committing
      // thousands of empty background batches for optional fields such as role and shortCode.
      for (const job of jobs) if (job.kind === 'value' && !this.values.hasStoredField(this.valueLayout(job.type), job.name))
        this.run("UPDATE index_builds SET state='ready',after_seq=through_seq WHERE type=? AND kind='value' AND name=?",
          [job.type, job.name]);
      this.search.ensure(this.heldSchema);
      this.sql.exec('DELETE FROM embedding_search');
      this.putMeta('schemaRevision', revision);
      const state = this.indexBuilds.readState();
      this.commitWrite();
      this.heldRevision = revision;
      this.indexBuilds.acceptState(state);
      this.indexBuilds.wake();
      for (const type of new Set(jobs.map(job => job.type))) this.indexesChanged(type);
    } catch (error) { this.abortFailedOperation(error); }
  }
  /** Called under native maintenance ownership; each transaction retires at most 32 derived rows. */
  collectInvalidatedNativeModels():boolean {
    this.writable();
    if(!this.nativeReader)return false;
    this.sql.exec('BEGIN IMMEDIATE');
    try {
      this.checkRevision();const progressed=this.nativeReader.collectSuperseded(32);this.commitWrite();return progressed;
    }catch(error){this.abortFailedOperation(error);}
  }
  private invalidateNativeModels():void {
    if(!this.get("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='vector_indexes'"))return;
    if(!this.nativeExtension)fail('NATIVE_MISSING','Load the trusted extension before replacing native model data');
    this.nativeReader ??= new SqliteVectorIndex(this,this.nativeExtension!);
    this.nativeReader.invalidate();
    if(this.get("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='vector_training'"))this.sql.exec('DELETE FROM vector_training');
  }
  reset() {
    const unit = this.begin();
    try {
      this.invalidateNativeModels();
      this.search.clear();
      this.values.clear();
      this.sql.exec(
        "DELETE FROM field_index; DELETE FROM relations; DELETE FROM entities;"
      );
      unit.changes.add("all");
      unit.commit();
    } catch (e) {
      this.abortFailedOperation(e);
    }
  }
  bulkLoad(loads: readonly Load[]) {
    const unit = this.begin();
    try {
      for (const load of loads) {
        if (load.load === "entity") {
          let row = this.row(load.id);
          if (!row) {
            row = this.newRow(
              { type: typeOf(load.id), id: load.id, fields: {} },
              0,
              unit.changes,
              true
            );
            delete row.createdAt;
            delete row.updatedAt;
          }
          const before = this.clone(row);
          for (const [k, v] of Object.entries(load.fields)) if (v !== undefined) own(row, k, this.canonical(v));
          if (load.trashed && !has(row, "trashedAt")) row.trashedAt = 0;
          this.save(row, unit.changes, before);
        } else if (load.load === "sequence")
          this.putMeta(
            load.name,
            Math.max(Number(this.meta(load.name) ?? 0), load.next)
          );
        else if (load.load === "relation") {
          this.run("INSERT OR REPLACE INTO relations VALUES (?,?,?,?,?,?,?)", [
            load.id,
            load.kind,
            load.source,
            load.target,
            this.next("seq"),
            load.info === undefined ? null : this.pack(load.info),
            load.weight === undefined ? null : this.pack(load.weight),
          ]);
          unit.changes.add(`kind:${load.kind}`);
        } else if (load.load === 'embedding') {
          const owner = this.get('SELECT type FROM entities WHERE id=?', [load.id]);
          if (owner) {
            const row = { id: load.id, index: load.index, chunk: load.chunk, hash: load.hash, model: load.model,
              dimensions: load.vector.length, bytes: encodeEmbeddingVector(load.vector, load.vector.length) };
            this.embeddings.replace(row); this.embeddings.relink(row);
            unit.changes.add(`vectors:${owner.type}`);
          }
        } else if (load.load === "unset") {
          const r = this.row(load.id);
          if (r) {
            const before = this.clone(r);
            delete r[load.field];
            this.save(r, unit.changes, before);
          }
        } else
          fail("UNSUPPORTED", "Unknown SQLite load");
      }
      // Unchecked import deliberately permits invalid data, just as the existing admin API does.
      this.putMeta("commit", this.advanceCounter("commit"));
      this.commitWrite();
      this.indexBuilds.committed(unit.changes);
      this.active = undefined;
      unit.ended();
      this.indexBuilds.wake();
    } catch (e) {
      this.abortFailedOperation(e);
    }
  }
  stats() {
    const types: Record<string, { live: number; trashed: number }> =
      Object.fromEntries(
        this.all(
          "SELECT type,sum(trashed=0) live,sum(trashed=1) trashed FROM entities GROUP BY type ORDER BY type"
        ).map((r) => [r.type, { live: r.live, trashed: r.trashed }])
      );
    return {
      types,
      relations: Object.fromEntries(
        this.all("SELECT kind,count(*) n FROM relations GROUP BY kind").map(
          (r) => [r.kind, r.n]
        )
      ),
      fileBytes: statSync(join(this.path, "data.sqlite3")).size,
    };
  }
  backup(target: string) {
    this.assertOpen();
    if (this.active) fail("UNIT_OPEN", "A unit is open");
    mkdirSync(target, { recursive: true });
    const file = join(target, "data.sqlite3");
    inspectDatabaseFiles(target, { empty: true });
    this.run("VACUUM INTO ?", [file]);
  }
  replaceWith(source: string) {
    this.writable();
    if (this.active) fail("UNIT_OPEN", "A unit is open");
    if (resolve(source) === this.path)
      fail("ALREADY_OPEN", "Cannot replace a database with itself");
    const sourceFile = join(resolve(source), "data.sqlite3");
    if (!existsSync(sourceFile))
      fail("NO_DATABASE", "Replacement source does not exist");
    const incoming = new SqliteDatabase({ path: source, readOnly: true, nativeVectorExtension: this.nativeVectorExtension });
    let failed = false, failure: unknown;
    try {
      incoming.sql.exec('BEGIN');
      const unit = this.begin();
      try {
        this.invalidateNativeModels();
        this.search.clear(); this.values.clear();
        this.sql.exec("DELETE FROM field_index; DELETE FROM relations; DELETE FROM entities;");
        this.sql.exec("DELETE FROM meta WHERE key NOT IN ('schema','commit','schemaRevision')");
        for (const entry of incoming.all("SELECT key,value FROM meta WHERE key NOT IN ('schema','commit','schemaRevision')"))
          this.run('INSERT INTO meta VALUES (?,?)', [entry.key,entry.value]);
        let position = 0;
        for (;;) {
          const page = incoming.all('SELECT id,type,seq,trashed,short_code FROM entities WHERE seq>? ORDER BY seq LIMIT 16', [position]);
          if (!page.length) break;
          const groups = new Map<string, string[]>();
          for (const row of page) {
            this.run('INSERT INTO entities VALUES (?,?,?,?,?)', [row.id,row.type,row.seq,row.trashed,row.short_code]);
            const layout = this.valueLayout(row.type, true);
            this.run(`INSERT INTO ${layout.table}(entity_id) VALUES (?)`, [row.id]);
            const ids = groups.get(row.type) ?? []; ids.push(row.id); groups.set(row.type, ids);
          }
          for (const [type, ids] of groups) {
            const layout = incoming.values.layout(type) ?? fail('CORRUPT', 'Replacement source lacks primary values');
            for (const cell of logicalValues(incoming, layout, ids))
              this.values.restoreCell(this.valueLayout(type), cell.id, cell.field, cell.storageKind, cell.value);
          }
          for (const record of page) {
            const row = this.row(record.id)!;
            this.refile(row, record.seq); this.search.refile(row, record.seq);
          }
          position = page.at(-1)!.seq;
        }
        let after = -1;
        for (;;) {
          const batch = incoming.all('SELECT * FROM relations WHERE seq>? ORDER BY seq LIMIT 256', [after]);
          if (!batch.length) break;
          for (const row of batch) {
            this.run('INSERT INTO relations VALUES (?,?,?,?,?,?,?)', [row.id,row.kind,row.source,row.target,row.seq,row.info,row.weight]);
            after = row.seq;
          }
        }
        for (const value of incoming.statement('SELECT entity_id,index_name,chunk,hash,model,dims,embedding FROM embedding_values ORDER BY id').iterate()) {
          const row = value as {entity_id: string; index_name: string; chunk: number; hash: string; model: string; dims: number; embedding: Uint8Array};
          this.embeddings.restore({ id: row.entity_id, index: row.index_name, chunk: row.chunk, hash: row.hash,
            model: row.model, dimensions: row.dims, bytes: row.embedding });
        }
        this.embeddings.relink();
        // All source reads are complete. A source-close refusal must roll back the destination,
        // rather than appear after its commit or mask an uncertain commit outcome.
        incoming.close();
        unit.changes.add('all'); unit.commit();
      } catch (error) { this.abortFailedOperation(error); }
    } catch (error) { failed = true; failure = error; }
    if (incoming.isOpen) {
      try { incoming.close(); }
      catch (cleanup) {
        failure = failed ? Object.assign(new AggregateError([failure, cleanup], 'Replacement and source cleanup failed', { cause: failure }),
          { code: (failure as { code?: unknown })?.code }) : cleanup;
        failed = true;
      }
    }
    if (failed) throw failure;
  }

  withExclusiveWrites<T>(operation: () => Promise<T>): Promise<T> {
    // A poisoned handle still needs a lease for drain/close. Data operations retain their fault guard.
    if(!this.opened)fail('CLOSED','The database is closed');
    if (this.active) return Promise.reject(Object.assign(new Error('Commit or abort the open unit before maintenance'), { code: 'UNIT_OPEN' }));
    return this.writeLease.run(operation);
  }
  withoutWriteAuthority<T>(operation: () => T): T { return withoutWriteAuthority(operation); }

  async durable() {
    this.assertOpen();
  }
  /** Storage owners drain workers before replacing/removing files; close remains synchronous. */
  async drainBackground():Promise<void> {
    if(!this.opened)return;
    this.writeLease.assertWritable();
    if(this.active)fail('UNIT_OPEN','End the open unit before draining background work');
    this.draining ??= this.indexBuilds.drain();
    await this.draining;
  }
  close() {
    if (!this.opened) return;
    this.writeLease.assertWritable();
    this.indexBuilds.stop();
    if (this.active) this.active.abort();
    this.indexBuilds.releaseNativeMaintenance();
    this.closeController.abort();
    this.sql.close();
    this.communityCore = undefined;
    this.opened = false;
    this.tracks.clear();
    this.indexListeners.clear();
    this.statements.clear();
    this.layouts.clear();
  }
}

class SqliteUnit implements EarsUnit {
  private readonly rootChanges = new Set<string>();
  private readonly savepoints: Array<{ depth: number; changes: Set<string> }> = [];
  // Only changes in the current savepoint receive newly completed batches. Releasing merges its delta;
  // rolling back discards it. No write copies the changes accumulated by the entire outer unit.
  get changes(): Set<string> { return this.savepoints.at(-1)?.changes ?? this.rootChanges; }
  changesForCommit(): Set<string> {
    for (const point of this.savepoints) for (const key of point.changes) this.rootChanges.add(key);
    return this.rootChanges;
  }
  private open = true;
  private depth = 0;
  private readonly db: SqliteDatabase;
  constructor(db: SqliteDatabase) { this.db = db; }
  get isOpen() {
    return this.open;
  }
  ended() {
    this.open = false;
  }
  write(request: WriteRequest) {
    this.db.assertWriteAuthority();
    if (!this.open) fail("CLOSED", "Unit has ended");
    return this.db.batch(request, this.changes);
  }
  read(request: ReadRequest) {
    if (!this.open) fail("CLOSED", "Unit has ended");
    return this.db.readSync(request);
  }
  savepoint() {
    this.db.assertWriteAuthority();
    if (!this.open) fail("CLOSED", "Unit has ended");
    const n = this.depth + 1;
    try { this.db.sql.exec(`SAVEPOINT unit_${n}`); }
    catch (error) { this.db.abortFailedOperation(error, null); }
    this.savepoints.push({ depth: n, changes: new Set() });
    this.depth = n;
    return n;
  }
  rollbackTo(n: number) {
    this.db.assertWriteAuthority();
    if (!this.open) fail("CLOSED", "Unit has ended");
    const index = this.savepoints.findIndex(point => point.depth === n);
    if (index < 0) fail("BATCH_INVALID", "No open savepoint has this depth");
    try { this.db.sql.exec(`ROLLBACK TO unit_${n}; RELEASE unit_${n}`); }
    catch (error) { this.db.abortFailedOperation(error); }
    this.savepoints.splice(index);
    this.db.invalidateLayouts();
    this.depth = n - 1;
  }
  release(n: number) {
    this.db.assertWriteAuthority();
    if (!this.open) fail("CLOSED", "Unit has ended");
    const index = this.savepoints.findIndex(point => point.depth === n);
    if (index < 0) fail("BATCH_INVALID", "No open savepoint has this depth");
    try { this.db.sql.exec(`RELEASE unit_${n}`); }
    catch (error) { this.db.abortFailedOperation(error); }
    const kept = this.savepoints.splice(index);
    for (const point of kept) for (const key of point.changes) this.changes.add(key);
    this.depth = n - 1;
  }
  commit(_durable?: boolean | null) {
    this.db.assertWriteAuthority();
    if (!this.open) fail("CLOSED", "Unit has ended");
    return this.db.finish(this, true);
  }
  abort() {
    this.db.assertWriteAuthority();
    if (this.open) this.db.finish(this, false);
  }
}
export { scalarKey };
