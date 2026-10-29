// Stored vectors are primary data. Derived chunk generations borrow their identity, never own their bytes.
import type { SqliteDatabase } from './database.ts';
export interface SqliteEmbedding {
  id: string; index: string; chunk: number; hash: string; model: string; dimensions: number; bytes: Uint8Array;
}
const fail = (message: string): never => { throw Object.assign(new Error(message), { code: 'CORRUPT' }); };
export function validateEmbeddingBytes(bytes: Uint8Array, dimensions: number): void {
  if (!Number.isSafeInteger(dimensions) || dimensions < 1 || !(bytes instanceof Uint8Array) || bytes.byteLength !== dimensions * 4)
    return fail('Invalid Float32 cosine embedding');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let nonzero = false;
  for (let offset = 0; offset < view.byteLength; offset += 4) {
    const value = view.getFloat32(offset, true);
    if (!Number.isFinite(value)) return fail('Invalid Float32 cosine embedding');
    if (value !== 0) nonzero = true;
  }
  if (!nonzero) fail('Invalid Float32 cosine embedding');
}
export function encodeEmbeddingVector(vector: number[], dimensions: number): Buffer {
  if (vector.length !== dimensions || vector.some(value => !Number.isFinite(value)))
    throw Object.assign(new Error('Invalid vector dimension/value'), { code: 'VALUE_INVALID' });
  const bytes = Buffer.from(Float32Array.from(vector).buffer);
  try { validateEmbeddingBytes(bytes, dimensions); }
  catch (cause) { throw Object.assign(new Error('Cosine vectors require finite Float32 components and a nonzero direction', { cause }), { code: 'VALUE_INVALID' }); }
  return bytes;
}
export class SqliteEmbeddings {
  private readonly db: SqliteDatabase;
  constructor(db: SqliteDatabase) { this.db = db; }
  initialize(): void {
    // Pre-adoption candidates with generation-owned bytes require explicit export using their original code.
    // Refuse before creating anything; absence must never silently turn stored primary vectors into pending work.
    const chunks = this.db.get("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='chunks'");
    if (chunks && this.db.all('PRAGMA table_info(chunks)').some(column => column.name === 'embedding'))
      throw Object.assign(new Error('Legacy SQLite candidate vector layout: export with its original version before conversion'), { code: 'WRONG_FORMAT' });
    const exists = this.db.get("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='embedding_values'");
    if (!exists && (chunks || this.db.readOnly || this.db.get("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='meta'"))) return fail('Missing authoritative embedding storage');
    if (!exists) this.db.sql.exec(`CREATE TABLE embedding_values(id INTEGER PRIMARY KEY,
      entity_id TEXT NOT NULL,index_name TEXT NOT NULL,chunk INTEGER NOT NULL,hash TEXT NOT NULL,
      model TEXT NOT NULL,dims INTEGER NOT NULL,embedding BLOB NOT NULL,
      UNIQUE(entity_id,index_name,chunk,hash,model,dims));`);
  }
  /** Caller owns validation of the entity and transaction. Raw restore retains all distinct reusable identities. */
  restore(row: SqliteEmbedding): number {
    validateEmbeddingBytes(row.bytes, row.dimensions);
    if (!Number.isSafeInteger(row.chunk) || row.chunk < 0 || !row.index || !row.hash || !row.model.trim())
      return fail('Invalid stored embedding identity');
    this.db.run(`INSERT INTO embedding_values(entity_id,index_name,chunk,hash,model,dims,embedding) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(entity_id,index_name,chunk,hash,model,dims) DO UPDATE SET embedding=excluded.embedding`,
      [row.id,row.index,row.chunk,row.hash,row.model,row.dimensions,Buffer.from(row.bytes)]);
    const id = Number(this.db.get(`SELECT id FROM embedding_values WHERE entity_id=? AND index_name=? AND chunk=? AND hash=? AND model=? AND dims=?`,
      [row.id,row.index,row.chunk,row.hash,row.model,row.dimensions])!.id);
    this.db.search.vectors.put(id, row.bytes, row.dimensions);
    return id;
  }
  /** A newly produced vector supersedes obsolete versions of that chunk in the same logical write. */
  replace(row: SqliteEmbedding): number {
    const id = this.restore(row);
    this.db.run(`UPDATE chunks SET embedding_id=NULL WHERE embedding_id IN
      (SELECT id FROM embedding_values WHERE entity_id=? AND index_name=? AND chunk=? AND id!=?)`, [row.id,row.index,row.chunk,id]);
    this.db.run('DELETE FROM embedding_values WHERE entity_id=? AND index_name=? AND chunk=? AND id!=?', [row.id,row.index,row.chunk,id]);
    return id;
  }
  /** Relink freshly derived chunks after raw import; mismatched content/model/dimensions remain pending. */
  relink(chunk?: Pick<SqliteEmbedding, 'id' | 'index' | 'chunk'>): void {
    this.db.run(`UPDATE chunks SET embedding_id=(SELECT v.id FROM embedding_values v WHERE v.entity_id=chunks.entity_id
      AND v.index_name=chunks.index_name AND v.chunk=chunks.chunk AND v.hash=chunks.hash AND v.model=chunks.model AND v.dims=chunks.dims)
      ${chunk ? 'WHERE entity_id=? AND index_name=? AND chunk=?' : ''}`, chunk ? [chunk.id,chunk.index,chunk.chunk] : []);
  }
}
