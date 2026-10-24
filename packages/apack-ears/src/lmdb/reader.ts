/// <reference types="node" />
// Direct reads of an LMDB environment, without hydrating it (backups, db scripts)
import type { EntityRecord, LmdbDbs, RelationRecord } from './envs.ts';
import { valueKey } from './adapter.ts';
import { isDeepStrictEqual } from 'node:util';

const US = '\x1F';

/** What a read says of an entity besides its attributes */
export type EntityMeta = { type: string };

/**
 * Validate that a string is safe for use as a key component.
 * Prevents adversarial prefixes with US character (\x1F) validation.
 */
function assertKeySafe(s: string, label: string) {
  if (typeof s !== 'string' || s.length === 0 || s.includes(US)) {
    throw new Error(`[Query] Invalid ${label}: must be non-empty string without \\x1F character`);
  }
}

/**
 * Smart equality comparison with support for Dates, ISO strings, and optional deep equality.
 */
function eq(a: unknown, b: unknown, deep = false): boolean {
  // Handle Date comparisons
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Date && typeof b === 'number') return a.getTime() === b;
  if (b instanceof Date && typeof a === 'number') return b.getTime() === a;
  
  // Handle Date vs ISO string comparisons
  if (a instanceof Date && typeof b === 'string') {
    return a.toISOString() === b || a.getTime() === Date.parse(b);
  }
  if (b instanceof Date && typeof a === 'string') {
    return b.toISOString() === a || b.getTime() === Date.parse(a);
  }
  
  // Optional deep equality for objects/arrays
  if (deep && a && b && typeof a === 'object' && typeof b === 'object') {
    return isDeepStrictEqual(a, b);
  }
  
  return a === b;
}

export type FindByAttrOpts = {
  /** optional: only return entities of this type */
  entityType?: string;
  /** return at most N unique entityIds */
  limit?: number;
  /** shortcut equality check instead of predicate: the value, or an element of a list value */
  equals?: unknown;
  /** opt-in deep equality for object/array comparisons */
  deepEquals?: boolean;
  /** custom predicate over the whole value (value, entityId) -> boolean */
  predicate?: (value: unknown, entityId: string) => boolean;
};

export class LmdbReader {
  constructor(private dbs: LmdbDbs) { }

  /** Each entity's id and record, in id order; attributes stored under an id no entity was created with are not one */
  private *entities(): Iterable<[string, EntityRecord]> {
    for (const { key, value } of this.dbs.rows.getRange()) if (value.type !== null) yield [key, value];
  }

  /** A value of the record: a small one from it, a large one from `values` */
  private valueIn(entityId: string, record: EntityRecord, kind: string): unknown {
    if (record.outOfLine.some(([k]) => k === kind)) return this.dbs.values.get(valueKey(kind, entityId));
    const field = record.fields.find(([k]) => k === kind);
    return field ? field[1] : undefined;
  }

  private holds(record: EntityRecord, kind: string): boolean {
    return record.fields.some(([k]) => k === kind) || record.outOfLine.some(([k]) => k === kind);
  }

  // ───────────────────────────── Attributes ─────────────────────────────

  /** An entity's attribute value as stored, or undefined when it holds none (a stored null reads as null) */
  getAttr(entityId: string, kind: string): unknown {
    assertKeySafe(entityId, 'entityId');
    assertKeySafe(kind, 'kind');
    const record = this.dbs.rows.get(entityId);
    return record && record.type !== null ? this.valueIn(entityId, record, kind) : undefined;
  }

  /** The entityIds holding the attribute, in id order */
  *entitiesHavingAttr(kind: string, limit = Infinity): Iterable<string> {
    assertKeySafe(kind, 'kind');
    let count = 0;
    for (const [id, record] of this.entities()) {
      if (!this.holds(record, kind)) continue;
      if (count++ >= limit) break;
      yield id;
    }
  }

  /**
   * Finds entityIds by attribute content: scans every entity, filtering by equals/predicate and (optionally)
   * entityType. O(#entities).
   */
  findEntitiesByAttr(kind: string, opts: FindByAttrOpts = {}): string[] {
    return [...this.findEntitiesByAttrIter(kind, opts)];
  }

  /** `findEntitiesByAttr`, streamed for early exit */
  *findEntitiesByAttrIter(kind: string, opts: FindByAttrOpts = {}): Iterable<string> {
    assertKeySafe(kind, 'kind');
    const { entityType, equals, deepEquals = false, predicate, limit = Infinity } = opts;
    let count = 0;

    for (const [entityId, record] of this.entities()) {
      if (count >= limit) break;
      if (entityType && record.type !== entityType) continue;
      if (!this.holds(record, kind)) continue;

      const val = this.valueIn(entityId, record, kind);
      const pass = equals !== undefined ? eq(val, equals, deepEquals) || (Array.isArray(val) && val.some((v) => eq(v, equals, deepEquals)))
                 : predicate ? !!predicate(val, entityId)
                 : true;
      if (!pass) continue;
      yield entityId;
      count++;
    }
  }

  // ───────────────────────────── Entities ─────────────────────────────

  /** Iterate entityIds of a given type */
  *entitiesOfType(type: string): Iterable<string> {
    for (const [entityId, record] of this.entities()) if (record.type === type) yield entityId;
  }

  /** The entity's type, or null when no entity has the id */
  getEntityMeta(entityId: string): EntityMeta | null {
    const record = this.dbs.rows.get(entityId);
    return record && record.type !== null ? { type: record.type } : null;
  }

  // ───────────────────────────── Relations ─────────────────────────────

  /** 
   * Iterate relations meeting optional filters.
   * Note: O(R) fallback scan. Future optimization: add secondary indexes (relBySrc, relByTgt)
   * for O(1) prefix scans when neighbors/BFS become hot.
   */
  *relations(filter?: { kind?: string; source?: string; target?: string; limit?: number })
    : Iterable<{ relId: string; rel: RelationRecord }> {
    const { kind, source, target, limit = Infinity } = filter ?? {};
    let count = 0;

    for (const { key, value: rel } of this.dbs.relationRows.getRange()) {
      if (kind && rel.kind !== kind) continue;
      if (source && rel.source !== source) continue;
      if (target && rel.target !== target) continue;
      yield { relId: key, rel };
      if (++count >= limit) break;
    }
  }

  /** 
   * Neighbors via relations: out / in / both.
   * Note: O(R) per call due to relation scan. Plan for secondary indexes if hot.
   */
  neighbors(id: string, opts?: { kind?: string; direction?: 'out' | 'in' | 'both' }): string[] {
    const kind = opts?.kind;
    const dir = opts?.direction ?? 'out';
    const set = new Set<string>();

    if (dir === 'out' || dir === 'both') {
      for (const { rel } of this.relations({ kind, source: id })) set.add(rel.target);
    }
    if (dir === 'in' || dir === 'both') {
      for (const { rel } of this.relations({ kind, target: id })) set.add(rel.source);
    }
    return [...set];
  }

  /**
   * Neighbors with edge metadata: returns edge information along with neighbor IDs.
   * Useful for graph operations needing relationship details.
   */
  neighborsWithEdges(id: string, opts?: { kind?: string; direction?: 'out' | 'in' | 'both' }): Array<{ from: string; to: string; kind: string; info?: any }> {
    const kind = opts?.kind;
    const dir = opts?.direction ?? 'out';
    const out: Array<{ from: string; to: string; kind: string; info?: any }> = [];

    if (dir === 'out' || dir === 'both') {
      for (const { rel } of this.relations({ kind, source: id })) {
        out.push({ from: rel.source, to: rel.target, kind: rel.kind, info: rel.info });
      }
    }
    if (dir === 'in' || dir === 'both') {
      for (const { rel } of this.relations({ kind, target: id })) {
        out.push({ from: rel.source, to: rel.target, kind: rel.kind, info: rel.info });
      }
    }
    return out;
  }

  /** 
   * Tiny BFS over relations.
   * Note: O(depth × R) due to neighbors() calls. Future: with secondary indexes, drops to O(edges on frontier).
   */
  bfs(startId: string, opts?: { maxDepth?: number; kind?: string; direction?: 'out' | 'in' | 'both' }) {
    const { maxDepth = 1, kind, direction = 'out' } = opts ?? {};
    const dist = new Map<string, number>([[startId, 0]]);
    const q: string[] = [startId];
    
    // Use index pointer instead of Array.shift() for O(1) queue operations
    for (let qi = 0; qi < q.length; qi++) {
      const cur = q[qi];
      const d = dist.get(cur)!;
      if (d >= maxDepth) continue;
      for (const n of this.neighbors(cur, { kind, direction })) {
        if (!dist.has(n)) {
          dist.set(n, d + 1);
          q.push(n);
        }
      }
    }
    return dist; // includes startId at distance 0
  }

  // ───────────────────────────── Generic range util ─────────────────────────────

  /**
   * Scan a raw key range from any DB.
   * Example: scan the rows of the entities whose ids start "Task-".
   */
  scan(dbName: keyof LmdbDbs, opts: { start: string; end: string; limit?: number; reverse?: boolean }) {
    const db = this.dbs[dbName] as any;
    return db.getRange(opts);
  }
}
