// Rebuildable vector projections. Canonical bytes remain owned by embedding_values.
import type { SqliteDatabase } from './database.ts';
import { encodeEmbeddingVector, validateEmbeddingBytes } from './embeddings.ts';

/** Float64 accumulation keeps every finite, nonzero Float32 direction normalizable. */
function normalized(bytes: Uint8Array): { bytes: Buffer; squared: number } {
  const source = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let squared = 0;
  for (let offset = 0; offset < source.byteLength; offset += 4) squared += source.getFloat32(offset, true) ** 2;
  const magnitude = Math.sqrt(squared), result = Buffer.allocUnsafe(bytes.byteLength);
  for (let offset = 0; offset < source.byteLength; offset += 4) result.writeFloatLE(source.getFloat32(offset, true) / magnitude, offset);
  return { bytes: result, squared };
}

export class SqliteVectors {
  private readonly db: SqliteDatabase;
  constructor(db: SqliteDatabase) { this.db = db; }
  ensure(): void {
    this.db.sql.exec(`CREATE TABLE IF NOT EXISTS embedding_search(
      embedding_id INTEGER PRIMARY KEY REFERENCES embedding_values(id) ON DELETE CASCADE,
      bits BLOB,normalized BLOB);`);
  }
  put(id: number, bytes: Uint8Array, dimensions: number): void {
    validateEmbeddingBytes(bytes, dimensions);
    this.db.search.loadVectorExtension();
    const value = normalized(bytes);
    // Ordinary model output keeps its original payload only. Rare magnitude extremes need a safe derived
    // direction because sqlite-vec's Float32 cosine accumulation can otherwise overflow or underflow.
    const safe = value.squared < 1e-20 || value.squared > 1e20 ? value.bytes : null;
    this.db.run(`INSERT INTO embedding_search VALUES (?,CASE WHEN ? THEN vec_quantize_binary(?) ELSE NULL END,?)
      ON CONFLICT(embedding_id) DO UPDATE SET bits=excluded.bits,normalized=excluded.normalized`,
      [id, dimensions >= 128 && dimensions % 8 === 0 ? 1 : 0, Buffer.from(bytes), safe]);
  }
  /** Reused primary vectors are projected during the existing bounded generation backfill. */
  retain(id: number): void {
    const row = this.db.get(`SELECT v.embedding,v.dims FROM embedding_values v LEFT JOIN embedding_search p
      ON p.embedding_id=v.id WHERE v.id=? AND p.embedding_id IS NULL`, [id]);
    if (row) this.put(id, row.embedding, row.dims);
  }
  search(ids: string[] | null, type: string, name: string, generation: number,
    dimensions: number, vector: number[], k: number, exclude?: string): Array<Record<string, any>> {
    const query = normalized(encodeEmbeddingVector(vector, dimensions)).bytes;
    const eligible = `c.type=? AND c.index_name=? AND c.generation=? AND c.embedding_id IS NOT NULL
      AND ${ids === null ? 'e.trashed=0' : 'c.entity_id IN (SELECT value FROM json_each(?))'} AND c.entity_id!=?`;
    const bindings = [type, name, generation, ...(ids === null ? [] : [JSON.stringify(ids)]), exclude ?? ''];
    const exact = () => this.db.all(`SELECT c.entity_id id,
      1-min(vec_distance_cosine(coalesce(p.normalized,v.embedding),?)) score FROM chunks c
      JOIN embedding_values v ON v.id=c.embedding_id JOIN entities e ON e.id=c.entity_id
      LEFT JOIN embedding_search p ON p.embedding_id=v.id WHERE ${eligible}
      GROUP BY c.entity_id ORDER BY score DESC,e.seq LIMIT ?`, [query, ...bindings, k]);
    // Small and large-K queries stay exact. No native candidate cap may silently underfill owners.
    if (k <= 0 || k > 32 || dimensions < 128 || dimensions % 8 !== 0) return exact();
    const count = Number(this.db.get(`SELECT count(*) n FROM chunks c JOIN entities e ON e.id=c.entity_id
      WHERE ${eligible}`, bindings)!.n);
    if (count <= 4096) return exact();
    const rows = this.db.all(`WITH candidates AS MATERIALIZED (
      SELECT c.entity_id FROM chunks c JOIN embedding_search p ON p.embedding_id=c.embedding_id
      JOIN entities e ON e.id=c.entity_id WHERE ${eligible}
      GROUP BY c.entity_id ORDER BY min(vec_distance_hamming(vec_bit(p.bits),vec_quantize_binary(?))),e.seq LIMIT 256
      ) SELECT c.entity_id id,1-min(vec_distance_cosine(coalesce(p.normalized,v.embedding),?)) score
      FROM candidates a JOIN chunks c ON c.entity_id=a.entity_id
      JOIN embedding_values v ON v.id=c.embedding_id JOIN entities e ON e.id=c.entity_id
      LEFT JOIN embedding_search p ON p.embedding_id=v.id WHERE ${eligible}
      GROUP BY c.entity_id ORDER BY score DESC,e.seq LIMIT ?`, [...bindings, query, query, ...bindings, k]);
    return rows.length < k ? exact() : rows;
  }
}
