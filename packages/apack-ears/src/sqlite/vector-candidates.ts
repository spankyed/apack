// The same bounded owner selection serves training owners and independently opened readers/writers.
import type { SqliteDatabase } from './database.ts';
import type { SqliteVectorIndex } from './vector-index.ts';
import type { SqliteEntityScope } from './query-scope.ts';
import { NATIVE_VECTOR_OWNER_TARGET } from './vector-policy.ts';

export function nativeVectorCandidateOwners(db: SqliteDatabase, index: SqliteVectorIndex,
  generation: number, vector: Uint8Array, scope: SqliteEntityScope | null, exclude?: string): number[] | undefined {
  if (db.get('SELECT state FROM vector_training WHERE generation=?', [generation])?.state !== 'ready') return;
  // A chunk cap is not an owner cap: expand when one owner has many close chunks.
  for (let limit = NATIVE_VECTOR_OWNER_TARGET; limit <= 4096; limit *= 2) {
    const rows = index.candidates(generation, vector, limit, scope, exclude, 'owners');
    const owners = [...new Set(rows.map(row => Number(row.owner)))];
    if (owners.some(owner => !Number.isSafeInteger(owner) || owner < 1))
      throw Object.assign(new Error('Invalid native candidate owner'), { code: 'CORRUPT' });
    if (owners.length >= NATIVE_VECTOR_OWNER_TARGET) return owners;
    if (rows.length < limit) break;
  }
  // Preserve ordinary owner-level execution when the native chunk budget cannot supply enough owners.
  return;
}
