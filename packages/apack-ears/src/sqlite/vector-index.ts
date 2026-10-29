// Generation-owned native projections. The database owner supplies its trusted extension;
// no database metadata may select executable code. Training and packaging have separate owners.
import { createHash } from 'node:crypto';
import type { SqliteDatabase } from './database.ts';
import type { SqliteIndexJob } from './index-builds.ts';
import type { SqliteEntityScope } from './query-scope.ts';

const fail = (code: string, message: string): never => { throw Object.assign(new Error(message), { code }); };
function table(generation: number): string {
  if (!Number.isSafeInteger(generation) || generation < 1) fail('CORRUPT', 'Invalid native vector generation');
  return 'ann_' + generation;
}

export class SqliteVectorIndex {
  private readonly db: SqliteDatabase;
  constructor(db: SqliteDatabase, extension: string) {
    this.db = db;
    db.sql.loadExtension(extension);
    const indexed=db.get("SELECT 1 FROM sqlite_schema WHERE type='index' AND name='chunk_native_admission'");
    if(!indexed) {
      if(db.readOnly)fail('CORRUPT','Missing native admission cursor index');
      if(db.get('SELECT 1 FROM chunks LIMIT 1'))fail('MAINTENANCE_REQUIRED','Prepare the native admission cursor index offline before enabling it on a populated store');
      db.sql.exec('CREATE INDEX chunk_native_admission ON chunks(generation,embedding_id) WHERE embedding_id IS NOT NULL');
    }
    if (!db.readOnly) db.sql.exec(`CREATE TABLE IF NOT EXISTS vector_indexes(
      generation INTEGER PRIMARY KEY,state TEXT NOT NULL CHECK(state IN ('building','ready')),
      after_id INTEGER NOT NULL,model_sha256 TEXT NOT NULL);`);
  }
  private writer(): void {
    if (this.db.readOnly || !this.db.sql.inTransaction) fail('UNIT_REQUIRED', 'Native index admission requires writer ownership');
  }
  /** Install into an empty private generation. Any model/DDL refusal rolls back with its caller. */
  admit(job: SqliteIndexJob, model: Uint8Array): void {
    this.writer();
    const current = this.db.indexBuilds.index(job.type, 'vector', job.name);
    if (job.kind !== 'vector' || current.generation !== job.generation ||
        JSON.stringify(current.definition) !== JSON.stringify(job.definition)) fail('SCHEMA_CHANGED', 'Native vector admission is stale');
    const name = table(job.generation), gen = job.generation;
    this.db.sql.exec(`CREATE VIRTUAL TABLE ${name} USING vec1(v,owner,active);`);
    this.db.run(`INSERT INTO ${name}(cmd,arg) VALUES ('rebuild',?)`, [Buffer.from(model)]);
    this.db.run("INSERT INTO vector_indexes VALUES (?,'building',0,?)",
      [gen, createHash('sha256').update(model).digest('hex')]);
    const project = `INSERT INTO ${name}(rowid,v,owner,active)
      SELECT v.id,coalesce(p.normalized,v.embedding),e.seq,1-e.trashed
      FROM embedding_values v JOIN entities e ON e.id=v.entity_id
      LEFT JOIN embedding_search p ON p.embedding_id=v.id WHERE v.id=NEW.embedding_id AND NEW.generation=${gen};`;
    // Native writes share the foreground transaction, including nested savepoints. Triggers also
    // reconcile writes behind the admission cursor, so readiness never publishes an old snapshot.
    this.db.sql.exec(`CREATE TRIGGER ${name}_insert AFTER INSERT ON chunks WHEN NEW.generation=${gen} BEGIN
        ${project} END;
      CREATE TRIGGER ${name}_update AFTER UPDATE OF embedding_id,generation,entity_id ON chunks
        WHEN OLD.generation=${gen} OR NEW.generation=${gen} BEGIN
        DELETE FROM ${name} WHERE rowid=OLD.embedding_id AND OLD.generation=${gen}; ${project} END;
      CREATE TRIGGER ${name}_delete AFTER DELETE ON chunks WHEN OLD.generation=${gen} BEGIN
        DELETE FROM ${name} WHERE rowid=OLD.embedding_id; END;
      CREATE TRIGGER ${name}_trash AFTER UPDATE OF trashed ON entities WHEN OLD.trashed!=NEW.trashed BEGIN
        UPDATE ${name} SET active=1-NEW.trashed WHERE rowid IN
          (SELECT embedding_id FROM chunks WHERE entity_id=NEW.id AND generation=${gen} AND embedding_id IS NOT NULL); END;`);
  }
  /** The scheduler owns short transactions; concurrent changes are already captured by the triggers. */
  step(generation: number, limit: number): boolean {
    this.writer();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128) fail('VALUE_INVALID', 'Invalid native projection batch');
    const name = table(generation), state = this.db.get('SELECT * FROM vector_indexes WHERE generation=?', [generation]);
    if (!state) fail('CORRUPT', 'Missing native vector admission');
    if (state!.state === 'ready') return true;
    const rows = this.db.all(`WITH page AS MATERIALIZED (
      SELECT entity_id,embedding_id FROM chunks WHERE generation=? AND embedding_id>? ORDER BY embedding_id LIMIT ?)
      SELECT v.id,coalesce(p.normalized,v.embedding) embedding,e.seq,1-e.trashed active
      FROM page c JOIN embedding_values v ON v.id=c.embedding_id JOIN entities e ON e.id=c.entity_id
      LEFT JOIN embedding_search p ON p.embedding_id=v.id`, [generation, state!.after_id, limit]);
    for (const row of rows) {
      if (!Number.isSafeInteger(row.id) || !Number.isSafeInteger(row.seq)) fail('CORRUPT', 'Invalid native vector identity');
      this.db.run(`DELETE FROM ${name} WHERE rowid=?`, [BigInt(row.id)]);
      this.db.run(`INSERT INTO ${name}(rowid,v,owner,active) VALUES (?,?,?,?)`,
        [BigInt(row.id),row.embedding,BigInt(row.seq),BigInt(row.active)]);
    }
    const ready = rows.length < limit;
    this.db.run('UPDATE vector_indexes SET after_id=?,state=? WHERE generation=?',
      [rows.at(-1)?.id ?? state!.after_id, ready ? 'ready' : 'building', generation]);
    return ready;
  }
  /** Chunk candidates only; final owner aggregation/reranking remains the query owner's responsibility. */
  candidates(generation: number, vector: Uint8Array, limit: number, scope: SqliteEntityScope | null = null,
    exclude?: string, projection:'owners'|'chunks'='chunks'): Array<Record<string, any>> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 4096) fail('VALUE_INVALID', 'Invalid native candidate limit');
    if(!this.db.get("SELECT 1 FROM index_builds WHERE generation=? AND kind='vector'",[generation]))
      fail('SCHEMA_CHANGED','Native vector generation was retired');
    const name = table(generation), state = this.db.get('SELECT state FROM vector_indexes WHERE generation=?', [generation]);
    if (state?.state !== 'ready') fail('INDEX_BUILDING', 'Native vector projection is not ready');
    const filter = scope || exclude ? `owner IN (SELECT e.seq FROM entities e WHERE
      ${scope ? `e.id IN (${scope.sql})` : 'e.trashed=0'} AND e.id!=?)` : 'active=1';
    // Owner admission does not need native Float32 payloads or a second exact distance calculation.
    const columns=projection==='owners'?'owner':'rowid embedding_id,owner,vec1_cos_distance(v,?) distance';
    return this.db.all(`SELECT ${columns} FROM ${name}(?,?) WHERE ${filter}`,
      [...(projection==='owners'?[]:[Buffer.from(vector)]),Buffer.from(vector),JSON.stringify({K:limit,nprobe:32}),
        ...(scope || exclude ? [...(scope?.parameters ?? []),exclude ?? ''] : [])]);
  }
  collect(generation:number,limit:number):boolean {
    this.writer();
    if(!Number.isSafeInteger(limit)||limit<1||limit>128)fail('VALUE_INVALID','Invalid native retirement batch');
    const name=table(generation);
    return Number(this.db.run(`DELETE FROM ${name} WHERE rowid IN (SELECT rowid FROM ${name} LIMIT ?)`,[limit]).changes)<limit;
  }
  /** Caller must first retire projection rows in bounded batches; DROP must not hide live work. */
  retire(generation: number): void {
    this.writer(); const name = table(generation);
    if (this.db.get(`SELECT 1 FROM ${name} LIMIT 1`)) fail('INDEX_NOT_EMPTY', 'Retire native rows before dropping the group');
    this.db.sql.exec(`DROP TRIGGER ${name}_insert; DROP TRIGGER ${name}_update;
      DROP TRIGGER ${name}_delete; DROP TRIGGER ${name}_trash; DROP TABLE ${name};`);
    this.db.run('DELETE FROM vector_indexes WHERE generation=?', [generation]);
  }
}
