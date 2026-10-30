// Advisory eligibility scans read bounded primary references, never vector payloads. Only their final
// enqueue is persistent; a restart may repeat a scan without changing data or a durable training attempt.
import type { SqliteDatabase } from './database.ts';
import type { SqliteIndexJob } from './index-builds.ts';
import { EXACT_VECTOR_CHUNK_LIMIT, NATIVE_VECTOR_OWNER_TARGET } from './vector-policy.ts';

interface Scan {
  generation: number;
  revision: number;
  through: number;
  after: number;
  live: number;
  owners: ReadonlySet<number>;
}
export interface SqliteAdmissionStep { progressed: boolean; accept(): void }

export class SqliteVectorAdmission {
  private readonly db: SqliteDatabase;
  private revision = 0;
  private dependencies: ReadonlyMap<string, ReadonlySet<number>>;
  private readonly dirty = new Map<number, number>();
  private readonly registered = new Set<number>();
  private externalVersion: number;
  private scan?: Scan;
  constructor(db: SqliteDatabase) {
    this.db = db; this.dependencies = db.indexBuilds.nativeAdmissionDependencies;
    this.externalVersion = Number(db.get('PRAGMA data_version')!.data_version);
    this.mark(this.dependencies.get('all'));
  }
  private mark(generations?: ReadonlySet<number>): void {
    if (!generations?.size) return;
    const revision = ++this.revision;
    for (const generation of generations ?? []) if (!this.registered.has(generation)) this.dirty.set(generation, revision);
  }
  /** A committed schema/rebuild can change generations without changing the logical sequence. */
  invalidate(dependencies: ReadonlyMap<string, ReadonlySet<number>>): void {
    this.dependencies = dependencies; this.registered.clear(); this.dirty.clear(); this.scan = undefined;
    this.mark(dependencies.get('all'));
  }
  committed(changes: ReadonlySet<string>): void {
    for (const key of changes) this.mark(this.dependencies.get(key));
  }
  hasWork(): boolean {
    // Other connections cannot supply precise mutation tags. Conservatively recheck when polled;
    // same-connection commits leave data_version unchanged and use generation-specific tags above.
    const version = Number(this.db.get('PRAGMA data_version')!.data_version);
    if (version !== this.externalVersion) {
      this.externalVersion = version; this.registered.clear(); this.mark(this.dependencies.get('all'));
    }
    return this.scan !== undefined || this.dirty.size > 0;
  }
  step(enqueue: (job: SqliteIndexJob) => void): SqliteAdmissionStep {
    if (!this.hasWork()) return { progressed: false, accept: () => {} };
    let scan = this.scan;
    if (!scan) {
      const generation = this.dirty.keys().next().value!;
      const revision = this.dirty.get(generation)!;
      const row = this.db.get(`SELECT b.type,b.name,b.state,t.state model_state FROM index_builds b
        LEFT JOIN vector_training t ON t.generation=b.generation WHERE b.generation=? AND b.kind='vector'`, [generation]);
      if (!row || row.model_state !== null || row.state === 'failed') return { progressed: true, accept: () => {
        this.registered.add(generation); this.dirty.delete(generation);
      } };
      if (row.state !== 'ready') return { progressed: false, accept: () => {} };
      const through = Number(this.db.get(`SELECT embedding_id id FROM chunks INDEXED BY chunk_native_admission
        WHERE generation=? AND embedding_id IS NOT NULL ORDER BY embedding_id DESC LIMIT 1`, [generation])?.id ?? 0);
      scan = { generation, revision, through, after: 0, live: 0, owners: new Set() };
    }
    // LIMIT precedes the live-owner join: a generation of trashed chunks is still bounded per turn.
    const rows = this.db.all(`WITH admission_page AS MATERIALIZED (
      SELECT embedding_id,entity_id FROM chunks INDEXED BY chunk_native_admission
      WHERE generation=? AND embedding_id IS NOT NULL AND embedding_id>? AND embedding_id<=?
      ORDER BY embedding_id LIMIT 128)
      SELECT p.embedding_id id,e.seq owner,e.trashed FROM admission_page p
      JOIN entities e ON e.id=p.entity_id ORDER BY p.embedding_id`, [scan.generation, scan.after, scan.through]);
    const owners = new Set(scan.owners);
    let live = scan.live, after = scan.after;
    for (const row of rows) {
      if (!Number.isSafeInteger(row.id) || row.id < 1 || !Number.isSafeInteger(row.owner) || row.owner < 1)
        throw Object.assign(new Error('Invalid native admission identity'), { code: 'CORRUPT' });
      after = row.id;
      if (row.trashed === 0) {
        live = Math.min(EXACT_VECTOR_CHUNK_LIMIT + 1, live + 1);
        if (owners.size < NATIVE_VECTOR_OWNER_TARGET) owners.add(row.owner);
      }
    }
    const eligible = live > EXACT_VECTOR_CHUNK_LIMIT && owners.size >= NATIVE_VECTOR_OWNER_TARGET;
    if (eligible) {
      const row = this.db.get('SELECT type,name FROM index_builds WHERE generation=?', [scan.generation])!;
      enqueue(this.db.indexBuilds.index(String(row.type), 'vector', String(row.name)));
    }
    const next = { ...scan, after, live, owners };
    const complete = eligible || rows.length < 128 || after >= scan.through;
    // A refused COMMIT must retry the same page/enqueue. Continuous relevant commits mark another
    // pass without resetting this finite range; unrelated generations are not scanned.
    return { progressed: true, accept: () => {
      this.scan = complete ? undefined : next;
      if (eligible) { this.registered.add(next.generation); this.dirty.delete(next.generation); }
      else if (complete && this.dirty.get(next.generation) === next.revision) this.dirty.delete(next.generation);
    } };
  }
}
