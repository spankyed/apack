// Generation-owned native projections. The database owner supplies its trusted extension;
// no database metadata may select executable code. Training and packaging have separate owners.
import { createHash } from 'node:crypto';
import { prepareEmptyNativeVectorCursor } from './vector-cursor.ts';
import type { SqliteDatabase } from './database.ts';
import type { SqliteIndexJob } from './index-builds.ts';
import type { SqliteEntityScope } from './query-scope.ts';

const fail = (code: string, message: string): never => { throw Object.assign(new Error(message), { code }); };
function table(identity: number): string {
  if (!Number.isSafeInteger(identity) || identity < 1) fail('CORRUPT', 'Invalid native vector generation');
  return 'ann_' + identity;
}

/** Exact trigger definitions for a pinned physical model; audits compare persisted SQL with this contract. */
export function nativeVectorTriggers(identity:number,generation:number):string[] {
  const name=table(identity),gen=generation;
  const project = `INSERT INTO ${name}(rowid,v,owner,active)
      SELECT v.id,coalesce(p.normalized,v.embedding),e.seq,1-e.trashed
      FROM embedding_values v JOIN entities e ON e.id=v.entity_id
      LEFT JOIN embedding_search p ON p.embedding_id=v.id WHERE v.id=NEW.embedding_id AND NEW.generation=${gen};`;
    // Native writes share the foreground transaction, including nested savepoints. Triggers also
    // reconcile writes behind the admission cursor, so readiness never publishes an old snapshot.
    const sql=`CREATE TRIGGER ${name}_insert AFTER INSERT ON chunks WHEN NEW.generation=${gen} BEGIN
        ${project} END;
      CREATE TRIGGER ${name}_update AFTER UPDATE OF embedding_id,generation,entity_id ON chunks
        WHEN OLD.generation=${gen} OR NEW.generation=${gen} BEGIN
        DELETE FROM ${name} WHERE rowid=OLD.embedding_id AND OLD.generation=${gen}; ${project} END;
      CREATE TRIGGER ${name}_delete AFTER DELETE ON chunks WHEN OLD.generation=${gen} BEGIN
        DELETE FROM ${name} WHERE rowid=OLD.embedding_id; END;
      CREATE TRIGGER ${name}_trash AFTER UPDATE OF trashed ON entities WHEN OLD.trashed!=NEW.trashed BEGIN
        UPDATE ${name} SET active=1-NEW.trashed WHERE rowid IN
          (SELECT embedding_id FROM chunks WHERE entity_id=NEW.id AND generation=${gen} AND embedding_id IS NOT NULL); END;`;
  return sql.split(/;(?=\s*CREATE TRIGGER)/).map(statement=>statement.trim().replace(/;$/,''));
}

export class SqliteVectorIndex {
  private readonly db: SqliteDatabase;
  constructor(db: SqliteDatabase, extension: string) {
    this.db = db;
    db.loadNativeVectors(extension);
    if (!prepareEmptyNativeVectorCursor(db)) {
      if(db.readOnly)fail('CORRUPT','Missing native admission cursor index');
      fail('MAINTENANCE_REQUIRED','Prepare the native admission cursor index offline before enabling it on a populated store');
    }
    if (!db.readOnly) db.sql.exec(`CREATE TABLE IF NOT EXISTS vector_indexes(
      id INTEGER PRIMARY KEY AUTOINCREMENT,generation INTEGER NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('building','ready','retiring')),
      after_id INTEGER NOT NULL,model_sha256 TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS vector_current ON vector_indexes(generation) WHERE state='ready';
      CREATE UNIQUE INDEX IF NOT EXISTS vector_building ON vector_indexes(generation) WHERE state='building';
      CREATE INDEX IF NOT EXISTS vector_retirement ON vector_indexes(state,id);`);
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
    const inserted=this.db.run("INSERT INTO vector_indexes(generation,state,after_id,model_sha256) VALUES (?,'building',0,?)",
      [job.generation,createHash('sha256').update(model).digest('hex')]);
    const name = table(Number(inserted.lastInsertRowid)), gen = job.generation;
    this.db.sql.exec(`CREATE VIRTUAL TABLE ${name} USING vec1(v,owner,active);`);
    this.db.run(`INSERT INTO ${name}(cmd,arg) VALUES ('rebuild',?)`, [Buffer.from(model)]);
    // Capture foreground changes in this same writer transaction, including writes behind the cursor.
    for(const sql of nativeVectorTriggers(Number(inserted.lastInsertRowid),gen))this.db.sql.exec(sql);

  }
  /** The scheduler owns short transactions; concurrent changes are already captured by the triggers. */
  step(generation: number, limit: number): boolean {
    this.writer();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128) fail('VALUE_INVALID', 'Invalid native projection batch');
    const state=this.db.get("SELECT * FROM vector_indexes WHERE generation=? AND state='building'",[generation]);
    if(!state) {
      if(this.ready(generation))return true;
      fail('CORRUPT','Missing native vector admission');
    }
    const name=table(Number(state!.id));
    const started = performance.now();
    const rows = this.db.all(`WITH page AS MATERIALIZED (
      SELECT entity_id,embedding_id FROM chunks WHERE generation=? AND embedding_id>? ORDER BY embedding_id LIMIT ?)
      SELECT v.id,coalesce(p.normalized,v.embedding) embedding,e.seq,1-e.trashed active
      FROM page c JOIN embedding_values v ON v.id=c.embedding_id JOIN entities e ON e.id=c.entity_id
      LEFT JOIN embedding_search p ON p.embedding_id=v.id ORDER BY v.id`, [generation, state!.after_id, limit]);
    let processed = 0, afterId = state!.after_id;
    for (const row of rows) {
      if (!Number.isSafeInteger(row.id) || !Number.isSafeInteger(row.seq)) fail('CORRUPT', 'Invalid native vector identity');
      this.db.run(`DELETE FROM ${name} WHERE rowid=?`, [BigInt(row.id)]);
      this.db.run(`INSERT INTO ${name}(rowid,v,owner,active) VALUES (?,?,?,?)`,
        [BigInt(row.id),row.embedding,BigInt(row.seq),BigInt(row.active)]);
      processed++; afterId = row.id;
      if (performance.now() - started >= this.db.indexBuilds.sliceMs) break;
    }
    const ready = processed === rows.length && rows.length < limit;
    if(ready) {
      // Both models have captured foreground writes. Flip only after the replacement's complete page
      // commits; the previous model remains queryable on every refusal/rollback and across snapshots.
      const incumbent=this.ready(generation);
      if(incumbent) {
        this.dropTriggers(Number(incumbent.id));
        this.db.run("UPDATE vector_indexes SET state='retiring' WHERE id=?",[incumbent.id]);
      }
    }
    this.db.run('UPDATE vector_indexes SET after_id=?,state=? WHERE id=?',
      [afterId, ready ? 'ready' : 'building', state!.id]);
    return ready;
  }
  /** Chunk candidates only; final owner aggregation/reranking remains the query owner's responsibility. */
  candidates(generation: number, vector: Uint8Array, limit: number, scope: SqliteEntityScope | null = null,
    exclude?: string, projection:'owners'|'chunks'='chunks'): Array<Record<string, any>> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 4096) fail('VALUE_INVALID', 'Invalid native candidate limit');
    if(!this.db.get("SELECT 1 FROM index_builds WHERE generation=? AND kind='vector'",[generation]))
      fail('SCHEMA_CHANGED','Native vector generation was retired');
    const state=this.ready(generation);
    if(!state)fail('INDEX_BUILDING','Native vector projection is not ready');
    const name=table(Number(state!.id));
    const filter = scope || exclude ? `owner IN (SELECT e.seq FROM entities e WHERE
      ${scope ? `e.id IN (${scope.sql})` : 'e.trashed=0'} AND e.id!=?)` : 'active=1';
    // Owner admission does not need native Float32 payloads or a second exact distance calculation.
    const columns=projection==='owners'?'owner':'rowid embedding_id,owner,vec1_cos_distance(v,?) distance';
    return this.db.all(`SELECT ${columns} FROM ${name}(?,?) WHERE ${filter}`,
      [...(projection==='owners'?[]:[Buffer.from(vector)]),Buffer.from(vector),JSON.stringify({K:limit,nprobe:32}),
        ...(scope || exclude ? [...(scope?.parameters ?? []),exclude ?? ''] : [])]);
  }
  ready(generation:number):Record<string,any>|undefined {
    return this.db.get("SELECT * FROM vector_indexes WHERE generation=? AND state='ready'",[generation]);
  }
  retirementPending():boolean {return !!this.db.get("SELECT 1 FROM vector_indexes WHERE state='retiring' LIMIT 1");}
  private dropTriggers(identity:number):void {
    const name=table(identity);
    this.db.sql.exec(`DROP TRIGGER ${name}_insert; DROP TRIGGER ${name}_update;
      DROP TRIGGER ${name}_delete; DROP TRIGGER ${name}_trash;`);
  }
  private collectGroup(row:Record<string,any>,limit:number):boolean {
    if(!Number.isSafeInteger(limit)||limit<1||limit>128)fail('VALUE_INVALID','Invalid native retirement batch');
    const name=table(Number(row.id));
    if(row.state!=='retiring') {
      this.dropTriggers(Number(row.id));
      this.db.run("UPDATE vector_indexes SET state='retiring' WHERE id=?",[row.id]);
    }
    return Number(this.db.run(`DELETE FROM ${name} WHERE rowid IN (SELECT rowid FROM ${name} LIMIT ?)`,[limit]).changes)<limit;
  }
  /** Retire the entire old corpus epoch atomically; row deletion remains bounded background work. */
  invalidate():void {
    this.writer();
    for(const row of this.db.all("SELECT id FROM vector_indexes WHERE state!='retiring' ORDER BY id")) {
      this.dropTriggers(Number(row.id));
      this.db.run("UPDATE vector_indexes SET state='retiring' WHERE id=?",[row.id]);
    }
  }
  /** Collect one physical group for a logically retired generation. */
  collect(generation:number,limit:number):boolean {
    this.writer();
    const row=this.db.get('SELECT * FROM vector_indexes WHERE generation=? ORDER BY id LIMIT 1',[generation]);
    return !row||this.collectGroup(row,limit);
  }
  private dropGroup(row:Record<string,any>):void {
    const name=table(Number(row.id));
    if(this.db.get(`SELECT 1 FROM ${name} LIMIT 1`))fail('INDEX_NOT_EMPTY','Retire native rows before dropping the group');
    if(row.state!=='retiring')this.dropTriggers(Number(row.id));
    this.db.sql.exec(`DROP TABLE ${name}`);
    this.db.run('DELETE FROM vector_indexes WHERE id=?',[row.id]);
  }
  /** Caller must first retire projection rows in bounded batches; DROP must not hide live work. */
  retire(generation:number):void {
    this.writer();const row=this.db.get('SELECT * FROM vector_indexes WHERE generation=? ORDER BY id LIMIT 1',[generation]);
    if(row)this.dropGroup(row);
  }
  /** Retire a superseded physical model without touching its logical generation or incumbent. */
  collectSuperseded(limit:number):boolean {
    this.writer();const row=this.db.get("SELECT * FROM vector_indexes WHERE state='retiring' ORDER BY id LIMIT 1");
    if(!row)return false;
    if(this.collectGroup(row,limit))this.dropGroup(row);
    return true;
  }
}
