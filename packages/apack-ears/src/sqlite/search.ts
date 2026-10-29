/// <reference types="node" />
// FTS5 owns text indexing/ranking. sqlite-vec owns vector distance evaluation; EARS owns chunks and model freshness.
// Fuzzy expansion and highlight adaptation are explicit application work, not native FTS5 capabilities.
import { createHash } from "node:crypto";
import { getLoadablePath } from "sqlite-vec";
import type { SqliteDatabase } from "./database.ts";
import { searchTable, type SqliteIndexJob } from './index-builds.ts';
import { SqliteText } from './text.ts';
import { SqliteTrigrams } from "./trigrams.ts";
import { missingSearchStructures, type SqliteSearchStructure } from "./search-structures.ts";
type Data = Record<string, any>;
const fail = (code: string, message: string): never => {
  throw Object.assign(new Error(message), { code });
};
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const textOf = (v: any): string =>
  typeof v === "string"
    ? v
    : Array.isArray(v)
    ? v.filter((x) => typeof x === "string").join("\n\n")
    : "";
export class SqliteSearch {
  private vectorLoaded = false;
  readonly trigrams: SqliteTrigrams;
  private readonly db: SqliteDatabase;
  private readonly texts: SqliteText;
  constructor(db: SqliteDatabase) { this.db = db; this.trigrams = new SqliteTrigrams(db); this.texts = new SqliteText(db); }
  private textIndex(
    type: string,
    schema = this.db.schemaForQueries()
  ): [string, Data] {
    const entries = Object.entries(schema.types[type]?.indexes ?? {}).filter(
      ([, d]) => (d as Data).kind === "text"
    ) as Array<[string, Data]>;
    const selected = entries[0] ?? fail("UNKNOWN_INDEX", `${type} has no text index`);
    this.db.indexBuilds.requireReady(type, 'text', selected[0]); return selected;
  }
  private vectorIndex(
    type: string,
    schema = this.db.schemaForQueries(), requireReady = true
  ): [string, Data] {
    const entries = Object.entries(schema.types[type]?.indexes ?? {}).filter(
      ([, d]) => (d as Data).kind === "vector"
    ) as Array<[string, Data]>;
    const selected = entries[0] ?? fail("UNKNOWN_INDEX", `${type} has no vector index`);
    if (requireReady) this.db.indexBuilds.requireReady(type, 'vector', selected[0]); return selected;
  }
  private table(type: string, name: string, index: Data) {
    return searchTable(this.db.indexBuilds.index(type, index.kind, name));
  }
  loadVectors(schema: Data) {
    if (
      !this.vectorLoaded &&
      Object.values(schema.types).some((d: any) =>
        Object.values(d.indexes ?? {}).some((i: any) => i.kind === "vector")
      )
    ) {
      this.db.sql.loadExtension(getLoadablePath());
      this.vectorLoaded = true;
    }
  }
  private structures(schema: Data): SqliteSearchStructure[] {
    const text: SqliteIndexJob[] = [], vectors: SqliteIndexJob[] = [];
    for (const [type, definition] of Object.entries(schema.types) as Array<[string, Data]>)
      for (const [name, index] of Object.entries(definition.indexes ?? {}) as Array<[string, Data]>) {
        if (index.kind === 'text') text.push(this.db.indexBuilds.index(type, 'text', name));
        if (index.kind === 'vector') vectors.push(this.db.indexBuilds.index(type, 'vector', name));
      }
    return [
      { types: text.map(j => j.type), indexes: text, objects: [['table', 'text_meta']] },
      { types: vectors.map(j => j.type), indexes: vectors, objects: [['table', 'chunks']] },
      { types: [], indexes: [], objects: [['index', 'chunk_pending'], ['index', 'chunk_reuse'], ['index', 'chunk_generation'], ['index', 'text_generation']] },
      ...text.map(job => this.texts.structure(job)), ...this.trigrams.structures(schema),
    ];
  }
  needsRepair(schema: Data): boolean { return missingSearchStructures(this.db, this.structures(schema)).length !== 0; }
  missingIndexes(schema: Data): SqliteIndexJob[] {
    return [...new Map(missingSearchStructures(this.db, this.structures(schema)).flatMap(group => group.indexes)
      .map(job => [job.generation, job])).values()];
  }
  /** Read-only opens cannot silently turn a missing derived group into incomplete search answers. */
  validateStructures(schema: Data): void {
    if (this.needsRepair(schema)) fail('CORRUPT', 'Derived SQLite search storage is incomplete; reopen writable to repair it');
  }
  indexFields(index: Data): string[] {
    return index.kind === 'text' ? Object.keys(index.fields) : index.kind === 'trigram' ? index.fields : index.from;
  }
  ensure(schema: Data): void {
    this.loadVectors(schema);
    this.trigrams.ensure(schema);
    this.db.sql
      .exec(`CREATE TABLE IF NOT EXISTS text_meta(entity_id TEXT,index_name TEXT,generation INTEGER NOT NULL,hashes TEXT NOT NULL,PRIMARY KEY(entity_id,index_name,generation));
      CREATE TABLE IF NOT EXISTS chunks(entity_id TEXT NOT NULL,type TEXT NOT NULL,index_name TEXT NOT NULL,generation INTEGER NOT NULL,
      chunk INTEGER NOT NULL,model TEXT NOT NULL,dims INTEGER NOT NULL,hash TEXT NOT NULL,text TEXT NOT NULL,
      embedding BLOB,PRIMARY KEY(entity_id,index_name,generation,chunk));
      CREATE INDEX IF NOT EXISTS chunk_pending ON chunks(type,index_name,generation,entity_id,chunk) WHERE embedding IS NULL;
      CREATE INDEX IF NOT EXISTS chunk_generation ON chunks(generation);
      CREATE INDEX IF NOT EXISTS text_generation ON text_meta(generation);
      CREATE INDEX IF NOT EXISTS chunk_reuse ON chunks(entity_id,index_name,chunk,hash,model,dims,generation);`);
    for (const [type, definition] of Object.entries(schema.types) as Array<
      [string, Data]
    >)
      for (const [name, index] of Object.entries(
        definition.indexes ?? {}
      ) as Array<[string, Data]>) {
        if (index.kind === "text") this.texts.ensure(this.db.indexBuilds.index(type, 'text', name));
      }
  }
  refile(row: Data, seq: number, schema = this.db.schemaForQueries(), changed?: ReadonlySet<string>) {
    for (const [name, index] of Object.entries(schema.types[row.entityType]?.indexes ?? {}) as Array<[string, Data]>) {
      if (index.kind === 'value') continue;
      const fields = this.indexFields(index);
      if (changed && !fields.some(field => changed.has(field))) continue;
      const selected = changed ? this.db.row(row.id, index.kind === 'text' ? fields.filter(field => changed.has(field)) : fields)! : row;
      this.refileIndex(selected, seq, this.db.indexBuilds.index(row.entityType, index.kind, name), changed);
    }
  }
  refileIndex(row: Data, seq: number, job: SqliteIndexJob, changed?: ReadonlySet<string>): void {
    const index = job.definition, name = job.name, generation = job.generation;
    if (job.kind === 'trigram') { this.trigrams.refileIndex(row, job); return; }
    if (job.kind === 'text') this.texts.refile(row, job, seq, changed);
    if (job.kind === 'vector') {
      const joined = index.from.map((field: string) => textOf(row[field])).filter(Boolean).join('\n\n').trim();
      const texts = index.chunk === 'paragraph' ? joined.split(/\n\s*\n/).filter(Boolean) : joined ? [joined] : [];
      for (let chunk = 0; chunk < texts.length; chunk++) {
        const text = texts[chunk], hash = digest(text);
        this.db.run(`INSERT INTO chunks VALUES (?,?,?,?,?,?,?,?,?,
          (SELECT embedding FROM chunks old WHERE old.entity_id=? AND old.index_name=? AND old.chunk=? AND old.hash=? AND old.model=? AND old.dims=? AND old.generation!=? AND old.embedding IS NOT NULL ORDER BY old.generation DESC LIMIT 1))
          ON CONFLICT(entity_id,index_name,generation,chunk) DO UPDATE SET
          model=excluded.model,dims=excluded.dims,hash=excluded.hash,text=excluded.text,
          embedding=CASE WHEN chunks.hash=excluded.hash AND chunks.model=excluded.model AND chunks.dims=excluded.dims THEN chunks.embedding ELSE excluded.embedding END`,
          [row.id, row.entityType, name, generation, chunk, index.model, index.dims, hash, text,
            row.id, name, chunk, hash, index.model, index.dims, generation]);
      }
      this.db.run('DELETE FROM chunks WHERE entity_id=? AND index_name=? AND generation=? AND chunk>=?', [row.id, name, generation, texts.length]);
    }
  }
  /** Retirement alternates with build work. Rows are removed in batches before dropping an empty group. */
  collectIndex(job: SqliteIndexJob, limit: number): boolean {
    if (job.kind === 'vector') return Number(this.db.run('DELETE FROM chunks WHERE rowid IN (SELECT rowid FROM chunks WHERE generation=? LIMIT ?)', [job.generation, limit]).changes) < limit;
    const structure = job.kind === 'text' ? this.texts.structure(job) : this.trigrams.structure(job);
    if (missingSearchStructures(this.db, [structure]).length) {
      this.db.sql.exec(structure.reset!);
    } else {
      const table = searchTable(job), docs = table + '_docs';
      if (job.kind === 'text' ? !this.texts.collect(job, limit) :
        Number(this.db.run(`DELETE FROM ${docs} WHERE rowid IN (SELECT rowid FROM ${docs} LIMIT ?)`, [limit]).changes) >= limit) return false;
      this.db.sql.exec(structure.reset!);
    }
    if (job.kind === 'text') return Number(this.db.run('DELETE FROM text_meta WHERE rowid IN (SELECT rowid FROM text_meta WHERE generation=? LIMIT ?)', [job.generation, limit]).changes) < limit;
    return true;
  }
  remove(id: string, type: string, schema = this.db.schemaForQueries()) {
    const seq = this.db.get('SELECT seq FROM entities WHERE id=?', [id])?.seq;
    if (!Number.isSafeInteger(seq)) fail('CORRUPT', 'Missing entity sequence during search removal');
    this.trigrams.remove(id, type, schema);
    for (const [name, index] of Object.entries(
      schema.types[type]?.indexes ?? {}
    ) as Array<[string, Data]>)
      if (index.kind === "text")
        this.texts.remove(this.db.indexBuilds.index(type, 'text', name), id);
    this.db.run("DELETE FROM text_meta WHERE entity_id=?", [id]);
    this.db.run("DELETE FROM chunks WHERE entity_id=?", [id]);
  }
  clear(schema = this.db.schemaForQueries()) {
    this.trigrams.clear(schema);
    for (const [type, definition] of Object.entries(schema.types) as Array<
      [string, Data]
    >)
      for (const [name, index] of Object.entries(
        definition.indexes ?? {}
      ) as Array<[string, Data]>)
        if (index.kind === "text")
          this.db.sql.exec(`DELETE FROM ${this.table(type, name, index)}; DELETE FROM ${this.table(type, name, index)}_docs;`);
    this.db.sql.exec("DELETE FROM text_meta; DELETE FROM chunks;");
  }
  pending(type: string, limit: number) {
    const [name, index] = this.vectorIndex(type);
    const generation = this.db.indexBuilds.index(type, 'vector', name).generation;
    return {
      kind: "pending" as const,
      index: name,
      model: index.model,
      dims: index.dims,
      count: this.db.get(
        "SELECT count(*) n FROM chunks WHERE type=? AND index_name=? AND generation=? AND embedding IS NULL",
        [type, name, generation]
      )!.n,
      chunks: this.db
        .all(
          "SELECT entity_id id,chunk,hash,text FROM chunks WHERE type=? AND index_name=? AND generation=? AND embedding IS NULL ORDER BY entity_id,chunk LIMIT ?",
          [type, name, generation, limit]
        )
        .map((r) => ({ id: String(r.id), chunk: Number(r.chunk), hash: String(r.hash), text: String(r.text) })),
    };
  }
  embed(op: Data) {
    const row = this.db.row(op.id);
    if (!row) return { kind: "stale" };
    const [name, index] = this.vectorIndex(row.entityType, this.db.schemaForQueries(), false);
    const job = this.db.indexBuilds.index(row.entityType, 'vector', name);
    if (job.state !== 'ready') return { kind: 'stale' };
    const chunk = this.db.get(
      "SELECT * FROM chunks WHERE entity_id=? AND index_name=? AND generation=? AND chunk=?",
      [op.id, name, job.generation, op.chunk]
    );
    if (!chunk || chunk.hash !== op.hash || chunk.model !== op.model)
      return { kind: "stale" };
    if (
      op.vector.length !== index.dims ||
      op.vector.some((x: number) => !Number.isFinite(x))
    )
      fail("VALUE_INVALID", "Invalid embedding dimension/value");
    const embedding = Buffer.from(Float32Array.from(op.vector).buffer);
    this.db.run(
      "UPDATE chunks SET embedding=? WHERE entity_id=? AND index_name=? AND generation=? AND chunk=?",
      [embedding, op.id, name, job.generation, op.chunk]
    );
    return { kind: "done" };
  }
  vector(
    ids: string[] | null,
    type: string,
    vector: number[],
    k: number,
    exclude?: string
  ): Data[] {
    const [name, index] = this.vectorIndex(type);
    const generation = this.db.indexBuilds.index(type, 'vector', name).generation;
    if (vector.length !== index.dims || vector.some((x) => !Number.isFinite(x)))
      fail("VALUE_INVALID", "Invalid query vector");
    const embedding = Buffer.from(Float32Array.from(vector).buffer);
    return this.db
      .all(
        `SELECT c.entity_id id,1-min(vec_distance_cosine(c.embedding,?)) score FROM chunks c
      JOIN entities e ON e.id=c.entity_id WHERE c.type=? AND c.index_name=? AND c.generation=? AND c.embedding IS NOT NULL
      AND ${
        ids === null
          ? "e.trashed=0"
          : "c.entity_id IN (SELECT value FROM json_each(?))"
      } AND c.entity_id!=? GROUP BY c.entity_id ORDER BY score DESC,e.seq LIMIT ?`,
        [
          embedding,
          type,
          name,
          generation,
          ...(ids === null ? [] : [JSON.stringify(ids)]),
          exclude ?? "",
          k,
        ]
      )
      .map((r) => ({ id: r.id, score: r.score, terms: [] }));
  }
  like(ids: string[] | null, type: string, id: string, k: number): Data[] {
    const [name] = this.vectorIndex(type);
    const generation = this.db.indexBuilds.index(type, 'vector', name).generation;
    const row = this.db.get(
      "SELECT embedding FROM chunks WHERE entity_id=? AND index_name=? AND generation=? AND embedding IS NOT NULL ORDER BY chunk LIMIT 1",
      [id, name, generation]
    );
    if (!row) return [];
    const bytes = Buffer.from(row.embedding);
    const vector = Array.from({ length: bytes.length / 4 }, (_, i) =>
      bytes.readFloatLE(i * 4)
    );
    return this.vector(ids, type, vector, k, id);
  }
  text(ids: string[] | null, type: string, query: string, options: Data = {}, wantHits = true, limit?: number): Data[] {
    const [name] = this.textIndex(type);
    return this.texts.search(this.db.indexBuilds.index(type, 'text', name), ids, query, options, wantHits, limit);
  }
}
