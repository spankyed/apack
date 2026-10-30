// Rebuildable vector projections. Canonical bytes remain owned by embedding_values.
import type { SqliteDatabase } from './database.ts';
import type { SqliteEntityScope } from './query-scope.ts';
import { encodeEmbeddingVector, validateEmbeddingBytes } from './embeddings.ts';
import { EXACT_VECTOR_CHUNK_LIMIT, NATIVE_VECTOR_OWNER_TARGET } from './vector-policy.ts';

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
  search(scope: SqliteEntityScope | null, type: string, name: string, generation: number,
    dimensions: number, vector: number[], k: number, exclude?: string): Array<Record<string, any>> {
    const query = normalized(encodeEmbeddingVector(vector, dimensions)).bytes;
    const eligible = `c.type=? AND c.index_name=? AND c.generation=? AND c.embedding_id IS NOT NULL
      AND ${scope === null ? 'e.trashed=0' : `c.entity_id IN (${scope.sql})`} AND c.entity_id!=?`;
    const bindings = [type, name, generation, ...(scope?.parameters ?? []), exclude ?? ''];
    const exact = () => this.db.all(`SELECT c.entity_id id,
      1-min(vec_distance_cosine(coalesce(p.normalized,v.embedding),?)) score FROM chunks c
      JOIN embedding_values v ON v.id=c.embedding_id JOIN entities e ON e.id=c.entity_id
      LEFT JOIN embedding_search p ON p.embedding_id=v.id WHERE ${eligible}
      GROUP BY c.entity_id ORDER BY score DESC,e.seq LIMIT ?`, [query, ...bindings, k]);
    // Small and large-K queries stay exact. No native candidate cap may silently underfill owners.
    if (k <= 0 || k > 32 || dimensions < 128 || dimensions % 8 !== 0) return exact();
    // Materialize the bounded eligibility page once. Small scopes reuse it for exact scoring;
    // large scopes return only their count and do not read canonical vector payloads here.
    const probe=this.db.all(`WITH eligible AS MATERIALIZED (
      SELECT c.entity_id id,c.embedding_id,e.seq FROM chunks c JOIN entities e ON e.id=c.entity_id
      WHERE ${eligible} LIMIT ${EXACT_VECTOR_CHUNK_LIMIT + 1}),
      total AS MATERIALIZED (SELECT count(*) n FROM eligible),
      ranked AS MATERIALIZED (
        SELECT c.id,1-min(vec_distance_cosine(coalesce(p.normalized,v.embedding),?)) score,c.seq
        FROM total t CROSS JOIN eligible c JOIN embedding_values v ON v.id=c.embedding_id
        LEFT JOIN embedding_search p ON p.embedding_id=v.id WHERE t.n<=${EXACT_VECTOR_CHUNK_LIMIT}
        GROUP BY c.id ORDER BY score DESC,c.seq LIMIT ?)
      SELECT NULL id,NULL score,n,NULL seq FROM total
      UNION ALL SELECT id,score,NULL,seq FROM ranked ORDER BY n DESC,score DESC,seq`, [...bindings,query,k]);
    if(Number(probe[0]!.n)<=EXACT_VECTOR_CHUNK_LIMIT)return probe.slice(1).map(row=>({id:row.id,score:row.score}));
    const owners=this.db.indexBuilds.nativeVectorOwners(generation,query,scope,exclude);
    if(owners) {
      const rows=this.db.all(`SELECT c.entity_id id,
        1-min(vec_distance_cosine(coalesce(p.normalized,v.embedding),?)) score
        FROM chunks c JOIN embedding_values v ON v.id=c.embedding_id JOIN entities e ON e.id=c.entity_id
        LEFT JOIN embedding_search p ON p.embedding_id=v.id
        WHERE c.entity_id IN (SELECT id FROM entities WHERE seq IN (SELECT value FROM json_each(?)))
          AND ${eligible} GROUP BY c.entity_id ORDER BY score DESC,e.seq LIMIT ?`,
        [query,JSON.stringify(owners),...bindings,k]);
      return rows.length<k?exact():rows;
    }
    // Candidate owners already passed eligibility in this read snapshot. Probe only their current chunks.
    const rows = this.db.all(`WITH candidates AS MATERIALIZED (
      SELECT c.entity_id FROM chunks c JOIN embedding_search p ON p.embedding_id=c.embedding_id
      JOIN entities e ON e.id=c.entity_id WHERE ${eligible}
      GROUP BY c.entity_id ORDER BY min(vec_distance_hamming(vec_bit(p.bits),vec_quantize_binary(?))),e.seq LIMIT ${NATIVE_VECTOR_OWNER_TARGET}
      ) SELECT c.entity_id id,1-min(vec_distance_cosine(coalesce(p.normalized,v.embedding),?)) score
      FROM chunks c JOIN embedding_values v ON v.id=c.embedding_id JOIN entities e ON e.id=c.entity_id
      LEFT JOIN embedding_search p ON p.embedding_id=v.id
      WHERE c.type=? AND c.index_name=? AND c.generation=? AND c.embedding_id IS NOT NULL
      AND c.entity_id IN (SELECT entity_id FROM candidates)
      GROUP BY c.entity_id ORDER BY score DESC,e.seq LIMIT ?`, [...bindings, query, query, type, name, generation, k]);
    return rows.length < k ? exact() : rows;
  }
}
